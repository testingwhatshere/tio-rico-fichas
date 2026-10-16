#!/usr/bin/env node
/**
 * Qué comprobantes le cuestan al validador: por banco/billetera, cuántos salen sin
 * fecha, cuántos tardan mucho y cuántos no se aprueban solos, con el link a la imagen
 * de los peores para abrirlos.
 *
 * Existe para encontrar el próximo "Brubank" antes de que se note: el 2026-10-14 dos
 * comprobantes de Brubank tardaban 34 s y salían sin fecha (su fecha va en gris claro y
 * el comprobante dice "Entidad: MercadoPago"), y se encontró mirando logs a mano.
 *
 * Lee los logs del worker del validador en Render (una línea "Validation completed" por
 * comprobante) y, para los casos a revisar, busca en los logs del backend el publicId de
 * la imagen. Render guarda los logs pocos días: sirve para la última semana, no más.
 *
 * Sólo lee. No modifica nada.
 *
 * Uso:
 *   node scripts/reporte-validador.js              # últimos 3 días
 *   node scripts/reporte-validador.js --dias 7
 *   node scripts/reporte-validador.js --lento 10   # umbral de "lento" en segundos (default 15)
 *
 * Credenciales: Render en ~/.render/api-key-finnegansadmin
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const VALIDADOR = 'srv-db7d1gjbc2fs73eo849g';
const BACKEND = 'srv-da9gteks728c73do3ri0';
const CLOUDINARY_CLOUD = 'dbkcb1zbe';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const DIAS = Number(opt('dias', 3));
const LENTO_S = Number(opt('lento', 15));
const MAX_LINKS = 15;

const KEY = fs.readFileSync(path.join(os.homedir(), '.render/api-key-finnegansadmin'), 'utf8').trim();

async function render(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`Render ${res.status} en ${url.split('?')[0]}`);
  // El texto del OCR que viaja en los logs trae caracteres de control que rompen JSON.parse.
  return JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, ' '));
}

async function logs(owner, resource, params) {
  const out = new Map();
  let startTime = params.startTime;
  for (let i = 0; i < 200; i++) {
    const q = new URLSearchParams({ ownerId: owner, resource, limit: '100', direction: 'forward', ...params, startTime });
    const d = await render(`https://api.render.com/v1/logs?${q}`);
    for (const l of d.logs ?? []) out.set(l.id, l);
    if (!d.hasMore) break;
    startTime = d.nextStartTime;
  }
  return [...out.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

(async () => {
  const owner = (await render(`https://api.render.com/v1/services/${VALIDADOR}`)).ownerId;
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
  const lineas = await logs(owner, VALIDADOR, { startTime: desde, text: 'Validation completed' });

  const porId = new Map();
  for (const l of lineas) {
    let m;
    try { m = JSON.parse(l.message); } catch { continue; }
    if (!String(m.message).startsWith('Validation completed') || !m.data?.id) continue;
    porId.set(m.data.id, { ...m.data, decision: m.message.split(': ')[1], ts: l.timestamp });
  }
  const v = [...porId.values()];
  if (v.length === 0) {
    console.log(`Sin validaciones en los últimos ${DIAS} días (¿Render ya no guarda logs de esa fecha?).`);
    return;
  }

  const grupos = new Map();
  for (const x of v) {
    const k = x.paymentMethod || '(sin banco)';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(x);
  }
  const sinFecha = (x) => (x.flags || []).includes('NO_DATE') || !x.extractedDate;
  const lento = (x) => x.durationMs / 1000 >= LENTO_S;
  const noAprobado = (x) => x.decision !== 'APPROVED';
  const pct = (n, t) => `${Math.round((100 * n) / t)}%`.padStart(4);

  console.log(`Validador · últimos ${DIAS} días · ${v.length} comprobantes\n`);
  console.log('banco/billetera        cant  sin fecha   lentos(≥' + LENTO_S + 's)  no aprobados  p50');
  const filas = [...grupos].sort((a, b) => b[1].length - a[1].length);
  for (const [k, xs] of filas) {
    const d = xs.map((x) => x.durationMs / 1000).sort((a, b) => a - b);
    const p50 = d[Math.floor(d.length / 2)];
    const a = xs.filter(sinFecha).length, b = xs.filter(lento).length, c = xs.filter(noAprobado).length;
    console.log(
      `${k.slice(0, 20).padEnd(20)} ${String(xs.length).padStart(6)}  ${String(a).padStart(4)} ${pct(a, xs.length)}  ${String(b).padStart(6)} ${pct(b, xs.length)}  ${String(c).padStart(6)} ${pct(c, xs.length)}  ${p50.toFixed(1)}s`,
    );
  }

  // Los peores primero: no aprobados, después lentos sin fecha, después lentos.
  const peso = (x) => (noAprobado(x) ? 4 : 0) + (sinFecha(x) ? 2 : 0) + (lento(x) ? 1 : 0);
  const revisar = v.filter((x) => peso(x) > 0).sort((a, b) => peso(b) - peso(a) || b.durationMs - a.durationMs);
  if (revisar.length === 0) {
    console.log('\nNada para revisar: todos con fecha, rápidos y aprobados.');
    return;
  }

  console.log(`\nPara abrir (${Math.min(MAX_LINKS, revisar.length)} de ${revisar.length}):`);
  const ownerBackend = (await render(`https://api.render.com/v1/services/${BACKEND}`)).ownerId;
  for (const x of revisar.slice(0, MAX_LINKS)) {
    let link = '(imagen no encontrada en logs)';
    try {
      const l = await logs(ownerBackend, BACKEND, { startTime: desde, text: x.requestId });
      const firma = l.map((y) => y.message).join('\n').match(/publicId=([0-9a-f-]{36})/);
      if (firma) link = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/proofs/${firma[1]}`;
    } catch {}
    const motivos = [noAprobado(x) && x.decision, sinFecha(x) && 'sin fecha', lento(x) && `${(x.durationMs / 1000).toFixed(0)}s`]
      .filter(Boolean).join(', ');
    console.log(`- ${x.ts.slice(0, 16).replace('T', ' ')}  ${x.paymentMethod || '?'}  $${x.extractedAmount ?? '?'}  [${motivos}]`);
    console.log(`  ${link}`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
