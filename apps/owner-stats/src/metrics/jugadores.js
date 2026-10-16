/**
 * Métricas de jugadores: quiénes son, cuánto valen y cuáles se están yendo.
 */
const { q, q1 } = require('../db');
const { TZ } = require('../ranges');

const n = (v) => Number(v) || 0;
const PANEL = (alias, p) => `($${p}::text IS NULL OR ${alias}."panelId" = $${p})`;

/** Los que más plata metieron en el período. */
async function top(from, to, panelId, limite = 12) {
  const rows = await q(`
    SELECT u.id,
           COALESCE(u.username, r."targetUsername", '(sin nombre)') AS jugador,
           COUNT(*)::int                       AS cargas,
           COALESCE(SUM(r.amount), 0)::float   AS monto,
           MAX(r."updatedAt")                  AS ultima,
           MIN(u."createdAt")                  AS alta,
           COALESCE((
             SELECT SUM(pc.amount) FROM "PrizeClaim" pc
             WHERE pc."userId" = u.id AND pc.status = 'COMPLETED'
               AND pc."updatedAt" >= $1 AND pc."updatedAt" < $2
           ), 0)::float                        AS premios
    FROM "Request" r
    JOIN "User" u ON u.id = r."userId"
    WHERE r.status = 'COMPLETED'
      AND r."updatedAt" >= $1 AND r."updatedAt" < $2 AND ${PANEL('r', 3)}
    GROUP BY u.id, r."targetUsername"
    ORDER BY 4 DESC
    LIMIT $4
  `, [from, to, panelId, limite]);

  return rows.map((r) => ({
    id: r.id,
    jugador: r.jugador,
    cargas: n(r.cargas),
    monto: n(r.monto),
    premios: n(r.premios),
    neto: n(r.monto) - n(r.premios),
    ultima: r.ultima,
    alta: r.alta,
  }));
}

/**
 * Nuevos vs. recurrentes: de la plata del período, cuánta vino de gente que ya
 * jugaba y cuánta de gente que llegó ahora. Dice si el negocio crece o se
 * sostiene sobre los mismos.
 */
async function composicion(from, to, panelId) {
  const r = await q1(`
    WITH act AS (
      SELECT r."userId" AS uid, SUM(r.amount)::float AS monto, COUNT(*)::int AS cargas
      FROM "Request" r
      WHERE r.status = 'COMPLETED'
        AND r."updatedAt" >= $1 AND r."updatedAt" < $2 AND ${PANEL('r', 3)}
      GROUP BY 1
    ),
    previo AS (
      -- ¿Ya había cargado alguna vez ANTES del período?
      SELECT DISTINCT r."userId" AS uid
      FROM "Request" r
      WHERE r.status = 'COMPLETED' AND r."updatedAt" < $1 AND ${PANEL('r', 3)}
    )
    SELECT
      COUNT(*) FILTER (WHERE p.uid IS NOT NULL)::int                              AS recurrentes,
      COUNT(*) FILTER (WHERE p.uid IS NULL)::int                                  AS nuevos,
      COALESCE(SUM(a.monto) FILTER (WHERE p.uid IS NOT NULL), 0)::float           AS monto_recurrentes,
      COALESCE(SUM(a.monto) FILTER (WHERE p.uid IS NULL), 0)::float               AS monto_nuevos,
      COALESCE(SUM(a.cargas) FILTER (WHERE p.uid IS NOT NULL), 0)::int            AS cargas_recurrentes,
      COALESCE(SUM(a.cargas) FILTER (WHERE p.uid IS NULL), 0)::int                AS cargas_nuevos
    FROM act a LEFT JOIN previo p ON p.uid = a.uid
  `, [from, to, panelId]);

  const mr = n(r.monto_recurrentes), mn = n(r.monto_nuevos);
  return {
    recurrentes: { jugadores: n(r.recurrentes), monto: mr, cargas: n(r.cargas_recurrentes) },
    nuevos: { jugadores: n(r.nuevos), monto: mn, cargas: n(r.cargas_nuevos) },
    participacionRecurrentes: mr + mn > 0 ? mr / (mr + mn) : null,
  };
}

/** Cuántas veces carga cada jugador en el período. Muestra si hay hábito o es one-shot. */
async function frecuencia(from, to, panelId) {
  const rows = await q(`
    WITH act AS (
      SELECT r."userId" AS uid, COUNT(*)::int AS cargas, SUM(r.amount)::float AS monto
      FROM "Request" r
      WHERE r.status = 'COMPLETED'
        AND r."updatedAt" >= $1 AND r."updatedAt" < $2 AND ${PANEL('r', 3)}
      GROUP BY 1
    )
    SELECT CASE WHEN cargas = 1 THEN 0
                WHEN cargas = 2 THEN 1
                WHEN cargas <= 5 THEN 2
                WHEN cargas <= 10 THEN 3
                ELSE 4 END                     AS tramo,
           COUNT(*)::int                       AS jugadores,
           COALESCE(SUM(monto), 0)::float      AS monto
    FROM act GROUP BY 1 ORDER BY 1
  `, [from, to, panelId]);

  const ETIQUETAS = ['1 carga', '2 cargas', '3 a 5 cargas', '6 a 10 cargas', 'más de 10 cargas'];
  const map = new Map(rows.map((r) => [n(r.tramo), r]));
  return ETIQUETAS.map((etiqueta, i) => ({
    etiqueta,
    jugadores: n(map.get(i)?.jugadores),
    monto: n(map.get(i)?.monto),
  }));
}

