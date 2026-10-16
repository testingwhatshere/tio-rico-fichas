/**
 * Bandeja unificada.
 *
 * El panel viejo repartía el trabajo en cuatro pestañas (Fallos, Chats, Premios,
 * Pagos) y el operador tenía que rondarlas para saber si algo lo esperaba. Pero
 * su pregunta real es una sola: *¿qué necesita atención ahora?*. Acá se normaliza
 * todo a un mismo tipo para poder mostrarlo en una lista, ordenado por urgencia.
 *
 * Cada caso conserva su ruta de detalle y sus acciones: unificar la *vista* no
 * unifica las *decisiones*, que siguen siendo distintas y con reglas propias
 * (ver `docs` del backend: aprobar crea Job, marcar-cargado no, etc.).
 *
 * Los premios son la excepción y no entran acá: no son casos sueltos sino un
 * flujo con etapas (verificar → retirar fichas → transferir → comprobante) donde
 * lo que importa es el estado del dinero en cada tramo. Viven en su propia
 * pantalla —`app/(tabs)/prizes.tsx`— con su badge en la navegación, así que
 * meterlos también acá era contarlos dos veces.
 */
import { colors } from '@/constants/theme';
import { humanizeError } from '@/utils/errors';

export type WorkKind =
  | 'validation'   // comprobante que la IA no pudo validar
  | 'bot'          // el bot falló cargando las fichas
  | 'discovery'    // no se pudo resolver en qué panel está el usuario
  | 'payment'      // pago saliente pendiente
  | 'chat';        // mensaje sin leer / pedido de ayuda

export type WorkItem = {
  id: string;
  kind: WorkKind;
  /** Ruta de detalle. */
  href: string;
  username: string;
  amount?: number;
  /** Por qué está en la bandeja. Es lo que el panel viejo obligaba a abrir para saber. */
  reason: string;
  createdAt: string;
  /** Más alto = antes. Empata por fecha. */
  priority: number;
};

export const KIND_META: Record<WorkKind, { label: string; color: string; icon: string }> = {
  validation: { label: 'Comprobante', color: colors.warning, icon: 'document-text-outline' },
  bot:        { label: 'Carga',       color: colors.error,   icon: 'hardware-chip-outline' },
  discovery:  { label: 'Usuario',     color: colors.info,    icon: 'help-circle-outline' },
  payment:    { label: 'Pago',        color: colors.success, icon: 'card-outline' },
  chat:       { label: 'Chat',        color: colors.textSecondary, icon: 'chatbubble-outline' },
};

/**
 * Un fallo del backend llega con `type` 'validation_failed' o 'job_failed', pero
 * 'job_failed' tapa dos cosas distintas: que el bot rompiera cargando, o que
 * nunca se hubiera encontrado el panel del usuario. Se distinguen porque el
 * fallo de discovery no tiene job (el backend lo emite con `id === requestId`).
 */
function failureKind(f: any): WorkKind {
  if (f.type === 'validation_failed' || f.validationError || f.validationScore != null) {
    return 'validation';
  }
  const hasJob = Boolean(f.jobId) || (f.requestId && f.id !== f.requestId);
  return hasJob ? 'bot' : 'discovery';
}

function failureReason(f: any, kind: WorkKind): string {
  if (kind === 'validation') {
    return humanizeError(f.validationError || f.error) || 'La validación automática no pudo confirmarlo';
  }
  if (kind === 'discovery') {
    return humanizeError(f.error) || 'No se encontró a este usuario en ningún panel';
  }
  return humanizeError(f.error) || 'El bot no pudo completar la carga';
}

export function buildWorkItems(input: {
  failures: any[];
  outboundPayments: any[];
  chats: any[];
}): WorkItem[] {
  const items: WorkItem[] = [];

  for (const f of input.failures ?? []) {
    if (f.resolvedAt || f.resolved) continue;
    const kind = failureKind(f);
    items.push({
      id: `failure:${f.id}`,
      kind,
      href: `/failure/${f.id}`,
      username: f.targetUsername || f.userEmail || 'sin usuario',
      amount: Number(f.amount) || undefined,
      reason: failureReason(f, kind),
      createdAt: f.createdAt,
      // La carga fallida es lo más urgente: el usuario ya pagó y está esperando.
      priority: kind === 'bot' ? 3 : 2,
    });
  }

  for (const p of input.outboundPayments ?? []) {
    if (!['PENDING', 'CONFIRMED'].includes(p.status)) continue;
    items.push({
      id: `payment:${p.id}`,
      kind: 'payment',
      href: `/(tabs)/payments`,
      username: p.prizeClaim?.targetUsername || p.userId || 'sin usuario',
      amount: Number(p.amount) || undefined,
      reason: p.error || 'Pago pendiente de envío',
      createdAt: p.createdAt,
      priority: 1,
    });
  }

  for (const c of input.chats ?? []) {
    const unread = c.unreadCount ?? c._count?.messages ?? 0;
    const needsHelp = Boolean(c.helpRequestedAt || c.helpContext);
    if (!unread && !needsHelp) continue;
    items.push({
      id: `chat:${c.id}`,
      kind: 'chat',
      href: `/chat/${c.id}`,
      username: c.user?.username || c.user?.email || 'sin usuario',
      reason: needsHelp ? 'Pidió ayuda' : `${unread} mensaje${unread === 1 ? '' : 's'} sin leer`,
      createdAt: c.updatedAt || c.createdAt,
      // Un pedido de ayuda explícito va arriba de todo: hay alguien escribiendo.
      priority: needsHelp ? 4 : 1,
    });
  }

  return items.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
