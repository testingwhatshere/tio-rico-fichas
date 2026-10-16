/**
 * Alertas derivadas: traduce los números a "esto hay que mirarlo ahora".
 * Función pura sobre el resumen ya calculado — no toca la DB.
 *
 * Criterio de qué entra acá: una alerta tiene que ser ACCIONABLE y PODER
 * APAGARSE. Si algo está encendido todos los días pase lo que pase, no es una
 * alerta: es decoración, y encima entrena al que mira a ignorar el resto.
 *
 * Por eso quedaron afuera varias que parecían obvias:
 *  - "Panel X no carga hace N horas": de madrugada ningún panel carga. Se
 *    prendía sola todas las noches.
 *  - "Sin cargas hace unas horas": lo mismo, más vago todavía.
 *  - "Se paga casi todo lo que entra": con pocos días de rango, un solo premio
 *    grande lo dispara. El dato ya está en el KPI del resumen, con su contexto.
 *
 * Y las que quedaron se miden sobre ventanas recientes (ver estadoActual),
 * no sobre el acumulado histórico.
 *
 * Niveles: 'critico' (plata o servicio parado), 'aviso' (atender hoy).
 */

const MIN = 60_000;
const minutosDesde = (ts) => (ts ? (Date.now() - new Date(ts).getTime()) / MIN : null);

const espera = (min) => {
  if (min == null) return '—';
  if (min < 90) return `${Math.round(min)} minutos`;
  return `${Math.round(min / 60)} horas`;
};

// Umbrales en un solo lugar, para poder ajustarlos sin bucear en la lógica.
const U = {
  colaTrabadaMin: Number(process.env.ALERTA_COLA_MIN || 45),
  fallidas24h: Number(process.env.ALERTA_FALLIDAS_24H || 5),
  botFallasMin: Number(process.env.ALERTA_BOT_FALLAS_MIN || 5),
  botTasaExito: Number(process.env.ALERTA_BOT_TASA || 0.7),
  usoWallet: Number(process.env.ALERTA_USO_WALLET || 0.85),
};

const fmt = (v) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    .format(Number(v) || 0);

function construir(d) {
  const a = [];
  const push = (nivel, titulo, detalle, accion) => a.push({ nivel, titulo, detalle, accion });
  const est = d.estadoActual;

  if (est) {
    // 1. Cola trabada — solo pedidos de las últimas 24 h.
    const esperaMin = minutosDesde(est.masViejaEnCola);
    if (esperaMin != null && esperaMin > U.colaTrabadaMin) {
      push('critico', 'Hay cargas frenadas esperando al bot',
        `${est.enCola} en la cola; la más vieja lleva ${espera(esperaMin)}.`,
        'Revisar que la extensión del bot esté conectada al panel.');
    }

    // 2. El bot fallando ahora — pide volumen real, no una racha de dos.
    const b24 = est.bot24h;
    if (b24 && b24.fallados >= U.botFallasMin && b24.tasaExito != null && b24.tasaExito < U.botTasaExito) {
      push('critico', 'El bot está fallando seguido',
        `En las últimas 24 h fallaron ${b24.fallados} de ${b24.ok + b24.fallados} trabajos.`,
        'Ver los motivos de falla en la pestaña Operación.');
    } else if (est.fallidas24h >= U.fallidas24h) {
      push('critico', `${est.fallidas24h} cargas fallaron en las últimas 24 horas`,
        'Cuando fallan varias seguidas suele ser que cambiaron los selectores del panel o se perdió la sesión.',
        'Ver el runbook de "el bot no carga".');
    }

    // 3. Premios pedidos esta semana que todavía no se pagaron: es plata que
    //    se le debe a alguien que está esperando.
    if (est.premiosPorPagar > 0) {
      push('aviso', `${est.premiosPorPagar} premio${est.premiosPorPagar > 1 ? 's' : ''} esperando pago`,
        `${fmt(est.premiosPorPagarMonto)} de jugadores que ya tienen las fichas verificadas o retiradas.`,
        'Pagar y adjuntar el comprobante desde el panel del operador.');
    }

    // 4. Comprobantes que la IA no pudo resolver, de las últimas 48 h.
    if (est.validacionFallida > 0) {
      push('aviso', `${est.validacionFallida} comprobante${est.validacionFallida > 1 ? 's' : ''} esperando decisión`,
        'La IA no los pudo validar en las últimas 48 horas.',
        'Revisar la cola de fallas.');
    }
  }

  // 5. Billetera por llegar al tope: dato objetivo, no depende de la hora.
  for (const w of d.wallets || []) {
    if (w.activa && w.usoLimite != null && w.usoLimite >= U.usoWallet) {
      push('aviso', `La billetera ${w.label} está por llegar al límite`,
        `Lleva ${fmt(w.acumulado)} acumulados sobre un tope de ${fmt(w.limite)}.`,
        'Vaciarla o dejar que rote sola.');
    }
  }

  const orden = { critico: 0, aviso: 1 };
  return a.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
}

module.exports = { construir, UMBRALES: U };
