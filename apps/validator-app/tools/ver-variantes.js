#!/usr/bin/env node
/**
 * Muestra qué lee cada variante de preprocesamiento sobre un comprobante concreto.
 *
 * `recognizeWithMultiPass` corre hasta 10 variantes y se queda con una sola, así que
 * cuando un comprobante se lee mal no hay forma de saber si alguna de las otras lo había
 * leído bien. Esto lo hace visible — es la herramienta para diagnosticar un caso puntual
 * antes de tocar una regex.
 *
 * Uso: node tools/ver-variantes.js <imagen>
 */
const fs = require('fs');
const path = require('path');

const logger = require('../src/logger');
for (const m of ['info', 'warn', 'error', 'success', 'debug']) {
  if (typeof logger[m] === 'function') logger[m] = () => {};
}
const { generateOCRVariants } = require('../src/ocr/preprocess');
const { initOCRWorker } = require('../src/ocr/worker');
const { extractAllAmounts } = require('../src/ocr/patterns/_helpers');

const IMG = process.argv[2];
const ESPERADO = process.argv[3] ? Number(process.argv[3]) : null;
if (!IMG || !fs.existsSync(IMG)) {
  console.error('Uso: node tools/ver-variantes.js <imagen> [montoEsperado]');
  process.exit(1);
}

(async () => {
  const img = fs.readFileSync(IMG);
  const worker = await initOCRWorker(null);
  if (!worker) { console.error('No arrancó Tesseract'); process.exit(1); }
  const variants = await generateOCRVariants(img);

  console.log(`${path.basename(IMG)}${ESPERADO ? `   esperado: ${ESPERADO}` : ''}\n`);
  const votos = {};

  for (const v of variants) {
    const params = { tessedit_pageseg_mode: String(v.psm) };
    if (v.name === 'number-focused') params.tessedit_char_whitelist = '0123456789.,$ ARSpesos';
    else if (v.name === 'digits-only') params.tessedit_char_whitelist = '0123456789.,';
    else params.tessedit_char_whitelist = '';
    await worker.setParameters(params);

    const { data } = await worker.recognize(v.buffer);
    const text = data.text || '';
    const lineas = text.split('\n').map((s) => s.trim())
      .filter((s) => /[0-9OoIiLlSsBb]{3}|\$/.test(s) && s.length < 60).slice(0, 5);
    const montos = extractAllAmounts(text);

    console.log(`=== ${v.name} (psm ${v.psm}) conf=${Math.round(data.confidence)} chars=${text.length} ===`);
    console.log(`  lineas con numeros: ${JSON.stringify(lineas)}`);
    console.log(`  montos: ${montos.map((a) => `${a.amount}[${a.source}]`).join(', ') || '(ninguno)'}\n`);

    for (const a of montos) votos[a.amount] = (votos[a.amount] || 0) + 1;
  }

  console.log('VOTOS POR MONTO (cuántas variantes vieron cada valor):');
  for (const [monto, n] of Object.entries(votos).sort((a, b) => b[1] - a[1])) {
    const marca = ESPERADO != null && Math.abs(Number(monto) - ESPERADO) <= 1 ? '  <- esperado' : '';
    console.log(`  ${String(n).padStart(3)}  ${monto}${marca}`);
  }

  await worker.terminate();
  process.exit(0);
})();
