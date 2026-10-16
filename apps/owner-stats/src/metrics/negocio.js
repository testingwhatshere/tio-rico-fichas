/**
 * Métricas de plata: qué entró, qué salió, por dónde y cuándo.
 *
 * Convención de tiempo (importante para leer los números):
 *  - Una carga cuenta en el momento en que quedó COMPLETED → se filtra por
 *    `Request.updatedAt`. Es la misma convención que usaba el panel viejo, así
 *    que los históricos no se mueven.
 *  - Una solicitud cuenta cuando el jugador la creó → `Request.createdAt`.
 *    Por eso el embudo y las cargas pueden no cerrar exacto dentro de un mismo
 *    período: son dos relojes distintos.
 */
const { q, q1 } = require('../db');
const { TZ } = require('../ranges');

const n = (v) => Number(v) || 0;

// Filtro de panel reutilizable: $N nulo = todos los paneles.
const PANEL = (alias, p) => `($${p}::text IS NULL OR ${alias}."panelId" = $${p})`;

// Los jugadores casi nunca tienen `User.panelId` cargado (solo ~130 de 4200:
// los preloaded no se pueden repartir desde la DB). Filtrar por ese campo daría
// casi cero al elegir un panel, así que el panel de un jugador se deduce de
// dónde cargó realmente.
const USUARIO_EN_PANEL = (p) =>
  `($${p}::text IS NULL OR EXISTS (
      SELECT 1 FROM "Request" rp WHERE rp."userId" = u.id AND rp."panelId" = $${p}))`;


/** KPIs de un tramo. Se llama dos veces (período actual y período previo). */
async function kpis(from, to, panelId) {
  const r = await q1(`
    WITH cargas AS (
      SELECT r.amount, r."userId"
      FROM "Request" r
      WHERE r.status = 'COMPLETED'
        AND r."updatedAt" >= $1 AND r."updatedAt" < $2
        AND ${PANEL('r', 3)}
    ),
    creadas AS (
      SELECT r.status
      FROM "Request" r
      WHERE r."createdAt" >= $1 AND r."createdAt" < $2
        AND ${PANEL('r', 3)}
    ),
    prem_ped AS (
      SELECT pc.amount FROM "PrizeClaim" pc
      WHERE pc."createdAt" >= $1 AND pc."createdAt" < $2 AND ${PANEL('pc', 3)}
    ),
    prem_est AS (
      SELECT pc.status, pc.amount FROM "PrizeClaim" pc
      WHERE pc."updatedAt" >= $1 AND pc."updatedAt" < $2 AND ${PANEL('pc', 3)}
    ),
    nuevos AS (
      SELECT 1 FROM "User" u
      WHERE u.role = 'CLIENT' AND u."createdAt" >= $1 AND u."createdAt" < $2
        AND ${USUARIO_EN_PANEL(3)}
    )
    SELECT
      (SELECT COUNT(*) FROM cargas)::int                                       AS cargas_count,
      (SELECT COALESCE(SUM(amount), 0) FROM cargas)::float                     AS entradas,
      (SELECT COALESCE(AVG(amount), 0) FROM cargas)::float                     AS ticket_prom,
      (SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount), 0)
         FROM cargas)::float                                                   AS ticket_mediana,
      (SELECT COALESCE(MAX(amount), 0) FROM cargas)::float                     AS ticket_max,
      (SELECT COUNT(DISTINCT "userId") FROM cargas)::int                       AS jugadores_activos,

      (SELECT COUNT(*) FROM creadas)::int                                      AS solicitudes,
      (SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED') FROM creadas)::int  AS sol_completadas,
      (SELECT COUNT(*) FILTER (WHERE status IN ('FAILED','REJECTED','CANCELLED','VALIDATION_FAILED'))
         FROM creadas)::int                                                    AS sol_perdidas,

      (SELECT COUNT(*) FROM prem_ped)::int                                     AS prem_ped_count,
      (SELECT COALESCE(SUM(amount), 0) FROM prem_ped)::float                   AS prem_ped_monto,
      (SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED') FROM prem_est)::int AS prem_pag_count,
      (SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0)
         FROM prem_est)::float                                                 AS prem_pag_monto,
      (SELECT COUNT(*) FILTER (WHERE status = 'REJECTED') FROM prem_est)::int  AS prem_rech,
      (SELECT COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED','REJECTED'))
         FROM prem_est)::int                                                   AS prem_proc,

      (SELECT COUNT(*) FROM nuevos)::int                                       AS jugadores_nuevos
  `, [from, to, panelId]);

  const entradas = n(r.entradas);
  const premios = n(r.prem_pag_monto);
  const cargas = n(r.cargas_count);
  const jug = n(r.jugadores_activos);
  const resueltas = n(r.sol_completadas) + n(r.sol_perdidas);

  return {
    cargas: {
      count: cargas,
      monto: entradas,
      promedio: n(r.ticket_prom),
      mediana: n(r.ticket_mediana),
      maximo: n(r.ticket_max),
    },
    solicitudes: {
      count: n(r.solicitudes),
      completadas: n(r.sol_completadas),
      perdidas: n(r.sol_perdidas),
      // Tasa de éxito sobre lo ya resuelto: lo que sigue en curso no penaliza.
      tasaExito: resueltas > 0 ? n(r.sol_completadas) / resueltas : null,
    },
    premiosPedidos: { count: n(r.prem_ped_count), monto: n(r.prem_ped_monto) },
    premiosPagados: { count: n(r.prem_pag_count), monto: premios },
    premiosEnProceso: n(r.prem_proc),
    premiosRechazados: n(r.prem_rech),
    resultado: entradas - premios,
    // Cuánto de cada peso que entra se va en premios. El número que define el margen.
    payoutRatio: entradas > 0 ? premios / entradas : null,
    jugadoresActivos: jug,
    jugadoresNuevos: n(r.jugadores_nuevos),
    cargasPorJugador: jug > 0 ? cargas / jug : 0,
    montoPorJugador: jug > 0 ? entradas / jug : 0,
  };
}

