#!/usr/bin/env node
/**
 * Baja un corpus de comprobantes reales desde producción para poder medir el OCR.
 *
 * Sin esto, tocar una regex de los patterns es adivinar: no hay forma de saber si un
 * cambio mejoró la extracción o rompió tres billeteras. El corpus anterior (~1200
 * comprobantes) se perdió porque el script que lo bajaba nunca se versionó — de ahí que
 * éste sí viva en el repo.
 *
 * Entra por el namespace /operator con la API key del panel (`get_requests` devuelve el
 * Request completo, incluido `proofUrl` y lo que el validador extrajo en su momento).
 * No usa la DB: el .env local apunta a Neon, que quedó desactualizado tras la migración
 * a Supabase, y leer de ahí da datos viejos.
 *
 * Las imágenes se bajan de Cloudinary de a una y se saltean las que ya están en disco:
 * el objetivo es no gastar banda de más re-bajando lo mismo en cada corrida.
 *
 * Uso:
 *   node tools/descargar-corpus.js --desde 2026-08-30 [--hasta 2026-08-30] [--salida DIR] [--solo-fallidos]
 *
 * --solo-fallidos: baja sólo los que el validador NO aprobó solo (validationError, aprobación
 * manual, VALIDATION_FAILED o REJECTED). Sirve para armar el corpus de una billetera que el
 * OCR no reconoce: sus comprobantes terminan todos en revisión manual.
 *
 * Env:
 *   API_URL           default https://tiorico-api-axfb.onrender.com
 *   OPERATOR_API_KEY  obligatorio
 *   OPERATOR_NAME     default "admin" (usar uno que YA exista: el backend crea el
 *                     operador si el nombre no está)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const opt = (nombre, def) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};

const DESDE = opt('desde', null);
const HASTA = opt('hasta', DESDE);
const SOLO_FALLIDOS = args.includes('--solo-fallidos');
const API_URL = process.env.API_URL || 'https://tiorico-api-axfb.onrender.com';
const API_KEY = process.env.OPERATOR_API_KEY;
const OPERATOR_NAME = process.env.OPERATOR_NAME || 'admin';
const PAGINA = 100;
// Tope duro de páginas: si el corte por fecha fallara, esto evita recorrer la historia entera.
const MAX_PAGINAS = 60;

if (!DESDE) {
  console.error('Falta --desde. Ej:\n  node tools/descargar-corpus.js --desde 2026-08-30');
  process.exit(1);
}
if (!API_KEY) {
  console.error('Falta OPERATOR_API_KEY en el entorno.');
  process.exit(1);
}

const SALIDA = opt('salida', path.join(os.homedir(), 'Desktop', `corpus-comprobantes-${DESDE.replace(/-/g, '')}${SOLO_FALLIDOS ? '-fallidos' : ''}`));

// Las fechas del negocio son hora argentina (UTC-3); createdAt viene en UTC.
const ART_OFFSET_MS = 3 * 60 * 60 * 1000;
const diaArt = (iso) => new Date(new Date(iso).getTime() - ART_OFFSET_MS).toISOString().slice(0, 10);

/** Campos que el validador dejó en validationDetails, aplanados a las columnas del index.csv. */
const CAMPOS = [
  'extractedAmount', 'extractedDate', 'transactionStatus', 'senderName',
  'senderDniCuit', 'bankName', 'transactionId', 'paymentMethod',
];

function csvCampo(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** El "grupo" es la etiqueta gruesa que usa el harness para segmentar resultados. */
function grupoDe(status) {
  if (status === 'COMPLETED') return 'completado';
  if (status === 'VALIDATION_FAILED') return 'validacion-fallida';
  if (status === 'FAILED' || status === 'REJECTED') return 'fallido';
  return 'otro';
}

async function bajarImagen(url, destino) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destino, buf);
  return buf.length;
}

