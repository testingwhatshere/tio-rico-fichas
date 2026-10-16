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
 * Variantes de preprocesado para el OCR de varias pasadas, en el orden en que se
 * prueban. Cada una se arma recién cuando se la pide (`getBuffer`, memoizado):
 * armarlas todas de entrada costaba más que el OCR mismo en una CPU chica, y la
 * mayoría de los comprobantes se resuelven con la primera pasada (corte temprano).
 * Los parámetros de cada variante son los mismos de siempre.
 *
 * @param {Buffer} imageBuffer — Raw image buffer
 * @returns {Promise<Array<{name: string, psm: number, getBuffer: () => Promise<Buffer>}>>}
 */
async function generateOCRVariantsLazy(imageBuffer) {
  const fija = (name, buffer, psm) => ({ name, psm, getBuffer: async () => buffer });

  if (!sharp) {
    return [fija('original', imageBuffer, 6)];
  }

  // Skip preprocessing for very small images (likely already processed)
  if (imageBuffer.length < 500) {
    logger.info('OCR', 'Image too small for preprocessing, using original');
    return [fija('original', imageBuffer, 6)];
  }

  let metaPromise = null;
  const meta = () => (metaPromise ??= sharp(imageBuffer).metadata());

  const lazy = (name, psm, build) => {
    let promise = null;
    return {
      name,
      psm,
      getBuffer: () => {
        if (!promise) {
          promise = build().catch((err) => {
            logger.warn('OCR', `${name} variant failed: ${err.message}`);
            throw err;
          });
        }
        return promise;
      },
    };
  };

  const variants = [];

  // Modo oscuro (AstroPay "Prueba de pago", 2026-10): las etiquetas y la fecha van en gris
  // medio sobre una tarjeta casi negra. Ninguna variante de abajo las lee — o el threshold
  // las funde con el fondo, o Tesseract las descarta por bajo contraste — y sin "Enviado
  // por", "Receptor" ni "Coelsa ID" los patterns no tienen de dónde agarrarse. Estirando
  // el rango oscuro (fondo ~35 → 0, gris ~110 → ~150) e invirtiendo, sale el comprobante
  // entero. Va primera para que el corte temprano la pueda usar, y sólo en imágenes
  // oscuras: en las claras no aporta y serían 3s más por comprobante.
  if (await esModoOscuro(imageBuffer)) {
    variants.push(lazy('dark-stretch', 4, async () => { // PSM 4 = una columna
      const m = await meta();
      return sharp(imageBuffer)
        .resize(Math.min((m.width || 720) * 2, 1600), null, { fit: 'inside', withoutEnlargement: false })
        .grayscale()
        .linear(2.2, -100)
        .negate()
        .png()
        .toBuffer();
    }));
  }

  // Always try the original image first — preprocessing sometimes destroys
  // detail (small text, thin strokes) that Tesseract could otherwise read.
  variants.push(fija('original', imageBuffer, 3)); // PSM 3 = auto layout

  // Texto gris claro sobre fondo claro (Brubank, 2026-10): la fecha va en gris ~#aaa sobre
  // lila y ninguna variante la leía — el normalize+threshold(140) de las demás la funde con
  // el fondo. Un umbral alto sin normalize la deja negra y nítida (probado 190–225: todos
  // leen fecha y monto; 205 queda en el medio). Va segunda: si la original ya leyó todo,
  // el corte temprano no llega a correrla.
  variants.push(lazy('light-gray', 6, () => sharp(imageBuffer)
    .resize(1400, null, { fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .threshold(205)
    .png()
    .toBuffer()));

  // Variant 1: Standard (good for document-style receipts)
  variants.push(lazy('standard', 6, () => sharp(imageBuffer)
    .resize(1200, null, { fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .threshold(140)
    .png()
    .toBuffer()));

  // Variant 2: High contrast (better for large bold text like amounts)
  variants.push(lazy('high-contrast', 11, () => sharp(imageBuffer) // PSM 11 = sparse text
    .resize(1400, null, { fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .normalize()
    .linear(1.8, -50) // Increase contrast aggressively
    .sharpen({ sigma: 2.0 })
    .threshold(120) // Lower threshold captures more dark text
    .png()
    .toBuffer()));

  // Variant 3: Inverted (catches text that's light on dark background)
  variants.push(lazy('inverted', 6, () => sharp(imageBuffer)
    .resize(1200, null, { fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .normalize()
    .negate() // Invert colors
    .threshold(140)
    .png()
    .toBuffer()));

  // Variant 4: Downscale (paradoxically, *very large* fonts read better when shrunk —
  // Tesseract's LSTM was trained on small text and gets confused by huge bold characters).
  variants.push(lazy('downscale', 6, () => sharp(imageBuffer)
    .resize(800, null, { fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.2 })
    .threshold(140)
    .png()
    .toBuffer()));

  // Variant 5: Number-focused (PSM 7 single line + heavy contrast — optimized for the
  // bold amount line). Whitelist is applied in worker.js when name='number-focused'.
  variants.push(lazy('number-focused', 11, () => sharp(imageBuffer)
    .resize(1600, null, { fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .normalize()
    .linear(2.0, -80) // Very high contrast
    .sharpen({ sigma: 2.5 })
    .threshold(100)
    .png()
    .toBuffer()));

  // Variant 6: Top-half crop @ high zoom — MP/MercadoPago renders the headline
  // amount in huge bold font in the upper portion of the receipt. By cropping
  // and zooming, we give Tesseract a clearer shot at it without the rest of the
  // page noise.
  const m = await meta().catch(() => ({}));
  if (m.width && m.height) {
    variants.push(lazy('top-half-zoom', 6, () => sharp(imageBuffer)
      .extract({ left: 0, top: 0, width: m.width, height: Math.floor(m.height * 0.55) })
      .resize(2400, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .linear(1.6, -40)
      .sharpen({ sigma: 2.0 })
      .threshold(130)
      .png()
      .toBuffer()));
  }

  // Variant 6b: Native-resolution negate + high threshold.
  // Caso: texto blanco bold sobre header coloreado (MP modern, Itaú, MODO, etc.).
  // El grid-search del 2026-06-27 mostró que las únicas variants que extraen
  // el monto del header son las que NO redimensionan + threshold ≥160 post-negate.
  // El LSTM de Tesseract se degrada con fuentes >100px, así que cualquier resize
  // que agrande el monto bold lo hace ilegible. La imagen nativa (~420px) lo
  // mantiene en un tamaño cómodo para el modelo.
  variants.push(lazy('native-negate', 6, () => sharp(imageBuffer)
    .grayscale()
    .negate()
    .threshold(180)
    .png()
    .toBuffer()));

  // Variant 6c: idem pero threshold más bajo, en caso que el gradient sea
  // más oscuro (Itaú top naranja, MODO azul institucional) y necesite cortar
  // antes para no fundir fondo+texto.
  variants.push(lazy('native-negate-soft', 6, () => sharp(imageBuffer)
    .grayscale()
    .negate()
    .threshold(160)
    .png()
    .toBuffer()));

  // Variant 7: digits-only PSM 7 (single line treated as one text line).
  // Aggressive zoom + strict whitelist (applied in worker.js when name starts with
  // 'digits-only'). Designed for the case where the amount is rendered alone on
  // its own visual line in a custom font.
  variants.push(lazy('digits-only', 7, () => sharp(imageBuffer)
    .resize(2000, null, { fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .normalize()
    .linear(1.8, -60)
    .sharpen({ sigma: 2.0 })
    .threshold(140)
    .png()
    .toBuffer()));

  return variants;
}

/**
 * Igual que generateOCRVariantsLazy pero con todos los buffers ya armados
 * (`buffer`). Lo usan las herramientas de tools/; las que fallan se omiten.
 *
 * @param {Buffer} imageBuffer — Raw image buffer
 * @returns {Promise<Array<{name: string, buffer: Buffer, psm: number}>>}
 */
async function generateOCRVariants(imageBuffer) {
  const lazy = await generateOCRVariantsLazy(imageBuffer);
  const variants = [];
  for (const v of lazy) {
    try {
      variants.push({ name: v.name, buffer: await v.getBuffer(), psm: v.psm });
    } catch (_) { /* ya logueado */ }
  }
  if (variants.length === 0) variants.push({ name: 'original', buffer: imageBuffer, psm: 6 });
  return variants;
}

/**
 * Si la mayor parte de la imagen es casi negra. Se mira una miniatura: alcanza para la
 * proporción y no cuesta nada. El 40% deja afuera los comprobantes claros con un header
 * oscuro (MP, Itaú) y agarra los de tema oscuro aunque tengan barra de estado blanca.
 */
async function esModoOscuro(imageBuffer) {
  try {
    const { data } = await sharp(imageBuffer)
      .resize(100, null, { fit: 'inside' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let oscuros = 0;
    for (const p of data) if (p < 60) oscuros++;
    return oscuros / data.length > 0.4;
  } catch {
    return false;
  }
}

function isAvailable() {
  return !!sharp;
}

module.exports = { preprocessForOCR, generateOCRVariants, generateOCRVariantsLazy, esModoOscuro, isAvailable };
