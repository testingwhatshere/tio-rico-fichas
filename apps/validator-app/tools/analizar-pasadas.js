#!/usr/bin/env node
/**
 * Qué pasada de OCR lee mejor cada banco.
 *
 * Corre TODAS las variantes de preprocesado (las mismas de producción, mismos
 * parámetros de Tesseract) sobre cada comprobante, sin corte temprano, y anota
 * para cada una si por sí sola ya alcanzaba: monto exacto + fecha + estado, sin
 * monto dudoso (el criterio de corte de producción). Con eso se arma, por banco,
 * el orden de pasadas que llega antes a una lectura completa.
 *
 * Uso:
 *   node tools/analizar-pasadas.js <dir-corpus> [--json salida.json]
 *
 * El directorio necesita un index.csv con `archivo` y `montoPedido`.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DIR = args.find((a) => !a.startsWith('--'));
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!DIR) {
  console.error('Uso: node tools/analizar-pasadas.js <dir-corpus> [--json salida.json]');
  process.exit(1);
}

const logger = require('../src/logger');
logger.configure({ writeFiles: false });
logger.log = () => ({});

const { generateOCRVariantsLazy } = require('../src/ocr/preprocess');
const { initOCRWorker } = require('../src/ocr/worker');
const { parseOCRText } = require('../src/ocr/parser');

function leerIndice(dir) {
  const [cab, ...filas] = fs.readFileSync(path.join(dir, 'index.csv'), 'utf8').trim().split('\n');
  const cols = cab.split(',');
  return filas.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

// Mismos parámetros por variante que src/ocr/worker.js
function parametros(variant) {
  const params = { tessedit_pageseg_mode: String(variant.psm) };
  if (variant.name === 'number-focused') params.tessedit_char_whitelist = '0123456789.,$ ARSpesos';
  else if (variant.name === 'digits-only') params.tessedit_char_whitelist = '0123456789.,';
  else params.tessedit_char_whitelist = '';
  return params;
}

async function main() {
  const worker = await initOCRWorker();
  const filas = leerIndice(DIR).filter((f) => f.archivo && !f.archivo.endsWith('.pdf'));
  const resultados = [];

  for (const [i, f] of filas.entries()) {
    const monto = Number(f.montoPedido);
    const buf = fs.readFileSync(path.join(DIR, f.archivo));
    const variantes = await generateOCRVariantsLazy(buf);
    const porVariante = [];
    let plataforma = null;

    for (const v of variantes) {
      const t0 = Date.now();
      let texto = '';
      try {
        await worker.setParameters(parametros(v));
        const { data } = await worker.recognize(await v.getBuffer());
        texto = data.text || '';
      } catch (_) { /* variante que no se pudo armar */ }
      const ms = Date.now() - t0;
      const p = parseOCRText(texto, monto);
      const montoExacto = p.extractedAmount != null && Math.abs(p.extractedAmount - monto) <= 1;
      const completa = montoExacto && !!p.extractedDate && !!p.transactionStatus && !p.amountAmbiguous;
      if (!plataforma && p.detectedPlatform && p.detectedPlatform !== 'generic') plataforma = p.detectedPlatform;
      porVariante.push({ variante: v.name, ms, montoExacto, fecha: !!p.extractedDate, estado: !!p.transactionStatus, completa });
    }
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });

    const primeraCompleta = porVariante.findIndex((x) => x.completa);
    resultados.push({ archivo: f.archivo, plataforma: plataforma || 'generic', porVariante, primeraCompleta });
    console.log(`${String(i + 1).padStart(3)}/${filas.length} ${(plataforma || 'generic').padEnd(14)} primera completa: ${primeraCompleta >= 0 ? porVariante[primeraCompleta].variante : 'ninguna'}`);
  }

  // ── Resumen por banco ─────────────────────────────────────────────
  const porBanco = new Map();
  for (const r of resultados) {
    if (!porBanco.has(r.plataforma)) porBanco.set(r.plataforma, []);
    porBanco.get(r.plataforma).push(r);
  }
  console.log('\n── Por banco: en cuántos comprobantes cada pasada sola ya alcanza ──');
  for (const [banco, rs] of [...porBanco.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const nombres = rs[0].porVariante.map((x) => x.variante);
    const conteo = {};
    const tiempo = {};
    for (const r of rs) {
      for (const x of r.porVariante) {
        conteo[x.variante] = (conteo[x.variante] || 0) + (x.completa ? 1 : 0);
        tiempo[x.variante] = (tiempo[x.variante] || 0) + x.ms;
      }
    }
    const sinNinguna = rs.filter((r) => r.primeraCompleta < 0).length;
    console.log(`\n${banco} (${rs.length} comprobantes, ${sinNinguna} sin ninguna pasada completa)`);
    for (const n of [...new Set(nombres.concat(Object.keys(conteo)))].sort((a, b) => (conteo[b] || 0) - (conteo[a] || 0))) {
      console.log(`  ${n.padEnd(20)} ${String(conteo[n] || 0).padStart(3)}/${rs.length}   ~${Math.round((tiempo[n] || 0) / rs.length)} ms`);
    }
  }

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(resultados, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
