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

// ── Bot / Extension ────────────────────────────────────────────────
export const STALE_PROGRESS_MS = 10 * 60 * 1000; // Clean progress entries older than 10min
export const BOT_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // No heartbeat for 2min = offline
export const BOT_PING_INTERVAL_MS = 90_000; // Socket.IO ping every 90s (Chrome SW can suspend for 30-60s)
export const BOT_PING_TIMEOUT_MS = 45_000; // 45s to respond to ping (generous for suspended SW)
export const BOT_DISCONNECT_DEBOUNCE_MS = 120_000; // 2 min grace — SW needs time to wake + reconnect

// ── Validator ──────────────────────────────────────────────────────
export const VALIDATOR_HEARTBEAT_TIMEOUT_MS = 90_000; // No heartbeat for 90s = dead
export const VALIDATOR_HEARTBEAT_CHECK_MS = 30_000; // Check heartbeat every 30s
export const VALIDATOR_HEALTH_CHECK_MS = 60_000; // Health poll every 60s
export const VALIDATOR_DISCONNECT_ALERT_MS = 5 * 60 * 1000; // Alert after 5min disconnected
export const VALIDATION_TIMEOUT_BUFFER_MS = 5_000; // Buffer between gateway and service timeout

// ── Uploads / Limits ───────────────────────────────────────────────
export const FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_WITHDRAWAL_AMOUNT = 3_000; // Minimum withdrawal in ARS
