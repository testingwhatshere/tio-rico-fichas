/**
 * owner-stats — Panel de KPIs de negocio para el dueño.
 *
 * Lee la DB de producción en modo SOLO LECTURA (default_transaction_read_only)
 * y sirve un dashboard estático. Única env var requerida: DATABASE_URL.
 */
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3010;
const TZ = process.env.DASHBOARD_TZ || 'America/Argentina/Buenos_Aires';
const CACHE_TTL_MS = 60_000;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  ssl: { rejectUnauthorized: false },
});

// Toda conexión del pool queda en solo-lectura: este servicio jamás escribe.
pool.on('connect', (client) => {
  client.query('SET default_transaction_read_only = on').catch(() => {});
});

// Expresiones SQL whitelisteadas para el inicio de cada período (en hora argentina).
const RANGE_FROM_SQL = {
  hoy: `date_trunc('day', (now() at time zone '${TZ}')) at time zone '${TZ}'`,
  '7d': `now() - interval '7 days'`,
  mes: `date_trunc('month', (now() at time zone '${TZ}')) at time zone '${TZ}'`,
  '30d': `now() - interval '30 days'`,
  todo: `to_timestamp(0)`,
};

const num = (v) => Number(v) || 0;

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function getSummary(range) {
  const fromSql = RANGE_FROM_SQL[range] || RANGE_FROM_SQL.hoy;

  const [
    cargas,
    premiosPedidos,
    premiosEstados,
    usuariosActivos,
    usuariosNuevos,
    porPanel,
    diarioCargas,
    diarioPremios,
    porHora,
    mensualCargas,
    mensualPremios,
    totales,
  ] = await Promise.all([
    // Cargas completadas del período (dinero que entró)
    q(`SELECT COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS monto,
              COALESCE(AVG(amount), 0)::float AS promedio
       FROM "Request"
       WHERE status = 'COMPLETED' AND "updatedAt" >= ${fromSql}`),

    // Premios pedidos en el período (todos los estados)
    q(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float AS monto
       FROM "PrizeClaim"
       WHERE "createdAt" >= ${fromSql}`),

    // Premios del período agrupados por estado
    q(`SELECT
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS pagados,
         COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0)::float AS pagados_monto,
         COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rechazados,
         COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED', 'REJECTED'))::int AS en_proceso
       FROM "PrizeClaim"
       WHERE "updatedAt" >= ${fromSql}`),

    // Jugadores que cargaron en el período
    q(`SELECT COUNT(DISTINCT "userId")::int AS count
       FROM "Request"
       WHERE "createdAt" >= ${fromSql}`),

    // Jugadores nuevos en el período
    q(`SELECT COUNT(*)::int AS count
       FROM "User"
       WHERE role = 'CLIENT' AND "createdAt" >= ${fromSql}`),

    // Cargas por panel en el período — lo más pedido por el dueño
    q(`SELECT COALESCE(p.name, 'Sin panel') AS panel,
              COUNT(*)::int AS cargas,
              COALESCE(SUM(r.amount), 0)::float AS monto
       FROM "Request" r
       LEFT JOIN "Panel" p ON p.id = r."panelId"
       WHERE r.status = 'COMPLETED' AND r."updatedAt" >= ${fromSql}
       GROUP BY 1
       ORDER BY 3 DESC`),

    // Serie diaria fija: últimos 30 días de entradas
    q(`SELECT to_char(("updatedAt" at time zone '${TZ}')::date, 'YYYY-MM-DD') AS fecha,
              COUNT(*)::int AS cargas,
              COALESCE(SUM(amount), 0)::float AS monto
       FROM "Request"
       WHERE status = 'COMPLETED' AND "updatedAt" >= now() - interval '30 days'
       GROUP BY 1`),

    // Serie diaria fija: últimos 30 días de premios pagados
    q(`SELECT to_char(("updatedAt" at time zone '${TZ}')::date, 'YYYY-MM-DD') AS fecha,
              COALESCE(SUM(amount), 0)::float AS monto
       FROM "PrizeClaim"
       WHERE status = 'COMPLETED' AND "updatedAt" >= now() - interval '30 days'
       GROUP BY 1`),

    // A qué hora se carga más (últimos 30 días)
    q(`SELECT EXTRACT(HOUR FROM ("updatedAt" at time zone '${TZ}'))::int AS hora,
              COUNT(*)::int AS cargas
       FROM "Request"
       WHERE status = 'COMPLETED' AND "updatedAt" >= now() - interval '30 days'
       GROUP BY 1`),

    // Mes a mes: últimos 12 meses de cargas
    q(`SELECT to_char(date_trunc('month', ("updatedAt" at time zone '${TZ}')), 'YYYY-MM') AS mes,
              COUNT(*)::int AS cargas,
              COALESCE(SUM(amount), 0)::float AS monto
       FROM "Request"
       WHERE status = 'COMPLETED'
         AND "updatedAt" >= (date_trunc('month', now() at time zone '${TZ}') - interval '11 months') at time zone '${TZ}'
       GROUP BY 1`),

    // Mes a mes: últimos 12 meses de premios pagados
    q(`SELECT to_char(date_trunc('month', ("updatedAt" at time zone '${TZ}')), 'YYYY-MM') AS mes,
              COUNT(*)::int AS premios,
              COALESCE(SUM(amount), 0)::float AS monto
       FROM "PrizeClaim"
       WHERE status = 'COMPLETED'
         AND "updatedAt" >= (date_trunc('month', now() at time zone '${TZ}') - interval '11 months') at time zone '${TZ}'
       GROUP BY 1`),

    // Totales históricos
    q(`SELECT
         (SELECT COUNT(*)::int FROM "Request" WHERE status = 'COMPLETED') AS cargas_total,
         (SELECT COALESCE(SUM(amount), 0)::float FROM "Request" WHERE status = 'COMPLETED') AS entradas_total,
         (SELECT COALESCE(SUM(amount), 0)::float FROM "PrizeClaim" WHERE status = 'COMPLETED') AS premios_total,
         (SELECT COUNT(*)::int FROM "User" WHERE role = 'CLIENT') AS jugadores_total`),
  ]);

  const c = cargas[0];
  const pe = premiosEstados[0];
  const t = totales[0];

  // Rellenar los 30 días (incluye días sin actividad) en hora argentina
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const cargasByDay = new Map(diarioCargas.map((r) => [r.fecha, r]));
  const premiosByDay = new Map(diarioPremios.map((r) => [r.fecha, r]));
  const diario = [];
  for (let i = 29; i >= 0; i--) {
    const fecha = dayFmt.format(new Date(Date.now() - i * 86_400_000));
    diario.push({
      fecha,
      cargas: num(cargasByDay.get(fecha)?.cargas),
      entradas: num(cargasByDay.get(fecha)?.monto),
      premios: num(premiosByDay.get(fecha)?.monto),
    });
  }

  // Rellenar las 24 horas
  const horaMap = new Map(porHora.map((r) => [r.hora, r.cargas]));
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, cargas: num(horaMap.get(h)) }));

  // Rellenar 12 meses
  const mCargas = new Map(mensualCargas.map((r) => [r.mes, r]));
  const mPremios = new Map(mensualPremios.map((r) => [r.mes, r]));
  const mensual = [];
  const now = new Date();
  const nowAR = new Date(dayFmt.format(now) + 'T12:00:00');
  for (let i = 11; i >= 0; i--) {
    const d = new Date(nowAR.getFullYear(), nowAR.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entradas = num(mCargas.get(mes)?.monto);
    const premios = num(mPremios.get(mes)?.monto);
    mensual.push({
      mes,
      cargas: num(mCargas.get(mes)?.cargas),
      entradas,
      premios,
      premiosCount: num(mPremios.get(mes)?.premios),
      resultado: entradas - premios,
    });
  }

  return {
    range,
    generatedAt: new Date().toISOString(),
    periodo: {
      cargas: { count: num(c.count), monto: num(c.monto), promedio: num(c.promedio) },
      premiosPedidos: { count: num(premiosPedidos[0].count), monto: num(premiosPedidos[0].monto) },
      premiosPagados: { count: num(pe.pagados), monto: num(pe.pagados_monto) },
      premiosEnProceso: num(pe.en_proceso),
      premiosRechazados: num(pe.rechazados),
      resultado: num(c.monto) - num(pe.pagados_monto),
      jugadoresActivos: num(usuariosActivos[0].count),
      jugadoresNuevos: num(usuariosNuevos[0].count),
    },
    porPanel: porPanel.map((r) => ({ panel: r.panel, cargas: num(r.cargas), monto: num(r.monto) })),
    diario,
    horas,
    mensual,
    totales: {
      cargas: num(t.cargas_total),
      entradas: num(t.entradas_total),
      premios: num(t.premios_total),
      jugadores: num(t.jugadores_total),
    },
  };
}

// Cache simple por rango para no castigar la DB con cada refresh
const cache = new Map();

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    // El HTML siempre fresco; assets con cache corto (los deploys son poco frecuentes)
    res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
  },
}));

app.get('/api/summary', async (req, res) => {
  const range = RANGE_FROM_SQL[req.query.range] ? req.query.range : 'hoy';
  const cached = cache.get(range);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.data);
  }
  try {
    const data = await getSummary(range);
    cache.set(range, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error('Error generando resumen:', err.message);
    res.status(503).json({ error: 'No se pudieron cargar los datos. Probá de nuevo en un minuto.' });
  }
});

app.get('/salud', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`owner-stats escuchando en :${PORT}`));
