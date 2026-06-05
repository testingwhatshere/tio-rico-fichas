// Service Worker - Main orchestrator for the automation bot
import { ApiClient } from './api-client.js';
import { JobProcessor } from './job-processor.js';

// Constants
const KEEPALIVE_ALARM_NAME = 'keepalive';
const KEEPALIVE_INTERVAL_MIN = 0.4; // ~24 seconds (minimum chrome.alarms allows is ~0.5 but we set lower to be safe)
const WS_CONNECTION_TIMEOUT_MS = 10000; // 10s to establish WS connection
const WS_ZOMBIE_THRESHOLD_MS = 120000;  // 120s (2min) without any WS message = zombie (server pings every 90s)
const OFFSCREEN_KEEPALIVE_INTERVAL_MS = 20000; // 20s - offscreen doc pings SW to prevent suspension
const SELECTOR_CHECK_ALARM_NAME = 'selector-check';
const SELECTOR_CHECK_INTERVAL_MIN = 1440; // Check selectors once per day (24h)
// State
let state = {
  status: 'IDLE', // IDLE, CONNECTED, PROCESSING, ERROR
  currentJob: null,
  connectionType: 'NONE', // NONE, WEBSOCKET, POLLING
  websocket: null,
  pollingInterval: null,
  config: null,
  reconnectTimer: null,        // Track reconnect setTimeout to prevent leaks
  wsUpgradeTimer: null,        // Periodic WS upgrade attempt while in polling mode
  pollingRecoveryTimer: null,  // Self-healing timer after polling failures
  heartbeatFailures: 0,        // Consecutive heartbeat failures
  startTime: Date.now(),        // Extension start time for uptime tracking
  lastJobCompletedAt: 0,       // Cooldown tracking
  consecutiveJobErrors: 0,      // Consecutive job failures for heartbeat reporting
  circuitBreakerActive: false,  // Circuit breaker: pause after repeated failures
  processedJobIds: new Map(),  // Duplicate job detection (jobId → timestamp)
  lastWsMessageTime: 0,        // Track last WS message for zombie detection
  wsConnectionTimer: null,     // Timeout for WS connection phase
  wsReconnectAttempts: 0,
  notificationSettings: {
    jobStarted: true,
    jobCompleted: true,
    jobFailed: true,
    connectionLost: true
  }
};

// Local statistics tracking
let localStats = {
  completed: 0,
  failed: 0,
  totalTime: 0,
  jobCount: 0,
  weeklyData: [0, 0, 0, 0, 0, 0, 0], // Last 7 days
  jobHistory: [] // Detailed job history
};