/** Serie temporal con los huecos rellenos por Postgres (generate_series). */
async function serie(from, to, panelId, bucket) {
  const rows = await q(`
    WITH pasos AS (
      -- El borde superior se corre un milisegundo hacia atras: cuando el fin del
      -- rango cae justo en el inicio de un bucket (rangos con fecha de fin, o
      -- "ayer"), generate_series agregaba un bucket vacio de mas al final.
      SELECT generate_series(
        date_trunc($4, ($1::timestamptz AT TIME ZONE $5)),
        date_trunc($4, (($2::timestamptz - interval '1 millisecond') AT TIME ZONE $5)),
        ('1 ' || $4)::interval
      ) AS b
    ),
    carg AS (
      SELECT date_trunc($4, (r."updatedAt" AT TIME ZONE $5)) AS b,
             COUNT(*)::int AS cargas,
             COALESCE(SUM(r.amount), 0)::float AS monto,
             COUNT(DISTINCT r."userId")::int AS jugadores
      FROM "Request" r
      WHERE r.status = 'COMPLETED'
        AND r."updatedAt" >= $1 AND r."updatedAt" < $2 AND ${PANEL('r', 3)}
      GROUP BY 1
    ),
    prem AS (
      SELECT date_trunc($4, (pc."updatedAt" AT TIME ZONE $5)) AS b,
             COUNT(*)::int AS premios,
             COALESCE(SUM(pc.amount), 0)::float AS monto
      FROM "PrizeClaim" pc
      WHERE pc.status = 'COMPLETED'
        AND pc."updatedAt" >= $1 AND pc."updatedAt" < $2 AND ${PANEL('pc', 3)}
      GROUP BY 1
    )
    SELECT to_char(p.b, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
           COALESCE(c.cargas, 0)      AS cargas,
           COALESCE(c.monto, 0)       AS entradas,
           COALESCE(c.jugadores, 0)   AS jugadores,
           COALESCE(pr.premios, 0)    AS premios_count,
           COALESCE(pr.monto, 0)      AS premios
    FROM pasos p
    LEFT JOIN carg c  ON c.b = p.b
    LEFT JOIN prem pr ON pr.b = p.b
    ORDER BY p.b
  `, [from, to, panelId, bucket, TZ]);

  return rows.map((r) => ({
    bucket: r.bucket,
    cargas: n(r.cargas),
    entradas: n(r.entradas),
    jugadores: n(r.jugadores),
    premiosCount: n(r.premios_count),
    premios: n(r.premios),
    resultado: n(r.entradas) - n(r.premios),
  }));
}

