/**
 * Resolución de períodos.
 *
 * Todo el negocio piensa en hora argentina, pero los timestamps de la DB son
 * UTC. En vez de hacer aritmética de calendario en JS (donde "el primero del
 * mes a las 00:00 en Buenos Aires" es fácil de errar), le pedimos a Postgres
 * que calcule los bordes con date_trunc sobre la hora local y nos devuelva
 * timestamps absolutos. Esos timestamps se pasan después como PARÁMETROS a
 * todas las demás queries: nada de fechas interpoladas en el SQL.
 */
const { q1 } = require('./db');

const TZ = process.env.DASHBOARD_TZ || 'America/Argentina/Buenos_Aires';

// Expresiones en hora local. `ln` = "local now". Ningún dato del usuario entra acá.
const DEFS = {
  hoy: {
    label: 'Hoy', corto: 'hoy', activos: 'Cargaron hoy',
    from: `date_trunc('day', ln)`, to: `ln`,
    prevFrom: `date_trunc('day', ln) - interval '1 day'`, prevTo: `ln - interval '1 day'`,
    prevLabel: 'ayer a esta hora',
  },
  ayer: {
    label: 'Ayer', corto: 'ayer', activos: 'Cargaron ayer',
    from: `date_trunc('day', ln) - interval '1 day'`, to: `date_trunc('day', ln)`,
    prevFrom: `date_trunc('day', ln) - interval '2 days'`, prevTo: `date_trunc('day', ln) - interval '1 day'`,
    prevLabel: 'anteayer',
  },
  '7d': {
    label: 'Últimos 7 días', corto: '7 días', activos: 'Cargaron (7 días)',
    from: `ln - interval '7 days'`, to: `ln`,
    prevFrom: `ln - interval '14 days'`, prevTo: `ln - interval '7 days'`,
    prevLabel: 'los 7 días previos',
  },
  '14d': {
    label: 'Últimos 14 días', corto: '14 días', activos: 'Cargaron (14 días)',
    from: `ln - interval '14 days'`, to: `ln`,
    prevFrom: `ln - interval '28 days'`, prevTo: `ln - interval '14 days'`,
    prevLabel: 'los 14 días previos',
  },
  '30d': {
    label: 'Últimos 30 días', corto: '30 días', activos: 'Cargaron (30 días)',
    from: `ln - interval '30 days'`, to: `ln`,
    prevFrom: `ln - interval '60 days'`, prevTo: `ln - interval '30 days'`,
    prevLabel: 'los 30 días previos',
  },
  '90d': {
    label: 'Últimos 90 días', corto: '90 días', activos: 'Cargaron (90 días)',
    from: `ln - interval '90 days'`, to: `ln`,
    prevFrom: `ln - interval '180 days'`, prevTo: `ln - interval '90 days'`,
    prevLabel: 'los 90 días previos',
  },
  semana: {
    label: 'Esta semana', corto: 'esta semana', activos: 'Cargaron esta semana',
    from: `date_trunc('week', ln)`, to: `ln`,
    prevFrom: `date_trunc('week', ln) - interval '7 days'`, prevTo: `ln - interval '7 days'`,
    prevLabel: 'la semana pasada a esta altura',
  },
  mes: {
    label: 'Este mes', corto: 'este mes', activos: 'Cargaron este mes',
    from: `date_trunc('month', ln)`, to: `ln`,
    prevFrom: `date_trunc('month', ln) - interval '1 month'`, prevTo: `ln - interval '1 month'`,
    prevLabel: 'el mes pasado a esta altura',
  },
  mes_pasado: {
    label: 'Mes pasado', corto: 'el mes pasado', activos: 'Cargaron el mes pasado',
    from: `date_trunc('month', ln) - interval '1 month'`, to: `date_trunc('month', ln)`,
    prevFrom: `date_trunc('month', ln) - interval '2 months'`, prevTo: `date_trunc('month', ln) - interval '1 month'`,
    prevLabel: 'el mes anterior',
  },
  anio: {
    label: 'Este año', corto: 'este año', activos: 'Cargaron este año',
    from: `date_trunc('year', ln)`, to: `ln`,
    prevFrom: `date_trunc('year', ln) - interval '1 year'`, prevTo: `ln - interval '1 year'`,
    prevLabel: 'el año pasado a esta altura',
  },
  '12m': {
    label: 'Últimos 12 meses', corto: '12 meses', activos: 'Cargaron (12 meses)',
    from: `date_trunc('month', ln) - interval '11 months'`, to: `ln`,
    prevFrom: `date_trunc('month', ln) - interval '23 months'`, prevTo: `date_trunc('month', ln) - interval '11 months'`,
    prevLabel: 'los 12 meses previos',
  },
  // 'todo' no usa expresiones: su inicio es la primera carga real (ver resolve()).
  // Arrancar en 1970 generaba una serie de 600+ buckets vacíos.
  todo: {
    label: 'Todo el histórico', corto: 'histórico', activos: 'Cargaron alguna vez',
    from: null, to: `ln`,
    prevFrom: null, prevTo: null, prevLabel: null,
  },
};

