#!/usr/bin/env node
/**
 * Medición y comparación del validador en modo servidor.
 *
 * Corre el pipeline de producción (el mismo que usa src/headless.js) sobre
 * comprobantes locales, de a uno, como en producción. Sirve para dos cosas:
 *
 * 1. Medir si entra en la máquina: tiempo por comprobante (p50/p95/máx) y
 *    memoria máxima. Correrlo dentro del contenedor con los límites de Render:
 *      docker run --cpus=0.5 --memory=512m -v <corpus>:/corpus <imagen> node server/bench.js /corpus
 *
 * 2. Comparar contra lo que validó la PC: si el directorio trae el index.csv de
 *    tools/descargar-corpus.js, compara monto/fecha/estado/nro de operación con
 *    lo que guardó producción y lista los casos que cambian.
 *
 * Uso:
 *   node server/bench.js <dir|archivos...> [--limite N] [--timeout-ms 120000] [--json salida.json]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function opt(nombre, porDefecto) {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : porDefecto;
}
const LIMITE = Number(opt('limite', 0));
const TIMEOUT_MS = Number(opt('timeout-ms', 120_000));
const JSON_SALIDA = opt('json', null);
const valoresDeOpciones = new Set(['limite', 'timeout-ms', 'json'].map((o) => opt(o, null)).filter(Boolean));
const entradas = args.filter((a) => !a.startsWith('--') && !valoresDeOpciones.has(a));

if (entradas.length === 0 && !process.env.BENCH_URLS) {
  console.error('Uso: node server/bench.js <dir|archivos...> [--limite N] [--timeout-ms 120000] [--json salida.json]');
  process.exit(1);
}

// Silenciar el logger del pipeline: acá interesa el resumen.
const logger = require('../src/logger');
logger.configure({ writeFiles: false });
logger.log = () => {};
try {
  const sharp = require('sharp');
  sharp.cache(false);
  sharp.concurrency(1);
} catch (_) {}

const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** Lee el index.csv de tools/descargar-corpus.js (CSV con comillas). */
function leerIndice(dir) {
  const archivo = path.join(dir, 'index.csv');
  if (!fs.existsSync(archivo)) return null;
  const raw = fs.readFileSync(archivo, 'utf8');
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
  const [cab, ...resto] = filas;
  const porArchivo = new Map();
  for (const f of resto) {
    if (f.length < cab.length) continue;
    const obj = Object.fromEntries(cab.map((c, i) => [c, f[i]]));
    porArchivo.set(obj.archivo, obj);
  }
  return porArchivo;
}

function listarComprobantes() {
  const lista = [];
  for (const e of entradas) {
    const st = fs.statSync(e);
    if (st.isDirectory()) {
      const indice = leerIndice(e);
      for (const f of fs.readdirSync(e).sort()) {
        const ext = path.extname(f).slice(1).toLowerCase();
        if (!EXT_MIME[ext]) continue;
        lista.push({ archivo: path.join(e, f), nombre: f, prod: indice?.get(f) || null });
      }
    } else {
      lista.push({ archivo: e, nombre: path.basename(e), prod: null });
    }
  }
  return LIMITE > 0 ? lista.slice(0, LIMITE) : lista;
}

function percentil(valores, p) {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
}

const igualNum = (a, b) => a != null && b != null && a !== '' && b !== '' && Math.abs(Number(a) - Number(b)) <= 1;
const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());

/**
 * Modo Render: BENCH_URLS trae [{requestId, url, monto, pcValid}] (los
 * comprobantes no viajan dentro de la imagen). Se bajan a un directorio
 * temporal con su index.csv y se mide igual que con un corpus local.
 */