/**
 * Cargas, premios y fallas por panel. Se arma sobre la lista de paneles (no
 * sobre las cargas) para que un panel sin movimiento igual aparezca en cero,
 * que es justamente lo que el dueño quiere notar.
 */
async function porPanel(from, to) {
  const rows = await q(`
    SELECT p.id,
           p.name                            AS panel,
           p."isActive"                      AS activo,
           COALESCE(c.cargas, 0)::int        AS cargas,
           COALESCE(c.monto, 0)::float       AS monto,
           COALESCE(c.jugadores, 0)::int     AS jugadores,
           COALESCE(pr.monto, 0)::float      AS premios,
           COALESCE(f.fallidas, 0)::int      AS fallidas
    FROM "Panel" p
    LEFT JOIN (
      SELECT r."panelId" AS pid, COUNT(*)::int AS cargas,
             SUM(r.amount)::float AS monto, COUNT(DISTINCT r."userId")::int AS jugadores
      FROM "Request" r
      WHERE r.status = 'COMPLETED' AND r."updatedAt" >= $1 AND r."updatedAt" < $2
      GROUP BY 1
    ) c ON c.pid = p.id
    LEFT JOIN (
      SELECT pc."panelId" AS pid, SUM(pc.amount)::float AS monto
      FROM "PrizeClaim" pc
      WHERE pc.status = 'COMPLETED' AND pc."updatedAt" >= $1 AND pc."updatedAt" < $2
      GROUP BY 1
    ) pr ON pr.pid = p.id
    LEFT JOIN (
      SELECT r."panelId" AS pid, COUNT(*)::int AS fallidas
      FROM "Request" r
      WHERE r.status = 'FAILED' AND r."updatedAt" >= $1 AND r."updatedAt" < $2
      GROUP BY 1
    ) f ON f.pid = p.id

    UNION ALL

    -- Cargas huérfanas (panelId nulo): existen y hay que verlas, no esconderlas.
    SELECT NULL, 'Sin panel', true,
           COUNT(*)::int, COALESCE(SUM(r.amount), 0)::float,
           COUNT(DISTINCT r."userId")::int, 0::float,
           COUNT(*) FILTER (WHERE r.status = 'FAILED')::int
    FROM "Request" r
    WHERE r."panelId" IS NULL
      AND r.status IN ('COMPLETED','FAILED')
      AND r."updatedAt" >= $1 AND r."updatedAt" < $2
    HAVING COUNT(*) > 0

    ORDER BY 5 DESC
  `, [from, to]);

  return rows.map((r) => ({
    id: r.id || null,
    panel: r.panel,
    activo: r.activo,
    cargas: n(r.cargas),
    monto: n(r.monto),
    jugadores: n(r.jugadores),
    premios: n(r.premios),
    fallidas: n(r.fallidas),
    resultado: n(r.monto) - n(r.premios),
  }));
}