const RANGE_KEYS = Object.keys(DEFS);

/** Granularidad de la serie temporal según cuánto abarca el período. */
function bucketFor(fromMs, toMs) {
  const dias = (toMs - fromMs) / 86_400_000;
  if (dias <= 2.2) return 'hour';
  if (dias <= 92) return 'day';
  if (dias <= 400) return 'week';
  return 'month';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Devuelve { key, label, from, to, prevFrom, prevTo, bucket, ... } con Dates reales.
 * `custom` acepta from/to en formato YYYY-MM-DD, interpretados en hora argentina
 * e inclusivos del día `to`.
 */
async function resolve(query = {}) {
  const custom = query.range === 'custom' && ISO_DATE.test(query.from || '') && ISO_DATE.test(query.to || '');

  if (custom) {
    // Fechas del usuario: SIEMPRE como parámetros, nunca interpoladas.
    const r = await q1(
      `SELECT ($2::date)::timestamp AT TIME ZONE $1                        AS f,
              (($3::date) + interval '1 day')::timestamp AT TIME ZONE $1   AS t`,
      [TZ, query.from, query.to],
    );
    const from = r.f, to = r.t;
    const largo = to.getTime() - from.getTime();
    const fmt = (d) => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: TZ });
    return {
      key: 'custom', custom: true,
      label: `${fmt(from)} — ${fmt(new Date(to.getTime() - 1))}`,
      corto: 'el período', activos: 'Cargaron en el período',
      prevLabel: 'el período previo de igual duración',
      from, to,
      prevFrom: new Date(from.getTime() - largo),
      prevTo: from,
      bucket: bucketFor(from.getTime(), to.getTime()),
      desde: query.from, hasta: query.to,
    };
  }

  const key = DEFS[query.range] ? query.range : 'hoy';
  const d = DEFS[key];

  if (key === 'todo') {
    // El histórico empieza cuando empezó el negocio, no en el epoch.
    const r = await q1(
      `SELECT COALESCE((SELECT MIN("createdAt") FROM "Request"), now()) AS f, now() AS t`, [],
    );
    return {
      key, custom: false,
      label: d.label, corto: d.corto, activos: d.activos, prevLabel: null,
      from: r.f, to: r.t, prevFrom: null, prevTo: null,
      bucket: bucketFor(new Date(r.f).getTime(), new Date(r.t).getTime()),
    };
  }
  const sel = [
    `(${d.from}) AT TIME ZONE $1 AS f`,
    `(${d.to}) AT TIME ZONE $1 AS t`,
    d.prevFrom ? `(${d.prevFrom}) AT TIME ZONE $1 AS pf` : `NULL::timestamptz AS pf`,
    d.prevTo ? `(${d.prevTo}) AT TIME ZONE $1 AS pt` : `NULL::timestamptz AS pt`,
  ].join(', ');

  const r = await q1(`WITH b AS (SELECT (now() AT TIME ZONE $1) AS ln) SELECT ${sel} FROM b`, [TZ]);

  return {
    key, custom: false,
    label: d.label, corto: d.corto, activos: d.activos, prevLabel: d.prevLabel,
    from: r.f, to: r.t,
    prevFrom: r.pf, prevTo: r.pt,
    bucket: bucketFor(new Date(r.f).getTime(), new Date(r.t).getTime()),
  };
}

/**
 * Clave de cache a partir de los parámetros crudos, SIN tocar la base.
 * Importa que no consulte: si la clave se calculara con resolve() (que sí hace
 * una query para ubicar los bordes del período), una base caída dejaría colgada
 * hasta la petición que se podía responder entera desde memoria.
 */
function clave(query = {}) {
  const range = DEFS[query.range] ? query.range
    : (query.range === 'custom' && ISO_DATE.test(query.from || '') && ISO_DATE.test(query.to || ''))
      ? 'custom' : 'hoy';
  const desde = range === 'custom' ? query.from : '';
  const hasta = range === 'custom' ? query.to : '';
  const panel = typeof query.panel === 'string' && query.panel ? query.panel : '';
  return { clave: `${range}|${desde}|${hasta}|${panel}`, panelId: panel || null };
}

/** Opciones que el frontend dibuja en la barra de períodos. */
const OPCIONES = RANGE_KEYS.map((k) => ({ key: k, label: DEFS[k].label }));

module.exports = { TZ, resolve, clave, OPCIONES, RANGE_KEYS, bucketFor };
