#!/usr/bin/env node
/**
 * Cuánto llevamos consumido en Render y en Cloudinary, contra los límites del plan free.
 *
 * Existe para no enterarnos de un problema cuando ya nos cortaron el servicio. Los dos
 * límites del free de Render son muy distintos entre sí:
 *
 *   - ANCHO DE BANDA (5 GB/mes): si se pasa, se cobra. La tarjeta lo cubre.
 *   - HORAS-INSTANCIA (750/mes): si se pasa, **se apagan los servicios**. La tarjeta NO
 *     lo cubre. Es el que de verdad puede dejar la plataforma abajo, y es el que menos
 *     se mira porque no aparece en ninguna alerta.
 *
 * Un dato clave para leer el resultado: los servicios web que están despiertos consumen
 * ~730 horas cada uno por mes (24×30). O sea que el free alcanza para UN servicio web
 * corriendo todo el mes. Los Static Sites no consumen horas — por eso conviene que todo
 * lo que sea HTML/JS estático viva como Static Site y no como Web Service.
 *
 * Sólo lee. No modifica nada, no deploya nada.
 *
 * Uso:
 *   node scripts/ver-consumo.js              # el mes en curso
 *   node scripts/ver-consumo.js --dias 7     # últimos 7 días
 *   node scripts/ver-consumo.js --json       # para scriptear encima
 *
 * Credenciales:
 *   Render     ~/.render/api-key-finnegansadmin
 *   Cloudinary CLOUDINARY_URL en apps/backend-api/.env (o en el entorno)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const DIAS = (() => {
  const i = args.indexOf('--dias');
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : null;
})();

// Límites del workspace (leídos del panel de Render el 2026-08-31; la API no los expone).
//
// El workspace bajó de Pro a Free ese día: la banda incluida pasó de 25 GB a 5 GB, pero el
// precio del GB extra es el mismo en los dos planes, así que pasarse cuesta centavos y NO
// corta el servicio — Render lo factura mientras haya medio de pago cargado. Sin medio de
// pago, en cambio, suspende los servicios free (no los pagos) por el resto del mes.
const LIMITE_HORAS = 750;            // horas de instancias FREE, por workspace
const USD_POR_GB_EXTRA = 0.15;       // igual en Free y en Pro
const LIMITE_BANDA_GB = (() => {
  const i = args.indexOf('--limite-banda');
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 5; // workspace Free
})();

const RAIZ = path.join(__dirname, '..');

// ── Credenciales ─────────────────────────────────────────────────────────
function claveRender() {
  const p = path.join(os.homedir(), '.render', 'api-key-finnegansadmin');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim();
}

function urlCloudinary() {
  if (process.env.CLOUDINARY_URL) return process.env.CLOUDINARY_URL;
  const env = path.join(RAIZ, 'apps', 'backend-api', '.env');
  if (!fs.existsSync(env)) return null;
  const m = fs.readFileSync(env, 'utf8').match(/^CLOUDINARY_URL\s*=\s*"?([^"\n\r]+)"?/m);
  return m ? m[1].trim() : null;
}

// ── Ventana de tiempo ────────────────────────────────────────────────────
function ventana() {
  const fin = new Date();
  let inicio;
  if (DIAS) {
    inicio = new Date(fin.getTime() - DIAS * 24 * 3600 * 1000);
  } else {
    // Mes calendario en curso. El ciclo real de facturación puede arrancar otro día;
    // para "no llevarse sorpresas" alcanza y sobra, y evita depender de un dato que la
    // API no expone.
    inicio = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), 1));
  }
  return { inicio: inicio.toISOString().replace(/\.\d+Z$/, 'Z'), fin: fin.toISOString().replace(/\.\d+Z$/, 'Z') };
}

async function pedir(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.replace(/\?.*/, '')}`);
  return res.json();
}

// ── Render ───────────────────────────────────────────────────────────────
async function servicios(key) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const u = `https://api.render.com/v1/services?limit=50${cursor ? `&cursor=${cursor}` : ''}`;
    const page = await pedir(u, { Authorization: `Bearer ${key}` });
    if (!page.length) break;
    for (const it of page) out.push(it.service || it);
    cursor = page[page.length - 1].cursor;
    if (page.length < 50) break;
  }
  return out;
}