async function prepararDesdeEnv() {
  const lista = JSON.parse(process.env.BENCH_URLS);
  const dir = path.join(require('os').tmpdir(), 'bench-corpus');
  fs.mkdirSync(dir, { recursive: true });
  const filas = ['requestId,archivo,montoPedido,pcValid'];
  for (const item of lista) {
    try {
      const resp = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ct = (resp.headers.get('content-type') || '').split(';')[0];
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[ct] || 'jpg';
      const archivo = `${item.requestId}.${ext}`;
      fs.writeFileSync(path.join(dir, archivo), Buffer.from(await resp.arrayBuffer()));
      filas.push(`${item.requestId},${archivo},${Math.round(item.monto)},${item.pcValid ?? ''}`);
    } catch (err) {
      console.log(`no se pudo bajar ${item.requestId}: ${err.message}`);
    }
  }
  fs.writeFileSync(path.join(dir, 'index.csv'), filas.join('\n') + '\n');
  return dir;
}

async function main() {
  if (process.env.BENCH_URLS && entradas.length === 0) {
    entradas.push(await prepararDesdeEnv());
  }
  const { createPdfConverter } = require('../src/pdf');
  const { convertPdfToImage } = createPdfConverter({ log: { info() {}, warn() {} } });
  const { createPipeline } = require('../src/validation/pipeline');
  const { initOCRWorker, reciclarSiPasa } = require('../src/ocr/worker');
  // Igual que src/headless.js: reciclar el worker de OCR entre comprobantes.
  const RECICLAR_MB = Number(process.env.OCR_RECYCLE_RSS_MB ?? 300);

  let ultimo = null;
  const pipeline = createPipeline({
    config: { ollamaEnabled: false },
    sendToRenderer: () => {},
    convertPdfToImage,
    emitValidationResult: (_req, payload) => { ultimo = payload; },
    getOllamaAvailable: () => false,
  });

  let rssMax = 0;
  const muestreo = setInterval(() => {
    rssMax = Math.max(rssMax, process.memoryUsage().rss);
  }, 100);

  const t0Init = Date.now();
  await initOCRWorker();
  const initMs = Date.now() - t0Init;

  const comprobantes = listarComprobantes();
  console.log(`${comprobantes.length} comprobantes · timeout del backend simulado ${TIMEOUT_MS} ms · init OCR ${initMs} ms\n`);

  const filas = [];
  for (const [i, c] of comprobantes.entries()) {
    const ext = path.extname(c.nombre).slice(1).toLowerCase();
    const monto = Number(c.prod?.montoPedido) || undefined;
    const recibido = Date.now();
    const request = {
      id: `bench_${i}`,
      requestId: c.prod?.requestId || c.nombre,
      imageBase64: fs.readFileSync(c.archivo).toString('base64'),
      mimeType: EXT_MIME[ext],
      expectedAmount: monto,
      validationTimeoutMs: TIMEOUT_MS,
      // Mismo cálculo que socket/connection.js: el timeout del backend menos 15 s.
      _deadline: recibido + Math.max(TIMEOUT_MS - 15_000, 10_000),
    };
    ultimo = null;
    await pipeline.processValidationRequest(request);
    const ms = Date.now() - recibido;
    const reciclado = await reciclarSiPasa(RECICLAR_MB);
    const r = ultimo || {};
    const fila = {
      archivo: c.nombre,
      ms,
      isValid: !!r.isValid,
      flags: r.flags || [],
      extractedAmount: r.extractedAmount ?? null,
      extractedDate: r.extractedDate ?? null,
      transactionStatus: r.transactionStatus ?? null,
      transactionId: r.transactionId ?? null,
      montoPedido: monto ?? null,
      amountConsensus: r.amountConsensus ?? null,
      prod: c.prod,
    };
    filas.push(fila);
    const marca = (r.flags?.includes('OCR_TIMEOUT') ? ' TIMEOUT' : '') + (reciclado ? ' [OCR reciclado]' : '');
    const rssMb = Math.round(process.memoryUsage().rss / 1048576);
    fila.rssMb = rssMb;
    console.log(`${String(i + 1).padStart(4)} ${String(ms).padStart(6)} ms  ${fila.isValid ? 'OK ' : 'NO '} ${String(rssMb).padStart(4)} MB  ${c.nombre}${marca}`);
  }
  clearInterval(muestreo);
  rssMax = Math.max(rssMax, process.memoryUsage().rss);

  const tiempos = filas.map((f) => f.ms);
  console.log('\n── Tiempo y memoria ─────────────────────────────');
  console.log(`p50 ${percentil(tiempos, 50)} ms · p95 ${percentil(tiempos, 95)} ms · máx ${Math.max(0, ...tiempos)} ms`);
  console.log(`cortados por tiempo: ${filas.filter((f) => f.flags.includes('OCR_TIMEOUT')).length}`);
  console.log(`RSS máx ${Math.round(rssMax / 1048576)} MB`);

  // Muestra armada desde los logs del backend: trae el veredicto que dio el
  // validador de la PC (columna pcValid). Es la comparación más directa.
  const conPc = filas.filter((f) => f.prod && (f.prod.pcValid === 'true' || f.prod.pcValid === 'false'));
  if (conPc.length > 0) {
    const iguales = conPc.filter((f) => f.isValid === (f.prod.pcValid === 'true')).length;
    console.log('\n── Comparación con el validador de la PC ────────');
    console.log(`mismo veredicto: ${iguales}/${conPc.length} (${Math.round((100 * iguales) / conPc.length)}%)`);
    for (const f of conPc.filter((x) => x.isValid && x.prod.pcValid === 'false')) {
      console.log(`  OK acá, NO en la PC: ${f.archivo}  leído $${f.extractedAmount} (pedido $${f.montoPedido})`);
    }
    for (const f of conPc.filter((x) => !x.isValid && x.prod.pcValid === 'true')) {
      console.log(`  NO acá, OK en la PC: ${f.archivo}  flags ${f.flags.join(',')}`);
    }
  }

  const conProd = filas.filter((f) => f.prod && f.prod.status !== undefined);
  if (conProd.length > 0) {
    const campos = [
      ['monto', (f) => igualNum(f.extractedAmount, f.prod.extractedAmount), (f) => f.prod.extractedAmount],
      ['fecha', (f) => norm(f.extractedDate) === norm(f.prod.extractedDate), (f) => f.prod.extractedDate],
      ['estado', (f) => norm(f.transactionStatus) === norm(f.prod.transactionStatus), (f) => f.prod.transactionStatus],
      ['nro operación', (f) => norm(f.transactionId) === norm(f.prod.transactionId), (f) => f.prod.transactionId],
    ];
    console.log('\n── Comparación con lo que guardó producción ─────');
    for (const [nombre, igual] of campos) {
      const n = conProd.filter(igual).length;
      console.log(`${nombre.padEnd(14)} ${n}/${conProd.length} iguales (${Math.round((100 * n) / conProd.length)}%)`);
    }
    // Aprobación automática en producción: terminó COMPLETED sin que lo tocara un operador.
    const aprobadoProd = (f) => f.prod.grupo === 'completado' && !f.prod.manuallyApproved && !f.prod.validationError;
    const nuevas = conProd.filter((f) => f.isValid && !aprobadoProd(f));
    const perdidas = conProd.filter((f) => !f.isValid && aprobadoProd(f));
    console.log(`\nValidador da OK y producción no lo aprobó solo: ${nuevas.length} (revisar uno por uno)`);
    for (const f of nuevas) {
      console.log(`  ${f.archivo}  leído $${f.extractedAmount} (pedido $${f.montoPedido}) · prod: ${f.prod.status} ${f.prod.validationError || ''}`);
    }
    console.log(`Producción lo aprobó solo y ahora va a revisión: ${perdidas.length}`);
    for (const f of perdidas) {
      console.log(`  ${f.archivo}  flags ${f.flags.join(',')}`);
    }
  }

  if (JSON_SALIDA) {
    fs.writeFileSync(JSON_SALIDA, JSON.stringify({ initMs, rssMaxMb: Math.round(rssMax / 1048576), filas }, null, 2));
    console.log(`\nDetalle: ${JSON_SALIDA}`);
  }
  if (process.env.BENCH_KEEP_ALIVE === '1') {
    // Un Background Worker que termina se reinicia solo: se queda quieto hasta
    // que se borre el servicio.
    console.log('\nBENCH TERMINADO');
    setInterval(() => {}, 1 << 30);
    return;
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
