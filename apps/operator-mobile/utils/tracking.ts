/**
 * El recorrido de una carga.
 *
 * Una carga no es un estado, es un camino: comprobante → IA → cola del bot →
 * panel. Hasta ahora el panel sólo mostraba las que se caían del camino, así que
 * una carga trabada en un paso intermedio era invisible hasta que el usuario
 * preguntaba. Acá se arma el camino completo a partir del historial de estados,
 * con los pasos cumplidos, el actual y los que faltan.
 *
 * Todo el cálculo vive en este archivo y no en la pantalla: la regla de "esto
 * está trabado" es una decisión de negocio, no de presentación.
 */

import type { OverpaidOffer } from './overpaidOffer';
import type { ProofTwin } from './proofTwins';

export type LoadStatus =
  | 'PENDING_PROOF'
  | 'VALIDATING'
  | 'VALIDATION_FAILED'
  | 'PENDING_MP_VERIFICATION'
  | 'APPROVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';

export type HistoryEntry = {
  status: LoadStatus;
  at: string;
  changedBy: string | null;
  /** Score del validador, sólo en la fila que escribe la IA. */
  score: number | null;
  note: string | null;
};

export type ActiveLoad = {
  id: string;
  status: LoadStatus;
  targetUsername: string;
  username: string | null;
  userId: string;
  /** Decimal de Prisma: llega como string. Pasar por `parseAmount`. */
  amount: string | number;
  createdAt: string;
  updatedAt: string;
  proofUrl: string | null;
  /** El comprobante existió y se borró por antigüedad (6 meses). */
  proofPurged?: boolean;
  /** Otras cargas con el mismo comprobante. Ver `utils/proofTwins.ts`. */
  proofTwins?: ProofTwin[];
  validationScore: number | null;
  validationError: string | null;
  /** Lo que el OCR leyó del comprobante. Es el monto con el que se decide
   *  cuánto cargar cuando no coincide con lo pedido. */
  extractedAmount: number | null;
  fraudFlags?: string[];
  /** Transfirió de más y lo decidió el jugador. Ver `utils/overpaidOffer.ts`. */
  overpaidOffer?: OverpaidOffer | null;
  panelId?: string | null;
  panelName: string | null;
  job: {
    id: string;
    status: string;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  history: HistoryEntry[];
};

// ── Los pasos ─────────────────────────────────────────────────────────────────

type StepSpec = {
  status: LoadStatus;
  /** Cómo se llama el paso mientras es el actual o todavía falta. */
  label: string;
  /** Cómo se llama una vez cumplido. */
  doneLabel: string;
};

/**
 * El camino feliz, en orden.
 *
 * `PENDING_MP_VERIFICATION` no está: sigue en el enum de la base por las cargas
 * viejas, pero ese tramo del flujo se eliminó. Mostrarlo como paso pendiente
 * haría ver toda carga en curso como si le faltara algo que nunca va a pasar.
 */
const PIPELINE: StepSpec[] = [
  {
    status: 'PENDING_PROOF',
    label: 'Esperando el comprobante',
    doneLabel: 'Comprobante recibido',
  },
  {
    status: 'VALIDATING',
    label: 'La IA está leyendo el comprobante',
    // "Leído" y no "validado": el paso siguiente puede ser justamente que no se
    // pudo validar, y un ✓ "Comprobante validado" arriba de un ✕ "No se pudo
    // validar" se contradice en la misma pantalla.
    doneLabel: 'Comprobante leído por la IA',
  },
  {
    status: 'APPROVED',
    label: 'Aprobado, esperando al bot',
    doneLabel: 'Tomado por el bot',
  },
  {
    status: 'PROCESSING',
    label: 'Cargando fichas en el panel',
    doneLabel: 'Fichas cargadas en el panel',
  },
  {
    status: 'COMPLETED',
    label: 'Fichas cargadas',
    doneLabel: 'Fichas cargadas',
  },
];

/** Salidas del camino feliz. Cortan el recorrido en el punto donde pasaron. */
const BRANCHES: Partial<Record<LoadStatus, StepSpec>> = {
  VALIDATION_FAILED: {
    status: 'VALIDATION_FAILED',
    label: 'No se pudo validar — lo revisa un operador',
    doneLabel: 'No se pudo validar',
  },
  FAILED: {
    status: 'FAILED',
    label: 'Falló la carga',
    doneLabel: 'Falló la carga',
  },
  REJECTED: {
    status: 'REJECTED',
    label: 'Rechazado por un operador',
    doneLabel: 'Rechazado',
  },
  CANCELLED: {
    status: 'CANCELLED',
    label: 'Cancelado',
    doneLabel: 'Cancelado',
  },
};

/**
 * Cuánto puede quedarse una carga en cada paso antes de que sea señal de que
 * algo se colgó.
 *
 * `PROCESSING` usa los mismos 5 minutos que el detector de jobs trabados del
 * backend, para que el panel y el servidor no digan cosas distintas del mismo
 * job. `PENDING_PROOF` es el más laxo a propósito: ahí no está trabado el
 * sistema, está el usuario sin subir nada, y no hay nada que un operador pueda
 * destrabar.
 */
const STALL_MINUTES: Partial<Record<LoadStatus, number>> = {
  PENDING_PROOF: 30,
  VALIDATING: 4,
  VALIDATION_FAILED: 15,
  APPROVED: 10,
  PROCESSING: 5,
};

// ── Armado del recorrido ──────────────────────────────────────────────────────

export type StepState = 'done' | 'current' | 'pending';

export type TrailStep = {
  status: LoadStatus;
  label: string;
  state: StepState;
  /** Momento a mostrar. Vacío en los pasos que todavía no ocurrieron. */
  at: string | null;
  /** Score del validador, cuando lo hay. */
  score: number | null;
  /** Motivo del fallo o nota del operador. */
  note: string | null;
  /** El camino se corta acá (falló, se rechazó, se canceló). */
  broken: boolean;
};

export type Trail = {
  steps: TrailStep[];
  /** El paso donde está parada ahora. Null si ya terminó. */
  current: TrailStep | null;
  /** Desde cuándo está en el paso actual. */
  currentSince: string | null;
  /** Lleva más tiempo del esperable en el paso actual. */
  stalled: boolean;
  /** Terminó, bien o mal: ya no espera nada. */
  settled: boolean;
};

/**
 * Terminales: la carga se detuvo y no vuelve a moverse sola.
 *
 * `FAILED` entra acá aunque un operador pueda reintentarla: dejó de avanzar, y
 * lo que hay que hacer con ella ya vive en la Bandeja. `VALIDATION_FAILED` no
 * entra, justamente al revés — sigue esperando que alguien la mire, y que se
 * note cuánto hace que espera es el punto de esta pantalla.
 */
const SETTLED: LoadStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED'];

/**
 * Primera aparición de cada estado.
 *
 * Primera y no última porque el historial puede repetir un estado —una carga
 * reabierta vuelve a `PENDING_PROOF`— y lo que marca el recorrido es cuándo
 * entró por primera vez en cada paso.
 */
function firstOccurrences(history: HistoryEntry[]): Map<LoadStatus, HistoryEntry> {
  const map = new Map<LoadStatus, HistoryEntry>();
  for (const h of history) {
    if (!map.has(h.status)) map.set(h.status, h);
  }
  return map;
}

const ms = (at: string | null | undefined) => (at ? new Date(at).getTime() : NaN);

export function buildTrail(load: ActiveLoad): Trail {
  const seen = firstOccurrences(load.history ?? []);

  /**
   * Las salidas del camino por las que pasó.
   *
   * En plural: una carga puede fallar la validación y después ser rechazada por
   * un operador. Si sólo se dibujara la del estado actual, ese recorrido diría
   * "comprobante validado → rechazado", que es justo lo que no pasó.
   */
  const branches = (Object.keys(BRANCHES) as LoadStatus[])
    .filter((st) => seen.has(st) || st === load.status)
    .map((st) => ({
      spec: BRANCHES[st]!,
      entry: seen.get(st) ?? null,
      // Sin registro (historial purgado) el estado actual igual ocurrió: la
      // última modificación de la solicitud es la mejor marca que hay.
      at: seen.get(st)?.at ?? (st === load.status ? load.updatedAt : null),
    }))
    .filter((b) => !!b.at)
    .sort((a, b) => ms(a.at) - ms(b.at));

  // Hasta dónde llegó por el camino feliz: el paso más avanzado del que hay
  // registro. El estado actual pesa igual, porque el historial puede venir
  // incompleto (se purga a los 30 días) y la carga sí está donde dice estar.
  let reached = PIPELINE.findIndex((p) => p.status === load.status);
  PIPELINE.forEach((p, i) => {
    if (seen.has(p.status)) reached = Math.max(reached, i);
  });
  if (reached < 0) reached = 0;

  // Todo lo que quedó registrado, en orden. Sirve para saber cuándo terminó
  // cada paso: terminó cuando empezó lo que vino después, sea del camino feliz
  // o una salida.
  const recorded = [
    ...PIPELINE.map((p) => seen.get(p.status)?.at ?? null),
    ...branches.map((b) => b.at),
  ]
    .filter((at): at is string => !!at)
    .sort((a, b) => ms(a) - ms(b));

  const endOf = (at: string | null): string | null =>
    at ? (recorded.find((r) => ms(r) > ms(at)) ?? null) : null;

  const onBranch = branches.some((b) => b.spec.status === load.status);
  const steps: TrailStep[] = [];
  let pendingBranches = [...branches];

  /** Vuelca las salidas ocurridas antes de `before` (todas, si no hay límite). */
  const flushBranches = (before?: string | null) => {
    while (
      pendingBranches.length &&
      (before === undefined || !before || ms(pendingBranches[0].at) < ms(before))
    ) {
      const b = pendingBranches.shift()!;
      const isCurrent = b.spec.status === load.status;
      steps.push({
        status: b.spec.status,
        label: isCurrent ? b.spec.label : b.spec.doneLabel,
        state: isCurrent ? 'current' : 'done',
        at: b.at,
        score: null,
        note: b.entry?.note ?? (isCurrent ? (load.validationError ?? load.job?.error ?? null) : null),
        broken: true,
      });
    }
  };

  for (let i = 0; i < PIPELINE.length; i++) {
    const spec = PIPELINE[i];
    const entry = seen.get(spec.status) ?? null;

    // Las salidas anteriores a este paso van antes que él: así una carga que
    // falló la validación y después se aprobó a mano muestra el desvío en el
    // lugar donde ocurrió, no al final.
    flushBranches(entry?.at ?? null);

    // Parada acá y sin haberse salido del camino: éste es el paso actual.
    // COMPLETED es el final, se muestra cumplido y no "en curso".
    const isCurrent = !onBranch && i === reached && load.status !== 'COMPLETED';
    const state: StepState = isCurrent ? 'current' : i <= reached ? 'done' : 'pending';

    steps.push({
      status: spec.status,
      label: state === 'done' ? spec.doneLabel : spec.label,
      state,
      // Un paso cumplido se estampa con la hora en que TERMINÓ. Si llevara la
      // de entrada, "Comprobante recibido" mostraría el momento en que se
      // empezó a esperarlo, que es otra cosa.
      at: state === 'done' ? (endOf(entry?.at ?? null) ?? entry?.at ?? null) : (entry?.at ?? null),
      // El score va sólo en el paso de la IA. El validador lo escribe en la
      // fila del estado al que pasa (APPROVED o VALIDATION_FAILED), no en la de
      // VALIDATING, así que se toma del campo de la solicitud: es el mismo dato
      // y no depende de que el historial siga estando.
      score: spec.status === 'VALIDATING' ? (load.validationScore ?? entry?.score ?? null) : null,
      note: state === 'pending' ? null : (entry?.note ?? null),
      broken: false,
    });

    // Cerrada sin cargar: mostrar los pasos que faltan sería prometer algo que
    // no va a pasar.
    if (i >= reached && (load.status === 'REJECTED' || load.status === 'CANCELLED')) {
      flushBranches();
      break;
    }
  }

  flushBranches();

  const current = steps.find((s) => s.state === 'current') ?? null;
  const currentSince = current?.at ?? null;
  const limit = STALL_MINUTES[load.status];
  const settled = SETTLED.includes(load.status);

  return {
    steps,
    current,
    currentSince,
    stalled:
      !settled &&
      !!limit &&
      !!currentSince &&
      Date.now() - new Date(currentSince).getTime() > limit * 60_000,
    settled,
  };
}

// ── Cerrar una carga colgada ──────────────────────────────────────────────────

/**
 * Estados en los que el operador puede cerrar la carga a mano.
 *
 * Tiene que decir lo mismo que `OPERATOR_CANCELLABLE` del backend, que es quien
 * manda: acá sólo se decide si se dibuja el botón. `PROCESSING` queda afuera
 * porque el bot puede haber cargado las fichas sin llegar a confirmarlo, y
 * cerrarla habilitaría un reintento que carga dos veces.
 */
const CANCELLABLE: LoadStatus[] = [
  'PENDING_PROOF',
  'VALIDATING',
  'VALIDATION_FAILED',
  'APPROVED',
];

export function canCancel(load: { status: LoadStatus }): boolean {
  return CANCELLABLE.includes(load.status);
}

/**
 * Por qué cerrarla no le hace daño a nadie, en las palabras que el operador
 * necesita leer antes de apretar. Cambia según dónde quedó parada.
 */
export function cancelConsequence(load: { status: LoadStatus }): string {
  switch (load.status) {
    case 'PENDING_PROOF':
      return 'Nunca llegó el comprobante, así que no hay nada que cargar. Al cerrarla, el usuario queda libre para pedir de nuevo.';
    case 'VALIDATING':
      return 'Quedó trabada antes de que la IA terminara. No se cargan fichas y el usuario queda libre para pedir de nuevo.';
    case 'VALIDATION_FAILED':
      return 'Se cierra sin cargar fichas. Si el comprobante era bueno, aprobala desde la Bandeja en vez de cerrarla.';
    case 'APPROVED':
      return 'Todavía no la agarró el bot: se saca de la cola y no se cargan fichas. El usuario queda libre para pedir de nuevo.';
    default:
      return 'Se cierra sin cargar fichas.';
  }
}

// ── Agrupación para la pantalla ───────────────────────────────────────────────

export type TrackingFilter = 'active' | 'stalled' | 'closed';

/**
 * Qué se mira.
 *
 * "En curso" es el default y es casi toda la pantalla: una carga completada,
 * fallada o cancelada ya no espera nada de nadie, y tenerlas mezcladas empuja
 * hacia abajo lo único que hay que mirar. "Cerradas" existe igual para ir a
 * revisar qué pasó, y es el único filtro que le pide al servidor traerlas.
 */
export const TRACKING_FILTERS: { key: TrackingFilter; label: string }[] = [
  { key: 'active', label: 'En curso' },
  { key: 'stalled', label: 'Trabadas' },
  { key: 'closed', label: 'Cerradas' },
];

/** Ventanas de tiempo. Mismas que usa la Bandeja, para no inventar otro criterio. */
export const TRACKING_RANGES: { key: TrackingRange; label: string; hours: number }[] = [
  { key: 'hour', label: 'Última hora', hours: 1 },
  { key: 'today', label: 'Hoy', hours: 24 },
  { key: 'week', label: '7 días', hours: 168 },
];

export type TrackingRange = 'hour' | 'today' | 'week';

export type TrackedLoad = ActiveLoad & { trail: Trail };

export function track(loads: ActiveLoad[]): TrackedLoad[] {
  return loads.map((l) => ({ ...l, trail: buildTrail(l) }));
}

export function matchesFilter(load: TrackedLoad, filter: TrackingFilter): boolean {
  switch (filter) {
    case 'stalled':
      return load.trail.stalled;
    case 'closed':
      return load.trail.settled;
    default:
      return !load.trail.settled;
  }
}

/** Cuándo se cerró: la hora del último paso registrado. */
export function closedAt(load: TrackedLoad): string | null {
  const withTime = [...load.trail.steps].reverse().find((st) => !!st.at);
  return withTime?.at ?? load.updatedAt ?? null;
}

/**
 * Orden de la lista: primero lo que necesita una mirada.
 *
 * Trabadas arriba, después las que siguen andando, y al final las cerradas.
 * Dentro de cada grupo, la que hace más rato que no se mueve primero: si algo
 * se colgó a las 14:30 y otra cosa a las 15:00, la vieja es la urgente.
 */
export function sortForOperator(loads: TrackedLoad[]): TrackedLoad[] {
  const rank = (l: TrackedLoad) => (l.trail.stalled ? 0 : l.trail.settled ? 2 : 1);
  return [...loads].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    const at = (l: TrackedLoad) => new Date(l.trail.currentSince ?? l.updatedAt).getTime();
    // Las cerradas se leen al revés: lo último que pasó es lo que interesa.
    return rank(a) === 2 ? at(b) - at(a) : at(a) - at(b);
  });
}