/** Suma los buckets de una serie de métrica. Cada valor ya es el total del bucket. */
function sumarSerie(series) {
  let total = 0;
  for (const s of series || []) for (const v of s.values || []) total += Number(v.value) || 0;
  return total;
}

/**
 * Horas-instancia: la serie dice cuántas instancias había en cada momento, no un total.
 * Hay que integrarla en el tiempo — multiplicar cada muestra por lo que dura el intervalo.
 */
function horasInstancia(series) {
  let segundos = 0;
  for (const s of series || []) {
    const vs = s.values || [];
    if (vs.length < 2) continue;
    const paso = (new Date(vs[1].timestamp) - new Date(vs[0].timestamp)) / 1000;
    if (!paso || paso < 0) continue;
    for (const v of vs) segundos += (Number(v.value) || 0) * paso;
  }
  return segundos / 3600;
}

/**
 * Pide una métrica bajando la resolución según el rango.
 *
 * La API devuelve una lista VACIA (no un error) cuando el rango pedido daría demasiados
 * puntos: a resolución de 1 minuto se corta cerca de los 2 días. Pedir "el mes" sin ajustar
 * la resolución devolvía cero y el reporte mostraba 0 horas-instancia como si los servicios
 * estuvieran apagados.
 */
async function metrica(key, nombre, recurso, inicio, fin) {
  const rangoHoras = (new Date(fin) - new Date(inicio)) / 3600000;
  // Apuntar a ~700 puntos: entra holgado y da buena resolución en cualquier rango.
  const res = Math.max(60, Math.ceil((rangoHoras * 3600) / 700 / 60) * 60);
  try {
    const u = `https://api.render.com/v1/metrics/${nombre}?resource=${recurso}`
      + `&startTime=${encodeURIComponent(inicio)}&endTime=${encodeURIComponent(fin)}&resolutionSeconds=${res}`;
    return await pedir(u, { Authorization: `Bearer ${key}` });
  } catch (e) {
    return null;
  }
}

/** Desde cuándo hay datos de verdad en una serie (Render no retiene todo el mes). */
function cobertura(series) {
  let min = null, max = null;
  for (const s of series || []) for (const v of s.values || []) {
    const t = new Date(v.timestamp).getTime();
    if (min === null || t < min) min = t;
    if (max === null || t > max) max = t;
  }
  if (min === null) return { horas: 0, desde: null };
  return { horas: (max - min) / 3600000, desde: new Date(min).toISOString() };
}

// ── Cloudinary ───────────────────────────────────────────────────────────
async function usoCloudinary(url) {
  // cloudinary://api_key:api_secret@cloud_name
  const m = String(url).match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!m) throw new Error('CLOUDINARY_URL con formato inesperado');
  const [, apiKey, apiSecret, cloud] = m;
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return pedir(`https://api.cloudinary.com/v1_1/${cloud}/usage`, { Authorization: `Basic ${auth}` });
}

// ── Presentación ─────────────────────────────────────────────────────────
const barra = (pct) => {
  const n = Math.max(0, Math.min(20, Math.round(pct / 5)));
  return '[' + '#'.repeat(n) + '.'.repeat(20 - n) + ']';
};
const alerta = (pct) => (pct >= 90 ? '  <<< CRITICO' : pct >= 70 ? '  <<< OJO' : '');

