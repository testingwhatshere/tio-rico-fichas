#!/usr/bin/env node
/**
 * Harness de evaluación del OCR contra comprobantes reales.
 *
 * Mide qué porcentaje de cada campo logra extraer el pipeline, sobre el corpus bajado de
 * producción. Es la métrica que dice si un cambio en los patterns sirvió o no: sin esto,
 * tocar una regex es adivinar.
 *
 * Por qué importa: el `confidence` que decide si un comprobante se aprueba solo es
 * literalmente (campos extraídos / 7) — ver calculateConfidence en patterns/_helpers.js.
 * Así que "cuántos campos extraemos" ES la tasa de aprobación automática.
 *
 * El OCR se cachea en disco: es lo lento (segundos por imagen). Una vez cacheado, iterar
 * sobre los patterns es cuestión de segundos. Para re-correr sólo el parseo (lo normal
 * mientras se ajustan regex) usar --solo-parseo.
 *
 * Uso:
 *   node tools/eval-corpus.js <dir-corpus> [--limite N] [--solo-parseo] [--umbral 0.7]
 *
 * El <dir-corpus> es el que genera el script de descarga: trae un index.csv con, por cada
 * comprobante, lo que producción extrajo en su momento y cómo terminó el pedido.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const CORPUS = args.find((a) => !a.startsWith('--'));
const LIMITE = Number((args.find((a) => a.startsWith('--limite')) || '').split('=')[1] || args[args.indexOf('--limite') + 1] || 0);
const SOLO_PARSEO = args.includes('--solo-parseo');
const UMBRAL = Number((args.find((a) => a.startsWith('--umbral')) || '').split('=')[1] || 0.7);
// --parte i/n procesa sólo la porción i de n. El OCR tarda ~30s por comprobante, así que
// llenar el cache del corpus entero en un solo proceso son horas; con varias partes en
// paralelo (una por proceso, cada una con su propio worker de Tesseract) baja a minutos.
const PARTE = (args[args.indexOf('--parte') + 1] || '1/1').split('/').map(Number);
// --corte-temprano: deja de probar variantes apenas una lee monto exacto + fecha + estado,
// igual que hace `validateWithOCR` en producción. Llena el cache varias veces más rápido y
// mide lo que de verdad lee el validador, no la mejor de las 10 variantes.
const CORTE_TEMPRANO = args.includes('--corte-temprano');

if (!CORPUS || !fs.existsSync(CORPUS)) {
  console.error('Falta el directorio del corpus.\n  node tools/eval-corpus.js ~/Desktop/corpus-comprobantes-20260828');
  process.exit(1);
}

const CACHE = path.join(CORPUS, '_ocr-cache');
fs.mkdirSync(CACHE, { recursive: true });

// Silenciar el logger de la app: acá el output útil es la tabla final.
const logger = require('../src/logger');
for (const m of ['info', 'warn', 'error', 'success', 'debug']) {
  if (typeof logger[m] === 'function') logger[m] = () => {};
}

const { parseOCRText } = require('../src/ocr/parser');

/** Lee el index.csv que dejó el script de descarga. */
function leerIndice(dir) {
  const raw = fs.readFileSync(path.join(dir, 'index.csv'), 'utf8');
  const filas = [];
  let campo = '', fila = [], enComillas = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (enComillas) {
      if (c === '"' && raw[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  const cab = filas.shift();
  return filas.filter((f) => f.length === cab.length).map((f) => Object.fromEntries(cab.map((k, i) => [k, f[i]])));
}

// Los 8 campos que cuenta calculateConfidence. El orden es el de esa función.
const CAMPOS = [
  'extractedAmount', 'extractedDate', 'transactionStatus', 'senderName',
  'senderDniCuit', 'bankName', 'transactionId', 'paymentMethod',
];

async function main() {
  let filas = leerIndice(CORPUS);
  if (LIMITE > 0) filas = filas.slice(0, LIMITE);
  const [iParte, nPartes] = PARTE;
  if (nPartes > 1) {
    filas = filas.filter((_, i) => i % nPartes === iParte - 1);
    console.log(`Parte ${iParte}/${nPartes}`);
  }
  console.log(`Corpus: ${filas.length} comprobantes\nCache OCR: ${CACHE}\n`);

  let worker = null;
  if (!SOLO_PARSEO) {
    const { initOCRWorker } = require('../src/ocr/worker');
    worker = await initOCRWorker(null);
    if (!worker) {
      console.error('No se pudo inicializar Tesseract. Probá con --solo-parseo si ya hay cache.');
      process.exit(1);
    }
  }
  const { recognizeWithMultiPass } = require('../src/ocr/worker');

  const resultados = [];
  let ocrNuevos = 0, sinTexto = 0;

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const cachePath = path.join(CACHE, `${f.requestId}.txt`);
    let texto = null;

    if (fs.existsSync(cachePath)) {
      texto = fs.readFileSync(cachePath, 'utf8');
    } else if (!SOLO_PARSEO) {
      const img = path.join(CORPUS, f.archivo);
      if (fs.existsSync(img)) {
        try {
          const esperadoOcr = Number(f.montoPedido) || 0;
          const yaAlcanza = CORTE_TEMPRANO && esperadoOcr > 0
            ? (t) => {
                const c = parseOCRText(t, esperadoOcr);
                return !c.amountAmbiguous && c.extractedAmount != null &&
                  Math.abs(c.extractedAmount - esperadoOcr) <= 1 && !!c.extractedDate && !!c.transactionStatus;
              }
            : undefined;
          const ocr = await recognizeWithMultiPass(fs.readFileSync(img), null, { yaAlcanza });
          texto = (ocr && ocr.text) || '';
          fs.writeFileSync(cachePath, texto);
          ocrNuevos++;
        } catch (e) {
          texto = '';
          fs.writeFileSync(cachePath, '');
        }
      }
    }

    if (texto === null) { sinTexto++; continue; }

    const esperado = Number(f.montoPedido) || 0;
    const campos = parseOCRText(texto, esperado);
    resultados.push({ meta: f, campos, largoTexto: texto.length });

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  ${i + 1}/${filas.length} (OCR nuevos: ${ocrNuevos})\r`);
    }
  }
  console.log(`\nEvaluados: ${resultados.length}   OCR nuevos: ${ocrNuevos}   sin texto: ${sinTexto}\n`);

  // ── Extracción por campo ─────────────────────────────────────────────
  const tieneValor = (v) => v !== null && v !== undefined && v !== '';
  console.log('EXTRACCION POR CAMPO');
  console.log('  campo                  ahora     produccion');
  for (const c of CAMPOS) {
    const ahora = resultados.filter((r) => tieneValor(r.campos[c])).length;
    const prod = resultados.filter((r) => tieneValor(r.meta[c])).length;
    const pct = (n) => `${String(Math.round((100 * n) / resultados.length)).padStart(3)}%`;
    console.log(`  ${c.padEnd(20)} ${pct(ahora)}       ${pct(prod)}`);
  }

  // ── Confianza y aprobación automática ────────────────────────────────
  const conf = (r) => Math.min(1, CAMPOS.filter((c) => tieneValor(r.campos[c])).length / 7);
  const pasan = resultados.filter((r) => conf(r) >= UMBRAL).length;
  console.log(`\nCONFIANZA (umbral ${UMBRAL})`);
  const dist = {};
  for (const r of resultados) {
    const k = conf(r).toFixed(3);
    dist[k] = (dist[k] || 0) + 1;
  }
  for (const k of Object.keys(dist).sort()) {
    const marca = Number(k) >= UMBRAL ? 'pasa solo' : 'a revision';
    console.log(`  ${k}  ${String(dist[k]).padStart(5)}   ${marca}`);
  }
  console.log(`  --> aprobados solos: ${pasan}/${resultados.length} (${Math.round((100 * pasan) / resultados.length)}%)`);

  // Los COMPLETED son ground truth: sabemos que eran legítimos. Cada uno que no pasa
  // solo es un falso positivo que le cae al operador.
  const cargados = resultados.filter((r) => r.meta.status === 'COMPLETED');
  if (cargados.length) {
    const fp = cargados.filter((r) => conf(r) < UMBRAL).length;
    console.log(`\nFALSOS POSITIVOS (comprobantes que terminaron cargados y aun asi no pasarian)`);
    console.log(`  ${fp}/${cargados.length} (${Math.round((100 * fp) / cargados.length)}%)`);
  }

  // ── Por plataforma ───────────────────────────────────────────────────
  console.log('\nPOR PLATAFORMA');
  const porPlat = {};
  for (const r of resultados) {
    const p = r.campos.detectedPlatformName || 'sin detectar';
    (porPlat[p] = porPlat[p] || []).push(r);
  }
  for (const [p, rs] of Object.entries(porPlat).sort((a, b) => b[1].length - a[1].length)) {
    const rem = rs.filter((r) => tieneValor(r.campos.senderName)).length;
    const fec = rs.filter((r) => tieneValor(r.campos.extractedDate)).length;
    const ok = rs.filter((r) => conf(r) >= UMBRAL).length;
    console.log(`  ${p.padEnd(24)} n=${String(rs.length).padStart(4)}  remitente ${String(Math.round((100 * rem) / rs.length)).padStart(3)}%  fecha ${String(Math.round((100 * fec) / rs.length)).padStart(3)}%  pasan ${String(Math.round((100 * ok) / rs.length)).padStart(3)}%`);
  }

  const salida = path.join(CORPUS, '_eval-resultado.json');
  fs.writeFileSync(salida, JSON.stringify(
    resultados.map((r) => ({
      requestId: r.meta.requestId, status: r.meta.status, grupo: r.meta.grupo,
      scoreProduccion: r.meta.score, confianzaAhora: conf(r),
      plataforma: r.campos.detectedPlatformName,
      campos: Object.fromEntries(CAMPOS.map((c) => [c, r.campos[c] ?? null])),
      largoTexto: r.largoTexto,
    })), null, 1));
  console.log(`\nDetalle por comprobante: ${salida}`);

  if (worker) { try { await worker.terminate(); } catch (_) {} }
}

// El logger de la app deja un setInterval de flush corriendo, así que el proceso no
// termina solo. Como acá ya está todo escrito, se sale explícitamente.
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
