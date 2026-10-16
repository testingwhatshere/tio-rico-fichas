/** Exportación a CSV, pensada para abrir en Excel argentino (separador ;). */
const SEP = ';';

const esc = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Excel lee los decimales con coma cuando el sistema está en es-AR.
const num = (v) => (v == null ? '' : String(Number(v).toFixed(2)).replace('.', ','));
const pct = (v) => (v == null ? '' : num(Number(v) * 100));
const fecha = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : '');

function tabla(cabeceras, filas) {
  // BOM para que Excel detecte UTF-8 y no rompa los acentos.
  return '﻿' + [cabeceras, ...filas].map((f) => f.map(esc).join(SEP)).join('\r\n') + '\r\n';
}

const TIPOS = {
  serie: (d) => tabla(
    ['Período', 'Cargas', 'Entró', 'Premios pagados', 'Resultado', 'Jugadores'],
    (d.serie || []).map((r) => [r.bucket, r.cargas, num(r.entradas), num(r.premios), num(r.resultado), r.jugadores]),
  ),
  mensual: (d) => tabla(
    ['Mes', 'Cargas', 'Entró', 'Premios pagados', 'Resultado', '% pagado', 'Jugadores', 'Nuevos'],
    (d.mensual || []).map((r) => [r.mes, r.cargas, num(r.entradas), num(r.premios), num(r.resultado), pct(r.payoutRatio), r.jugadores, r.nuevos]),
  ),
  paneles: (d) => tabla(
    ['Panel', 'Activo', 'Cargas', 'Entró', 'Premios', 'Resultado', 'Jugadores', 'Fallidas'],
    (d.porPanel || []).map((r) => [r.panel, r.activo ? 'sí' : 'no', r.cargas, num(r.monto), num(r.premios), num(r.resultado), r.jugadores, r.fallidas]),
  ),
  wallets: (d) => tabla(
    ['Billetera', 'Tipo', 'Titular', 'Activa', 'Cargas', 'Entró', 'Acumulado', 'Límite'],
    (d.wallets || []).map((r) => [r.label, r.tipo, r.titular, r.activa ? 'sí' : 'no', r.cargas, num(r.monto), num(r.acumulado), num(r.limite)]),
  ),
  jugadores: (d) => tabla(
    ['Jugador', 'Cargas', 'Cargó', 'Premios cobrados', 'Neto', 'Última carga'],
    (d.topJugadores || []).map((r) => [r.jugador, r.cargas, num(r.monto), num(r.premios), num(r.neto), fecha(r.ultima)]),
  ),
  riesgo: (d) => tabla(
    ['Jugador', 'Cargas (180d)', 'Total cargado', 'Última carga', 'Días sin cargar'],
    (d.enRiesgo || []).map((r) => [r.jugador, r.cargas, num(r.monto), fecha(r.ultima), r.dias]),
  ),
  errores: (d) => tabla(
    ['Motivo', 'Cantidad', 'Última vez'],
    (d.bot?.errores || []).map((r) => [r.motivo, r.cantidad, fecha(r.ultima)]),
  ),
  resumen: (d) => {
    const p = d.periodo || {};
    const filas = [
      ['Período', d.rango?.label],
      ['Desde', fecha(d.rango?.desde)],
      ['Hasta', fecha(d.rango?.hasta)],
      ['Entró', num(p.cargas?.monto)],
      ['Cargas', p.cargas?.count],
      ['Carga promedio', num(p.cargas?.promedio)],
      ['Carga mediana', num(p.cargas?.mediana)],
      ['Premios pagados', num(p.premiosPagados?.monto)],
      ['Premios pagados (cantidad)', p.premiosPagados?.count],
      ['Resultado', num(p.resultado)],
      ['% de lo que entra que se paga', pct(p.payoutRatio)],
      ['Jugadores que cargaron', p.jugadoresActivos],
      ['Jugadores nuevos', p.jugadoresNuevos],
      ['Solicitudes iniciadas', p.solicitudes?.count],
      ['Tasa de éxito', pct(p.solicitudes?.tasaExito)],
      ['Cargas sin intervención humana', pct(d.validacion?.tasaAutomatica)],
    ];
    return tabla(['Métrica', 'Valor'], filas);
  },
};

module.exports = { TIPOS, tipos: Object.keys(TIPOS) };
