/**
 * OCR Worker — Manages Tesseract.js with preprocessing and multi-pass.
 *
 * Strategy for maximum extraction:
 * 1. Preprocess image (grayscale, contrast, binarize) via Sharp
 * 2. Run Tesseract with PSM 6 (block text) on standard variant
 * 3. Run Tesseract with PSM 11 (sparse text) on high-contrast variant
 * 4. Merge results: take the text with the most extracted fields
 */

const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const { generateOCRVariantsLazy, isAvailable: isSharpAvailable } = require('./preprocess');
const { extractAllAmounts } = require('./patterns/_helpers');

const OCR_RECOGNIZE_TIMEOUT_MS = 30000; // 30s per recognition call

let ocrWorker = null;
let ocrInitializing = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
let ocrDisabled = false;
let ocrDisabledAt = 0;
// Auto-recovery: tras 5 minutos de "disabled", reintentamos solo. Sin esto el
// validator queda inválido hasta que el operador cierre y abra la app — exactamente
// el incidente del 2026-06-24 (rechazaba todo en producción).
const OCR_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Locate `spa.traineddata` shipped with the app.
 * Packaged: under `process.resourcesPath` (declared in electron-builder extraResources).
 * Dev:      at the app root (`apps/validator-app/spa.traineddata`).
 */
function findBundledTrainedData() {
  const isPackaged = process && (process.resourcesPath && !process.defaultApp);
  const candidates = [];
  if (isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'spa.traineddata'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'spa.traineddata'));
  }
  candidates.push(path.join(__dirname, '..', '..', 'spa.traineddata'));
  candidates.push(path.join(__dirname, '..', '..', '..', 'spa.traineddata'));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Ensure traineddata is in a writable location (userData). Tesseract.js needs to
 * be able to read it from a path that resolves cleanly on Windows — copying it
 * to userData avoids issues with process.resourcesPath on portable .exe builds.
 * Returns the directory containing the file, or null if we couldn't prepare it.
 */
