/**
 * Premios: etapas, no estados.
 *
 * `PrizeClaimStatus` tiene diez valores y el operador no razona en esos
 * términos: su pregunta es "¿qué me toca hacer ahora?". Un premio siempre está
 * en una de cinco etapas, y cada etapa tiene exactamente una acción posible.
 *
 * Esto es lo único que sabe traducir status → etapa → acción. La pantalla, la
 * tarjeta y el badge de la navegación leen todos de acá: antes cada lugar tenía
 * su propia idea de "pendiente" y los números no coincidían entre sí.
 */
import { colors } from '@/constants/theme';
import { parseAmount, formatMoney } from '@/utils/amount';
import { humanizeError } from '@/utils/errors';

export type PrizeStage =
  | 'pay'      // fichas retiradas, falta transferir la plata  ← plata en el aire
  | 'withdraw' // el operador tiene que mandar al bot a retirar las fichas
  | 'stuck'    // el bot falló retirando; hay que reintentar
  | 'working'  // el sistema (o el usuario) está haciendo lo suyo, no hay acción
  | 'closed';  // pagado, rechazado o sin fichas suficientes

export type PrizeStageMeta = {
  label: string;
  /** Qué significa estar en esta etapa, en criollo. Va bajo el título. */
  hint: string;
  color: string;
  icon: string;
  /** Etapas accionables: son las que suman al badge de la navegación. */
  actionable: boolean;
};

export const PRIZE_STAGES: Record<PrizeStage, PrizeStageMeta> = {
  pay: {
    label: 'Falta pagarles',
    hint: 'Las fichas ya salieron del panel. Falta transferir y adjuntar el comprobante.',
    color: colors.primary,
    icon: 'cash-outline',
    actionable: true,
  },
  withdraw: {
    label: 'Para retirar fichas',
    hint: 'Pidieron el premio y están verificados. Falta mandar al bot a retirarles las fichas.',
    color: colors.warning,
    icon: 'download-outline',
    actionable: true,
  },
  stuck: {
    label: 'Trabados',
    hint: 'El bot no pudo retirar las fichas. Hay que reintentar o rechazar.',
    color: colors.error,
    icon: 'alert-circle-outline',
    actionable: true,
  },
  working: {
    label: 'En curso',
    hint: 'El sistema está trabajando. Si se demora, podés adelantarlo vos.',
    color: colors.info,
    icon: 'sync-outline',
    actionable: false,
  },
  closed: {
    label: 'Cerrados',
    hint: 'Ya resueltos.',
    color: colors.textMuted,
    icon: 'checkmark-done-outline',
    actionable: false,
  },
};

/** Orden en el que se muestran las columnas: primero lo que más urge. */
export const BOARD_STAGES: PrizeStage[] = ['pay', 'withdraw', 'stuck', 'working'];

export function prizeStage(claim: any): PrizeStage {
  // `__pending: false` = vino sólo del historial, el servidor ya no lo cuenta
  // como pendiente. Ver `usePrizes`.
  if (claim?.__pending === false) return 'closed';

  switch (claim?.status) {
    case 'CHIPS_WITHDRAWN':
      return 'pay';
    case 'VERIFIED':
      return 'withdraw';
    // Error de verificación: el operador puede procesarlo igual si lo chequeó a
    // mano. Con `verifiedBalance` cargado no es un error sino fichas
    // insuficientes: al usuario ya se le dijo que pida menos, no hay nada que
    // hacer acá.
    case 'VERIFICATION_FAILED':
      return claim.verifiedBalance == null ? 'withdraw' : 'closed';
    case 'FAILED':
      return 'stuck';
    case 'PROCESSING':
    case 'VERIFYING_CHIPS':
    case 'PENDING_VERIFICATION':
    case 'PENDING_PAYMENT_DETAILS':
      return 'working';
    default:
      return 'closed';
  }
}

