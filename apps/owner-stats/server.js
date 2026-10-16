/**
 * owner-stats — Panel de KPIs de negocio para el dueño.
 *
 * Lee la DB de producción en modo SOLO LECTURA y sirve un dashboard estático.
 * Única env var obligatoria: DATABASE_URL.
 *
 * Opcionales:
 *   DASHBOARD_TZ        zona horaria del negocio (default Buenos Aires)
 *   DASHBOARD_USER/PASS si están las dos, el panel pide usuario y contraseña
 *   CACHE_TTL_MS        frescura del cache (default 60s)
 *   QUERY_TIMEOUT_MS    corte por query (default 15s)
 *   PG_POOL_MAX         conexiones máximas (default 4)
 */
const express = require('express');
const path = require('path');
const { ping } = require('./src/db');
const rangos = require('./src/ranges');
const resumen = require('./src/resumen');
const csv = require('./src/csv');
const { q } = require('./src/db');

const PORT = process.env.PORT || 3010;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);
// Cuánto tiempo seguimos sirviendo datos viejos si la DB deja de responder.
// Vale más un panel con números de hace 5 minutos que una pantalla de error.
const STALE_MAX_MS = Number(process.env.STALE_MAX_MS || 15 * 60_000);
// Techo para armar el resumen completo. Sin esto, una base que no responde deja
// la petición colgada hasta que el navegador se cansa.
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS || 25_000);
// Cuánto se espera a la revalidación antes de resignarse a servir lo viejo.
const ESPERA_REVALIDACION_MS = Number(process.env.ESPERA_REVALIDACION_MS || 4_000);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- auth opcional ----------
const USER = process.env.DASHBOARD_USER;
const PASS = process.env.DASHBOARD_PASS;
if (USER && PASS) {
  const esperado = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  app.use((req, res, next) => {
    if (req.path === '/salud') return next();
    const dado = req.headers.authorization || '';
    // Comparación de largo constante para no filtrar la contraseña por tiempos.
    if (dado.length === esperado.length && seguroIguales(dado, esperado)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Panel del dueño", charset="UTF-8"');
    res.status(401).send('Credenciales requeridas');
  });
  console.log('[auth] panel protegido con usuario y contraseña');
} else {
  console.warn('[auth] SIN protección: cualquiera con la URL ve los números. Definí DASHBOARD_USER y DASHBOARD_PASS.');
}

function seguroIguales(a, b) {
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// ---------- estáticos ----------
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    // `no-cache` no significa "no cachear": el navegador guarda el archivo pero
    // revalida con ETag y recibe un 304 vacío si no cambió. Con max-age el
    // navegador ni pregunta, y después de un deploy el panel sigue mostrando
    // el JS viejo sin que nadie entienda por qué.
    // La librería de gráficos sí se cachea fuerte: su nombre incluye la versión.
    res.setHeader('Cache-Control', filePath.includes('/vendor/')
      ? 'public, max-age=604800, immutable'
      : 'no-cache');
  },
}));

// ---------- cache con stale-while-revalidate ----------
const cache = new Map();
const enVuelo = new Map();

/** Corta una promesa que tarda demasiado, para no dejar peticiones colgadas. */
function conTimeout(promesa, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`la consulta tardó más de ${ms / 1000}s`)), ms);
    promesa.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

function revalidar(clave, fn) {
  if (enVuelo.has(clave)) return enVuelo.get(clave);
  const p = conTimeout(fn(), BUILD_TIMEOUT_MS)
    .then((data) => {
      // Un resumen sin el bloque principal significa que la base no contestó
      // nada útil. Guardarlo pisaría números válidos con una pantalla vacía:
      // como cada sección atrapa su propio error, esto llega acá como "éxito".
      if (!data || !data.periodo) {
        throw new Error('la base no devolvió datos utilizables');
      }
      cache.set(clave, { at: Date.now(), data });
      return data;
    })
    .catch((err) => {
      // Se anota el fallo para poder avisar en pantalla SOLO cuando la base
      // falló de verdad. Datos vencidos mientras se recalculan no son un
      // problema y no merecen una banda de advertencia.
      const hit = cache.get(clave);
      if (hit) hit.fallo = { at: Date.now(), motivo: err.message };
      throw err;
    })
    .finally(() => enVuelo.delete(clave));
  enVuelo.set(clave, p);
  return p;
}

