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
const { generateOCRVariants, isAvailable: isSharpAvailable } = require('./preprocess');

const OCR_RECOGNIZE_TIMEOUT_MS = 30000; // 30s per recognition call

let ocrWorker = null;
let ocrInitializing = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
let ocrDisabled = false;

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
  return Promise.race([
    worker.recognize(buffer),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`OCR recognize timeout (${timeoutMs}ms)`)), timeoutMs)
    ),
  ]);
}

/**
 * Run OCR with preprocessing and multi-pass for best results.
 *
 * @param {Buffer} imageBuffer — Raw image buffer
 * @param {Function} sendToRenderer — For UI feedback
 * @returns {Promise<{text: string, confidence: number, method: string}>}
 */
async function recognizeWithMultiPass(imageBuffer, sendToRenderer) {
  if (ocrDisabled) return null;

  let worker = await initOCRWorker(sendToRenderer);
  if (!worker) return null;

  // Validate image size (reject >50MB to prevent memory issues)
  if (imageBuffer.length > 50 * 1024 * 1024) {
    logger.warn('OCR', `Image too large (${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB), skipping OCR`);
    return null;
  }

  // Generate preprocessed variants
  const variants = await generateOCRVariants(imageBuffer);

  let bestResult = null;
  let bestScore = -1;
  let workerFailed = false;

  for (const variant of variants) {
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

      const { data } = await recognizeWithTimeout(worker, variant.buffer);
      const text = data.text || '';
      const confidence = (data.confidence || 0) / 100;

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
          logger.error('OCR', `OCR disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
          if (sendToRenderer) sendToRenderer('log', { message: 'Lectura Inteligente desactivada por fallos repetidos. Usando Verificacion IA.', type: 'error' });
        }
        break;
      }
    }
  }

  // Reset failure counter on success
  if (bestResult) consecutiveFailures = 0;

  // If multi-pass found something, try merging amount from other passes that
  // saw a clearer number than the best-scoring variant.
  // Permissive regex: accepts OCR-confused digits ([0-9OoIlS]), spaces between
  // thousand groups, both ARS and US decimal notations.
  const AMOUNT_RE = /\$\s*([0-9OoIlS]{1,3}(?:[\s.,][0-9OoIlS]{3})*(?:[.,][0-9OoIlS]{1,2})?|[0-9OoIlS]{3,8}(?:[.,][0-9OoIlS]{1,2})?)/;
  if (bestResult && variants.length > 1 && !workerFailed && worker) {
    for (const variant of variants) {
      if (variant.name === bestResult.method) continue;
      try {
        const params = { tessedit_pageseg_mode: String(variant.psm) };
        if (variant.name === 'number-focused') {
          params.tessedit_char_whitelist = '0123456789.,$ ARSpesos';
        } else {
          params.tessedit_char_whitelist = '';
        }
        await worker.setParameters(params);
        const { data } = await recognizeWithTimeout(worker, variant.buffer);
        const text = data.text || '';

        const amountMatch = text.match(AMOUNT_RE);
        const bestHasAmount = bestResult.text.match(AMOUNT_RE);

        if (amountMatch && !bestHasAmount) {
          bestResult.text = amountMatch[0].trim() + '\n' + bestResult.text;
          bestResult.method += '+' + variant.name;
          logger.info('OCR', `Merged amount "${amountMatch[0]}" from variant "${variant.name}"`);
          break;
        }
      } catch {}
    }
  }

  // Reset to default PSM
  if (worker) {
    try { await worker.setParameters({ tessedit_pageseg_mode: '6' }); } catch {}
  }

  return bestResult;
}

function resetOCRDisabled() {
  ocrDisabled = false;
  consecutiveFailures = 0;
  logger.info('OCR', 'OCR re-enabled manually');
}

module.exports = { initOCRWorker, resetOCRWorker, recognizeWithMultiPass, resetOCRDisabled };