async function main() {
  const key = claveRender();
  const { inicio, fin } = ventana();
  const reporte = { ventana: { inicio, fin }, render: { servicios: [] }, cloudinary: null };

  if (!JSON_OUT) {
    console.log(`\nCONSUMO  —  ${inicio.slice(0, 10)} a ${fin.slice(0, 10)}${DIAS ? ` (${DIAS} dias)` : ' (mes en curso)'}\n`);
  }

  // ── Render ──
  if (!key) {
    if (!JSON_OUT) console.log('RENDER: falta ~/.render/api-key-finnegansadmin\n');
  } else {
    const svs = await servicios(key);
    let bandaTotal = 0;
    let horasTotal = 0;
    let horasCubiertas = 0;
    let desdeReal = null;
    let horasFree = 0;
    const pagos = [];
    const filas = [];

    for (const s of svs) {
      const esEstatico = s.type === 'static_site';
      // El plan cambia por completo cómo hay que leer las horas: las 750 del free son un
      // límite del workspace que sólo cuentan los servicios EN plan free. Un servicio en
      // Starter paga una cuota fija y no toca ese cupo.
      const plan = (s.serviceDetails && s.serviceDetails.plan) || (esEstatico ? 'static' : '?');
      const esFree = plan === 'free';
      const [bw, ic] = await Promise.all([
        metrica(key, 'bandwidth', s.id, inicio, fin),
        esEstatico ? null : metrica(key, 'instance-count', s.id, inicio, fin),
      ]);
      const mb = sumarSerie(bw);
      const hs = ic ? horasInstancia(ic) : 0;
      const cob = cobertura(bw && bw.length ? bw : ic);
      bandaTotal += mb;
      horasTotal += hs;
      if (cob.horas > horasCubiertas) { horasCubiertas = cob.horas; desdeReal = cob.desde; }
      if (esFree) horasFree += hs;
      if (!esEstatico && !esFree) pagos.push(s.name);
      filas.push({ id: s.id, nombre: s.name, tipo: s.type, plan, esFree, bandaMB: mb, horas: hs, estatico: esEstatico });
    }

    filas.sort((a, b) => b.bandaMB - a.bandaMB);
    reporte.render.servicios = filas;
    reporte.render.bandaGB = bandaTotal / 1024;
    reporte.render.horas = horasTotal;

    if (!JSON_OUT) {
      console.log('RENDER — por servicio');
      console.log('  servicio                  plan          banda      horas   cuenta contra el cupo free');
      for (const f of filas) {
        const banda = f.bandaMB >= 1024 ? `${(f.bandaMB / 1024).toFixed(2)} GB` : `${f.bandaMB.toFixed(1)} MB`;
        const horas = f.estatico ? '  -  ' : `${f.horas.toFixed(0)} h`;
        const cuenta = f.estatico ? 'no (estatico)' : f.esFree ? 'SI' : 'no (pago)';
        console.log(`  ${f.nombre.padEnd(24).slice(0, 24)}  ${String(f.plan).padEnd(12)}  ${banda.padStart(9)}  ${horas.padStart(6)}   ${cuenta}`);
      }

      const pctB = (bandaTotal / 1024 / LIMITE_BANDA_GB) * 100;
      const pctH = (horasFree / LIMITE_HORAS) * 100;
      console.log('\nRENDER — contra los limites del plan free');
      console.log(`  ancho de banda   ${barra(pctB)} ${(bandaTotal / 1024).toFixed(2)} de ${LIMITE_BANDA_GB} GB  (${pctB.toFixed(0)}%)${alerta(pctB)}`);
      const excedente = Math.max(0, bandaTotal / 1024 - LIMITE_BANDA_GB);
      console.log(`     -> pasado el incluido se cobra USD ${USD_POR_GB_EXTRA}/GB y el servicio NO se corta.`);
      if (excedente > 0) console.log(`     -> excedente actual: ${excedente.toFixed(1)} GB = USD ${(excedente * USD_POR_GB_EXTRA).toFixed(2)}`);
      console.log(`  horas-instancia  ${barra(pctH)} ${horasFree.toFixed(0)} de ${LIMITE_HORAS} h  (${pctH.toFixed(0)}%)${alerta(pctH)}`);
      console.log(`     -> solo cuentan los servicios en plan free. Si se pasa, esos se apagan.`);
      if (pagos.length) {
        console.log(`\n  ${pagos.length} servicios en plan pago (no tocan ese cupo): ${pagos.join(', ')}`);
        console.log(`  Costo fijo: ${pagos.length} x USD 7 = USD ${pagos.length * 7}/mes.`);
      }

      // Lo importante no es lo consumido hasta ahora sino a qué ritmo se consume, porque
      // Render sólo retiene unos pocos días de métricas: un total "del mes" que en realidad
      // cubre 2 días se lee como si sobrara lugar cuando puede estar por explotar.
      const horasPedidas = (new Date(fin) - new Date(inicio)) / 3600000;
      const parcial = horasCubiertas > 0 && horasCubiertas < horasPedidas * 0.9;
      if (horasCubiertas > 1) {
        const factor = 720 / horasCubiertas; // a 30 dias
        const proyB = (bandaTotal / 1024) * factor;
        const proyH = horasFree * factor;
        console.log('\nRENDER — proyeccion a 30 dias, al ritmo actual');
        const exc = Math.max(0, proyB - LIMITE_BANDA_GB);
        console.log(`  ancho de banda   ~${proyB.toFixed(1)} GB de ${LIMITE_BANDA_GB}`
          + (exc > 0 ? `   -> se pasaria ${exc.toFixed(1)} GB = USD ${(exc * USD_POR_GB_EXTRA).toFixed(2)}/mes` : '   (entra holgado)'));
        console.log(`  horas-instancia  ~${proyH.toFixed(0)} h de ${LIMITE_HORAS} (solo los free)${proyH > LIMITE_HORAS ? '   <<< SE PASA: SE APAGAN LOS SERVICIOS FREE' : ''}`);
      }
      if (parcial) {
        console.log(`\n  OJO: Render guarda metricas de poco tiempo. Los numeros de arriba cubren`);
        console.log(`  ${horasCubiertas.toFixed(0)} h (desde ${desdeReal ? desdeReal.slice(0, 16).replace('T', ' ') : '?'}), no el mes entero.`);
        console.log(`  Para el consumo real del ciclo, mirar el panel de Render. Lo que si sirve de aca`);
        console.log(`  es la proyeccion: dice si el ritmo actual entra o no en el limite.`);
      }

      const webFree = filas.filter((f) => !f.estatico && f.esFree);
      if (webFree.length > 1) {
        console.log(`\n  Hay ${webFree.length} servicios en plan free consumiendo horas (${webFree.map((f) => f.nombre).join(', ')}).`);
        console.log(`  Un servicio despierto todo el mes son ~730 h, asi que el cupo free alcanza para uno solo.`);
      }
      console.log('');
    }
  }

  // ── Cloudinary ──
  const cu = urlCloudinary();
  if (!cu) {
    if (!JSON_OUT) console.log('CLOUDINARY: no se encontro CLOUDINARY_URL\n');
  } else {
    try {
      const u = await usoCloudinary(cu);
      reporte.cloudinary = u;
      if (!JSON_OUT) {
        const gb = (b) => (Number(b || 0) / 1024 ** 3).toFixed(2);
        console.log('CLOUDINARY');
        console.log(`  plan: ${u.plan || '?'}${u.last_updated ? `   (al ${u.last_updated})` : ''}`);
        if (u.credits) {
          const usados = Number(u.credits.usage || 0);
          const limite = Number(u.credits.limit || 0);
          const pct = limite ? (usados / limite) * 100 : 0;
          console.log(`  creditos         ${barra(pct)} ${usados.toFixed(2)} de ${limite}  (${pct.toFixed(0)}%)${alerta(pct)}`);
          console.log('     -> en Cloudinary todo (almacenamiento, trafico, transformaciones) se paga con creditos.');
        }
        console.log(`  almacenamiento   ${gb(u.storage && u.storage.usage)} GB`);
        console.log(`  trafico del mes  ${gb(u.bandwidth && u.bandwidth.usage)} GB`);
        console.log(`  transformaciones ${Number((u.transformations && u.transformations.usage) || 0).toLocaleString('es-AR')}`);
        console.log(`  archivos         ${Number(u.resources || 0).toLocaleString('es-AR')}`);
        console.log('');
      }
    } catch (e) {
      if (!JSON_OUT) console.log(`CLOUDINARY: no se pudo consultar (${e.message})\n`);
    }
  }

  if (JSON_OUT) console.log(JSON.stringify(reporte, null, 2));
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