/**
 * Cohortes de retención por mes de primera carga (últimos 6 meses).
 * Fila = grupo que debutó ese mes. Columna = cuántos de ese grupo volvieron
 * a cargar N meses después. Es la métrica que dice si el negocio retiene.
 */
async function cohortes(panelId) {
  const rows = await q(`
    WITH primera AS (
      SELECT r."userId" AS uid,
             date_trunc('month', (MIN(r."updatedAt") AT TIME ZONE $2)) AS cohorte
      FROM "Request" r
      WHERE r.status = 'COMPLETED' AND ${PANEL('r', 1)}
      GROUP BY 1
    ),
    recientes AS (
      SELECT * FROM primera
      WHERE cohorte >= date_trunc('month', (now() AT TIME ZONE $2)) - interval '5 months'
    ),
    actividad AS (
      SELECT p.uid, p.cohorte,
             date_trunc('month', (r."updatedAt" AT TIME ZONE $2)) AS mes
      FROM recientes p
      JOIN "Request" r ON r."userId" = p.uid AND r.status = 'COMPLETED' AND ${PANEL('r', 1)}
      GROUP BY 1, 2, 3
    )
    SELECT to_char(cohorte, 'YYYY-MM')                                            AS cohorte,
           (EXTRACT(YEAR FROM age(mes, cohorte)) * 12
            + EXTRACT(MONTH FROM age(mes, cohorte)))::int                         AS offset_mes,
           COUNT(DISTINCT uid)::int                                               AS jugadores
    FROM actividad
    GROUP BY 1, 2 ORDER BY 1, 2
  `, [panelId, TZ]);

  const porCohorte = new Map();
  for (const r of rows) {
    if (!porCohorte.has(r.cohorte)) porCohorte.set(r.cohorte, new Map());
    porCohorte.get(r.cohorte).set(n(r.offset_mes), n(r.jugadores));
  }

  return [...porCohorte.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([cohorte, meses]) => {
      const base = meses.get(0) || 0;
      const celdas = [];
      for (let i = 0; i <= 5; i++) {
        const v = meses.get(i);
        celdas.push(v == null ? null : { jugadores: v, tasa: base > 0 ? v / base : null });
      }
      return { cohorte, base, celdas };
    });
}

/**
 * Jugadores que se están apagando: cargaban seguido y hace rato no aparecen.
 * Es la lista accionable — a esta gente se la puede ir a buscar.
 */
async function enRiesgo(panelId, limite = 12) {
  const rows = await q(`
    WITH hist AS (
      SELECT r."userId" AS uid,
             COUNT(*)::int AS cargas,
             SUM(r.amount)::float AS monto,
             MAX(r."updatedAt") AS ultima
      FROM "Request" r
      WHERE r.status = 'COMPLETED' AND ${PANEL('r', 1)}
        AND r."updatedAt" >= now() - interval '180 days'
      GROUP BY 1
      HAVING COUNT(*) >= 3
    )
    SELECT COALESCE(u.username, '(sin nombre)') AS jugador,
           h.cargas, h.monto, h.ultima,
           EXTRACT(DAY FROM (now() - h.ultima))::int AS dias
    FROM hist h JOIN "User" u ON u.id = h.uid
    WHERE h.ultima < now() - interval '14 days'
    ORDER BY h.monto DESC
    LIMIT $2
  `, [panelId, limite]);

  return rows.map((r) => ({
    jugador: r.jugador,
    cargas: n(r.cargas),
    monto: n(r.monto),
    ultima: r.ultima,
    dias: n(r.dias),
  }));
}

/** Recurrencia mes contra mes: de los que cargaron el mes pasado, cuántos volvieron. */
async function recurrenciaMensual(panelId) {
  const r = await q1(`
    WITH mes_actual AS (
      SELECT DISTINCT r."userId" AS uid FROM "Request" r
      WHERE r.status = 'COMPLETED' AND ${PANEL('r', 1)}
        AND r."updatedAt" >= date_trunc('month', (now() AT TIME ZONE $2)) AT TIME ZONE $2
    ),
    mes_previo AS (
      SELECT DISTINCT r."userId" AS uid FROM "Request" r
      WHERE r.status = 'COMPLETED' AND ${PANEL('r', 1)}
        AND r."updatedAt" >= (date_trunc('month', (now() AT TIME ZONE $2)) - interval '1 month') AT TIME ZONE $2
        AND r."updatedAt" <  date_trunc('month', (now() AT TIME ZONE $2)) AT TIME ZONE $2
    )
    SELECT (SELECT COUNT(*) FROM mes_previo)::int AS previo,
           (SELECT COUNT(*) FROM mes_actual)::int AS actual,
           (SELECT COUNT(*) FROM mes_previo p WHERE EXISTS
              (SELECT 1 FROM mes_actual a WHERE a.uid = p.uid))::int AS volvieron
  `, [panelId, TZ]);

  const previo = n(r.previo);
  return {
    mesPrevio: previo,
    mesActual: n(r.actual),
    volvieron: n(r.volvieron),
    tasa: previo > 0 ? n(r.volvieron) / previo : null,
  };
}

module.exports = { top, composicion, frecuencia, cohortes, enRiesgo, recurrenciaMensual };
