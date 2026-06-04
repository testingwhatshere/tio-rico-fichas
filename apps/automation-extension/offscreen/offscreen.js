// Offscreen document keepalive
// Sends periodic messages to the service worker to prevent Chrome from suspending it.
// Unlike chrome.alarms (clamped to 30s minimum), setInterval in an offscreen document
// can fire at shorter intervals, keeping the SW alive continuously.

const KEEPALIVE_INTERVAL_MS = 20000; // 20 seconds

setInterval(() => {
  chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }).catch(() => {
    // SW might be restarting — ignore errors
  });
}, KEEPALIVE_INTERVAL_MS);
