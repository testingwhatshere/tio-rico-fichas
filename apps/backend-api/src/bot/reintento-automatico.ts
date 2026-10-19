/**
 * Reintento automático de una carga que falló SIN mover plata.
 *
 * La regla del bot es "nunca reintentar": si algo falla, para y lo revisa una
 * persona, porque reintentar algo que quizás entró es cargar dos veces. La
 * excepción acordada es lo que falla ANTES de Aceptar (login, navegación,
 * extensión cambiándose): ahí hay certeza de que no se movió nada, y mandarle
 * "error" al usuario sólo genera reclamos y cargas a mano (sabrinamac, 16/10).
 *
 * Se reintenta UNA vez, y sólo si se cumple todo:
 *  - la extensión dice NOT_APPLIED (1.0.8+; sin outcome no se sabe → no);
 *  - el backend no vio que tocara Aceptar (la extensión también manda
 *    NOT_APPLIED después de Aceptar cuando el panel rechazó o el historial no
 *    la muestra: esos casos van al operador);
 *  - el error no es definitivo (reintentar daría lo mismo y el operador tiene
 *    que enterarse ya);
 *  - no se reintentó antes.
 */
export const REINTENTO_DEMORA_MS = 90_000;
export const REINTENTO_CHANGED_BY = 'system-autoretry';

const ERRORES_DEFINITIVOS =
  /insuficiente|no encontrado en este panel|monto inv[aá]lido|guardia|bloque|duplicad|historial|aceptar|rechaz|no la aplic[oó]|no se carg[oó]|no se descarg[oó]/i;

export function debeReintentarSolo(p: {
  outcome?: string;
  error?: string;
  tocoAceptar: boolean;
  yaReintentado: boolean;
}): boolean {
  if (p.outcome !== 'NOT_APPLIED') return false;
  if (p.tocoAceptar || p.yaReintentado) return false;
  if (ERRORES_DEFINITIVOS.test(p.error || '')) return false;
  return true;
}
