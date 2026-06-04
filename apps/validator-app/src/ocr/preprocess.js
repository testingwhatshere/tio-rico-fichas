/**
 * Image preprocessing for OCR — improves Tesseract accuracy.
 *
 * Problems with raw screenshots:
 * - Large bold text (amounts) → Tesseract skips or misreads
 * - Colored backgrounds → reduces contrast
 * - High resolution → wastes processing time
 * - App UI elements → noise in OCR
 *
 * Solutions:
 * 1. Resize to standard width (maintain aspect ratio)
 * 2. Convert to grayscale
 * 3. Increase contrast (normalize)
 * 4. Binarize (threshold to pure B&W)
 * 5. Optional: sharpen text edges
 */

const logger = require('../logger');

let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  console.warn('[Preprocess] sharp not available — preprocessing disabled');
}

/**
 * Preprocess an image buffer for better OCR results.
 * Returns a new buffer optimized for Tesseract.
 *
 * @param {Buffer} imageBuffer — Raw image buffer (PNG, JPG, WebP)
 * @returns {Promise<Buffer>} — Preprocessed PNG buffer
 */
async function preprocessForOCR(imageBuffer) {
  if (!sharp) return imageBuffer; // Fallback: return as-is

  try {
    const processed = await sharp(imageBuffer)
      // 1. Resize to standard width (1200px) — reduces noise, normalizes scale
      .resize(1200, null, { fit: 'inside', withoutEnlargement: false })
      // 2. Grayscale — removes color distractions
      .grayscale()
      // 3. Normalize — stretches contrast to full range (helps with light text)
      .normalize()
      // 4. Sharpen — makes text edges crisper
      .sharpen({ sigma: 1.5 })
      // 5. Threshold — binarize to pure B&W (threshold at 128)
      //    This is the key step for large bold text!
      .threshold(140)
      // Output as PNG (lossless)
      .png()
      .toBuffer();

    logger.info('OCR', `Preprocessed image: ${imageBuffer.length} → ${processed.length} bytes`);
    return processed;
  } catch (err) {
    logger.warn('OCR', `Preprocessing failed: ${err.message} — using original`);
    return imageBuffer;
  }
}

/**
 * Generate multiple preprocessed variants for multi-pass OCR.
 * Each variant is optimized for different text types.
 *
 * @param {Buffer} imageBuffer — Raw image buffer
 * @returns {Promise<Array<{name: string, buffer: Buffer, psm: number}>>}
 */
async function generateOCRVariants(imageBuffer) {
  if (!sharp) {
    return [{ name: 'original', buffer: imageBuffer, psm: 6 }];
  }

  // Skip preprocessing for very small images (likely already processed)
  if (imageBuffer.length < 1000) {
    logger.info('OCR', 'Image too small for preprocessing, using original');
    return [{ name: 'original', buffer: imageBuffer, psm: 6 }];
  }

  const variants = [];

  try {
    // Variant 1: Standard (good for document-style receipts)
    const standard = await sharp(imageBuffer)
      .resize(1200, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .threshold(140)
      .png()
      .toBuffer();
    variants.push({ name: 'standard', buffer: standard, psm: 6 });
  } catch (err) {
    logger.warn('OCR', `Standard variant failed: ${err.message}`);
  }

  try {
    // Variant 2: High contrast (better for large bold text like amounts)
    const highContrast = await sharp(imageBuffer)
      .resize(1400, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .linear(1.8, -50) // Increase contrast aggressively
      .sharpen({ sigma: 2.0 })
      .threshold(120) // Lower threshold captures more dark text
      .png()
      .toBuffer();
    variants.push({ name: 'high-contrast', buffer: highContrast, psm: 11 }); // PSM 11 = sparse text
  } catch (err) {
    logger.warn('OCR', `High-contrast variant failed: ${err.message}`);
  }

  try {
    // Variant 3: Inverted (catches text that's light on dark background)
    const inverted = await sharp(imageBuffer)
      .resize(1200, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .negate() // Invert colors
      .threshold(140)
      .png()
      .toBuffer();
    variants.push({ name: 'inverted', buffer: inverted, psm: 6 });
  } catch (err) {
    logger.warn('OCR', `Inverted variant failed: ${err.message}`);
  }

  // Always include original as fallback
  if (variants.length === 0) {
    variants.push({ name: 'original', buffer: imageBuffer, psm: 6 });
  }

  return variants;
}

function isAvailable() {
  return !!sharp;
}

module.exports = { preprocessForOCR, generateOCRVariants, isAvailable };
