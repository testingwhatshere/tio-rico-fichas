/**
 * Arma el resumen completo que consume el dashboard.
 *
 * Dos decisiones de robustez que importan:
 *  1. Cada sección se calcula por separado y con tolerancia a fallo: si una
 *     query se cae (timeout, tabla nueva, lo que sea), esa sección viene en
 *     null y el resto del panel se dibuja igual. Antes, cualquier error dejaba
 *     la pantalla entera en blanco.
 *  2. Las queries salen en paralelo pero limitadas por el pool (4 conexiones),
 *     así un refresh del dashboard no le come las conexiones al backend.
 */
const { seccion } = require('./db');
const negocio = require('./metrics/negocio');
const operacion = require('./metrics/operacion');
const jugadores = require('./metrics/jugadores');
const alertas = require('./alertas');

/** Compara un número contra el mismo número del período anterior. */
function delta(actual, previo) {
  if (previo == null || actual == null) return null;
  const cambio = actual - previo;
  return {
    previo,
    cambio,
    // Sin base previa el porcentaje no significa nada: mejor null que "+∞%".
    pct: previo !== 0 ? cambio / Math.abs(previo) : null,
  };
}

function construirDeltas(act, prev) {
  if (!act || !prev) return null;
  return {
    entradas: delta(act.cargas.monto, prev.cargas.monto),
    cargas: delta(act.cargas.count, prev.cargas.count),
    ticket: delta(act.cargas.promedio, prev.cargas.promedio),
    premios: delta(act.premiosPagados.monto, prev.premiosPagados.monto),
    resultado: delta(act.resultado, prev.resultado),
    jugadoresActivos: delta(act.jugadoresActivos, prev.jugadoresActivos),
    jugadoresNuevos: delta(act.jugadoresNuevos, prev.jugadoresNuevos),
    solicitudes: delta(act.solicitudes.count, prev.solicitudes.count),
    payoutRatio: delta(act.payoutRatio, prev.payoutRatio),
    tasaExito: delta(act.solicitudes.tasaExito, prev.solicitudes.tasaExito),
  };
}

async function construir(rango, panelId) {
  const errores = {};
  const S = (nombre, fn) => seccion(nombre, fn, errores);
  const { from, to, prevFrom, prevTo, bucket } = rango;

  const [
    periodo, previo, serie, porPanel, wallets, distribucion, heatmap, mensual, totales,
  ] = await Promise.all([
    S('periodo', () => negocio.kpis(from, to, panelId)),
    S('previo', () => (prevFrom ? negocio.kpis(prevFrom, prevTo, panelId) : null)),
    S('serie', () => negocio.serie(from, to, panelId, bucket)),
    S('porPanel', () => negocio.porPanel(from, to)),
    S('wallets', () => negocio.porWallet(from, to, panelId)),
    S('distribucion', () => negocio.distribucion(from, to, panelId)),
    S('heatmap', () => negocio.heatmap(from, to, panelId)),
    S('mensual', () => negocio.mensual(panelId)),
    S('totales', () => negocio.totales(panelId)),
  ]);

  const [
    embudo, tiempos, bot, validacion, premios, estadoActual,
  ] = await Promise.all([
    S('embudo', () => operacion.embudo(from, to, panelId)),
    S('tiempos', () => operacion.tiempos(from, to, panelId)),
    S('bot', () => operacion.bot(from, to, panelId)),
    S('validacion', () => operacion.validacion(from, to, panelId)),
    S('premios', () => operacion.premios(from, to, panelId)),
    S('estadoActual', () => operacion.estadoActual(panelId)),
  ]);

  const [
    topJugadores, composicion, frecuencia, cohortes, enRiesgo, recurrencia,
  ] = await Promise.all([
    S('topJugadores', () => jugadores.top(from, to, panelId)),
    S('composicion', () => jugadores.composicion(from, to, panelId)),
    S('frecuencia', () => jugadores.frecuencia(from, to, panelId)),
    S('cohortes', () => jugadores.cohortes(panelId)),
    S('enRiesgo', () => jugadores.enRiesgo(panelId)),
    S('recurrencia', () => jugadores.recurrenciaMensual(panelId)),
  ]);

  const d = {
    generadoEn: new Date().toISOString(),
    rango: {
      key: rango.key,
      label: rango.label,
      corto: rango.corto,
      activos: rango.activos,
      prevLabel: rango.prevLabel,
      desde: from,
      hasta: to,
      bucket,
      custom: rango.custom,
      ...(rango.custom ? { desdeFecha: rango.desde, hastaFecha: rango.hasta } : {}),
    },
    panelId: panelId || null,
    periodo, previo,
    deltas: construirDeltas(periodo, previo),
    serie, porPanel, wallets, distribucion, heatmap, mensual, totales,
    embudo, tiempos, bot, validacion, premios, estadoActual,
    topJugadores, composicion, frecuencia, cohortes, enRiesgo, recurrencia,
    errores: Object.keys(errores).length ? errores : null,
  };

  d.alertas = seguro(() => alertas.construir(d), []);
  return d;
}

function seguro(fn, fallback) {
  try { return fn(); } catch (e) { console.error('[alertas]', e.message); return fallback; }
}

module.exports = { construir };
