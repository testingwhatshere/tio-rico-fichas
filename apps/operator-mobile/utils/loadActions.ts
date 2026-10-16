/**
 * Qué se puede hacer con una carga, según dónde quedó parada.
 *
 * Las reglas son las del backend (`RequestsService.approve`, `cancelByOperator`,
 * `markLoadedManually`): están acá para que un botón no se ofrezca cuando el
 * servidor lo va a rechazar, y sobre todo para que las mismas decisiones
 * aparezcan igual en la Bandeja, en Seguimiento, en el Historial y en la ficha
 * del cliente — antes cada pantalla ofrecía un subconjunto distinto y el
 * operador tenía que acordarse de dónde estaba cada botón.
 */
import { LoadStatus, canCancel } from '@/utils/tracking';
import type { OverpaidOffer } from './overpaidOffer';
import type { ProofTwin } from './proofTwins';

export type ActionableLoad = {
  /** Id del Request. Es lo que espera el backend en todas las acciones. */
  id: string;
  status: LoadStatus | string;
  userId?: string | null;
  targetUsername: string;
  amount: number;
  /** Lo que dice el comprobante, si se pudo leer. */
  extractedAmount?: number | null;
  proofUrl?: string | null;
  proofTwins?: ProofTwin[];
  /** Transfirió de más y lo decidió el jugador. Ver `utils/overpaidOffer.ts`. */
  overpaidOffer?: OverpaidOffer | null;
  jobId?: string | null;
  /** Si ya existe un Job. Cambia qué es seguro ofrecer. */
  hasJob?: boolean;
};

/** Estados desde los que el backend acepta aprobar y mandar el bot. */
export function canApprove(load: ActionableLoad): boolean {
  if (['VALIDATING', 'VALIDATION_FAILED', 'PENDING_MP_VERIFICATION'].includes(load.status)) {
    return true;
  }
  // APPROVED o FAILED sin Job son los dos casos de recuperación: nadie despachó
  // al bot todavía, así que aprobar no puede cargar dos veces.
  return ['APPROVED', 'FAILED'].includes(load.status) && !load.hasJob;
}

/** Cerrar sin cargar. `PROCESSING` queda afuera: el bot puede estar cargando. */
export { canCancel };

/** Cerrar como cargada a mano, sin mandar el bot. */
export function canMarkLoaded(load: ActionableLoad): boolean {
  return ['VALIDATION_FAILED', 'FAILED', 'PENDING_MP_VERIFICATION'].includes(load.status);
}

/**
 * Reintentar: con job es mandar el bot de nuevo, sin job es re-buscar el panel.
 *
 * Una carga que tiene job pero de la que no sabemos el id (el Historial no lo
 * trae) no se ofrece: mandaríamos el reintento por la vía de discovery, que no
 * es la que corresponde.
 */
export function canRetry(load: ActionableLoad): boolean {
  return load.status === 'FAILED' && (!!load.jobId || !load.hasJob);
}

/** Pedirle al usuario un comprobante nuevo. */
export function canAskNewProof(load: ActionableLoad): boolean {
  return ['VALIDATING', 'VALIDATION_FAILED'].includes(load.status);
}

/**
 * Cargar fichas por decisión del operador, sin tocar esta carga.
 *
 * Es la salida universal: sirve cuando la carga ya está cerrada, cuando el bot
 * la dejó a medias, o cuando hay que completar una diferencia. Lo único que
 * necesita es saber a qué cliente.
 */
export function canLoadCredits(load: ActionableLoad): boolean {
  return !!load.userId;
}

/** Una carga terminada: mostrarle acciones de flujo no tiene sentido. */
export function isSettled(load: ActionableLoad): boolean {
  return ['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(load.status);
}

/** Adapta una carga del seguimiento a lo que necesitan las acciones. */
export function toActionable(load: {
  id: string;
  status: string;
  userId?: string | null;
  targetUsername: string;
  amount: string | number;
  extractedAmount?: number | null;
  proofUrl?: string | null;
  proofTwins?: ProofTwin[];
  overpaidOffer?: OverpaidOffer | null;
  job?: { id?: string; status?: string } | null;
}): ActionableLoad {
  const n = typeof load.amount === 'number' ? load.amount : parseFloat(load.amount ?? '0');
  return {
    id: load.id,
    status: load.status,
    userId: load.userId ?? null,
    targetUsername: load.targetUsername,
    amount: Number.isFinite(n) ? n : 0,
    extractedAmount: load.extractedAmount ?? null,
    proofUrl: load.proofUrl ?? null,
    proofTwins: load.proofTwins ?? [],
    overpaidOffer: load.overpaidOffer ?? null,
    jobId: load.job?.id ?? null,
    hasJob: !!load.job,
  };
}