async function conCache(clave, fn) {
  const hit = cache.get(clave);
  const edad = hit ? Date.now() - hit.at : Infinity;

  if (hit && edad < CACHE_TTL_MS) return { data: hit.data, cache: 'fresco' };

  // Con datos vencidos pero todavía usables: se devuelven YA y la actualización
  // corre por detrás. Esperar no servía de nada: como cada sección atrapa su
  // propio error, la promesa no falla rápido cuando la base no responde —
  // simplemente tarda un minuto. El resultado era una pantalla en blanco
  // justo cuando teníamos números perfectamente mostrables en memoria.
  if (hit && edad < STALE_MAX_MS) {
    // El fallo anterior NO se borra acá: si se borrara, se perdería la
    // evidencia justo antes de poder informarla (la revalidación tarda más en
    // fracasar que lo que esperamos). Una revalidación exitosa reemplaza la
    // entrada entera del cache, así que se limpia sola.
    const pendiente = revalidar(clave, fn);
    pendiente.catch((err) => console.warn('[cache] revalidación falló:', err.message));
    // Un respiro corto: si la base contesta rápido (el caso normal) devolvemos
    // datos frescos igual; si tarda, se sirve lo que hay y sigue por detrás.
    await Promise.race([pendiente.catch(() => {}), new Promise((r) => setTimeout(r, ESPERA_REVALIDACION_MS))]);
    const post = cache.get(clave);
    const edadFinal = Date.now() - post.at;
    return {
      data: post.data,
      cache: edadFinal < CACHE_TTL_MS ? 'fresco' : 'viejo',
      edadMs: edadFinal,
      ...(post.fallo ? { fallo: post.fallo.motivo } : {}),
    };
  }

  // Sin nada usable en memoria: no queda otra que esperar (con techo).
  return { data: await revalidar(clave, fn), cache: 'nuevo' };
}

// ---------- API ----------
app.get('/api/summary', async (req, res) => {
  try {
    // La clave sale de los parámetros crudos: resolver el período consulta la
    // base, y eso tiene que pasar solo cuando de verdad hay que recalcular.
    const { clave, panelId } = rangos.clave(req.query);
    const construir = async () => resumen.construir(await rangos.resolve(req.query), panelId);

    const { data, cache: estado, edadMs, fallo } = await conCache(clave, construir);
    res.set('Cache-Control', 'no-store');
    res.json({ ...data, cache: estado, ...(edadMs ? { cacheEdadMs: edadMs } : {}), ...(fallo ? { fallo } : {}) });
  } catch (err) {
    console.error('Error generando resumen:', err.message);
    res.status(503).json({ error: 'No se pudieron cargar los datos. Probá de nuevo en un minuto.' });
  }
});

app.get('/api/paneles', async (_req, res) => {
  try {
    const rows = await q('SELECT id, name AS nombre, "isActive" AS activo FROM "Panel" ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('Error listando paneles:', err.message);
    res.status(503).json({ error: 'No se pudo leer la lista de paneles.' });
  }
});

/** Opciones de período y tipos de export: el frontend no los hardcodea. */
app.get('/api/meta', (_req, res) => {
  res.json({ rangos: rangos.OPCIONES, exports: csv.tipos, tz: rangos.TZ });
});

app.get('/api/export.csv', async (req, res) => {
  const tipo = csv.TIPOS[req.query.tipo] ? req.query.tipo : 'resumen';
  try {
    const { clave, panelId } = rangos.clave(req.query);
    const construir = async () => resumen.construir(await rangos.resolve(req.query), panelId);
    const { data } = await conCache(clave, construir);

    const nombre = `tiorico-${tipo}-${clave.split('|')[0]}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(csv.TIPOS[tipo](data));
  } catch (err) {
    console.error('Error exportando CSV:', err.message);
    res.status(503).send('No se pudo generar el archivo.');
  }
});

app.get('/salud', async (_req, res) => {
  try {
    const t0 = Date.now();
    await ping();
    res.json({ ok: true, db: 'ok', latenciaMs: Date.now() - t0, cache: cache.size });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'error', detalle: err.message });
  }
});

app.listen(PORT, () => console.log(`owner-stats escuchando en :${PORT} (TZ ${rangos.TZ})`));
