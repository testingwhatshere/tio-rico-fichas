export function parseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/** Sin simbolo. Para mostrar en la UI usar `formatMoney`. */
export function formatAmount(value: number): string {
  return value.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Monto listo para mostrar, con simbolo. */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${formatAmount(value)}`;
}
