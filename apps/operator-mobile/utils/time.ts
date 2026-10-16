/**
 * Tiempo relativo, una sola implementación.
 *
 * Antes había seis (`getRelativeTime`, `timeAgo`, `formatRelativeTime`…) con
 * salidas distintas para el mismo instante: 'recién' / 'ahora' / 'hace un momento'.
 */
export function timeAgo(input: string | number | Date | null | undefined): string {
  if (!input) return '—';
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return '—';

  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return 'recién';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}me`;
}

/**
 * Rangos temporales de la UI.
 *
 * Los operadores trabajan sobre lo de hoy: un fallo de hace tres meses no se
 * resuelve, se archiva. El rango además viaja al backend, que hasta ahora traía
 * `VALIDATION_FAILED` y jobs fallidos **sin ningún corte por fecha**.
 */
export const TIME_RANGES = {
  hour: { label: 'Última hora', ms: 60 * 60 * 1000 },
  today: { label: 'Hoy', ms: 24 * 60 * 60 * 1000 },
  week: { label: '7 días', ms: 7 * 24 * 60 * 60 * 1000 },
  all: { label: 'Todo', ms: null },
} as const;

export type TimeRangeKey = keyof typeof TIME_RANGES;

export function withinRange(date: string | Date | null | undefined, range: TimeRangeKey): boolean {
  const spec = TIME_RANGES[range];
  if (spec.ms === null) return true;
  if (!date) return false;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= spec.ms;
}

/**
 * Hora del día, sin fecha. Para los pasos de un recorrido, donde lo que importa
 * es a qué hora entró en cada uno y todos son del mismo día.
 *
 * Va acá y no en una pantalla porque este archivo es el único lugar donde se
 * formatea tiempo: ver el comentario de arriba sobre las seis implementaciones.
 */
export function formatClock(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Cuánto hace que algo no se mueve, en minutos. */
export function minutesSince(input: string | number | Date | null | undefined): number {
  if (!input) return 0;
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}
