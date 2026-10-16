/**
 * Historial de cargas.
 *
 * Es una pantalla de consulta, no de trabajo: sirve para ir a buscar un
 * comprobante viejo, ver qué pasó con una carga y responderle a alguien que
 * pregunta. Por eso no tiene acciones ni contadores — sólo búsqueda.
 */
import type { OverpaidOffer } from './overpaidOffer';
import { colors } from '@/constants/theme';
import { LoadStatus } from '@/utils/tracking';
import type { ProofTwin } from './proofTwins';

export type HistoryCategory = 'all' | 'completed' | 'failed' | 'closed' | 'inflight';

/**
 * Las categorías tienen que decir lo mismo que `HISTORY_CATEGORIES` del backend,
 * que es quien arma la consulta. Acá están sólo para dibujar los botones: el
 * cliente manda la clave, nunca una lista de estados.
 */
export const HISTORY_CATEGORIES: { key: HistoryCategory; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'completed', label: 'Cargadas' },
  { key: 'failed', label: 'Con problema' },
  { key: 'closed', label: 'Cerradas' },
  { key: 'inflight', label: 'En curso' },
];

/** Ventanas de consulta. El default corto es el que menos índice recorre. */
export const HISTORY_RANGES: { key: HistoryRange; label: string; hours: number }[] = [
  { key: 'today', label: 'Hoy', hours: 24 },
  { key: 'week', label: '7 días', hours: 24 * 7 },
  { key: 'month', label: '30 días', hours: 24 * 30 },
  { key: 'year', label: 'Todo', hours: 24 * 365 },
];

export type HistoryRange = 'today' | 'week' | 'month' | 'year';

export type HistoryItem = {
  id: string;
  targetUsername: string;
  amount: string | number;
  status: LoadStatus;
  proofUrl: string | null;
  /** El comprobante existió y se borró por antigüedad (6 meses). */
  proofPurged?: boolean;
  proofTwins?: ProofTwin[];
  /** Transfirió de más y lo decidió el jugador. Ver `utils/overpaidOffer.ts`. */
  overpaidOffer?: OverpaidOffer | null;
  validationScore: number | null;
  validationError: string | null;
  rejectionReason: string | null;
  manuallyApproved: boolean;
  createdAt: string;
  updatedAt: string;
  user: { id: string; username: string | null } | null;
  panel: { name: string } | null;
  job: { status: string; error: string | null; completedAt: string | null } | null;
};

/** Cómo se le muestra cada estado al operador, con su color. */
const STATUS_META: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: 'Cargada', color: colors.success },
  FAILED: { label: 'Falló la carga', color: colors.error },
  VALIDATION_FAILED: { label: 'No se validó', color: colors.warning },
  REJECTED: { label: 'Rechazada', color: colors.textMuted },
  CANCELLED: { label: 'Cancelada', color: colors.textMuted },
  PENDING_PROOF: { label: 'Sin comprobante', color: colors.info },
  VALIDATING: { label: 'Validando', color: colors.info },
  APPROVED: { label: 'Esperando al bot', color: colors.info },
  PROCESSING: { label: 'Cargando', color: colors.info },
  // Estado legado: no se entra más acá, pero hay solicitudes viejas que quedaron.
  PENDING_MP_VERIFICATION: { label: 'En revisión', color: colors.textMuted },
};

export function statusMeta(status: string): { label: string; color: string } {
  return STATUS_META[status] ?? { label: status, color: colors.textMuted };
}

/**
 * El motivo, cuando lo hay. Cada estado lo guarda en un campo distinto, y en la
 * lista el operador quiere leerlo sin abrir nada.
 */
export function reasonOf(item: HistoryItem): string | null {
  const raw =
    item.status === 'FAILED'
      ? (item.job?.error ?? item.validationError)
      : (item.validationError ?? item.rejectionReason);
  return raw?.trim() || null;
}
