/**
 * Métricas de operación: qué tan bien está funcionando la máquina.
 * Acá vive lo que explica por qué los números de plata son los que son.
 */
const { q, q1 } = require('../db');
const { TZ } = require('../ranges');

const n = (v) => Number(v) || 0;
const PANEL = (alias, p) => `($${p}::text IS NULL OR ${alias}."panelId" = $${p})`;

/**
 * Embudo: de las solicitudes CREADAS en el período, dónde terminó cada una.
 * Los estados se agrupan en etapas porque al dueño no le sirve ver los 10
 * RequestStatus crudos; le sirve saber en qué escalón se le cae la gente.
 */
async function embudo(from, to, panelId) {
  const rows = await q(`
    SELECT r.status::text AS estado, COUNT(*)::int AS cantidad,
           COALESCE(SUM(r.amount), 0)::float AS monto
    FROM "Request" r
    WHERE r."createdAt" >= $1 AND r."createdAt" < $2 AND ${PANEL('r', 3)}
    GROUP BY 1
  `, [from, to, panelId]);

  const por = Object.fromEntries(rows.map((r) => [r.estado, r]));
  const c = (s) => n(por[s]?.cantidad);
  const m = (s) => n(por[s]?.monto);

  const total = rows.reduce((a, r) => a + n(r.cantidad), 0);
  const sinComprobante = c('PENDING_PROOF');
  const enValidacion = c('VALIDATING');
  const validacionFallida = c('VALIDATION_FAILED');
  const enCola = c('APPROVED') + c('PENDING_MP_VERIFICATION');
  const procesando = c('PROCESSING');
  const completadas = c('COMPLETED');
  const falladas = c('FAILED');
  const rechazadas = c('REJECTED');
  const canceladas = c('CANCELLED');

  // Cada escalón cuenta a los que llegaron hasta ahí (los de arriba lo pasaron).
  const conComprobante = total - sinComprobante - canceladas;
  const validadas = conComprobante - validacionFallida - rechazadas - enValidacion;
  const ejecutadas = completadas + falladas;

  return {
    total,
    etapas: [
      { etapa: 'Solicitudes iniciadas', cantidad: total, nota: 'el jugador abrió el pedido' },
      { etapa: 'Subieron comprobante', cantidad: conComprobante, nota: `${sinComprobante} quedaron sin subirlo` },
      { etapa: 'Comprobante validado', cantidad: validadas, nota: `${validacionFallida} no pasaron la validación` },
      { etapa: 'Llegaron al bot', cantidad: ejecutadas, nota: `${enCola + procesando} todavía en curso` },
      { etapa: 'Fichas cargadas', cantidad: completadas, nota: `${falladas} fallaron en el panel` },
    ],
    detalle: {
      sinComprobante, enValidacion, validacionFallida, enCola, procesando,
      completadas, falladas, rechazadas, canceladas,
    },
    montoCompletado: m('COMPLETED'),
    montoPerdido: m('FAILED') + m('REJECTED') + m('VALIDATION_FAILED'),
    // Conversión punta a punta: de cada 100 que abren un pedido, cuántas terminan cargadas.
    conversion: total > 0 ? completadas / total : null,
  };
}

