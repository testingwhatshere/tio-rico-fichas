/**
 * Parse a Decimal/string amount to a number.
 * Handles Prisma Decimal serialization where amounts come as strings.
 */
export function parseAmount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Maximum amount allowed in input fields.
 * Prevents crashes from toLocaleString with extremely large numbers in React Native.
 */
export const MAX_INPUT_AMOUNT = 99_999_999;

/**
 * Safely format a number with Argentine locale.
 * Falls back to basic formatting if toLocaleString fails (RN compatibility).
 */
export function formatAmount(value: number | null | undefined): string {
  if (value == null || isNaN(value) || !isFinite(value)) return '0';
  try {
    return value.toLocaleString('es-AR');
  } catch {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
}