/** Por qué billetera entró la plata, y cuánto le queda de límite antes de rotar. */
async function porWallet(from, to, panelId) {
  const rows = await q(`
    SELECT w.id,
           w.label,
           w.type::text                      AS tipo,
           w."holderName"                    AS titular,
           w."isActive"                      AS activa,
           w."isSelected"                    AS seleccionada,
           w."amountLimit"::float            AS limite,
           w."accumulatedAmount"::float      AS acumulado,
           w."lastEmptiedAt"                 AS vaciada,
           COUNT(r.id)::int                  AS cargas,
           COALESCE(SUM(r.amount), 0)::float AS monto
    FROM "PaymentConfig" w
    LEFT JOIN "Request" r
      ON r."walletId" = w.id AND r.status = 'COMPLETED'
     AND r."updatedAt" >= $1 AND r."updatedAt" < $2 AND ${PANEL('r', 3)}
    GROUP BY w.id
    ORDER BY 11 DESC, w.label
  `, [from, to, panelId]);

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    tipo: r.tipo,
    titular: r.titular,
    activa: r.activa,
    seleccionada: r.seleccionada,
    cargas: n(r.cargas),
    monto: n(r.monto),
    acumulado: n(r.acumulado),
    limite: r.limite == null ? null : n(r.limite),
    vaciada: r.vaciada || null,
    usoLimite: r.limite > 0 ? Math.min(n(r.acumulado) / n(r.limite), 1) : null,
  }));
}

/** Cuánto pesa cada tamaño de carga: dice si el negocio vive de muchas chicas o pocas grandes. */
async function distribucion(from, to, panelId) {
  const rows = await q(`
    SELECT CASE
             WHEN amount <   2000 THEN 0
             WHEN amount <   5000 THEN 1
             WHEN amount <  10000 THEN 2
             WHEN amount <  20000 THEN 3
             WHEN amount <  50000 THEN 4
             WHEN amount < 100000 THEN 5
             ELSE 6
           END                              AS tramo,
           COUNT(*)::int                    AS cargas,
           COALESCE(SUM(amount), 0)::float  AS monto
    FROM "Request" r
    WHERE r.status = 'COMPLETED' AND r."updatedAt" >= $1 AND r."updatedAt" < $2
      AND ${PANEL('r', 3)}
    GROUP BY 1 ORDER BY 1
  `, [from, to, panelId]);

  const ETIQUETAS = [
    'menos de $2.000', '$2.000 a $5.000', '$5.000 a $10.000', '$10.000 a $20.000',
    '$20.000 a $50.000', '$50.000 a $100.000', 'más de $100.000',
  ];
  const map = new Map(rows.map((r) => [n(r.tramo), r]));
  return ETIQUETAS.map((etiqueta, i) => ({
    etiqueta,
    cargas: n(map.get(i)?.cargas),
    monto: n(map.get(i)?.monto),
  }));
}

/** Mapa de calor día de semana × hora: cuándo conviene tener gente mirando. */
async function heatmap(from, to, panelId) {
  const rows = await q(`
    SELECT EXTRACT(ISODOW FROM (r."updatedAt" AT TIME ZONE $4))::int AS dia,
           EXTRACT(HOUR   FROM (r."updatedAt" AT TIME ZONE $4))::int AS hora,
           COUNT(*)::int                    AS cargas,
           COALESCE(SUM(r.amount), 0)::float AS monto
    FROM "Request" r
    WHERE r.status = 'COMPLETED' AND r."updatedAt" >= $1 AND r."updatedAt" < $2
      AND ${PANEL('r', 3)}
    GROUP BY 1, 2
  `, [from, to, panelId, TZ]);

  const map = new Map(rows.map((r) => [`${r.dia}-${r.hora}`, r]));
  const celdas = [];
  for (let dia = 1; dia <= 7; dia++) {
    for (let hora = 0; hora < 24; hora++) {
      const c = map.get(`${dia}-${hora}`);
      celdas.push({ dia, hora, cargas: n(c?.cargas), monto: n(c?.monto) });
    }
  }
  return celdas;
}

