/**
 * PDF → imagen (primera página), compartido entre la app de escritorio y el
 * modo servidor (headless.js).
 *
 * Dos motores:
 * - pdf-to-png-converter (pdfjs + @napi-rs/canvas): multiplataforma. Es el único
 *   que se usa en Linux y el primario en Windows.
 * - pdf-poppler: binario empaquetado, sólo existe para darwin/win32. OJO: en
 *   cualquier otra plataforma su `require` llama a `process.exit(1)` (no es un
 *   throw, el try/catch no lo frena), así que se carga perezosamente y nunca
 *   fuera de esas dos plataformas.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let pdfToPng = null;
try { ({ pdfToPng } = require('pdf-to-png-converter')); } catch (_) {}

const POPPLER_PLATFORMS = new Set(['darwin', 'win32']);
let pdfPoppler; // undefined = todavía no se intentó cargar
function getPoppler() {
  if (pdfPoppler !== undefined) return pdfPoppler;
  pdfPoppler = null;
  if (!POPPLER_PLATFORMS.has(process.platform)) return null;
  try { pdfPoppler = require('pdf-poppler'); } catch (_) {}
  return pdfPoppler;
}

/**
 * @param {object} [opts]
 * @param {() => string|null} [opts.getTempDir] directorio de trabajo para poppler
 * @param {object} [opts.log] logger con info/warn (default console)
 */
function createPdfConverter(opts = {}) {
  const log = opts.log || { info: console.log, warn: console.warn };
  const getTempDir = opts.getTempDir || (() => null);

  async function renderWithPdfJs(pdfBuffer) {
    if (!pdfToPng) throw new Error('pdf-to-png-converter not available');
    const t0 = Date.now();
    // viewportScale 2.0 → A4 (595×842pt) renderiza a ~1190×1684px, mucho mejor para OCR
    // que el scale=1024 de poppler. Comprobantes MP móviles típicos quedan en ~900-1200px.
    const pages = await pdfToPng(pdfBuffer, {
      pagesToProcess: [1],
      viewportScale: 2.0,
      disableFontFace: true,
      useSystemFonts: false,
      verbosityLevel: 0,
    });
    if (!pages || !pages[0] || !pages[0].content) {
      throw new Error('pdf-to-png-converter returned no page content');
    }
    const base64 = pages[0].content.toString('base64');
    log.info(`PDF→PNG via pdfjs in ${Date.now() - t0}ms (${pages[0].width}×${pages[0].height}, ${base64.length} chars)`);
    return base64;
  }

  async function renderWithPoppler(pdfBuffer) {
    const poppler = getPoppler();
    if (!poppler) throw new Error('pdf-poppler not available');
    const tempDir = path.join(getTempDir() || os.tmpdir(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const timestamp = Date.now();
    const tempPdfPath = path.join(tempDir, `proof_${timestamp}.pdf`);

    const t0 = Date.now();
    try {
      fs.writeFileSync(tempPdfPath, pdfBuffer);

      await poppler.convert(tempPdfPath, {
        format: 'png',
        out_dir: tempDir,
        out_prefix: `proof_${timestamp}`,
        page: 1,
        // 2048 producía PNGs de 30-60s en comprobantes MP normales; 1024 sigue siendo
        // más que suficiente para OCR y baja el tiempo de conversión 3-4x.
        scale: 1024,
      });

      const pngFiles = fs.readdirSync(tempDir).filter(f =>
        f.startsWith(`proof_${timestamp}`) && f.endsWith('.png')
      );
      if (pngFiles.length === 0) throw new Error('No PNG output from pdf-poppler');

      const pngPath = path.join(tempDir, pngFiles[0]);
      const imageBase64 = fs.readFileSync(pngPath).toString('base64');

      try { fs.unlinkSync(tempPdfPath); } catch (_) {}
      try { fs.unlinkSync(pngPath); } catch (_) {}

      log.info(`PDF→PNG via poppler in ${Date.now() - t0}ms (${imageBase64.length} chars)`);
      return imageBase64;
    } catch (error) {
      try { fs.unlinkSync(tempPdfPath); } catch (_) {}
      throw error;
    }
  }

  async function convertPdfToImage(base64Pdf) {
    const pdfBuffer = Buffer.from(base64Pdf, 'base64');

    // En Windows el pdftocairo 0.51 empaquetado por pdf-poppler (binario de 2016)
    // renderiza mal PDFs MP modernos → el OCR no encuentra datos y marca el
    // comprobante como inválido. Por eso pdfjs va primero ahí. En macOS (poppler
    // 0.66) poppler sigue primario para no cambiar lo que viene andando. En Linux
    // poppler no existe: sólo pdfjs.
    let order;
    if (process.platform === 'darwin') order = [renderWithPoppler, renderWithPdfJs];
    else if (process.platform === 'win32') order = [renderWithPdfJs, renderWithPoppler];
    else order = [renderWithPdfJs];

    const errors = [];
    for (const render of order) {
      try {
        return await render(pdfBuffer);
      } catch (err) {
        errors.push(err.message);
        log.warn(`PDF renderer failed (${err.message})${errors.length < order.length ? ', trying fallback' : ''}`);
      }
    }
    throw new Error(`PDF render failed — ${errors.join('; ')}`);
  }

  return { convertPdfToImage };
}

module.exports = { createPdfConverter };
