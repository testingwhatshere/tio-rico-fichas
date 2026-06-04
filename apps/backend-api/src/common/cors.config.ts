/**
 * CORS origin configuration helper.
 *
 * - If CORS_ORIGIN is unset or '*': returns `true` which tells Socket.IO
 *   to reflect the requesting origin (handles credentials correctly).
 * - Otherwise: splits comma-separated origins into an array.
 */
export function getCorsOrigin(): string[] | boolean {
  const env = process.env.CORS_ORIGIN;
  if (!env || env === '*') {
    return true;
  }
  return env.split(',').map((o) => o.trim());
}