/** Etiqueta del estado exacto. La etapa dice qué hacer; esto, dónde está. */
export const PRIZE_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT_DETAILS: { label: 'Esperando sus datos', color: colors.textMuted },
  PENDING_VERIFICATION: { label: 'Esperando verificación', color: colors.info },
  VERIFYING_CHIPS: { label: 'Verificando fichas', color: colors.info },
  VERIFIED: { label: 'Listo para retirar', color: colors.warning },
  VERIFICATION_FAILED: { label: 'No se pudo verificar', color: colors.error },
  PROCESSING: { label: 'Retirando fichas', color: colors.info },
  CHIPS_WITHDRAWN: { label: 'Falta transferir', color: colors.primary },
  COMPLETED: { label: 'Pagado', color: colors.success },
  REJECTED: { label: 'Rechazado', color: colors.textMuted },
  FAILED: { label: 'Falló el retiro', color: colors.error },
};

export function prizeStatusMeta(status: string) {
  return PRIZE_STATUS[status] || { label: status, color: colors.textMuted };
}

export type PrizeActionKind = 'process' | 'retry' | 'pay';

export type PrizeAction = {
  kind: PrizeActionKind;
  label: string;
  icon: string;
  tone: 'primary' | 'success' | 'neutral';
};

/** La acción que corresponde ahora. Una sola: si hay que elegir, no es obvia. */
export function prizeAction(claim: any): PrizeAction | null {
  switch (claim?.status) {
    case 'VERIFIED':
      return { kind: 'process', label: 'Retirar fichas', icon: 'download-outline', tone: 'primary' };
    case 'VERIFICATION_FAILED':
      return claim.verifiedBalance == null
        ? { kind: 'process', label: 'Procesar igual', icon: 'download-outline', tone: 'primary' }
        : null;
    case 'FAILED':
      return { kind: 'retry', label: 'Reintentar retiro', icon: 'refresh', tone: 'primary' };
    case 'CHIPS_WITHDRAWN':
      return { kind: 'pay', label: 'Ya le transferí', icon: 'checkmark-circle', tone: 'success' };
    // La verificación puede tardar media hora si las extensiones flapean. El
    // operador que ya miró el saldo en el panel no tiene por qué esperarla:
    // decide él, como con cualquier otro premio.
    case 'PENDING_VERIFICATION':
    case 'VERIFYING_CHIPS':
      return {
        kind: 'process',
        label: 'Retirar sin esperar',
        icon: 'flash-outline',
        tone: 'neutral',
      };
    default:
      return null;
  }
}

/** Por qué está donde está. Una línea, sin obligar a abrir el detalle. */
export function prizeReason(claim: any): string {
  // Sólo si de verdad está rechazado: el barrido de premios colgados guarda su
  // motivo en el mismo campo, y la tarjeta terminaba diciendo "Rechazado: la
  // verificación quedó colgada" sobre un premio que nadie rechazó.
  if (claim?.status === 'REJECTED' && claim?.rejectionReason) {
    return `Rechazado: ${claim.rejectionReason}`;
  }
  switch (claim?.status) {
    case 'CHIPS_WITHDRAWN':
      return 'Fichas retiradas — falta transferirle la plata';
    case 'VERIFIED':
      // Sin `verifiedBalance` nadie leyó el saldo: el premio llegó directo a
      // manos del operador. Decir "saldo confirmado" ahí sería mentirle justo
      // antes de que apriete el botón que mueve las fichas.
      return claim.verifiedBalance != null
        ? `Saldo confirmado en el panel: ${formatMoney(parseAmount(claim.verifiedBalance))}`
        : 'Confirmá el saldo en el panel antes de retirar';
    case 'VERIFICATION_FAILED':
      return claim.verifiedBalance == null
        ? 'No se pudo verificar el saldo en el panel'
        : `Sin fichas suficientes (tenía ${parseAmount(claim.verifiedBalance)})`;
    case 'PROCESSING':
      return 'El bot está retirando las fichas';
    case 'FAILED':
      // `humanizeError` devuelve 'Sin detalle' cuando no hay error, así que el
      // fallback tiene que decidirse antes de llamarla.
      return claim.error ? humanizeError(claim.error) : 'El bot no pudo retirar las fichas';
    case 'COMPLETED':
      return 'Pagado';
    case 'PENDING_PAYMENT_DETAILS':
      return 'Esperando que el usuario cargue sus datos de cobro';
    case 'PENDING_VERIFICATION':
    case 'VERIFYING_CHIPS':
      // El backend avisa en qué reintento va cuando el bot no contesta. Sin
      // esto el premio decía "verificando" media hora, igual el primer minuto
      // que el minuto treinta.
      return claim.verifyAttempt
        ? `El bot no responde — reintento ${claim.verifyAttempt} de ${claim.verifyMaxAttempts || 5}`
        : 'Verificando el saldo en el panel';
    default:
      return 'Pedido de cobro';
  }
}

