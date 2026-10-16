/**
 * Comprobantes repetidos.
 *
 * El backend manda, por cada carga, las otras cargas que comparten el
 * comprobante (mismo hash del archivo o mismo número de operación). Acá se
 * traduce eso a la frase que el operador necesita leer.
 *
 * Existe porque la pregunta que llega es siempre la misma: "me mandó otro
 * comprobante, no sé si es el mismo de antes". Compararlos a ojo no escala y se
 * presta a acreditar dos veces el mismo pago.
 */
import { formatMoney } from './amount';

export type ProofTwin = {
  id: string;
  status: string;
  amount: string | number;
  createdAt: string;
  /** false = el mismo comprobante aparece en la carga de OTRA persona. */
  sameUser: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_PROOF: 'sin comprobante',
  VALIDATING: 'validando',
  VALIDATION_FAILED: 'no se validó',
  APPROVED: 'aprobada',
  PROCESSING: 'cargando',
  COMPLETED: 'ya cargada',
  FAILED: 'falló',
  REJECTED: 'rechazada',
  CANCELLED: 'cancelada',
};

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Que el comprobante esté repetido en la carga de otra persona es más grave que
 * repetirlo uno mismo: eso decide el color y el texto de la alerta.
 */
export function proofTwinAlert(
  twins?: ProofTwin[] | null,
): { label: string; detail: string; severe: boolean } | null {
  if (!twins || twins.length === 0) return null;

  const foreign = twins.find((t) => !t.sameUser);
  const ref = foreign ?? twins[0];
  const amount =
    typeof ref.amount === 'number' ? ref.amount : parseFloat(ref.amount ?? '0');

  const detail =
    `Mismo comprobante que la carga del ${when(ref.createdAt)}` +
    (Number.isFinite(amount) && amount > 0 ? ` por ${formatMoney(amount)}` : '') +
    ` (${STATUS_LABEL[ref.status] ?? ref.status.toLowerCase()})` +
    (foreign ? ', de otra persona' : '') +
    (twins.length > 1 ? ` — y ${twins.length - 1} más` : '');

  return {
    label: foreign ? 'Comprobante de otra persona' : 'Comprobante repetido',
    detail,
    severe: !!foreign,
  };
}
