#!/usr/bin/env node
/**
 * Mide cuánto ahorra el corte temprano del OCR, sobre comprobantes reales.
 *
 * Corre cada comprobante dos veces — con y sin corte — y compara tiempo y texto
 * resultante. Lo que importa no es sólo el ahorro: es que el veredicto no cambie.
 * Si con corte se extrae un monto distinto al de la corrida completa, el criterio
 * está mal y hay que verlo antes de mandarlo a producción.
 *
 * Uso: node tools/bench-early-exit.js <dir-corpus> [cantidad]
 */

const fs = require('fs');
const path = require('path');

const CORPUS = process.argv[2];
const CANTIDAD = Number(process.argv[3] || 12);
if (!CORPUS || !fs.existsSync(CORPUS)) {
  console.error('Uso: node tools/bench-early-exit.js <dir-corpus> [cantidad]');
  process.exit(1);
}

const logger = require('../src/logger');
for (const m of ['info', 'warn', 'error', 'success', 'debug']) {
  if (typeof logger[m] === 'function') logger[m] = () => {};
}

const { parseOCRText } = require('../src/ocr/parser');
const { initOCRWorker, recognizeWithMultiPass } = require('../src/ocr/worker');

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
  return filas.filter((f) => f.length === cab.length)
    .map((f) => Object.fromEntries(cab.map((k, i) => [k, f[i]])));
}

async function main() {
  const worker = await initOCRWorker(null);
  if (!worker) { console.error('No se pudo iniciar Tesseract'); process.exit(1); }

  // Comprobantes que terminaron cargados y con monto conocido: el caso normal, que es
  // donde el ahorro tiene que notarse.
  const filas = leerIndice(CORPUS)
    .filter((f) => f.status === 'COMPLETED' && Number(f.montoPedido) > 0)
    .slice(0, CANTIDAD);

  console.log(`Midiendo ${filas.length} comprobantes cargados\n`);
  console.log('  monto      completo   con corte   ahorro   ¿mismo monto leído?');

  let totalCompleto = 0, totalCorte = 0, difieren = 0, cortaron = 0;
  const ganadoras = {};

  for (const f of filas) {
    const img = path.join(CORPUS, f.archivo);
    if (!fs.existsSync(img)) continue;
    const buf = fs.readFileSync(img);
    const esperado = Number(f.montoPedido);

    const yaAlcanza = (texto) => {
      try {
        const c = parseOCRText(texto, esperado);
        return c.extractedAmount != null && Math.abs(c.extractedAmount - esperado) <= 1
          && !!c.extractedDate && !!c.transactionStatus;
      } catch (_) { return false; }
    };

    let t = Date.now();
    const completo = await recognizeWithMultiPass(buf, null);
    const msCompleto = Date.now() - t;

    t = Date.now();
    const corte = await recognizeWithMultiPass(buf, null, { yaAlcanza });
    const msCorte = Date.now() - t;

    const mA = completo ? parseOCRText(completo.text, esperado).extractedAmount : null;
    const mB = corte ? parseOCRText(corte.text, esperado).extractedAmount : null;
    const igual = mA === mB;
    if (!igual) difieren++;
    if (msCorte < msCompleto * 0.9) cortaron++;
    // Qué variante terminó ganando: si siempre gana la misma, conviene ponerla
    // primera en preprocess.js y el corte temprano ahorra mucho más.
    if (corte) ganadoras[corte.method] = (ganadoras[corte.method] || 0) + 1;

    totalCompleto += msCompleto;
    totalCorte += msCorte;
    const ahorro = Math.round((100 * (msCompleto - msCorte)) / msCompleto);
    console.log(`  $${String(esperado).padEnd(9)} ${String((msCompleto / 1000).toFixed(1) + 's').padStart(8)} ${String((msCorte / 1000).toFixed(1) + 's').padStart(11)} ${String(ahorro + '%').padStart(8)}   ${igual ? 'si' : `NO (${mA} vs ${mB})`}`);
  }

  const n = filas.length;
  console.log(`\n  promedio sin corte: ${(totalCompleto / n / 1000).toFixed(1)}s`);
  console.log(`  promedio con corte: ${(totalCorte / n / 1000).toFixed(1)}s`);
  console.log(`  ahorro total: ${Math.round((100 * (totalCompleto - totalCorte)) / totalCompleto)}%`);
  console.log(`  cortaron temprano: ${cortaron}/${n}`);
  console.log(`  leyeron distinto: ${difieren}/${n}${difieren ? '  <-- REVISAR' : '  (el veredicto no cambia)'}`);
  console.log('\n  variante que gano (con corte):');
  for (const [k, v] of Object.entries(ganadoras).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(22)} ${v}`);
  }

  try { await worker.terminate(); } catch (_) {}
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