/** Cuánto tarda una carga de punta a punta, y dónde se va el tiempo. */
async function tiempos(from, to, panelId) {
  const r = await q1(`
    WITH ciclo AS (
      SELECT EXTRACT(EPOCH FROM (r."updatedAt" - r."createdAt")) AS seg
      FROM "Request" r
      WHERE r.status = 'COMPLETED'
        AND r."updatedAt" >= $1 AND r."updatedAt" < $2 AND ${PANEL('r', 3)}
        AND r."updatedAt" > r."createdAt"
    ),
    espera AS (
      SELECT EXTRACT(EPOCH FROM (j."startedAt" - j."createdAt")) AS seg
      FROM "Job" j
      WHERE j."startedAt" IS NOT NULL
        AND j."createdAt" >= $1 AND j."createdAt" < $2 AND ${PANEL('j', 3)}
    ),
    ejec AS (
      SELECT EXTRACT(EPOCH FROM (j."completedAt" - j."startedAt")) AS seg
      FROM "Job" j
      WHERE j."completedAt" IS NOT NULL AND j."startedAt" IS NOT NULL
        AND j."createdAt" >= $1 AND j."createdAt" < $2 AND ${PANEL('j', 3)}
    ),
    premio AS (
      SELECT EXTRACT(EPOCH FROM (pc."updatedAt" - pc."createdAt")) AS seg
      FROM "PrizeClaim" pc
      WHERE pc.status = 'COMPLETED'
        AND pc."updatedAt" >= $1 AND pc."updatedAt" < $2 AND ${PANEL('pc', 3)}
    )
    SELECT
      (SELECT COUNT(*) FROM ciclo)::int                                                 AS muestras,
      (SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY seg) FROM ciclo)::float      AS ciclo_p50,
      (SELECT percentile_cont(0.9)  WITHIN GROUP (ORDER BY seg) FROM ciclo)::float      AS ciclo_p90,
      (SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY seg) FROM espera)::float     AS espera_p50,
      (SELECT percentile_cont(0.9)  WITHIN GROUP (ORDER BY seg) FROM espera)::float     AS espera_p90,
      (SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY seg) FROM ejec)::float       AS ejec_p50,
      (SELECT percentile_cont(0.9)  WITHIN GROUP (ORDER BY seg) FROM ejec)::float       AS ejec_p90,
      (SELECT COUNT(*) FROM premio)::int                                                AS premio_muestras,
      (SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY seg) FROM premio)::float     AS premio_p50,
      (SELECT percentile_cont(0.9)  WITHIN GROUP (ORDER BY seg) FROM premio)::float     AS premio_p90
  `, [from, to, panelId]);

  const s = (v) => (v == null ? null : n(v));
  return {
    muestras: n(r.muestras),
    cicloP50: s(r.ciclo_p50), cicloP90: s(r.ciclo_p90),
    esperaColaP50: s(r.espera_p50), esperaColaP90: s(r.espera_p90),
    ejecucionP50: s(r.ejec_p50), ejecucionP90: s(r.ejec_p90),
    premioMuestras: n(r.premio_muestras),
    premioP50: s(r.premio_p50), premioP90: s(r.premio_p90),
  };
}