function ensureTrainedDataInUserData(sendToRenderer) {
  try {
    const { app } = require('electron');
    const userDataDir = app.getPath('userData');
    const targetPath = path.join(userDataDir, 'spa.traineddata');
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (stat.size > 1_000_000) {
        logger.info('OCR', `Using cached traineddata at ${userDataDir} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        return userDataDir;
      }
      // File exists but is suspiciously small — re-copy.
      logger.warn('OCR', `Cached traineddata too small (${stat.size}b), re-copying`);
    }
    const bundled = findBundledTrainedData();
    if (bundled) {
      fs.copyFileSync(bundled, targetPath);
      const copied = fs.statSync(targetPath);
      logger.info('OCR', `Copied traineddata to userData: ${(copied.size / 1024 / 1024).toFixed(1)} MB`);
      if (sendToRenderer) sendToRenderer('log', { message: 'Modelo de español copiado al cache', type: 'success' });
      return userDataDir;
    }
    logger.warn('OCR', 'No bundled traineddata found in any candidate path');
    if (sendToRenderer) sendToRenderer('log', { message: 'No se encontro el modelo de español bundleado. Tesseract intentara descargarlo.', type: 'warning' });
    return null;
  } catch (err) {
    // Fuera de Electron no hay userData (p. ej. el harness de evaluación en
    // tools/eval-corpus.js). Alcanza con apuntar Tesseract al traineddata que viene
    // en el repo: así el harness corre exactamente el mismo OCR que producción.
    const bundled = findBundledTrainedData();
    if (bundled) return path.dirname(bundled);
    logger.error('OCR', `ensureTrainedDataInUserData failed: ${err.message}`);
    return null;
  }
}

async function initOCRWorker(sendToRenderer) {
  if (ocrWorker) return ocrWorker;
  if (ocrInitializing) return null;
  ocrInitializing = true;
  try {
    const Tesseract = require('tesseract.js');
    const trainedDataDir = ensureTrainedDataInUserData(sendToRenderer);
    const workerOptions = { logger: () => {} };
    if (trainedDataDir) {
      workerOptions.langPath = trainedDataDir;
      workerOptions.cachePath = trainedDataDir;
      // 'write' so Tesseract.js can also fall back to CDN if our copy fails.
      workerOptions.cacheMethod = 'write';
      workerOptions.gzip = false;
      logger.info('OCR', `Tesseract langPath=${trainedDataDir}`);
    } else {
      logger.warn('OCR', 'Tesseract will fetch traineddata from CDN');
    }
    ocrWorker = await Tesseract.createWorker('spa', 1, workerOptions);
    const sharpStatus = isSharpAvailable() ? 'con Sharp' : 'sin Sharp';
    logger.success('OCR', `Tesseract.js worker initialized (Spanish, ${sharpStatus})`);
    if (sendToRenderer) {
      sendToRenderer('log', { message: `Lectura Inteligente inicializada (${sharpStatus})`, type: 'success' });
    }
  } catch (err) {
    logger.warn('OCR', `Failed to init Tesseract: ${err.message}`);
    ocrWorker = null;
    // Don't set permanent failure — allow retry on next call
    if (sendToRenderer) {
      sendToRenderer('log', { message: `Lectura Inteligente no disponible: ${err.message}`, type: 'warning' });
    }
  }
  ocrInitializing = false;
  return ocrWorker;
}

/**
 * Terminate and recreate the OCR worker (recovery from stuck/crashed state).
 */
async function resetOCRWorker(sendToRenderer) {
  if (ocrWorker) {
    try { await ocrWorker.terminate(); } catch (_) {}
    ocrWorker = null;
  }
  logger.info('OCR', 'Worker reset — will reinitialize on next use');
  return initOCRWorker(sendToRenderer);
}

/**
 * Run worker.recognize with a timeout to prevent hangs.
 */
async function recognizeWithTimeout(worker, buffer, timeoutMs = OCR_RECOGNIZE_TIMEOUT_MS) {
  let timer = null;
  try {
    return await Promise.race([
      worker.recognize(buffer),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`OCR recognize timeout (${timeoutMs}ms)`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ¿Alcanza el tiempo para otra pasada? Se estima con la pasada más lenta hasta
// ahora (+20%). La primera pasada siempre corre: sin ella no hay nada que decidir.
function hayTiempoParaOtraPasada(deadline, duraciones) {
  if (!deadline || duraciones.length === 0) return true;
  const estimada = Math.max(...duraciones) * 1.2;
  return Date.now() + estimada < deadline;
}

/**
 * Run OCR with preprocessing and multi-pass for best results.
 *
 * @param {Buffer} imageBuffer — Raw image buffer
 * @param {Function} sendToRenderer — For UI feedback
 * @param {object} [options]
 * @param {(text: string) => boolean} [options.yaAlcanza] — Se consulta después de cada
 *   variante con el texto que salió. Si devuelve true se corta y se usa ese resultado.
 *   Sirve para no gastar las 9 pasadas restantes cuando la primera ya leyó todo: son
 *   ~3s cada una, y el 95% de los comprobantes son legibles de entrada. Sin esta
 *   opción el comportamiento es el de siempre (todas las variantes, gana la de mejor score).
 * @returns {Promise<{text: string, confidence: number, method: string}>}
 */
async function recognizeWithMultiPass(imageBuffer, sendToRenderer, options = {}) {
  // deadline (epoch ms, opcional): no se arranca una pasada nueva si no termina
  // antes. El resultado sale con `truncated: true` y con lo leído hasta ahí.
  const { yaAlcanza, deadline } = options;
  // Auto-recovery: si pasaron 5 min desde la última desactivación, reintentamos.
  if (ocrDisabled) {
    const sinceDisabled = Date.now() - ocrDisabledAt;
    if (sinceDisabled >= OCR_RECOVERY_COOLDOWN_MS) {
      logger.info('OCR', `Auto-recovery: re-habilitando OCR tras ${Math.round(sinceDisabled / 1000)}s desactivado`);
      if (sendToRenderer) sendToRenderer('log', { message: 'Lectura Inteligente: reintentando despues del cooldown', type: 'info' });
      ocrDisabled = false;
      consecutiveFailures = 0;
      // Forzar reinicialización del worker — el viejo puede estar en estado inválido
      if (ocrWorker) {
        try { await ocrWorker.terminate(); } catch (_) {}
        ocrWorker = null;
      }
    } else {
      const remaining = Math.round((OCR_RECOVERY_COOLDOWN_MS - sinceDisabled) / 1000);
      logger.warn('OCR', `OCR aún desactivado (auto-recovery en ${remaining}s)`);
      return null;
    }
  }

  let worker = await initOCRWorker(sendToRenderer);
  if (!worker) return null;

  // Validate image size (reject >50MB to prevent memory issues)
  if (imageBuffer.length > 50 * 1024 * 1024) {
    logger.warn('OCR', `Image too large (${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB), skipping OCR`);
    return null;
  }

  // Variantes de preprocesado: cada una se arma recién antes de su pasada.
  const variants = await generateOCRVariantsLazy(imageBuffer);

  let bestResult = null;
  let bestScore = -1;
  let workerFailed = false;
  // Se guarda lo que leyó CADA variante, no sólo la ganadora. Cuesta cero (ese OCR ya se
  // corrió) y es la única forma de resolver un monto dudoso: si nueve variantes leen
  // $1.000 y una lee $51.000, la discrepancia es visible sólo mirándolas juntas.
  const variantTexts = [];
  // Texto de cada pasada de la primera vuelta, para no volver a correrla en el
  // rescate de monto de más abajo (mismos parámetros → mismo texto).
  const textoPorVariante = new Map();
  const duraciones = [];
  let truncated = false;

  for (const variant of variants) {
    if (!hayTiempoParaOtraPasada(deadline, duraciones)) {
      truncated = true;
      logger.warn('OCR', `Tope de tiempo: se cortan ${variants.length - variants.indexOf(variant)} pasadas (antes de "${variant.name}")`);
      break;
    }
    const t0 = Date.now();
    try {
      const params = {
        tessedit_pageseg_mode: String(variant.psm),
      };
      // Restrict character set for digit-targeted variants. This forces Tesseract
      // to never emit letters where digits should be — huge precision win for
      // bold/large amount text in custom fonts.
      if (variant.name === 'number-focused') {
        params.tessedit_char_whitelist = '0123456789.,$ ARSpesos';
      } else if (variant.name === 'digits-only') {
        params.tessedit_char_whitelist = '0123456789.,';
      } else {
        // Clear any previous whitelist so other variants use the full alphabet.
        params.tessedit_char_whitelist = '';
      }
      await worker.setParameters(params);

      const buffer = await variant.getBuffer();
      const { data } = await recognizeWithTimeout(worker, buffer);
      duraciones.push(Date.now() - t0);
      const text = data.text || '';
      const confidence = (data.confidence || 0) / 100;
      textoPorVariante.set(variant.name, text);

      // Log a short preview of each variant's output so we can see which
      // one actually saw the amount when debugging. Mirror to UI for operator visibility.
      const preview = text.replace(/\s+/g, ' ').slice(0, 80);
      logger.info('OCR', `Variant "${variant.name}" out: "${preview}"`);
      if (sendToRenderer) sendToRenderer('log', { message: `[${variant.name}] ${preview}`, type: 'info' });

      const score = text.length * confidence;

      logger.info('OCR', `Variant "${variant.name}" (PSM ${variant.psm}): ${text.length} chars, ${Math.round(confidence * 100)}% conf, score=${Math.round(score)}`);

      if (score > bestScore) {
        bestScore = score;
        bestResult = { text, confidence, method: variant.name };
      }

      if (text) {
        variantTexts.push({ name: variant.name, text, confidence });
      }

      // Corte temprano: si esta variante ya leyó el comprobante entero, las que faltan
      // no pueden mejorar el resultado, sólo sumar segundos de espera al usuario.
      if (yaAlcanza && bestResult && bestResult.method === variant.name && yaAlcanza(text)) {
        const restantes = variants.length - variants.indexOf(variant) - 1;
        logger.info('OCR', `Corte temprano en "${variant.name}": comprobante leído completo, se saltean ${restantes} variantes`);
        break;
      }
    } catch (err) {
      logger.warn('OCR', `Variant "${variant.name}" failed: ${err.message}`);
      // If timeout or crash, reset worker and stop trying more variants
      if (err.message.includes('timeout') || err.message.includes('terminated')) {
        logger.warn('OCR', 'Worker appears stuck/crashed — resetting');
        worker = await resetOCRWorker(sendToRenderer);
        workerFailed = true;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          ocrDisabled = true;
          ocrDisabledAt = Date.now();
          logger.error('OCR', `OCR disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — auto-recovery in ${OCR_RECOVERY_COOLDOWN_MS / 1000}s`);
          if (sendToRenderer) sendToRenderer('log', { message: `Lectura Inteligente desactivada por fallos. Reintenta en ${Math.round(OCR_RECOVERY_COOLDOWN_MS / 60000)} min.`, type: 'error' });
        }
        break;
      }
    }
  }

  // Reset failure counter on success
  if (bestResult) consecutiveFailures = 0;

  // If multi-pass found something, try merging amount from other passes that
  // saw a clearer number than the best-scoring variant.
  //
  // Quién "tiene monto" lo decide `extractAllAmounts`, el mismo extractor que corre
  // después sobre el texto final. Antes se usaba una regex propia que exigía un `$`
  // literal, y eso hacía lo contrario de lo que promete el nombre: un titular leído como
  // "s1.000" (el `$` sale como letra en la fuente grande) no matcheaba, así que la
  // variante buena contaba como "sin monto" y se le inyectaba arriba el número de otra
  // variante — típicamente `number-focused`, que en ese comprobante corría con 5% de
  // confianza. El monto inyectado ganaba y el pedido se aprobaba por el valor equivocado.
  //
  // Con el extractor real, si la mejor variante ya vio un monto no se toca nada.
  if (bestResult && variants.length > 1 && !workerFailed && worker) {
    const bestHasAmount = extractAllAmounts(bestResult.text).length > 0;
    if (bestHasAmount) {
      logger.info('OCR', 'Merge de monto innecesario: la mejor variante ya trae monto');
    } else {
      for (const variant of variants) {
        if (variant.name === bestResult.method) continue;
        // Ya leída en la primera vuelta con los mismos parámetros: se usa ese texto.
        // digits-only es la excepción: acá corre SIN su whitelist (ver abajo), así
        // que su texto sería otro y se sigue corriendo como siempre.
        if (variant.name !== 'digits-only' && textoPorVariante.has(variant.name)) {
          const linea = textoPorVariante.get(variant.name).split('\n').find((l) => extractAllAmounts(l).length > 0);
          if (linea) {
            bestResult.text = linea.trim() + '\n' + bestResult.text;
            bestResult.method += '+' + variant.name;
            logger.info('OCR', `Merged amount line "${linea.trim()}" from variant "${variant.name}" (texto ya leído)`);
            break;
          }
          continue;
        }
        if (!hayTiempoParaOtraPasada(deadline, duraciones)) {
          truncated = true;
          logger.warn('OCR', 'Tope de tiempo: se corta el rescate de monto entre variantes');
          break;
        }
        const t0 = Date.now();
        try {
          const params = { tessedit_pageseg_mode: String(variant.psm) };
          if (variant.name === 'number-focused') {
            params.tessedit_char_whitelist = '0123456789.,$ ARSpesos';
          } else {
            params.tessedit_char_whitelist = '';
          }
          await worker.setParameters(params);
          const buffer = await variant.getBuffer();
          const { data } = await recognizeWithTimeout(worker, buffer);
          duraciones.push(Date.now() - t0);
          const text = data.text || '';

          // Se rescata la línea donde esa variante vio el monto, no el texto entero:
          // el resto de esa lectura es peor que la que ya tenemos.
          const linea = text.split('\n').find((l) => extractAllAmounts(l).length > 0);
          if (linea) {
            bestResult.text = linea.trim() + '\n' + bestResult.text;
            bestResult.method += '+' + variant.name;
            logger.info('OCR', `Merged amount line "${linea.trim()}" from variant "${variant.name}"`);
            break;
          }
        } catch {}
      }
    }
  }

  // Reset to default PSM
  if (worker) {
    try { await worker.setParameters({ tessedit_pageseg_mode: '6' }); } catch {}
  }

  if (bestResult) {
    bestResult.variantTexts = variantTexts;
    bestResult.passes = duraciones.length;
    bestResult.truncated = truncated;
  } else if (truncated || duraciones.length > 0) {
    // Corrió pero no salió texto útil: se distingue de "OCR no disponible" (null).
    return { text: '', confidence: 0, method: 'none', variantTexts, passes: duraciones.length, truncated };
  }
  return bestResult;
}

/**
 * La memoria del worker de Tesseract (WASM) crece con cada imagen grande y nunca
 * se devuelve: en un contenedor de 512 MB terminaba matado por falta de memoria
 * cada ~25 comprobantes. Si el proceso pasa `limiteMb`, se descarta el worker
 * (libera toda esa memoria) y el próximo comprobante arma uno nuevo (<1 s).
 * Se llama ENTRE comprobantes, nunca durante uno.
 */
async function reciclarSiPasa(limiteMb) {
  if (!ocrWorker || !(limiteMb > 0)) return false;
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);
  if (rssMb <= limiteMb) return false;
  try { await ocrWorker.terminate(); } catch (_) {}
  ocrWorker = null;
  const despuesMb = Math.round(process.memoryUsage().rss / 1048576);
  logger.info('MEMORY', `Worker de OCR reciclado (${rssMb} MB > ${limiteMb} MB, queda ${despuesMb} MB)`);
  return true;
}

function resetOCRDisabled() {
  ocrDisabled = false;
  ocrDisabledAt = 0;
  consecutiveFailures = 0;
  logger.info('OCR', 'OCR re-enabled manually');
}

function getOCRStatus() {
  return {
    disabled: ocrDisabled,
    disabledAt: ocrDisabledAt || null,
    consecutiveFailures,
    autoRecoveryAt: ocrDisabled ? ocrDisabledAt + OCR_RECOVERY_COOLDOWN_MS : null,
  };
}

module.exports = { initOCRWorker, resetOCRWorker, recognizeWithMultiPass, resetOCRDisabled, getOCRStatus, reciclarSiPasa };