async function main() {
  const { io } = require('socket.io-client');
  fs.mkdirSync(SALIDA, { recursive: true });

  console.log(`API:    ${API_URL}`);
  console.log(`Rango:  ${DESDE} .. ${HASTA} (hora argentina)`);
  console.log(`Salida: ${SALIDA}\n`);

  const socket = io(`${API_URL}/operator`, {
    transports: ['websocket'],
    auth: { apiKey: API_KEY, operatorName: OPERATOR_NAME },
    timeout: 30000,
  });

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', (e) => reject(new Error(`No conecta: ${e.message}`)));
    setTimeout(() => reject(new Error('Timeout conectando (Render puede estar despertando, reintentá)')), 60000);
  });
  console.log('Conectado al namespace /operator\n');

  const pedir = (evento, payload) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout en ${evento}`)), 45000);
      socket.emit(evento, payload, (resp) => {
        clearTimeout(t);
        if (!resp || !resp.success) return reject(new Error(resp?.error || 'respuesta vacía'));
        resolve(resp.data);
      });
    });

  // ── Paginar hacia atrás hasta salir del rango ──────────────────────────
  const enRango = [];
  let offset = 0;
  let pagina = 0;
  let masViejoVisto = null;

  while (pagina < MAX_PAGINAS) {
    const lote = await pedir('get_requests', { limit: PAGINA, offset });
    if (!Array.isArray(lote) || lote.length === 0) break;

    for (const r of lote) {
      const dia = diaArt(r.createdAt);
      masViejoVisto = dia;
      if (dia >= DESDE && dia <= HASTA) enRango.push(r);
    }

    process.stdout.write(`  página ${pagina + 1}: ${lote.length} pedidos (más viejo: ${masViejoVisto}), en rango: ${enRango.length}\r`);

    // findAll ordena por createdAt desc, así que una vez pasado el borde inferior
    // no puede aparecer nada más del rango.
    if (masViejoVisto < DESDE) break;
    if (lote.length < PAGINA) break;
    offset += PAGINA;
    pagina++;
  }
  console.log(`\n\n${enRango.length} pedidos en el rango.`);

  // Lo terminado como COMPLETED también cuenta si pasó por manos de un operador: el
  // validador falló y alguien lo aprobó a mano. Es justo el caso a corregir.
  const noPasoSolo = (r) =>
    !!r.validationError || !!r.manuallyApproved || r.status === 'VALIDATION_FAILED' || r.status === 'REJECTED';
  const conComprobante = enRango.filter((r) => r.proofUrl && (!SOLO_FALLIDOS || noPasoSolo(r)));
  console.log(`${conComprobante.length} con comprobante.\n`);

  // ── Bajar imágenes de a una, salteando lo ya descargado ────────────────
  const filas = [];
  let bajadas = 0, cacheadas = 0, fallidas = 0, bytes = 0;

  for (const r of conComprobante) {
    const ext = (r.proofUrl.split('?')[0].match(/\.(jpe?g|png|webp|pdf)$/i) || [, 'jpg'])[1].toLowerCase();
    const archivo = `${r.id}.${ext}`;
    const destino = path.join(SALIDA, archivo);

    if (fs.existsSync(destino) && fs.statSync(destino).size > 0) {
      cacheadas++;
    } else {
      try {
        bytes += await bajarImagen(r.proofUrl, destino);
        bajadas++;
      } catch (e) {
        console.log(`  ! ${r.id}: ${e.message}`);
        fallidas++;
        continue;
      }
    }

    const d = r.validationDetails || {};
    filas.push({
      requestId: r.id,
      archivo,
      montoPedido: r.amount,
      status: r.status,
      grupo: grupoDe(r.status),
      score: r.validationScore ?? '',
      ...Object.fromEntries(CAMPOS.map((c) => [c, d[c] ?? ''])),
      detectedPlatform: d.detectedPlatform ?? '',
      statusFlags: Array.isArray(d.statusFlags) ? d.statusFlags.join('|') : '',
      validationError: r.validationError ?? '',
      manuallyApproved: r.manuallyApproved ? 'si' : '',
      createdAt: r.createdAt,
    });

    if ((bajadas + cacheadas) % 10 === 0) {
      process.stdout.write(`  ${bajadas + cacheadas}/${conComprobante.length} (nuevas: ${bajadas}, ya estaban: ${cacheadas})\r`);
    }
  }

  const cabecera = ['requestId', 'archivo', 'montoPedido', 'status', 'grupo', 'score', ...CAMPOS, 'detectedPlatform', 'statusFlags', 'validationError', 'manuallyApproved', 'createdAt'];
  const csv = [cabecera.join(',')]
    .concat(filas.map((f) => cabecera.map((c) => csvCampo(f[c])).join(',')))
    .join('\n');
  fs.writeFileSync(path.join(SALIDA, 'index.csv'), csv + '\n');

  console.log(`\n\nListo.`);
  console.log(`  comprobantes en el corpus: ${filas.length}`);
  console.log(`  bajados ahora: ${bajadas} (${(bytes / 1024 / 1024).toFixed(1)} MB)   ya estaban: ${cacheadas}   fallidos: ${fallidas}`);
  console.log(`  index.csv: ${path.join(SALIDA, 'index.csv')}`);

  // Resumen por billetera detectada: sirve para saber si hay muestras suficientes
  // de la que se quiere trabajar antes de escribir un solo pattern.
  const porPlataforma = {};
  for (const f of filas) {
    const k = f.detectedPlatform || f.bankName || '(sin detectar)';
    porPlataforma[k] = (porPlataforma[k] || 0) + 1;
  }
  console.log('\nPor billetera detectada en producción:');
  for (const [k, n] of Object.entries(porPlataforma).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }

  socket.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
