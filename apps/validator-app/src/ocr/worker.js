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
 * Resolve where bundled `spa.traineddata` lives.
 * Packaged: under `process.resourcesPath` (declared in electron-builder extraResources).
 * Dev:      at the app root (`apps/validator-app/spa.traineddata`).
 */
function resolveTrainedDataDir() {
  const isPackaged = process && (process.resourcesPath && !process.defaultApp);
  if (isPackaged) {
    const p = process.resourcesPath;
    if (fs.existsSync(path.join(p, 'spa.traineddata'))) return p;
  }
  const devPath = path.join(__dirname, '..', '..');
  if (fs.existsSync(path.join(devPath, 'spa.traineddata'))) return devPath;
  return null;
}

async function initOCRWorker(sendToRenderer) {
  if (ocrWorker) return ocrWorker;
  if (ocrInitializing) return null;
  ocrInitializing = true;
  try {
    const Tesseract = require('tesseract.js');
    const trainedDataDir = resolveTrainedDataDir();
    const workerOptions = { logger: () => {} };
    if (trainedDataDir) {
      // Use bundled traineddata — no network round-trip on first run.
      workerOptions.langPath = trainedDataDir;
      workerOptions.cachePath = trainedDataDir;
      workerOptions.cacheMethod = 'readOnly';
      workerOptions.gzip = false;
      logger.info('OCR', `Using bundled traineddata from ${trainedDataDir}`);
    } else {
      logger.warn('OCR', 'Bundled spa.traineddata not found — Tesseract will fetch from CDN');
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
      await worker.setParameters({
        tessedit_pageseg_mode: String(variant.psm),
      });

      const { data } = await recognizeWithTimeout(worker, variant.buffer);
      const text = data.text || '';
      const confidence = (data.confidence || 0) / 100;

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

  // If multi-pass found something, try merging amount from sparse pass
  if (bestResult && variants.length > 1 && !workerFailed && worker) {
    for (const variant of variants) {
      if (variant.name === bestResult.method) continue;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: String(variant.psm) });
        const { data } = await recognizeWithTimeout(worker, variant.buffer);
        const text = data.text || '';

        const amountMatch = text.match(/\$\s*([\d.]+(?:,\d{2})?)\s/);
        const bestHasAmount = bestResult.text.match(/\$\s*([\d.]+(?:,\d{2})?)\s/);

        if (amountMatch && !bestHasAmount) {
          bestResult.text = amountMatch[0].trim() + '\n' + bestResult.text;
          bestResult.method += '+' + variant.name;
          logger.info('OCR', `Merged amount "$${amountMatch[1]}" from variant "${variant.name}"`);
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
