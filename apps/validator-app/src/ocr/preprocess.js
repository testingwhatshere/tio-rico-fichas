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
  if (imageBuffer.length < 500) {
    logger.info('OCR', 'Image too small for preprocessing, using original');
    return [{ name: 'original', buffer: imageBuffer, psm: 6 }];
  }

  const variants = [];

  // Always try the original image first — preprocessing sometimes destroys
  // detail (small text, thin strokes) that Tesseract could otherwise read.
  variants.push({ name: 'original', buffer: imageBuffer, psm: 3 }); // PSM 3 = auto layout

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

  try {
    // Variant 4: Downscale (paradoxically, *very large* fonts read better when shrunk —
    // Tesseract's LSTM was trained on small text and gets confused by huge bold characters).
    const downscale = await sharp(imageBuffer)
      .resize(800, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2 })
      .threshold(140)
      .png()
      .toBuffer();
    variants.push({ name: 'downscale', buffer: downscale, psm: 6 });
  } catch (err) {
    logger.warn('OCR', `Downscale variant failed: ${err.message}`);
  }

  try {
    // Variant 5: Number-focused (PSM 7 single line + heavy contrast — optimized for the
    // bold amount line). Whitelist is applied in worker.js when name='number-focused'.
    const numberFocused = await sharp(imageBuffer)
      .resize(1600, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .linear(2.0, -80) // Very high contrast
      .sharpen({ sigma: 2.5 })
      .threshold(100)
      .png()
      .toBuffer();
    variants.push({ name: 'number-focused', buffer: numberFocused, psm: 11 });
  } catch (err) {
    logger.warn('OCR', `Number-focused variant failed: ${err.message}`);
  }

  // Variant 6: Top-half crop @ high zoom — MP/MercadoPago renders the headline
  // amount in huge bold font in the upper portion of the receipt. By cropping
  // and zooming, we give Tesseract a clearer shot at it without the rest of the
  // page noise.
  try {
    const meta = await sharp(imageBuffer).metadata();
    if (meta.width && meta.height) {
      const topHalf = await sharp(imageBuffer)
        .extract({ left: 0, top: 0, width: meta.width, height: Math.floor(meta.height * 0.55) })
        .resize(2400, null, { fit: 'inside', withoutEnlargement: false })
        .grayscale()
        .normalize()
        .linear(1.6, -40)
        .sharpen({ sigma: 2.0 })
        .threshold(130)
        .png()
        .toBuffer();
      variants.push({ name: 'top-half-zoom', buffer: topHalf, psm: 6 });
    }
  } catch (err) {
    logger.warn('OCR', `Top-half-zoom variant failed: ${err.message}`);
  }

  // Variant 6b: Native-resolution negate + high threshold.
  // Caso: texto blanco bold sobre header coloreado (MP modern, Itaú, MODO, etc.).
  // El grid-search del 2026-06-27 mostró que las únicas variants que extraen
  // el monto del header son las que NO redimensionan + threshold ≥160 post-negate.
  // El LSTM de Tesseract se degrada con fuentes >100px, así que cualquier resize
  // que agrande el monto bold lo hace ilegible. La imagen nativa (~420px) lo
  // mantiene en un tamaño cómodo para el modelo.
  try {
    const nativeNegate = await sharp(imageBuffer)
      .grayscale()
      .negate()
      .threshold(180)
      .png()
      .toBuffer();
    variants.push({ name: 'native-negate', buffer: nativeNegate, psm: 6 });
  } catch (err) {
    logger.warn('OCR', `Native-negate variant failed: ${err.message}`);
  }

  // Variant 6c: idem pero threshold más bajo, en caso que el gradient sea
  // más oscuro (Itaú top naranja, MODO azul institucional) y necesite cortar
  // antes para no fundir fondo+texto.
  try {
    const nativeNegateSoft = await sharp(imageBuffer)
      .grayscale()
      .negate()
      .threshold(160)
      .png()
      .toBuffer();
    variants.push({ name: 'native-negate-soft', buffer: nativeNegateSoft, psm: 6 });
  } catch (err) {
    logger.warn('OCR', `Native-negate-soft variant failed: ${err.message}`);
  }

  // Variant 7: digits-only PSM 7 (single line treated as one text line).
  // Aggressive zoom + strict whitelist (applied in worker.js when name starts with
  // 'digits-only'). Designed for the case where the amount is rendered alone on
  // its own visual line in a custom font.
  try {
    const digitsOnly = await sharp(imageBuffer)
      .resize(2000, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .linear(1.8, -60)
      .sharpen({ sigma: 2.0 })
      .threshold(140)
      .png()
      .toBuffer();
    variants.push({ name: 'digits-only', buffer: digitsOnly, psm: 7 });
  } catch (err) {
    logger.warn('OCR', `Digits-only variant failed: ${err.message}`);
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
