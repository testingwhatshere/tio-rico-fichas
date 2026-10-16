/**
 * Centralized timeout and interval constants.
 * All time values are in milliseconds unless noted otherwise.
 *
 * These are compile-time defaults. Many can be overridden at runtime
 * via SettingsService (e.g. VALIDATION_TIMEOUT_MS, QUEUE_COOLDOWN_MS).
 */

// ── Job Queue ──────────────────────────────────────────────────────
export const STUCK_JOB_CHECK_INTERVAL_MS = 60_000; // Check every 60s
export const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000; // PROCESSING > 5min = stuck
export const PERIODIC_DISPATCH_RETRY_MS = 60_000; // Retry dispatch every 60s

// ── Cargas ─────────────────────────────────────────────────────────
// Una carga que se quedó en PENDING_PROOF sin comprobante caduca sola pasado
// este tiempo. Existe porque `create` rechaza cualquier carga nueva mientras
// haya una activa, sin mirar la antigüedad: una solicitud abandonada dejaba al
// usuario sin poder pedir NUNCA MÁS, y la única salida era que él mismo la
// cancelara desde el chat o que un operador la cerrara. Se midió el 2026-09-04:
// 27 solicitudes fantasma vivas, 6 de clientes reales trabados hacía 9-22 días.
//
// 30 minutos: los casos reales se traban en cuestión de minutos (reintentan a
// los 20 segundos), y es margen de sobra para transferir y volver con el
// comprobante. Quien tarde más simplemente pide la carga de nuevo.
export const PENDING_PROOF_TTL_MS = 30 * 60 * 1000;

/**
 * Cuánto espera la pregunta "transferiste de más, ¿cargamos el monto del
 * comprobante?" antes de mandar la carga al operador.
 */
export const OVERPAID_OFFER_TTL_MS = 10 * 60 * 1000;

/**
 * Cuánto se espera a que el validador se reconecte (deploy, corte corto) antes
 * de mandar un comprobante a revisión manual por "validador no conectado".
 */
export const VALIDATOR_RECONNECT_WAIT_MS = 60 * 1000;

// ── Bot / Extension ────────────────────────────────────────────────
export const STALE_PROGRESS_MS = 10 * 60 * 1000; // Clean progress entries older than 10min
export const BOT_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // No heartbeat for 2min = offline
// Ping every 20s: Chrome ≥116 resets the MV3 service-worker idle timer (30s)
// on every WebSocket message, so frequent server pings PREVENT SW suspension
// entirely — far better than tolerating it with long intervals. With 90s pings
// the SW died between pings on machines where the extension's keepalive alarm
// wasn't enough (observed as reconnect churn every ~72s).
export const BOT_PING_INTERVAL_MS = 20_000;
export const BOT_PING_TIMEOUT_MS = 45_000; // 45s to respond to ping (generous for suspended SW)
export const BOT_DISCONNECT_DEBOUNCE_MS = 120_000; // 2 min grace — SW needs time to wake + reconnect
// BOT_LAST_HEARTBEAT sólo se lee al arrancar el backend (BotService.onModuleInit), y
// ahí el próximo heartbeat real llega a los 20s. Persistirlo en cada latido costaba
// ~33.000 upserts y 409s de CPU de base por mes — el 85% del tiempo de queries del
// servicio. Con 5 minutos el dato sigue sirviendo para lo único que se usa.
export const HEARTBEAT_PERSIST_INTERVAL_MS = 5 * 60 * 1000;

// ── Validator ──────────────────────────────────────────────────────
export const VALIDATOR_HEARTBEAT_TIMEOUT_MS = 90_000; // No heartbeat for 90s = dead
export const VALIDATOR_HEARTBEAT_CHECK_MS = 30_000; // Check heartbeat every 30s
// A reconnecting validator is rejected while the old (zombie) socket is still
// registered. 45s = 1.5× the client heartbeat interval (30s): a genuinely alive
// second validator never looks stale, but our own zombie after a blip is reaped
// fast so the reconnection takes over without operator intervention.
export const VALIDATOR_TAKEOVER_STALE_MS = 45_000;
export const VALIDATOR_HEALTH_CHECK_MS = 60_000; // Health poll every 60s
export const VALIDATOR_DISCONNECT_ALERT_MS = 5 * 60 * 1000; // Alert after 5min disconnected
export const VALIDATION_TIMEOUT_BUFFER_MS = 5_000; // Buffer between gateway and service timeout

// ── Uploads / Limits ───────────────────────────────────────────────
export const FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_WITHDRAWAL_AMOUNT = 3_000; // Minimum withdrawal in ARS