/** Salud del bot: qué corrió, qué falló y por qué. */
async function bot(from, to, panelId) {
  const [porTipo, errores, resumen] = await Promise.all([
    q(`SELECT j.type::text AS tipo,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE j.status = 'COMPLETED')::int AS ok,
              COUNT(*) FILTER (WHERE j.status = 'FAILED')::int    AS fallados,
              COUNT(*) FILTER (WHERE j.status IN ('QUEUED','PROCESSING'))::int AS en_curso
       FROM "Job" j
       WHERE j."createdAt" >= $1 AND j."createdAt" < $2 AND ${PANEL('j', 3)}
       GROUP BY 1 ORDER BY 2 DESC`, [from, to, panelId]),

    // Agrupamos por el error recortado: los mensajes largos traen IDs que
    // ensucian el agrupado, pero el prefijo identifica bien la causa.
    q(`SELECT left(coalesce(j.error, 'sin detalle'), 90) AS motivo,
              COUNT(*)::int AS cantidad,
              MAX(j."createdAt")   AS ultima
       FROM "Job" j
       WHERE j.status = 'FAILED'
         AND j."createdAt" >= $1 AND j."createdAt" < $2 AND ${PANEL('j', 3)}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to, panelId]),

    q1(`SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS ok,
               COUNT(*) FILTER (WHERE status = 'FAILED')::int    AS fallados
        FROM "Job" j
        WHERE j."createdAt" >= $1 AND j."createdAt" < $2 AND ${PANEL('j', 3)}`, [from, to, panelId]),
  ]);

  const resueltos = n(resumen.ok) + n(resumen.fallados);
  return {
    total: n(resumen.total),
    ok: n(resumen.ok),
    fallados: n(resumen.fallados),
    tasaExito: resueltos > 0 ? n(resumen.ok) / resueltos : null,
    porTipo: porTipo.map((r) => ({
      tipo: r.tipo,
      total: n(r.total), ok: n(r.ok), fallados: n(r.fallados), enCurso: n(r.en_curso),
      tasaExito: n(r.ok) + n(r.fallados) > 0 ? n(r.ok) / (n(r.ok) + n(r.fallados)) : null,
    })),
    errores: errores.map((r) => ({
      motivo: r.motivo, cantidad: n(r.cantidad), ultima: r.ultima,
    })),
  };
}

/** Qué tanto trabaja sola la IA y qué tanto tiene que meter mano un operador. */
async function validacion(from, to, panelId) {
  const r = await q1(`
    WITH v AS (
      SELECT r."validationScore" AS score, r."manuallyApproved" AS manual, r.status::text AS estado
      FROM "Request" r
      WHERE r."createdAt" >= $1 AND r."createdAt" < $2 AND ${PANEL('r', 3)}
        AND r."proofUploadedAt" IS NOT NULL
    )
    SELECT COUNT(*)::int                                                    AS con_comprobante,
           COUNT(*) FILTER (WHERE manual)::int                              AS manuales,
           COUNT(*) FILTER (WHERE estado = 'VALIDATION_FAILED')::int        AS fallidas,
           COUNT(score)::int                                                AS con_score,
           COALESCE(AVG(score), 0)::float                                   AS score_prom,
           COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY score), 0)::float AS score_mediana
    FROM v
  `, [from, to, panelId]);

  const total = n(r.con_comprobante);
  return {
    conComprobante: total,
    manuales: n(r.manuales),
    automaticas: total - n(r.manuales),
    // El KPI de "casi totalmente automatizado": qué fracción pasó sin humano.
    tasaAutomatica: total > 0 ? (total - n(r.manuales)) / total : null,
    validacionFallida: n(r.fallidas),
    scorePromedio: n(r.con_score) > 0 ? n(r.score_prom) : null,
    scoreMediana: n(r.con_score) > 0 ? n(r.score_mediana) : null,
  };
}

/** Pipeline de premios por estado, con la plata comprometida en cada escalón. */
async function premios(from, to, panelId) {
  const rows = await q(`
    SELECT pc.status::text AS estado, COUNT(*)::int AS cantidad,
           COALESCE(SUM(pc.amount), 0)::float AS monto
    FROM "PrizeClaim" pc
    WHERE pc."createdAt" >= $1 AND pc."createdAt" < $2 AND ${PANEL('pc', 3)}
    GROUP BY 1 ORDER BY 2 DESC
  `, [from, to, panelId]);

  const ETIQUETAS = {
    PENDING_PAYMENT_DETAILS: 'Esperando datos de pago',
    PENDING_VERIFICATION: 'Esperando verificar fichas',
    VERIFYING_CHIPS: 'Verificando fichas',
    VERIFIED: 'Fichas confirmadas — falta decidir',
    VERIFICATION_FAILED: 'No tenía fichas suficientes',
    PROCESSING: 'Retirando fichas',
    CHIPS_WITHDRAWN: 'Fichas retiradas — falta pagar',
    COMPLETED: 'Pagado',
    REJECTED: 'Rechazado',
    FAILED: 'Falló el retiro',
  };
  // Los estados donde la plata todavía le debe al jugador: lo que hay que destrabar hoy.
  const PENDIENTES = new Set(['VERIFIED', 'CHIPS_WITHDRAWN', 'PROCESSING', 'PENDING_VERIFICATION', 'VERIFYING_CHIPS']);

  return {
    porEstado: rows.map((r) => ({
      estado: r.estado,
      etiqueta: ETIQUETAS[r.estado] || r.estado,
      cantidad: n(r.cantidad),
      monto: n(r.monto),
      pendiente: PENDIENTES.has(r.estado),
    })),
  };
}

/**
 * Foto del ahora. Todo lo que alimenta una alerta se mide sobre una ventana
 * reciente, no sobre el acumulado histórico.
 *
 * El motivo es concreto: la base arrastra pedidos que quedaron colgados en
 * estados intermedios hace meses. Contarlos como "cola actual" hacía que el
 * panel gritara "64 cargas trabadas, la más vieja hace 168 días" todos los
 * días, para siempre. Eso no es una alerta, es ruido — y una alerta que
 * siempre está encendida se deja de mirar.
 *
 * Los totales históricos igual se devuelven, pero como "residuo": se muestran
 * al costado, sin color de alarma.
 */
async function estadoActual(panelId) {
  const [r, bot24] = await Promise.all([
    q1(`SELECT
          -- Ventana operativa: lo que entró en las últimas 24 h y sigue esperando.
          (SELECT COUNT(*) FROM "Request" r
            WHERE r.status IN ('APPROVED','PROCESSING')
              AND r."createdAt" > now() - interval '24 hours' AND ${PANEL('r', 1)})::int      AS en_cola,
          (SELECT MIN(r."createdAt") FROM "Request" r
            WHERE r.status IN ('APPROVED','PROCESSING')
              AND r."createdAt" > now() - interval '24 hours' AND ${PANEL('r', 1)})           AS mas_vieja_en_cola,
          (SELECT COUNT(*) FROM "Request" r
            WHERE r.status IN ('VALIDATING','PENDING_MP_VERIFICATION')
              AND r."createdAt" > now() - interval '24 hours' AND ${PANEL('r', 1)})::int      AS validando,
          (SELECT COUNT(*) FROM "Request" r
            WHERE r.status = 'VALIDATION_FAILED'
              AND r."createdAt" > now() - interval '48 hours' AND ${PANEL('r', 1)})::int      AS validacion_fallida,
          (SELECT COUNT(*) FROM "Request" r
            WHERE r.status = 'FAILED' AND r."updatedAt" > now() - interval '24 hours'
              AND ${PANEL('r', 1)})::int                                                      AS fallidas_24h,
          (SELECT COUNT(*) FROM "PrizeClaim" pc
            WHERE pc.status IN ('VERIFIED','CHIPS_WITHDRAWN')
              AND pc."createdAt" > now() - interval '7 days' AND ${PANEL('pc', 1)})::int      AS premios_por_pagar,
          (SELECT COALESCE(SUM(pc.amount), 0) FROM "PrizeClaim" pc
            WHERE pc.status IN ('VERIFIED','CHIPS_WITHDRAWN')
              AND pc."createdAt" > now() - interval '7 days' AND ${PANEL('pc', 1)})::float    AS premios_por_pagar_monto,
          (SELECT MAX(r."updatedAt") FROM "Request" r
            WHERE r.status = 'COMPLETED' AND ${PANEL('r', 1)})                                AS ultima_carga,

          -- Residuo: lo mismo sin ventana. Contexto, no alarma.
          (SELECT COUNT(*) FROM "Request" r
            WHERE r.status IN ('APPROVED','PROCESSING','VALIDATING','VALIDATION_FAILED')
              AND r."createdAt" <= now() - interval '7 days' AND ${PANEL('r', 1)})::int       AS residuo_pedidos,
          (SELECT COUNT(*) FROM "PrizeClaim" pc
            WHERE pc.status IN ('VERIFIED','CHIPS_WITHDRAWN')
              AND pc."createdAt" <= now() - interval '7 days' AND ${PANEL('pc', 1)})::int     AS residuo_premios
    `, [panelId]),

    // Salud del bot en las últimas 24 h: una tasa sobre el histórico no dice
    // nada de si el bot anda bien en este momento.
    q1(`SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS ok,
               COUNT(*) FILTER (WHERE status = 'FAILED')::int    AS fallados
        FROM "Job" j
        WHERE j."createdAt" > now() - interval '24 hours' AND ${PANEL('j', 1)}`, [panelId]),
  ]);

  const ok24 = n(bot24.ok);
  const fallados24 = n(bot24.fallados);

  return {
    enCola: n(r.en_cola),
    masViejaEnCola: r.mas_vieja_en_cola || null,
    validando: n(r.validando),
    validacionFallida: n(r.validacion_fallida),
    fallidas24h: n(r.fallidas_24h),
    premiosPorPagar: n(r.premios_por_pagar),
    premiosPorPagarMonto: n(r.premios_por_pagar_monto),
    ultimaCarga: r.ultima_carga || null,
    bot24h: {
      ok: ok24,
      fallados: fallados24,
      tasaExito: ok24 + fallados24 > 0 ? ok24 / (ok24 + fallados24) : null,
    },
    residuo: {
      pedidos: n(r.residuo_pedidos),
      premios: n(r.residuo_premios),
    },
  };
}

module.exports = { embudo, tiempos, bot, validacion, premios, estadoActual };