export function prizeUsername(claim: any): string {
  return claim?.targetUsername || claim?.user?.username || 'sin usuario';
}

/** Dónde transferirle, resumido en una línea copiable. */
export function payoutLine(claim: any): { label: string; value: string } | null {
  const d = claim?.paymentDetails;
  if (!d) return null;
  if (typeof d === 'string') return { label: claim.paymentMethod || 'Datos', value: d };
  const cbu = d.cbu || d.cvu;
  if (cbu) return { label: d.cbu ? 'CBU' : 'CVU', value: String(cbu) };
  if (d.alias) return { label: 'Alias', value: String(d.alias) };
  const first = Object.entries(d).find(([, v]) => v !== null && v !== undefined && v !== '');
  return first ? { label: claim.paymentMethod || 'Datos', value: String(first[1]) } : null;
}

/**
 * Hace cuánto espera, en horas. La antigüedad es la única señal de urgencia
 * dentro de una misma etapa: dos premios "falta transferir" no son iguales si
 * uno entró recién y el otro hace seis horas.
 */
export function waitingHours(claim: any): number {
  const t = new Date(claim?.createdAt).getTime();
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / 3_600_000;
}

/**
 * Cuánto lleva esperando, en palabras.
 *
 * `timeAgo` abrevia ('2me', '13d') porque vive en listas densas. Acá el dato es
 * el argumento principal de la tarjeta —un premio de hace dos meses sin pagar es
 * un problema— y "espera 2me" se lee como ruido.
 */
export function waitLabel(claim: any): string {
  const h = waitingHours(claim);
  if (h < 1) {
    const mins = Math.max(1, Math.round(h * 60));
    return `${mins} min`;
  }
  if (h < 24) return `${Math.round(h)} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} ${days === 1 ? 'día' : 'días'}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? 'mes' : 'meses'}`;
}

/** Verde/naranja/rojo según cuánto lleva esperando. Sólo para etapas con acción. */
export function urgencyColor(claim: any, stage: PrizeStage): string {
  if (!PRIZE_STAGES[stage].actionable) return colors.textMuted;
  const h = waitingHours(claim);
  if (h >= 6) return colors.error;
  if (h >= 2) return colors.warning;
  return colors.textMuted;
}

export function claimAmount(claim: any): number {
  return parseAmount(claim?.amount);
}

export function sumAmounts(claims: any[]): number {
  return claims.reduce((acc, c) => acc + claimAmount(c), 0);
}

/**
 * Agrupa en etapas y ordena.
 *
 * Dentro de una etapa con acción va primero el que más espera: el operador
 * trabaja de arriba hacia abajo y así nada envejece al fondo de la columna.
 * Las etapas sin acción van al revés — lo último que pasó, arriba.
 */
export function groupByStage(claims: any[]): Record<PrizeStage, any[]> {
  const groups: Record<PrizeStage, any[]> = {
    pay: [], withdraw: [], stuck: [], working: [], closed: [],
  };
  for (const c of claims) groups[prizeStage(c)].push(c);

  for (const stage of Object.keys(groups) as PrizeStage[]) {
    const oldestFirst = PRIZE_STAGES[stage].actionable;
    groups[stage].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return oldestFirst ? ta - tb : tb - ta;
    });
  }
  return groups;
}

/** Premios que esperan una decisión del operador. Es el número del badge. */
export function actionablePrizes(claims: any[]): any[] {
  return claims.filter((c) => PRIZE_STAGES[prizeStage(c)].actionable);
}