// Retry helper: retries an async fn up to maxRetries times with delay between attempts
async function retryWithDelay(fn, maxRetries = 2, delayMs = 3000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[ServiceWorker] Retry attempt ${attempt + 1}/${maxRetries + 1} failed:`, error.message);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

// Session log buffer - batches logs and flushes periodically
const sessionLogBuffer = [];
const SESSION_LOG_FLUSH_INTERVAL_MS = 5000;
let sessionLogFlushTimer = null;

const MAX_SESSION_LOG_BUFFER = 200;

function bufferSessionLog(entry) {
  sessionLogBuffer.push({
    ...entry,
    sessionId: state.currentJob?.id || 'idle',
    startedAt: entry.startedAt || new Date().toISOString(),
    completedAt: entry.completedAt || new Date().toISOString(),
  });
  // Drop oldest entries if buffer exceeds cap (prevents memory leak during backend outages)
  while (sessionLogBuffer.length > MAX_SESSION_LOG_BUFFER) {
    sessionLogBuffer.shift();
  }
  // Auto-flush if buffer gets large
  if (sessionLogBuffer.length >= 20) {
    flushSessionLogs();
  }
}

let sessionLogFlushing = false;
async function flushSessionLogs() {
  if (sessionLogBuffer.length === 0 || !state.config) return;
  // Guard against concurrent flushes (periodic timer + auto-flush at 20 entries)
  if (sessionLogFlushing) return;
  sessionLogFlushing = true;
  const count = sessionLogBuffer.length;
  try {
    await ApiClient.sendSessionLogBatch(state.config, sessionLogBuffer.slice(0, count));
    // Only remove after successful send
    sessionLogBuffer.splice(0, count);
  } catch (error) {
    console.warn('[ServiceWorker] Failed to flush session logs:', error.message);
    // Entries remain in buffer for next flush attempt
  } finally {
    sessionLogFlushing = false;
  }
}

// Start periodic flush
function startSessionLogFlusher() {
  if (sessionLogFlushTimer) clearInterval(sessionLogFlushTimer);
  sessionLogFlushTimer = setInterval(flushSessionLogs, SESSION_LOG_FLUSH_INTERVAL_MS);
}



// Persist a failed job report to chrome.storage.local for manual recovery
async function persistFailedReport(jobId, result) {
  try {
    const stored = await chrome.storage.local.get(['failedReports']);
    const failedReports = stored.failedReports || [];
    failedReports.push({
      jobId,
      result,
      failedAt: new Date().toISOString()
    });
    // Keep last 20 failed reports
    if (failedReports.length > 20) {
      failedReports.splice(0, failedReports.length - 20);
    }
    await chrome.storage.local.set({ failedReports });
    console.error(`[ServiceWorker] Job result persisted to failedReports for manual recovery: ${jobId}`);
  } catch (storageError) {
    console.error('[ServiceWorker] Failed to persist failed report:', storageError.message);
  }
}

// Persist a structured log entry to chrome.storage.local for the logs page (ring buffer, max 200)
async function persistLog(level, category, message, data = null) {
  try {
    const stored = await chrome.storage.local.get(['logs']);
    const logs = stored.logs || [];
    logs.push({
      level,
      category,
      message,
      data,
      timestamp: new Date().toISOString()
    });
    // Keep last 200 entries
    if (logs.length > 200) {
      logs.splice(0, logs.length - 200);
    }
    await chrome.storage.local.set({ logs });
  } catch (error) {
    console.error('[ServiceWorker] Failed to persist log:', error.message);
  }

  // Stream log to backend for operator real-time view
  if (state.websocket?.readyState === WebSocket.OPEN) {
    try {
      state.websocket.send('42/bot,' + JSON.stringify(['extension:log', {
        level: level.toLowerCase(),
        category,
        message,
        timestamp: new Date().toISOString(),
        metadata: { panelId: state.config?.panelId }
      }]));
    } catch (_) { /* best-effort streaming */ }
  }
}

// Create offscreen document to keep SW alive via periodic messages
async function ensureOffscreenDocument() {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existingContexts.length > 0) return; // Already exists

    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Keep service worker alive for WebSocket connection',
    });
    console.log('[ServiceWorker] Offscreen document created for keepalive');
  } catch (error) {
    // Ignore "already exists" errors (race condition between listeners)
    if (!error.message?.includes('Only a single offscreen')) {
      console.warn('[ServiceWorker] Failed to create offscreen document:', error.message);
    }
  }
}

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ServiceWorker] Extension installed');
  await loadConfig();
  await loadLocalStats();
  await loadNotificationSettings();

  // Always ensure keepalive alarm is running
  await ensureKeepaliveAlarm();
  await ensureOffscreenDocument();

  // Only try to connect if config is present
  if (state.config?.backendUrl && state.config?.apiKey) {
    await initializeConnection();
  } else {
    console.log('[ServiceWorker] Backend not configured yet - please configure in options page');
    state.status = 'IDLE';
    updateBadge();
  }
});

// Also run on startup (service worker wake up)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[ServiceWorker] Extension started');
  await loadConfig();
  await loadLocalStats();
  await loadNotificationSettings();

  // Always ensure keepalive alarm is running
  await ensureKeepaliveAlarm();
  await ensureOffscreenDocument();

  // Only try to connect if config is present
  if (state.config?.backendUrl && state.config?.apiKey) {
    await initializeConnection();
  } else {
    console.log('[ServiceWorker] Backend not configured yet - please configure in options page');
    state.status = 'IDLE';
    updateBadge();
  }
});

// Listen for config changes in storage (debounced to prevent reconnect storms)
let configChangeDebounceTimer = null;
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes.config) {
    console.log('[ServiceWorker] Config changed in storage, reloading...');
    await loadConfig();

    // If backend URL or API key changed, reconnect (debounced)
    if (changes.config.newValue?.backendUrl !== changes.config.oldValue?.backendUrl ||
        changes.config.newValue?.apiKey !== changes.config.oldValue?.apiKey) {
      if (configChangeDebounceTimer) clearTimeout(configChangeDebounceTimer);
      configChangeDebounceTimer = setTimeout(async () => {
        configChangeDebounceTimer = null;
        console.log('[ServiceWorker] Backend connection settings changed, reconnecting...');
        await initializeConnection();
      }, 500);
    }
  }
});

// Listen for tab updates to auto-login to panel
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when page has finished loading
  if (changeInfo.status !== 'complete') {
    return;
  }

  // Check if this is the panel URL
  if (!state.config?.panelUrl || !tab.url) {
    return;
  }

  try {
    const panelUrlObj = new URL(state.config.panelUrl);
    const tabUrlObj = new URL(tab.url);

    // Check if we're on the panel domain
    if (tabUrlObj.hostname !== panelUrlObj.hostname) {
      return;
    }

    console.log('[ServiceWorker] Panel page detected:', tab.url);

    // Wait for Nuxt.js SPA to hydrate (DOM might not be ready immediately)
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('[ServiceWorker] Checking login status...');

    // Ensure content scripts are injected with config
    await JobProcessor.injectContentScripts(tabId, state.config);

    // Wait a bit for scripts to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if already logged in
    const loginStatus = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.panelAutomation) {
          return window.panelAutomation.checkLoginStatus();
        }
        return { isLoggedIn: false, error: 'panelAutomation not loaded' };
      }
    });

    console.log('[ServiceWorker] Login status result:', loginStatus[0]?.result);
    const isLoggedIn = loginStatus[0]?.result?.isLoggedIn;

    if (!isLoggedIn && state.config?.panelUsername && state.config?.panelPassword) {
      console.log('[ServiceWorker] Not logged in, attempting auto-login...');

      // Attempt login
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (credentials) => {
          if (window.panelAutomation) {
            return await window.panelAutomation.login(credentials);
          }
          return { success: false, error: 'Panel automation not loaded' };
        },
        args: [{
          username: state.config.panelUsername,
          password: state.config.panelPassword
        }]
      });

      if (result[0]?.result?.success) {
        console.log('[ServiceWorker] Auto-login successful!');

        // Wait a bit for login to complete
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Navigate to users page if not already there
        if (!tabUrlObj.pathname.includes('users')) {
          const origin = new URL(state.config.panelUrl).origin;
          const usersUrl = `${origin}/users`;
          console.log('[ServiceWorker] Navigating to users page:', usersUrl);

          await chrome.tabs.update(tabId, { url: usersUrl });

          // Show success notification (silent, no sound)
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Login Automático',
            message: 'Sesión iniciada - Navegando a página de usuarios',
            priority: 0,
            silent: true
          });
        } else {
          console.log('[ServiceWorker] Already on users page');
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Bot Listo',
            message: 'Sesión iniciada - Bot listo en página de usuarios',
            priority: 0,
            silent: true
          });
        }
      } else {
        console.warn('[ServiceWorker] Auto-login failed:', result[0]?.result?.error);
        // Show error notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Auto-login Fallido',
          message: result[0]?.result?.error || 'Error desconocido',
          priority: 1
        });
      }
    } else if (isLoggedIn) {
      console.log('[ServiceWorker] Already logged in to panel');

      // If logged in but not on users page, navigate there
      if (!tabUrlObj.pathname.includes('users')) {
        console.log('[ServiceWorker] Logged in, navigating to users page...');
        const origin = new URL(state.config.panelUrl).origin;
        const usersUrl = `${origin}/users`;
        await chrome.tabs.update(tabId, { url: usersUrl });
      } else {
        console.log('[ServiceWorker] On users page, bot ready');
        // Ensure scripts are injected and ready
        await JobProcessor.injectContentScripts(tabId, state.config);
      }
    } else {
      console.log('[ServiceWorker] Auto-login skipped (no credentials configured)');
    }
  } catch (error) {
    console.error('[ServiceWorker] Auto-login check failed:', error);
    if (state.config?.debugMode) {
      console.log('[ServiceWorker] Error details:', error);
    }
  }
});

// Load configuration from storage
async function loadConfig() {
  const DEFAULT_CONFIG = {
    backendUrl: 'https://tiorico-api.onrender.com',
    apiKey: 'Narciso',
  };
  const stored = await chrome.storage.local.get(['config']);
  if (stored.config && stored.config.backendUrl && stored.config.apiKey) {
    state.config = { ...DEFAULT_CONFIG, ...stored.config };
  } else {
    state.config = { ...DEFAULT_CONFIG, ...(stored.config || {}) };
    await chrome.storage.local.set({ config: state.config });
    console.log('[ServiceWorker] Defaults applied + persisted');
  }
  console.log('[ServiceWorker] Config loaded:', {
    backendUrl: state.config.backendUrl,
    hasApiKey: !!state.config.apiKey
  });
}

// Load local statistics from storage
async function loadLocalStats() {
  try {
    const stored = await chrome.storage.local.get(['localStats']);
    if (stored.localStats) {
      localStats = { ...localStats, ...stored.localStats };
      // Rotate weekly data if needed
      rotateWeeklyData();
      console.log('[ServiceWorker] Local stats loaded');
    }
  } catch (error) {
    console.error('[ServiceWorker] Failed to load local stats:', error);
  }
}

// Save local statistics to storage
async function saveLocalStats() {
  try {
    await chrome.storage.local.set({ localStats });
  } catch (error) {
    console.error('[ServiceWorker] Failed to save local stats:', error);
  }
}

// Load notification settings
async function loadNotificationSettings() {
  try {
    const stored = await chrome.storage.local.get(['notificationSettings']);
    if (stored.notificationSettings) {
      state.notificationSettings = { ...state.notificationSettings, ...stored.notificationSettings };
      console.log('[ServiceWorker] Notification settings loaded');
    }
  } catch (error) {
    console.error('[ServiceWorker] Failed to load notification settings:', error);
  }
}

// Rotate weekly data (shift old data, add new day)
async function rotateWeeklyData() {
  try {
    const stored = await chrome.storage.local.get(['lastStatsDate']);
    const today = new Date().toDateString();

    if (stored.lastStatsDate && stored.lastStatsDate !== today) {
      const lastDate = new Date(stored.lastStatsDate);
      const daysDiff = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));

      if (daysDiff > 0) {
        // Shift array and add zeros for new days
        for (let i = 0; i < Math.min(daysDiff, 7); i++) {
          localStats.weeklyData.shift();
          localStats.weeklyData.push(0);
        }
      }
    }

    // Store today's date
    await chrome.storage.local.set({ lastStatsDate: today });
  } catch (error) {
    console.error('[ServiceWorker] Failed to rotate weekly data:', error);
  }
}

// Record job completion in local stats
async function recordJobCompletion(job, success, duration) {
  // Update counters
  if (success) {
    localStats.completed++;
  } else {
    localStats.failed++;
  }

  localStats.jobCount++;
  localStats.totalTime += duration || 0;

  // Update today's count in weekly data
  localStats.weeklyData[6]++;

  // Add to job history (keep last 50)
  localStats.jobHistory.unshift({
    id: job.id,
    targetUsername: job.targetUsername,
    amount: job.amount,
    success,
    duration,
    timestamp: new Date().toISOString(),
    error: success ? null : job.error
  });

  // Trim history to last 50 entries
  if (localStats.jobHistory.length > 50) {
    localStats.jobHistory = localStats.jobHistory.slice(0, 50);
  }

  await saveLocalStats();
}

// Initialize connection to backend (WebSocket with polling fallback)
async function initializeConnection() {
  // Clear any pending reconnect timer to prevent duplicate connections
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (!state.config?.backendUrl || !state.config?.apiKey) {
    console.log('[ServiceWorker] Cannot connect - backend not configured');
    state.status = 'IDLE';
    updateBadge();
    return;
  }

  console.log('[ServiceWorker] Initializing connection to backend...');

  // Ensure keepalive alarm is running (survives service worker restarts)
  ensureKeepaliveAlarm();

  // Try WebSocket first
  try {
    await connectWebSocket();
  } catch (error) {
    console.warn('[ServiceWorker] WebSocket connection failed, falling back to polling');
    if (state.config.debugMode) {
      console.log('[ServiceWorker] WebSocket error details:', error);
    }
    startPolling();
  }
}

// Ensure the keepalive alarm is registered (idempotent)
async function ensureKeepaliveAlarm() {
  const existing = await chrome.alarms.get(KEEPALIVE_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
      delayInMinutes: KEEPALIVE_INTERVAL_MIN,
      periodInMinutes: KEEPALIVE_INTERVAL_MIN
    });
    console.log('[ServiceWorker] Keepalive alarm created');
  }

  // Selector health check alarm (hourly)
  const selectorAlarm = await chrome.alarms.get(SELECTOR_CHECK_ALARM_NAME);
  if (!selectorAlarm) {
    chrome.alarms.create(SELECTOR_CHECK_ALARM_NAME, {
      delayInMinutes: 5, // First check 5 min after startup
      periodInMinutes: SELECTOR_CHECK_INTERVAL_MIN,
    });
    console.log('[ServiceWorker] Selector check alarm created (every', SELECTOR_CHECK_INTERVAL_MIN, 'min)');
  }
}

// Connect via WebSocket
async function connectWebSocket() {
  // NOTE: Don't stop polling here — keep it running as a safety net until WS
  // namespace ack (40/bot) confirms we're truly connected. Polling is stopped
  // in the onmessage handler when the /bot namespace is acknowledged.

  // Close any existing WebSocket before opening a new one (prevents leaked connections).
  // Detach handlers first so the old WS's async onclose doesn't clobber the new WS reference.
  if (state.websocket) {
    const oldWs = state.websocket;
    oldWs.onclose = null;
    oldWs.onmessage = null;
    oldWs.onerror = null;
    try { oldWs.close(); } catch (_) {}
    state.websocket = null;
  }

  // Clear any previous connection timeout
  if (state.wsConnectionTimer) {
    clearTimeout(state.wsConnectionTimer);
    state.wsConnectionTimer = null;
  }

  // Convert HTTP URL to WS URL
  const wsUrl = state.config.backendUrl.replace('http://', 'ws://').replace('https://', 'wss://');

  console.log('[ServiceWorker] Connecting to WebSocket:', wsUrl);

  // Connect with Socket.IO client (using native approach since we can't import socket.io-client in service worker)
  // Socket.IO uses /socket.io/ path, namespace is specified in the handshake message
  // Pass apiKey as query param so it's available in handshake.query (raw WebSocket
  // doesn't reliably populate handshake.auth from namespace CONNECT packet)
  // Include panelId in query params for Socket.IO handshake
  let wsQueryParams = '/socket.io/?EIO=4&transport=websocket&apiKey=' + encodeURIComponent(state.config.apiKey);
  if (state.config.panelId) {
    wsQueryParams += '&panelId=' + encodeURIComponent(state.config.panelId);
  }
  state.websocket = new WebSocket(wsUrl + wsQueryParams);

  // Connection timeout: if onopen doesn't fire within WS_CONNECTION_TIMEOUT_MS, give up
  state.wsConnectionTimer = setTimeout(() => {
    state.wsConnectionTimer = null;
    if (state.websocket && state.websocket.readyState !== WebSocket.OPEN) {
      console.warn(`[ServiceWorker] WebSocket connection timed out after ${WS_CONNECTION_TIMEOUT_MS / 1000}s`);
      persistLog('WARN', 'CONNECTION', `WebSocket connection timed out after ${WS_CONNECTION_TIMEOUT_MS / 1000}s`);
      state.websocket.close();
      // onclose handler will trigger reconnection/fallback
    }
  }, WS_CONNECTION_TIMEOUT_MS);

  state.websocket.onopen = () => {
    // Clear connection timeout — we connected successfully
    if (state.wsConnectionTimer) {
      clearTimeout(state.wsConnectionTimer);
      state.wsConnectionTimer = null;
    }

    console.log('[ServiceWorker] WebSocket connected');
    persistLog('SUCCESS', 'CONNECTION', 'WebSocket connected');
    state.lastWsMessageTime = Date.now(); // Start tracking

    // Send Socket.IO namespace connection to /bot with authentication
    // Format: 40/namespace,{auth data} — auth data goes directly (not wrapped in "auth" key)
    const handshakeData = { apiKey: state.config.apiKey };
    if (state.config.panelId) {
      handshakeData.panelId = state.config.panelId;
    }
    // Guard: ensure WS is truly OPEN before sending (Chrome edge case)
    if (state.websocket?.readyState === WebSocket.OPEN) {
      state.websocket.send('40/bot,' + JSON.stringify(handshakeData));
    } else {
      console.warn('[ServiceWorker] WS onopen fired but readyState is not OPEN, retrying in 100ms');
      setTimeout(() => {
        if (state.websocket?.readyState === WebSocket.OPEN) {
          state.websocket.send('40/bot,' + JSON.stringify(handshakeData));
        }
      }, 100);
    }

    // Don't set CONNECTED here — wait for namespace ack (40/bot response)
    // Transport is open but /bot namespace auth hasn't been confirmed yet
    state.connectionType = 'WEBSOCKET';
  };

  state.websocket.onmessage = async (event) => {
    const data = event.data;

    // Update last message timestamp for zombie detection (every message counts, including pings)
    state.lastWsMessageTime = Date.now();

    if (state.config?.debugMode) {
      console.log('[ServiceWorker] WebSocket raw message:', data);
    }

    // Parse Socket.IO message format
    // Socket.IO messages start with a number indicating the message type
    // 40 = connect ack, 42 = event message
    // For namespaces, format is: 42/namespace,["event", data]

    if (data.startsWith('40/bot')) {
      // Connection acknowledged for /bot namespace — NOW we're truly connected
      console.log('[ServiceWorker] Connected to /bot namespace');
      state.status = 'CONNECTED';
      state.heartbeatFailures = 0;
      state.wsReconnectAttempts = 0;
      // Report status to backend
      ApiClient.reportStatus(state.config, 'online').catch(() => {});
      // Start session log flusher
      startSessionLogFlusher();

      // Stop polling if it was running (WebSocket is now primary)
      clearPolling();

      updateBadge();
    } else if (data.startsWith('42/bot,')) {
      // Event from /bot namespace
      try {
        const jsonPart = data.substring(7); // Remove "42/bot,"

        // Parse ACK ID if present (format: "42/bot,<ackId>[..." or "42/bot,["...")
        let ackId = null;
        let jsonBody = jsonPart;
        const bracketIdx = jsonPart.indexOf('[');
        if (bracketIdx > 0) {
          const possibleAckId = jsonPart.substring(0, bracketIdx);
          if (/^\d+$/.test(possibleAckId)) {
            ackId = possibleAckId;
            jsonBody = jsonPart.substring(bracketIdx);
          }
        }

        const message = JSON.parse(jsonBody);
        const [eventName, eventData] = message;

        console.log('[ServiceWorker] Socket.IO event:', eventName, eventData, ackId ? `(ackId=${ackId})` : '');

        // Helper to send ACK response back to server
        const sendAck = (response) => {
          if (ackId && state.websocket?.readyState === WebSocket.OPEN) {
            const ackPayload = `43/bot,${ackId}${JSON.stringify([response])}`;
            state.websocket.send(ackPayload);
            console.log('[ServiceWorker] Sent ACK for id', ackId);
          }
        };

        if (eventName === 'new_job') {
          // ACK immediately to confirm receipt, then process
          sendAck({ received: true, jobId: eventData?.id });
          await handleNewJob(eventData);
        } else if (eventName === 'search_user') {
          await handleSearchUser(eventData);
        } else if (eventName === 'create_user') {
          await handleCreateUser(eventData);
        } else if (eventName === 'verify_chips') {
          await handleVerifyChips(eventData);
        } else if (eventName === 'check_balance') {
          await handleCheckBalance(eventData);
        } else if (eventName === 'reset_circuit_breaker') {
          state.circuitBreakerActive = false;
          state.consecutiveJobErrors = 0;
          persistLog('INFO', 'CIRCUIT_BREAKER', 'Circuit breaker reseteado por operador');
        } else if (eventName === 'kill_switch') {
          await handleKillSwitch();
        } else if (eventName === 'connected') {
          console.log('[ServiceWorker] Bot authenticated successfully:', eventData);
        } else if (eventName === 'error') {
          console.warn('[ServiceWorker] WebSocket authentication error:', eventData?.message);
          // Close WebSocket and fall back to polling
          if (state.websocket) {
            state.websocket.close();
            state.websocket = null;
          }
          state.connectionType = 'NONE';
          console.log('[ServiceWorker] Falling back to polling due to auth error...');
          startPolling();
        }
      } catch (e) {
        console.error('[ServiceWorker] Failed to parse Socket.IO message:', e);
      }
    } else if (data.startsWith('42')) {
      // Event from default namespace (fallback)
      try {
        const message = JSON.parse(data.substring(2));
        const [eventName, eventData] = message;
        console.log('[ServiceWorker] Socket.IO event (default ns):', eventName, eventData);
      } catch (e) {
        console.error('[ServiceWorker] Failed to parse Socket.IO message:', e);
      }
    } else if (data.startsWith('41/bot')) {
      // Namespace disconnect — server removed us from /bot namespace
      console.warn('[ServiceWorker] Server disconnected /bot namespace');
      persistLog('WARN', 'CONNECTION', 'Server disconnected /bot namespace');
      // Close WebSocket to trigger full reconnection
      if (state.websocket) {
        state.websocket.close();
      }
    } else if (data === '2') {
      // Ping from server, respond with pong
      if (state.websocket?.readyState === WebSocket.OPEN) {
        state.websocket.send('3');
      }
    }
  };

  state.websocket.onerror = (error) => {
    console.warn('[ServiceWorker] WebSocket error event fired');
    persistLog('WARN', 'CONNECTION', 'WebSocket error event');
    // Note: onerror is always followed by onclose, so reconnection logic lives in onclose.
    // But we update status here so the UI reflects the error immediately.
    if (state.status !== 'PROCESSING' && state.status !== 'IDLE') {
      state.status = 'ERROR';
      updateBadge();
    }
  };

  state.websocket.onclose = () => {
    // Clear connection timeout if still pending
    if (state.wsConnectionTimer) {
      clearTimeout(state.wsConnectionTimer);
      state.wsConnectionTimer = null;
    }

    const wasConnected = state.connectionType === 'WEBSOCKET';
    if (wasConnected) {
      console.log('[ServiceWorker] WebSocket connection closed');
      persistLog('WARN', 'CONNECTION', 'WebSocket connection closed');
    }
    state.websocket = null;
    state.lastWsMessageTime = 0;

    // If polling is still running (kept as safety net), mark connection type accordingly
    if (state.pollingInterval) {
      state.connectionType = 'POLLING';
    } else {
      state.connectionType = 'NONE';
    }

    // Reconnect WS for ANY active status (not just CONNECTED).
    // IDLE = intentional disconnect (kill switch), skip reconnect.
    // ALWAYS attempt WS reconnect even if polling is running — WS is the primary
    // channel and polling is just a safety net. When WS reconnects successfully,
    // polling is stopped in the 40/bot namespace ack handler.
    const MAX_WS_RECONNECT_ATTEMPTS = 15;
    if (state.status !== 'IDLE') {
      // Start polling as safety net if not already running
      if (!state.pollingInterval) {
        startPolling(true);
      }

      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      state.wsReconnectAttempts = (state.wsReconnectAttempts || 0) + 1;

      if (state.wsReconnectAttempts > MAX_WS_RECONNECT_ATTEMPTS) {
        console.warn(`[ServiceWorker] WebSocket reconnect limit reached (${MAX_WS_RECONNECT_ATTEMPTS}), staying on polling + scheduling WS upgrade`);
        persistLog('WARN', 'CONNECTION', `WebSocket reconnect limit reached (${MAX_WS_RECONNECT_ATTEMPTS}), staying on polling`, { attempts: state.wsReconnectAttempts });
        // Don't give up forever — schedule periodic WS upgrade attempts
        scheduleWsUpgrade();
        return;
      }

      // Backoff: 3s, 4.5s, 6.75s, 10s, 15s (cap at 15s — WS must reconnect fast)
      const delay = Math.min(3000 * Math.pow(1.5, state.wsReconnectAttempts - 1), 15000);
      console.log(`[ServiceWorker] WebSocket reconnect attempt ${state.wsReconnectAttempts}/${MAX_WS_RECONNECT_ATTEMPTS}, delay: ${Math.round(delay / 1000)}s`);
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        if (state.config?.backendUrl && state.config?.apiKey) {
          console.log('[ServiceWorker] Attempting to reconnect WebSocket...');
          connectWebSocket().catch((err) => {
            console.warn('[ServiceWorker] WS reconnect failed:', err.message);
            // Polling is already running as safety net — next onclose cycle will retry WS
          });
        }
      }, delay);
    }
  };
}

// Clear polling safely (works with both setTimeout chains and setInterval)
function clearPolling() {
  if (state.pollingInterval) {
    clearTimeout(state.pollingInterval);
    state.pollingInterval = null;
  }
  if (state.wsUpgradeTimer) {
    clearTimeout(state.wsUpgradeTimer);
    state.wsUpgradeTimer = null;
  }
  if (state.pollingRecoveryTimer) {
    clearTimeout(state.pollingRecoveryTimer);
    state.pollingRecoveryTimer = null;
  }
}

// Periodically attempt WebSocket upgrade while in polling mode.
// WS is the primary channel — try to upgrade frequently.
function scheduleWsUpgrade() {
  if (state.wsUpgradeTimer) return;
  const WS_UPGRADE_INTERVAL_MS = 45 * 1000; // Try WS every 45s — WS should always be primary
  state.wsUpgradeTimer = setTimeout(async () => {
    state.wsUpgradeTimer = null;
    if (state.connectionType !== 'POLLING') return; // Already on WS or disconnected
    if (!state.config?.backendUrl || !state.config?.apiKey) return;

    console.log('[ServiceWorker] Attempting WebSocket upgrade from polling mode...');
    persistLog('INFO', 'CONNECTION', 'Attempting WebSocket upgrade from polling');
    // Reset reconnect counter — this is a fresh upgrade attempt, not a rapid-fire retry
    state.wsReconnectAttempts = 0;
    try {
      await connectWebSocket();
      // If WS connects, polling will be cleared in the 40/bot handler
    } catch (e) {
      console.log('[ServiceWorker] WebSocket upgrade failed, staying on polling:', e.message);
      // Schedule next upgrade attempt
      scheduleWsUpgrade();
    }
  }, WS_UPGRADE_INTERVAL_MS);
}

// Start polling as fallback (with exponential backoff, auth error detection, and self-healing)
// When aggressive=true (after WS failure), poll faster (5s) to catch QUEUED jobs quickly
function startPolling(aggressive = false) {
  if (state.pollingInterval) {
    return; // Already polling
  }

  const maskedKey = state.config?.apiKey ? `${state.config.apiKey.slice(0, 4)}...` : 'NONE';
  console.log(`[ServiceWorker] Starting polling mode (aggressive=${aggressive}) backendUrl=${state.config?.backendUrl || 'NOT SET'} apiKey=${maskedKey}`);
  persistLog('INFO', 'CONNECTION', `Switched to polling mode (aggressive=${aggressive}, ${state.config?.backendUrl || 'NO URL'})`);
  state.connectionType = 'POLLING';
  state.status = 'CONNECTED';
  state.heartbeatFailures = 0;

  // Polling state
  let consecutiveFailures = 0;
  const MIN_INTERVAL_MS = aggressive ? 5000 : 10000;
  let currentIntervalMs = MIN_INTERVAL_MS;
  const MAX_INTERVAL_MS = 60000;
  const MAX_TRANSIENT_FAILURES = 5; // After 5 transient failures, try full reconnection

  async function pollOnce() {
    // Guard: polling was stopped externally
    if (!state.pollingInterval) return;

    try {
      const job = await ApiClient.checkForJob(state.config);

      // Success — reset backoff
      if (consecutiveFailures > 0) {
        console.log(`[ServiceWorker] Polling recovered after ${consecutiveFailures} failure(s)`);
        consecutiveFailures = 0;
        currentIntervalMs = MIN_INTERVAL_MS;
        if (state.status === 'ERROR') {
          state.status = 'CONNECTED';
          updateBadge();
        }
      }

      if (job) {
        await handleNewJob(job);
      }
    } catch (error) {
      // Auth errors are unrecoverable — stop immediately
      if (error.isAuthError) {
        console.error('[ServiceWorker] Authentication error in polling — stopping:', error.message);
        persistLog('ERROR', 'CONNECTION', `Polling auth error: ${error.message}`);
        clearPolling();
        state.status = 'ERROR';
        state.connectionType = 'NONE';
        updateBadge();
        showNotification('Error de Autenticación', 'API Key inválida o sin permisos. Revisar configuración.', 'error');
        return; // Don't schedule next poll
      }

      // Transient error — backoff
      consecutiveFailures++;
      currentIntervalMs = Math.min(currentIntervalMs * 1.5, MAX_INTERVAL_MS);
      console.warn(`[ServiceWorker] Polling error (${consecutiveFailures}/${MAX_TRANSIENT_FAILURES}), next in ${Math.round(currentIntervalMs / 1000)}s:`, error.message);

      if (consecutiveFailures >= MAX_TRANSIENT_FAILURES && state.status !== 'PROCESSING') {
        console.error(`[ServiceWorker] Polling failed ${consecutiveFailures} times — attempting full reconnection`);
        persistLog('WARN', 'CONNECTION', `Polling failed ${consecutiveFailures} times, attempting reconnection`);
        clearPolling();
        state.status = 'ERROR';
        updateBadge();
        if (state.notificationSettings?.connectionLost) {
          showNotification('Backend Inalcanzable', `Reconectando después de ${consecutiveFailures} fallos...`, 'error');
        }
        // Self-healing: wait then try full reconnection (WS first, then polling)
        state.pollingRecoveryTimer = setTimeout(() => {
          state.pollingRecoveryTimer = null;
          console.log('[ServiceWorker] Polling self-healing: attempting full reconnection...');
          initializeConnection().catch(console.error);
        }, 15000); // Wait 15s before retry
        return; // Don't schedule next poll
      }
    }

    // Schedule next poll with current (possibly backed-off) interval
    if (state.pollingInterval !== null) {
      state.pollingInterval = setTimeout(pollOnce, currentIntervalMs);
    }
  }

  // Poll immediately on start to catch any QUEUED jobs right away,
  // then use setTimeout chain for dynamic backoff intervals
  pollOnce();
  state.pollingInterval = setTimeout(pollOnce, MIN_INTERVAL_MS);

  // Schedule periodic WebSocket upgrade attempts
  scheduleWsUpgrade();

  updateBadge();
}

// Handle new job
async function handleNewJob(job) {
  console.log('[ServiceWorker] New job received:', job);

  // Circuit breaker guard — reject jobs when paused due to repeated failures
  if (state.circuitBreakerActive) {
    persistLog('WARN', 'CIRCUIT_BREAKER', 'Job rechazado — extension pausada por errores repetidos');
    try {
      await ApiClient.reportJobResult(state.config, job.id, {
        success: false,
        error: 'Circuit breaker active — extension paused after consecutive failures',
      });
    } catch (_) { /* best-effort */ }
    return;
  }

  // Check kill switch before processing (covers polling mode where WS event isn't received)
  try {
    const killSwitch = await ApiClient.checkKillSwitch(state.config);
    if (killSwitch?.active) {
      console.warn('[ServiceWorker] Kill switch active, ignoring job');
      await handleKillSwitch();
      return;
    }
  } catch (e) {
    // Safe default: if kill switch check fails (backend unreachable), don't execute the job.
    // Better to skip a job than risk executing during an emergency.
    console.warn('[ServiceWorker] Kill switch check failed (backend unreachable), skipping job as safety precaution:', e.message);
    persistLog('WARN', 'SAFETY', `Kill switch check failed, skipping job ${job.id} as precaution: ${e.message}`);
    return;
  }

  // Panel ID guard — reject jobs meant for a different panel
  if (state.config.panelId && job.panelId && job.panelId !== state.config.panelId) {
    console.warn(`[ServiceWorker] Job ${job.id} is for panel "${job.panelId}" but this extension is configured for "${state.config.panelId}" — ignoring`);
    return;
  }

  // Check if already processing — silently ignore, job stays QUEUED in backend
  if (state.status === 'PROCESSING') {
    console.warn('[ServiceWorker] Already processing a job, ignoring new job:', job.id);
    return;
  }

  // Duplicate job detection — silently ignore, job stays in current backend status
  const processedAt = state.processedJobIds.get(job.id);
  if (processedAt && (Date.now() - processedAt) < 3600000) {
    console.warn('[ServiceWorker] Duplicate job, already processed:', job.id);
    return;
  }

  // Cooldown enforcement — silently ignore, job stays QUEUED for next dispatch cycle
  const COOLDOWN_MS = 30000;
  const timeSinceLastJob = Date.now() - state.lastJobCompletedAt;
  if (state.lastJobCompletedAt > 0 && timeSinceLastJob < COOLDOWN_MS) {
    const remainingS = Math.ceil((COOLDOWN_MS - timeSinceLastJob) / 1000);
    console.warn(`[ServiceWorker] Cooldown active, ${remainingS}s remaining. Ignoring job:`, job.id);
    return;
  }

  // Update state
  state.status = 'PROCESSING';
  state.currentJob = { ...job, startTime: Date.now() };
  updateBadge();
  ApiClient.reportStatus(state.config, 'busy').catch(() => {});

  // Mostrar notificación de trabajo iniciado (if enabled)
  const isWithdrawal = job.type === 'WITHDRAW_CHIPS';
  const isPasswordChange = job.type === 'CHANGE_PASSWORD';
  const isCreateUser = job.type === 'CREATE_USER';
  if (state.notificationSettings.jobStarted) {
    const title = isCreateUser ? 'Creando Usuario' : isPasswordChange ? 'Cambiando Contraseña' : isWithdrawal ? 'Retirando Fichas' : 'Procesando Trabajo';
    const body = isCreateUser
      ? `Creando usuario ${job.targetUsername} en el panel...`
      : isPasswordChange
        ? `Cambiando contraseña de ${job.targetUsername}...`
        : isWithdrawal
          ? `Retirando ${job.amount} fichas de ${job.targetUsername}...`
          : `Cargando ${job.amount} créditos para ${job.targetUsername}...`;
    showNotification(title, body, 'info');
  }

  // Report job started — if backend says another bot already claimed it, abort
  let startResult;
  try {
    startResult = await ApiClient.reportJobStarted(state.config, job.id);
  } catch (startError) {
    console.error(`[ServiceWorker] Failed to report job started for ${job.id}:`, startError.message);
    state.status = 'CONNECTED';
    state.currentJob = null;
    updateBadge();
    return;
  }
  if (startResult?.alreadyClaimed) {
    console.warn(`[ServiceWorker] Job ${job.id} already claimed by another bot — aborting`);
    state.status = 'CONNECTED';
    state.currentJob = null;
    updateBadge();
    return;
  }
  persistLog('INFO', 'JOB', `Job started: ${job.type} ${job.targetUsername}`, { jobId: job.id, type: job.type, targetUsername: job.targetUsername, amount: job.amount });

  // Process job (Fix 2: timeout prevents permanent PROCESSING deadlock)
  const JOB_TIMEOUT_MS = 120000;
  const startTime = Date.now();
  try {
    // Route job execution based on type
    const jobExecution = isCreateUser
      ? JobProcessor.createUser(job.targetUsername, state.config)
      : isPasswordChange
        ? JobProcessor.executePasswordChange(job, state.config)
        : isWithdrawal
          ? JobProcessor.executeWithdrawChips(job, state.config)
          : JobProcessor.execute(job, state.config);

    const result = await Promise.race([
      jobExecution,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Job execution timed out after ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS)
      )
    ]);
    const duration = Math.round((Date.now() - startTime) / 1000); // seconds

    console.log('[ServiceWorker] Job completed successfully:', result);
    persistLog('SUCCESS', 'JOB', `Job completed: ${job.targetUsername} ($${job.amount}) in ${duration}s`, { jobId: job.id, targetUsername: job.targetUsername, amount: job.amount, duration });

    // Upload screenshot if exists
    let screenshotPath = null;
    if (result.screenshot) {
      screenshotPath = await ApiClient.uploadScreenshot(state.config, job.id, result.screenshot);
    }

    const successResult = {
      success: true,
      screenshotPath: screenshotPath || undefined,
      duration,
      completedAt: new Date().toISOString()
    };
    try {
      await retryWithDelay(() => ApiClient.reportJobResult(state.config, job.id, successResult));
    } catch (reportError) {
      console.error('[ServiceWorker] All retries failed for job result report:', reportError.message);
      await persistFailedReport(job.id, successResult);
    }

    // Record in local stats
    await recordJobCompletion(job, true, duration);

    // Track processed job and cooldown (Fix 4 + Fix 8)
    state.processedJobIds.set(job.id, Date.now());
    for (const [id, ts] of state.processedJobIds) {
      if (Date.now() - ts > 3600000) state.processedJobIds.delete(id);
    }
    if (state.processedJobIds.size > 500) {
      const first = state.processedJobIds.keys().next().value;
      state.processedJobIds.delete(first);
    }
    state.lastJobCompletedAt = Date.now();

    // Mostrar notificación de éxito (if enabled)
    if (state.notificationSettings.jobCompleted) {
      showNotification(
        '¡Créditos Cargados!',
        `${job.amount} créditos agregados a ${job.targetUsername} (${duration}s)`,
        'success'
      );
    }

    // Track successful job for enriched heartbeat. Keep this as an integer (ms epoch) —
    // the cooldown check at line ~1030 does `Date.now() - state.lastJobCompletedAt`, which
    // produces NaN/garbage if this is a string. Format to ISO at the heartbeat call site.
    state.lastJobCompletedAt = Date.now();
    state.consecutiveJobErrors = 0;

    // Flush session logs on job completion
    flushSessionLogs().catch(() => {});

    state.status = 'CONNECTED';
    state.currentJob = null;
    updateBadge();
    ApiClient.reportStatus(state.config, 'online').catch(() => {});

    // Reconnect if WebSocket was lost during job processing
    if (!state.websocket && state.connectionType === 'NONE' && !state.pollingInterval) {
      console.log('[ServiceWorker] No active connection after job completion, reconnecting...');
      initializeConnection().catch(console.error);
    }
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.error('[ServiceWorker] Job failed:', error);
    persistLog('ERROR', 'JOB', `Job failed: ${job.targetUsername} ($${job.amount}) - ${error.message}`, { jobId: job.id, targetUsername: job.targetUsername, amount: job.amount, duration, error: error.message });

    // If timeout, abort panel automation by navigating panel tabs to about:blank
    // This kills running content scripts and prevents a second job from running concurrently
    if (error.message && error.message.includes('timed out')) {
      console.warn('[ServiceWorker] Timeout detected — aborting panel tabs');
      persistLog('WARN', 'JOB', 'Timeout: aborting panel tabs to kill content scripts', { jobId: job.id });
      try {
        if (state.config?.panelUrl) {
          const panelHostname = new URL(state.config.panelUrl).hostname;
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            try {
              if (tab.url && new URL(tab.url).hostname === panelHostname) {
                await chrome.tabs.update(tab.id, { url: 'about:blank' });
              }
            } catch (_) { /* ignore per-tab errors */ }
          }
        }
      } catch (abortError) {
        console.error('[ServiceWorker] Failed to abort panel tabs:', abortError.message);
      }
    }

    // Upload screenshot if exists (retry once on failure — operators need this for debugging)
    let screenshotPath = null;
    let screenshotLost = false;
    if (error.screenshot) {
      screenshotPath = await ApiClient.uploadScreenshot(state.config, job.id, error.screenshot);
      if (!screenshotPath) {
        // Retry once after 2s
        await new Promise(r => setTimeout(r, 2000));
        screenshotPath = await ApiClient.uploadScreenshot(state.config, job.id, error.screenshot);
        if (!screenshotPath) {
          screenshotLost = true;
          persistLog('WARN', 'SCREENSHOT', `Screenshot upload failed for job ${job.id} after retry`);
        }
      }
    }

    const failureResult = {
      success: false,
      error: screenshotLost
        ? `${error.message} [⚠ CAPTURA DE PANTALLA PERDIDA — no se pudo subir el screenshot del error]`
        : error.message,
      screenshotPath: screenshotPath || undefined,
      duration
    };
    try {
      await retryWithDelay(() => ApiClient.reportJobResult(state.config, job.id, failureResult));
    } catch (reportError) {
      console.error('[ServiceWorker] All retries failed for job failure report:', reportError.message);
      await persistFailedReport(job.id, failureResult);
    }

    // Record in local stats
    await recordJobCompletion({ ...job, error: error.message }, false, duration);

    // Track processed job and cooldown (Fix 4 + Fix 8)
    state.processedJobIds.set(job.id, Date.now());
    for (const [id, ts] of state.processedJobIds) {
      if (Date.now() - ts > 3600000) state.processedJobIds.delete(id);
    }
    if (state.processedJobIds.size > 500) {
      const first = state.processedJobIds.keys().next().value;
      state.processedJobIds.delete(first);
    }
    state.lastJobCompletedAt = Date.now();

    // Mostrar notificación de error (if enabled)
    if (state.notificationSettings.jobFailed) {
      showNotification(
        'Trabajo Fallido',
        `Error al cargar créditos para ${job.targetUsername}: ${error.message}`,
        'error'
      );
    }

    // Track job failure for enriched heartbeat + circuit breaker
    state.consecutiveJobErrors = (state.consecutiveJobErrors || 0) + 1;
    if (state.consecutiveJobErrors >= 3 && !state.circuitBreakerActive) {
      state.circuitBreakerActive = true;
      persistLog('ERROR', 'CIRCUIT_BREAKER', `Extension pausada tras ${state.consecutiveJobErrors} errores consecutivos`);
      // Notify backend
      if (state.websocket?.readyState === WebSocket.OPEN) {
        state.websocket.send('42/bot,' + JSON.stringify(['extension:circuit_breaker', {
          active: true,
          errors: state.consecutiveJobErrors,
          panelId: state.config?.panelId,
        }]));
      }
    }

    state.currentJob = null;

    // Flush session logs and report error status
    flushSessionLogs().catch(() => {});
    ApiClient.reportStatus(state.config, 'error').catch(() => {});

    // Reconnect if WebSocket was lost during job processing
    if (!state.websocket && state.connectionType === 'NONE' && !state.pollingInterval) {
      console.log('[ServiceWorker] No active connection after job failure, reconnecting...');
      state.status = 'ERROR';
      updateBadge();
      initializeConnection().catch(console.error);
    } else {
      // Connection is still alive — briefly show ERROR then auto-recover to CONNECTED
      // so the bot remains ready for the next job instead of appearing stuck in ERROR
      state.status = 'ERROR';
      updateBadge();
      setTimeout(() => {
        if (state.status === 'ERROR' && !state.currentJob && (state.websocket || state.pollingInterval)) {
          console.log('[ServiceWorker] Auto-recovering from ERROR to CONNECTED (connection still active)');
          state.status = 'CONNECTED';
          updateBadge();
        }
      }, 10000); // 10s grace period to show error in UI before recovering
    }
  }
}

// Handle check_balance request from backend (Telegram /fichas command)
async function handleCheckBalance(data) {
  console.log('[ServiceWorker] Balance check request received');
  try {
    // Find panel tab by URL (normalize trailing slash)
    const panelUrl = (state.config?.panelUrl || '').replace(/\/+$/, '');
    if (!panelUrl) throw new Error('Panel URL not configured');

    // Try multiple URL patterns to find the tab
    let panelTab = null;
    for (const pattern of [`${panelUrl}/*`, `${panelUrl}/`]) {
      const [tab] = await chrome.tabs.query({ url: pattern });
      if (tab) { panelTab = tab; break; }
    }

    if (!panelTab) {
      // Try matching by hostname as last resort
      const hostname = new URL(panelUrl).hostname;
      const allTabs = await chrome.tabs.query({});
      panelTab = allTabs.find(t => t.url && new URL(t.url).hostname === hostname) || null;
    }

    if (!panelTab) throw new Error('Panel tab not open — abri una pestaña del panel');

    // Navigate to /users if not there (own-balance is on users page)
    if (panelTab.url && !panelTab.url.includes('/users')) {
      await chrome.tabs.update(panelTab.id, { url: panelUrl + '/users' });
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const balance = await JobProcessor.readPanelBalance(panelTab.id);

    // Send response back via WebSocket
    if (state.websocket?.readyState === WebSocket.OPEN) {
      state.websocket.send('42/bot,' + JSON.stringify(['balance_result', { balance, panelId: state.config?.panelId || 'default' }]));
    }
    console.log(`[ServiceWorker] Balance check result: ${balance}`);
  } catch (error) {
    console.error('[ServiceWorker] Balance check failed:', error.message);
    if (state.websocket?.readyState === WebSocket.OPEN) {
      state.websocket.send('42/bot,' + JSON.stringify(['balance_result', { balance: null, error: error.message }]));
    }
  }
}

// Handle search_user discovery request from backend
async function handleSearchUser(data) {
  const { taskId, targetUsername } = data;
  console.log(`[ServiceWorker] Discovery request: search for "${targetUsername}" (task ${taskId})`);

  // If currently processing a job OR another discovery, report busy
  if (state.status === 'PROCESSING') {
    console.warn('[ServiceWorker] Cannot search — currently busy');
    await ApiClient.reportDiscoveryResult(state.config, taskId, {
      found: false,
      busy: true,
    });
    return;
  }

  // Validate config
  if (!state.config?.panelUrl) {
    console.error('[ServiceWorker] Cannot search — panelUrl not configured');
    await ApiClient.reportDiscoveryResult(state.config, taskId, {
      found: false,
      error: 'panelUrl not configured',
    });
    return;
  }

  // CRITICAL: Set PROCESSING to block incoming jobs/discoveries during search
  state.status = 'PROCESSING';
  updateBadge();

  try {
    const result = await JobProcessor.searchUser(targetUsername, state.config);

    console.log(`[ServiceWorker] Discovery result for "${targetUsername}": found=${result.found}`);
    const httpResult = await ApiClient.reportDiscoveryResult(state.config, taskId, {
      found: result.found,
    });
    // Fallback: if HTTP failed, report via WebSocket
    if (!httpResult && state.websocket?.readyState === WebSocket.OPEN) {
      console.log('[ServiceWorker] HTTP report failed, sending discovery result via WebSocket fallback');
      state.websocket.send('42/bot,' + JSON.stringify(['discovery_result', { taskId, panelId: state.config.panelId, found: result.found }]));
    }
  } catch (error) {
    console.error(`[ServiceWorker] Discovery search failed for "${targetUsername}":`, error.message);
    const httpResult = await ApiClient.reportDiscoveryResult(state.config, taskId, {
      found: false,
      error: error.message,
    });
    if (!httpResult && state.websocket?.readyState === WebSocket.OPEN) {
      console.log('[ServiceWorker] HTTP report failed, sending discovery error via WebSocket fallback');
      state.websocket.send('42/bot,' + JSON.stringify(['discovery_result', { taskId, panelId: state.config.panelId, found: false, error: error.message }]));
    }
  } finally {
    // Restore to CONNECTED — discovery is done, bot is idle again
    state.status = 'CONNECTED';
    updateBadge();
  }
}

// Handle create_user request from backend (auto-create user on panel when not found)
async function handleCreateUser(data) {
  const { taskId, targetUsername } = data;
  console.log(`[ServiceWorker] Create user request: "${targetUsername}" (task ${taskId})`);

  // If currently processing a job, report busy
  if (state.status === 'PROCESSING') {
    console.warn('[ServiceWorker] Cannot create user — currently busy');
    await ApiClient.reportCreateUserResult(state.config, taskId, {
      success: false,
      error: 'Bot is busy processing another job',
    });
    return;
  }

  if (!state.config?.panelUrl) {
    console.error('[ServiceWorker] Cannot create user — panelUrl not configured');
    await ApiClient.reportCreateUserResult(state.config, taskId, {
      success: false,
      error: 'panelUrl not configured',
    });
    return;
  }

  // Set PROCESSING to block incoming jobs during creation
  state.status = 'PROCESSING';
  updateBadge();

  try {
    const result = await JobProcessor.createUser(targetUsername, state.config);

    console.log(`[ServiceWorker] Create user result for "${targetUsername}":`, result);
    const httpResult = await ApiClient.reportCreateUserResult(state.config, taskId, {
      success: true,
      targetUsername,
      password: result.password || '123casino',
    });
    if (!httpResult && state.websocket?.readyState === WebSocket.OPEN) {
      console.log('[ServiceWorker] HTTP report failed, sending create_user result via WebSocket fallback');
      state.websocket.send('42/bot,' + JSON.stringify(['create_user_result', { taskId, panelId: state.config.panelId, success: true, targetUsername, password: result.password || '123casino' }]));
    }
  } catch (error) {
    console.error(`[ServiceWorker] User creation failed for "${targetUsername}":`, error.message);
    const httpResult = await ApiClient.reportCreateUserResult(state.config, taskId, {
      success: false,
      error: error.message,
    });
    if (!httpResult && state.websocket?.readyState === WebSocket.OPEN) {
      console.log('[ServiceWorker] HTTP report failed, sending create_user error via WebSocket fallback');
      state.websocket.send('42/bot,' + JSON.stringify(['create_user_result', { taskId, panelId: state.config.panelId, success: false, error: error.message }]));
    }
  } finally {
    // Restore to CONNECTED — creation is done, bot is idle again
    state.status = 'CONNECTED';
    updateBadge();
  }
}

// Handle verify_chips request from backend (prize claim verification)
async function handleVerifyChips(data) {
  const { taskId, targetUsername } = data;
  console.log(`[ServiceWorker] Verify chips request: "${targetUsername}" (task ${taskId})`);

  // If currently processing a job, report busy
  if (state.status === 'PROCESSING') {
    console.warn('[ServiceWorker] Cannot verify chips — currently busy');
    await ApiClient.reportVerifyChipsResult(state.config, taskId, {
      success: false,
      error: 'Bot is busy processing another job',
    });
    return;
  }

  if (!state.config?.panelUrl) {
    console.error('[ServiceWorker] Cannot verify chips — panelUrl not configured');
    await ApiClient.reportVerifyChipsResult(state.config, taskId, {
      success: false,
      error: 'panelUrl not configured',
    });
    return;
  }

  // Set PROCESSING to block incoming jobs during verification
  state.status = 'PROCESSING';
  updateBadge();

  try {
    const result = await JobProcessor.verifyChips(targetUsername, state.config);
    console.log(`[ServiceWorker] Verify chips result for "${targetUsername}":`, result);
    await ApiClient.reportVerifyChipsResult(state.config, taskId, result);
  } catch (error) {
    console.error(`[ServiceWorker] Verify chips failed for "${targetUsername}":`, error.message);
    await ApiClient.reportVerifyChipsResult(state.config, taskId, {
      success: false,
      error: error.message,
    });
  } finally {
    state.status = 'CONNECTED';
    updateBadge();
  }
}

// Handle kill switch
async function handleKillSwitch() {
  console.warn('[ServiceWorker] KILL SWITCH ACTIVATED');
  persistLog('ERROR', 'KILL_SWITCH', 'Kill switch activated', { hadActiveJob: !!state.currentJob });

  if (state.currentJob) {
    await ApiClient.reportJobResult(state.config, state.currentJob.id, {
      success: false,
      error: 'Kill switch activated',
      completedAt: new Date().toISOString()
    });
  }

  state.status = 'IDLE';
  state.currentJob = null;

  // Close WebSocket
  if (state.websocket) {
    state.websocket.close();
    state.websocket = null;
  }

  // Stop polling (clearPolling handles setTimeout chains and upgrade/recovery timers)
  clearPolling();

  // Clear pending reconnect timer (Fix 5)
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  // Clear WS connection timeout
  if (state.wsConnectionTimer) {
    clearTimeout(state.wsConnectionTimer);
    state.wsConnectionTimer = null;
  }

  state.connectionType = 'NONE';
  state.lastWsMessageTime = 0;
  // Note: we keep the keepalive alarm running — it checks kill switch before reconnecting
  updateBadge();
}

// Keepalive alarm handler — replaces unreliable setInterval
// This fires every ~24s and survives service worker restarts.
// Handles: heartbeat, zombie WS detection, and connection self-healing.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // --- Selector health check (hourly) ---
  if (alarm.name === SELECTOR_CHECK_ALARM_NAME) {
    try {
      await loadConfig();
      if (!state.config?.backendUrl || !state.config?.apiKey) return;

      // Find the panel tab
      const panelUrl = state.config.panelUrl;
      if (!panelUrl) return;

      const tabs = await chrome.tabs.query({ url: panelUrl + '*' });
      if (tabs.length === 0) {
        console.log('[SelectorCheck] No panel tab found, skipping');
        return;
      }

      // Send check request to content script
      const result = await chrome.tabs.sendMessage(tabs[0].id, { type: 'CHECK_SELECTORS' });
      if (!result) return;

      console.log(`[SelectorCheck] ${result.matched}/${result.total} OK, ${result.failed.length} failed`);

      // Report to backend
      await ApiClient.postSelectorCheck(state.config, result);

      // Stream selector health via WebSocket for real-time dashboard.
      // Use the same socket.io framing as every other server-bound emit (`42/bot,`).
      // Sending plain JSON here was a no-op even when the variable existed: the backend gateway
      // would not deliver it as an event.
      if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
        state.websocket.send('42/bot,' + JSON.stringify(['extension:selector_health', {
          matched: result.matched,
          failed: result.failed.length,
          total: result.total,
          failedSelectors: result.failed,
          timestamp: new Date().toISOString(),
        }]));
      }

      // Show notification if selectors are broken
      if (result.failed.length > 0) {
        chrome.notifications.create('selector-alert', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'Selectores rotos',
          message: `${result.failed.length} selectores no matchean: ${result.failed.slice(0, 3).join(', ')}${result.failed.length > 3 ? '...' : ''}`,
          priority: 2,
        });
      }
    } catch (e) {
      console.warn('[SelectorCheck] Error:', e.message);
    }
    return;
  }

  if (alarm.name !== KEEPALIVE_ALARM_NAME) return;

  // Step 0: Ensure offscreen document is alive (keeps SW from being suspended)
  await ensureOffscreenDocument();

  // Step 1: Always reload config from storage (service worker restart wipes in-memory state,
  // and options page saves may not have notified us if SW was suspended)
  await loadConfig();
  if (!state.notificationSettings?.jobStarted && !state.notificationSettings?.jobCompleted) {
    // Only reload these if they look uninitialized (avoid unnecessary reads)
    await loadLocalStats();
    await loadNotificationSettings();
  }

  if (!state.config?.backendUrl || !state.config?.apiKey) return;

  // Step 2: Self-healing — if we should be connected but have no active connection, reconnect
  if (state.status === 'IDLE') {
    // IDLE means intentional disconnect (kill switch). Don't auto-reconnect.
    // But check: was IDLE because the service worker restarted and lost state?
    // If config is present and status is IDLE with no kill switch, we should reconnect.
    try {
      const killSwitch = await ApiClient.checkKillSwitch(state.config);
      if (!killSwitch?.active) {
        console.log('[ServiceWorker] Keepalive: was IDLE but kill switch is off — reconnecting');
        persistLog('INFO', 'CONNECTION', 'Self-healing: reconnecting after service worker restart');
        await initializeConnection();
        return;
      }
    } catch (e) {
      // Backend unreachable — try again next alarm cycle
      return;
    }
    return;
  }

  const hasActiveConnection = state.websocket || state.pollingInterval;
  const hasReconnectPending = !!state.reconnectTimer;

  if (!hasActiveConnection && !hasReconnectPending && state.status !== 'PROCESSING') {
    console.warn('[ServiceWorker] Keepalive: no active connection detected — self-healing');
    persistLog('WARN', 'CONNECTION', 'Self-healing: no active connection, reconnecting');
    if (state.notificationSettings.connectionLost) {
      showNotification('Reconectando', 'Conexión perdida detectada, reconectando...', 'error');
    }
    state.status = 'ERROR';
    updateBadge();
    await initializeConnection().catch(console.error);
    return;
  }

  // Step 3: Zombie WebSocket detection — WS is "open" but no messages received
  if (state.connectionType === 'WEBSOCKET' && state.websocket && state.lastWsMessageTime > 0) {
    const silentMs = Date.now() - state.lastWsMessageTime;
    if (silentMs > WS_ZOMBIE_THRESHOLD_MS) {
      console.warn(`[ServiceWorker] Keepalive: zombie WebSocket detected (${Math.round(silentMs / 1000)}s silent)`);
      persistLog('WARN', 'CONNECTION', `Zombie WebSocket detected (${Math.round(silentMs / 1000)}s silent), forcing reconnect`);
      // Start polling immediately as safety net BEFORE closing WS.
      // onclose will attempt WS reconnect, but polling catches jobs in the meantime.
      if (!state.pollingInterval) {
        startPolling(true);
      }
      // Force close — onclose handler will trigger WS reconnection attempt
      if (state.websocket) {
        state.websocket.close();
      }
      return;
    }
  }

  // Step 4: Send WebSocket keepalive frame to prevent server ping timeout
  if (state.websocket?.readyState === WebSocket.OPEN) {
    state.websocket.send('3'); // Pong frame keeps the WS connection alive
    // DO NOT reset lastWsMessageTime here — it must only be reset when we
    // RECEIVE a message from the server (onmessage handler, line ~627).
    // Resetting on send masked zombie detection: the extension thought the
    // WS was alive because it kept refreshing its own timer every 24s.
  }

  // Step 5: Check panel balance via content script (if panel tab is open)
  try {
    const panelUrl = state.config.panelUrl;
    if (panelUrl) {
      const [panelTab] = await chrome.tabs.query({ url: panelUrl + '/*' });
      if (panelTab) {
        const balance = await JobProcessor.readPanelBalance(panelTab.id, state.config);
        if (balance != null) {
          await ApiClient.reportPanelBalance(state.config, balance);
        }
      }
    }
  } catch (e) {
    // Panel tab not accessible — skip balance check silently
  }

  // Step 6: Send heartbeat to backend
  const success = await ApiClient.sendHeartbeat(state.config, state);

  if (state.config.debugMode) {
    console.log('[ServiceWorker] Heartbeat sent:', success ? 'success' : 'failed');
  }

  if (success) {
    state.heartbeatFailures = 0;
    // Auto-recover from ERROR state when backend is reachable and we have a connection
    if (state.status === 'ERROR' && hasActiveConnection) {
      console.log('[ServiceWorker] Heartbeat succeeded while in ERROR state, recovering to CONNECTED');
      persistLog('INFO', 'CONNECTION', 'Auto-recovered from ERROR state via heartbeat');
      state.status = 'CONNECTED';
      updateBadge();
    }
  } else {
    state.heartbeatFailures++;
    if (state.config.debugMode) {
      console.warn(`[ServiceWorker] Heartbeat failed (${state.heartbeatFailures} consecutive)`);
    }
    if (state.heartbeatFailures >= 3) {
      persistLog('WARN', 'HEARTBEAT', `Heartbeat failed ${state.heartbeatFailures} times, reconnecting`);
      if (state.status !== 'PROCESSING') {
        state.status = 'ERROR';
        updateBadge();
      }
      if (state.notificationSettings.connectionLost) {
        showNotification('Conexión Perdida', 'Backend inalcanzable. Reconectando...', 'error');
      }
      state.heartbeatFailures = 0;
      initializeConnection().catch(console.error);
    }
  }
});

// Show notification toast
function showNotification(title, message, type = 'info') {
  const notificationId = `job-${Date.now()}`;

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
    priority: type === 'error' ? 2 : 1,
    requireInteraction: type === 'error'
  });

  // Auto-close after 5 seconds (except errors which require interaction)
  if (type !== 'error') {
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
    }, 5000);
  }
}

// Update extension badge
function updateBadge() {
  const badgeConfig = {
    IDLE: { text: '', color: '#888888' },
    CONNECTED: { text: '✓', color: '#00AA00' },
    PROCESSING: { text: '⚙', color: '#FFA500' },
    ERROR: { text: '!', color: '#FF0000' }
  };

  const config = badgeConfig[state.status] || badgeConfig.IDLE;
  chrome.action.setBadgeText({ text: config.text });
  chrome.action.setBadgeBackgroundColor({ color: config.color });
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    // Include current job with elapsed time
    const responseState = { ...state };
    if (state.currentJob?.startTime) {
      responseState.currentJob = {
        ...state.currentJob,
        elapsedTime: Math.round((Date.now() - state.currentJob.startTime) / 1000)
      };
    }
    sendResponse(responseState);
  } else if (message.type === 'MANUAL_TRIGGER') {
    // Manual job trigger from popup
    handleManualTrigger(message.job).then(sendResponse);
    return true; // Async response
  } else if (message.type === 'RECONNECT') {
    initializeConnection().then(sendResponse);
    return true;
  } else if (message.type === 'DISCONNECT') {
    handleKillSwitch().then(sendResponse);
    return true;
  } else if (message.type === 'UPDATE_CONFIG') {
    loadConfig().then(() => initializeConnection()).then(sendResponse);
    return true;
  } else if (message.type === 'CAPTURE_SCREENSHOT') {
    // Capture screenshot from content script
    chrome.tabs.captureVisibleTab(null, { format: 'png' })
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  } else if (message.type === 'GET_STATS') {
    // Get job statistics (local + backend fallback)
    getJobStats().then(sendResponse).catch(() => sendResponse(null));
    return true;
  } else if (message.type === 'GET_JOB_HISTORY') {
    // Get detailed job history
    sendResponse(localStats.jobHistory);
  } else if (message.type === 'GET_NOTIFICATION_SETTINGS') {
    // Get notification settings
    sendResponse(state.notificationSettings);
  } else if (message.type === 'UPDATE_NOTIFICATION_SETTINGS') {
    // Update notification settings
    state.notificationSettings = { ...state.notificationSettings, ...message.settings };
    chrome.storage.local.set({ notificationSettings: state.notificationSettings });
    sendResponse({ success: true });
  } else if (message.type === 'EXPORT_STATS') {
    // Export statistics as JSON
    const exportData = {
      exportDate: new Date().toISOString(),
      stats: {
        completed: localStats.completed,
        failed: localStats.failed,
        total: localStats.completed + localStats.failed,
        avgTime: localStats.jobCount > 0 ? Math.round(localStats.totalTime / localStats.jobCount) : 0,
        weeklyData: localStats.weeklyData
      },
      jobHistory: localStats.jobHistory
    };
    sendResponse(exportData);
  } else if (message.type === 'EXPORT_LOGS') {
    // Get logs from storage and export
    chrome.storage.local.get(['logs']).then(stored => {
      sendResponse({
        exportDate: new Date().toISOString(),
        logs: stored.logs || []
      });
    });
    return true;
  } else if (message.type === 'CLEAR_STATS') {
    // Clear local statistics
    localStats = {
      completed: 0,
      failed: 0,
      totalTime: 0,
      jobCount: 0,
      weeklyData: [0, 0, 0, 0, 0, 0, 0],
      jobHistory: []
    };
    saveLocalStats().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.type === 'KEEPALIVE_PING') {
    // Offscreen document keepalive — just respond to keep SW awake
    // Also send WS frame if connected to prevent server timeout
    if (state.websocket?.readyState === WebSocket.OPEN) {
      state.websocket.send('3');
    }
    sendResponse({ pong: true });
  } else if (message.type === 'SESSION_LOG') {
    // Session log from content scripts (humanize.js actions)
    bufferSessionLog(message.data);
    sendResponse({ ok: true });
  } else if (message.type === 'LOG') {
    // Log from content scripts (Fix 10: consolidated into single listener)
    console.log(`[ContentScript] ${message.message}`, message.data || '');
    sendResponse({ received: true });
  }
});

// Manual job trigger
async function handleManualTrigger(job) {
  console.log('[ServiceWorker] Manual trigger requested');
  await handleNewJob(job);
  return { success: true };
}

// Get job statistics (local stats with backend as secondary source)
async function getJobStats() {
  // Calculate average time
  const avgTime = localStats.jobCount > 0
    ? Math.round(localStats.totalTime / localStats.jobCount)
    : 0;

  // Compute today's counts from job history
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let todayCompleted = 0;
  let todayFailed = 0;
  for (const entry of localStats.jobHistory) {
    if (entry.timestamp && entry.timestamp.slice(0, 10) === todayStr) {
      if (entry.success) {
        todayCompleted++;
      } else {
        todayFailed++;
      }
    }
  }

  // Build local stats response
  const stats = {
    completed: localStats.completed,
    failed: localStats.failed,
    total: localStats.completed + localStats.failed,
    avgTime,
    todayCompleted,
    todayFailed,
    weeklyData: localStats.weeklyData,
    jobHistory: localStats.jobHistory.slice(0, 10), // Last 10 for popup
    source: 'local'
  };

  // Try to get backend stats to merge/validate
  if (state.config?.backendUrl && state.config?.apiKey) {
    try {
      const response = await fetch(`${state.config.backendUrl}/api/bot/stats`, {
        method: 'GET',
        headers: {
          'X-Bot-API-Key': state.config.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const backendStats = await response.json();
        // Merge backend stats (backend is authoritative for totals)
        if (backendStats.completed !== undefined) {
          stats.backendCompleted = backendStats.completed;
          stats.backendFailed = backendStats.failed;
          stats.source = 'merged';
        }
        // Use backend's today counts if available (more accurate across restarts)
        if (backendStats.todayCompleted !== undefined) {
          stats.todayCompleted = Math.max(stats.todayCompleted, backendStats.todayCompleted);
        }
        if (backendStats.todayFailed !== undefined) {
          stats.todayFailed = Math.max(stats.todayFailed, backendStats.todayFailed);
        }
      }
    } catch (error) {
      console.error('[ServiceWorker] Failed to fetch backend stats:', error);
      // Continue with local stats only
    }
  }

  return stats;
}

console.log('[ServiceWorker] Initialized');
