#!/usr/bin/env node
/**
 * Borra de Cloudinary los archivos de demo que la cuenta trae de fábrica
 * (`samples/`, `cld-sample*`, `main-sample`): 64 archivos, ~178 MB, todos
 * creados el día que se abrió la cuenta. No los usa nadie y ocupan el 10% del
 * almacenamiento del plan free.
 *
 * Sólo toca esos prefijos: los comprobantes viven en `proofs/`, las capturas del
 * bot en `screenshots/` y el otro proyecto en `nexora/`. Nada de eso se toca.
 *
 * Uso:
 *   node scripts/limpiar-samples-cloudinary.js            # lista qué borraría
 *   node scripts/limpiar-samples-cloudinary.js --borrar   # lo borra de verdad
 *
 * El borrado es PERMANENTE y no tiene papelera.
 */
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', 'apps', 'backend-api', '.env');
const line = fs
  .readFileSync(ENV, 'utf8')
  .split('\n')
  .find((l) => l.startsWith('CLOUDINARY_URL='));
if (!line) {
  console.error('No encontré CLOUDINARY_URL en apps/backend-api/.env');
  process.exit(1);
}
const m = line.slice('CLOUDINARY_URL='.length).trim().match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
if (!m) {
  console.error('CLOUDINARY_URL con formato inesperado');
  process.exit(1);
}
const [, key, secret, cloud] = m;
const auth = 'Basic ' + Buffer.from(key + ':' + secret).toString('base64');

// Los nombres que Cloudinary precarga al crear la cuenta.
const ES_DEMO = (id) =>
  id.startsWith('samples/') ||
  id.startsWith('cld-sample') ||
  id === 'sample' ||
  id === 'main-sample';

const BORRAR = process.argv.includes('--borrar');

const api = async (p, init) => {
  const r = await fetch('https://api.cloudinary.com/v1_1/' + cloud + p, {
    ...init,
    headers: { Authorization: auth, ...(init?.headers || {}) },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
  return j;
};

(async () => {
  const porTipo = {};
  let bytes = 0;

  for (const tipo of ['image', 'video', 'raw']) {
    porTipo[tipo] = [];
    let cursor = null;
    do {
      const j = await api(
        `/resources/${tipo}?type=upload&max_results=500` +
          (cursor ? `&next_cursor=${cursor}` : ''),
      );
      for (const r of j.resources || []) {
        if (!ES_DEMO(r.public_id)) continue;
        porTipo[tipo].push(r.public_id);
        bytes += r.bytes;
      }
      cursor = j.next_cursor;
    } while (cursor);
  }

  const total = Object.values(porTipo).flat().length;
  console.log(`Archivos de demo encontrados: ${total} (${(bytes / 1e6).toFixed(0)} MB)`);
  for (const [tipo, ids] of Object.entries(porTipo)) {
    if (ids.length) console.log(`  ${tipo}: ${ids.length}`);
  }

  if (!total) return;
  if (!BORRAR) {
    console.log('\nEjemplos:', Object.values(porTipo).flat().slice(0, 5).join(', '));
    console.log('\nEsto fue sólo un listado. Para borrarlos: --borrar');
    return;
  }

  for (const [tipo, ids] of Object.entries(porTipo)) {
    // La API acepta hasta 100 public_ids por llamada.
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const qs = lote.map((id) => 'public_ids[]=' + encodeURIComponent(id)).join('&');
      const j = await api(`/resources/${tipo}/upload?${qs}`, { method: 'DELETE' });
      const hechos = Object.values(j.deleted || {}).filter((v) => v === 'deleted').length;
      console.log(`  ${tipo}: ${hechos}/${lote.length} borrados`);
    }
  }
  console.log(`\nListo. Se liberaron ~${(bytes / 1e6).toFixed(0)} MB.`);
})().catch((e) => {
  console.error('Falló:', e.message);
  process.exit(1);
});