/** Mes a mes, siempre 12 meses, independiente del rango elegido. */
async function mensual(panelId) {
  const rows = await q(`
    WITH borde AS (
      SELECT (date_trunc('month', (now() AT TIME ZONE $2)) - interval '11 months') AS ini_local
    ),
    pasos AS (
      SELECT generate_series(
        (SELECT ini_local FROM borde),
        date_trunc('month', (now() AT TIME ZONE $2)),
        interval '1 month'
      ) AS b
    ),
    carg AS (
      SELECT date_trunc('month', (r."updatedAt" AT TIME ZONE $2)) AS b,
             COUNT(*)::int AS cargas, COALESCE(SUM(r.amount), 0)::float AS monto,
             COUNT(DISTINCT r."userId")::int AS jugadores
      FROM "Request" r
      WHERE r.status = 'COMPLETED'
        AND r."updatedAt" >= (SELECT ini_local FROM borde) AT TIME ZONE $2
        AND ${PANEL('r', 1)}
      GROUP BY 1
    ),
    prem AS (
      SELECT date_trunc('month', (pc."updatedAt" AT TIME ZONE $2)) AS b,
             COUNT(*)::int AS premios, COALESCE(SUM(pc.amount), 0)::float AS monto
      FROM "PrizeClaim" pc
      WHERE pc.status = 'COMPLETED'
        AND pc."updatedAt" >= (SELECT ini_local FROM borde) AT TIME ZONE $2
        AND ${PANEL('pc', 1)}
      GROUP BY 1
    ),
    nuev AS (
      SELECT date_trunc('month', (u."createdAt" AT TIME ZONE $2)) AS b, COUNT(*)::int AS nuevos
      FROM "User" u
      WHERE u.role = 'CLIENT'
        AND u."createdAt" >= (SELECT ini_local FROM borde) AT TIME ZONE $2
        AND ${USUARIO_EN_PANEL(1)}
      GROUP BY 1
    )
    SELECT to_char(p.b, 'YYYY-MM')      AS mes,
           COALESCE(c.cargas, 0)        AS cargas,
           COALESCE(c.monto, 0)         AS entradas,
           COALESCE(c.jugadores, 0)     AS jugadores,
           COALESCE(pr.premios, 0)      AS premios_count,
           COALESCE(pr.monto, 0)        AS premios,
           COALESCE(nv.nuevos, 0)       AS nuevos
    FROM pasos p
    LEFT JOIN carg c  ON c.b  = p.b
    LEFT JOIN prem pr ON pr.b = p.b
    LEFT JOIN nuev nv ON nv.b = p.b
    ORDER BY p.b
  `, [panelId, TZ]);

  return rows.map((r) => {
    const entradas = n(r.entradas);
    const premios = n(r.premios);
    return {
      mes: r.mes,
      cargas: n(r.cargas),
      entradas,
      jugadores: n(r.jugadores),
      premiosCount: n(r.premios_count),
      premios,
      nuevos: n(r.nuevos),
      resultado: entradas - premios,
      payoutRatio: entradas > 0 ? premios / entradas : null,
    };
  });
}

/** Totales históricos, sin filtro de fecha. */
async function totales(panelId) {
  const r = await q1(`
    SELECT
      (SELECT COUNT(*) FROM "Request" r WHERE r.status = 'COMPLETED' AND ${PANEL('r', 1)})::int   AS cargas,
      (SELECT COALESCE(SUM(r.amount), 0) FROM "Request" r
        WHERE r.status = 'COMPLETED' AND ${PANEL('r', 1)})::float                                 AS entradas,
      (SELECT COALESCE(SUM(pc.amount), 0) FROM "PrizeClaim" pc
        WHERE pc.status = 'COMPLETED' AND ${PANEL('pc', 1)})::float                               AS premios,
      (SELECT COUNT(*) FROM "User" u
        WHERE u.role = 'CLIENT' AND ${USUARIO_EN_PANEL(1)})::int                                  AS jugadores,
      (SELECT MIN(r."createdAt") FROM "Request" r WHERE ${PANEL('r', 1)})                         AS desde
  `, [panelId]);

  const entradas = n(r.entradas);
  const premios = n(r.premios);
  return {
    cargas: n(r.cargas),
    entradas,
    premios,
    jugadores: n(r.jugadores),
    resultado: entradas - premios,
    payoutRatio: entradas > 0 ? premios / entradas : null,
    desde: r.desde || null,
  };
}

module.exports = { kpis, serie, porPanel, porWallet, distribucion, heatmap, mensual, totales };
