const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, dialog } = require('electron');
const fsPromises = require('fs/promises');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');
const { checkForUpdate, downloadUpdate } = require('./updater');

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let socket = null;
let rendererReady = false;
let pendingRendererMessages = [];
const MAX_PENDING_RENDERER_MESSAGES = 500;
let isConnecting = false; // Guard against rapid connectToBackend calls
// Per-wallet timestamp tracking moved inside connectToBackend()

// Config file path
const configPath = path.join(app.getPath('userData'), 'config.json');

// App state
let state = {
  connected: false,
  config: {
    backendUrl: 'https://tiorico-api.onrender.com',
    apiKey: 'Narciso',
    operatorName: ''
  },
  pendingFailures: 0,
  pendingChats: 0,
  killSwitchActive: false,
  botStatus: 'offline', // online, offline, busy, error
  validatorConnected: false,
  lastUpdate: null
};

// Notification settings
let notificationSettings = {
  soundEnabled: true,
  validationFailures: true,
  jobFailures: true,
  newMessages: true,
  connectionStatus: true,
  jobCompleted: false
};

// Quick replies (null = use defaults in renderer)
let quickReplies = null;

// ============================================
// OLLAMA AI STATE
// ============================================

let ollamaAvailable = false;
let ollamaModel = null;
let ollamaHealthInterval = null;
let botProcessingQueue = []; // Sequential queue for bot messages
let isBotProcessing = false;

const defaultOllamaConfig = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  botEnabled: false,            // Conversational AI removed (user-facing bot disabled).
  suggestedRepliesEnabled: false, // No suggestions: operator types own replies.
  failureAnalysisEnabled: false,  // No AI failure analysis: operator reviews proof + score.
};
let ollamaConfig = { ...defaultOllamaConfig };

// Store for failures queue and other data
let store = {
  failures: [],
  jobs: [],
  chats: [],
  wallets: [],
  stats: {
    todayCompleted: 0,
    todayFailed: 0,
    totalCompleted: 0,
    totalFailed: 0,
    requests: {},
    jobs: {},
    chats: {}
  },
  activityLog: [],
  trends: [],
  prizeClaims: [],
  outboundPayments: []
};

// Fix 92: Prune store arrays to prevent unbounded memory growth
const MAX_STORE_FAILURES = 500;
const MAX_STORE_JOBS = 500;
const MAX_STORE_CHATS = 200;

function pruneStore() {
  if (store.failures.length > MAX_STORE_FAILURES) {
    store.failures = store.failures.slice(0, MAX_STORE_FAILURES);
  }
  if (store.jobs.length > MAX_STORE_JOBS) {
    store.jobs = store.jobs.slice(0, MAX_STORE_JOBS);
  }
  if (store.chats.length > MAX_STORE_CHATS) {
    store.chats = store.chats.slice(0, MAX_STORE_CHATS);
  }
  // Rebuild processedFailureIds from current store to prevent unbounded growth
  processedFailureIds.clear();
  for (const f of store.failures) {
    processedFailureIds.add(f.id);
  }
}

// Fix 85: Track processed failure IDs to prevent re-adding resolved failures
const processedFailureIds = new Set();
const MAX_PROCESSED_FAILURE_IDS = 500;

// ============================================
// CONFIG PERSISTENCE
// ============================================

function loadConfig() {
  console.log('[Main] Loading config from:', configPath);

  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const saved = JSON.parse(data);

      console.log('[Main] Loaded config:', JSON.stringify({
        backendUrl: saved.config?.backendUrl,
        hasApiKey: !!saved.config?.apiKey,
        operatorName: saved.config?.operatorName,
      }));

      state.config = saved.config || state.config;
      notificationSettings = saved.notificationSettings || notificationSettings;
      if (saved.quickReplies && Array.isArray(saved.quickReplies)) {
        quickReplies = saved.quickReplies;
      }
      if (saved.ollamaConfig) {
        ollamaConfig = { ...defaultOllamaConfig, ...saved.ollamaConfig };
      }

      console.log('[Main] Config loaded successfully');
      console.log('[Main] Backend URL:', state.config.backendUrl || '(not set)');
      console.log('[Main] API Key length:', state.config.apiKey?.length || 0);
    } else {
      console.log('[Main] No config file found, using defaults');
    }
  } catch (error) {
    console.error('[Main] Error loading config:', error);
  }
}

function saveConfig() {
  console.log('[Main] Saving config to:', configPath);
  console.log('[Main] State config:', JSON.stringify({
    backendUrl: state.config.backendUrl,
    hasApiKey: !!state.config.apiKey,
    operatorName: state.config.operatorName,
  }));

  try {
    const data = JSON.stringify({
      config: state.config,
      notificationSettings,
      quickReplies,
      ollamaConfig,
    }, null, 2);

    fs.writeFileSync(configPath, data, 'utf8');
    console.log('[Main] Config saved successfully');
    console.log('[Main] Config saved to disk');
  } catch (error) {
    console.error('[Main] Error saving config:', error);
    throw error;
  }
}

// ============================================
// ACTIVITY LOG
// ============================================

function logActivity(action, details = {}) {
  const entry = {
    id: Date.now().toString(),
    action,
    details,
    timestamp: new Date().toISOString()
  };
  store.activityLog.unshift(entry);
  // Keep only last 100 entries
  if (store.activityLog.length > 100) {
    store.activityLog = store.activityLog.slice(0, 100);
  }
  sendToRenderer('activity-log', entry);
}

// ============================================
// WINDOW MANAGEMENT
// ============================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Panel de Operadores',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0f172a',
    show: false,
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : true
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Renderer finished loading');
    rendererReady = true;
    flushPendingMessages();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    pendingRendererMessages = [];
  });
}

// ============================================
// SYSTEM TRAY
// ============================================

function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png');

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = createDefaultTrayIcon();
    }
  } catch {
    trayIcon = createDefaultTrayIcon();
  }

  trayIcon = trayIcon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('Panel de Operadores');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createDefaultTrayIcon() {
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4T2N0dnb+z0ABYGRkZGBgYGD4////AwMFgJGJIqcPGjBowKABgwYMGkA5AABhOQMRtyNDmQAAAABJRU5ErkJggg=='
  );
}

function updateTrayMenu() {
  const botStatusLabel = {
    online: '🟢 Bot Online',
    offline: '⚫ Bot Offline',
    busy: '🟡 Bot Procesando',
    error: '🔴 Bot Error'
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Fallos pendientes: ${state.pendingFailures}`,
      enabled: false
    },
    {
      label: `Chats sin leer: ${state.pendingChats}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: state.connected ? '● Conectado' : '○ Desconectado',
      enabled: false
    },
    {
      label: botStatusLabel[state.botStatus] || '⚫ Bot Offline',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Abrir Panel',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Ver Fallos',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          sendToRenderer('navigate', 'failures');
        }
      }
    },
    { type: 'separator' },
    {
      // Wallet-listener phone onboarding: opens a window with a form + QR generator that the
      // operator scans from the Android app to pair a new phone with this backend.
      label: '📱 Vincular celular (QR)',
      click: () => { openQrPairingWindow(); },
    },
    { type: 'separator' },
    {
      label: state.killSwitchActive ? '⚠️ KILL SWITCH ACTIVO' : 'Activar Kill Switch',
      click: () => {
        toggleKillSwitch();
      }
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  const tooltip = state.connected
    ? `Panel de Operadores\n${state.pendingFailures} fallos pendientes\nBot: ${state.botStatus}`
    : 'Panel de Operadores (Desconectado)';
  tray.setToolTip(tooltip);
}

function updateTrayBadge() {
  if (process.platform === 'darwin' && app.dock) {
    if (state.pendingFailures > 0) {
      app.dock.setBadge(state.pendingFailures.toString());
    } else {
      app.dock.setBadge('');
    }
  }
  updateTrayMenu();
}

// ============================================
// NOTIFICATIONS & SOUND
// ============================================

function showNotification(title, body, type = 'normal', soundType = null) {
  // Check if this notification type is enabled
  const typeMap = {
    'validation_failure': 'validationFailures',
    'job_failure': 'jobFailures',
    'new_message': 'newMessages',
    'new_chat': 'newMessages',
    'connection': 'connectionStatus',
    'job_completed': 'jobCompleted'
  };

  const settingKey = typeMap[soundType];
  if (settingKey && !notificationSettings[settingKey]) {
    return; // Notification type disabled
  }

  // Play distinct sound alert via renderer
  if (notificationSettings.soundEnabled) {
    const soundMap = {
      'validation_failure': 'alert',
      'job_failure': 'alert',
      'new_message': 'message',
      'new_chat': 'message',
      'job_completed': 'success',
    };
    const sound = soundMap[soundType] || 'message';
    sendToRenderer('play-sound', { sound, type });
  }

  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: path.join(__dirname, '../assets/icon.png'),
      urgency: type === 'critical' ? 'critical' : 'normal',
      silent: true, // We handle sound ourselves
    });

    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.show();
  }

  // Send sound event to renderer if enabled
  if (notificationSettings.soundEnabled && soundType) {
    sendToRenderer('play-sound', { type: soundType });
  }
}

// ============================================
// SOCKET.IO CONNECTION
// ============================================

// ============================================
// OLLAMA AI INTEGRATION — REMOVED
// ============================================
// Conversational AI (intent extraction, suggested replies, failure analysis) was
// removed. The validator app still uses Ollama as an OCR fallback in its own
// process — that's intentional and lives elsewhere.

// All conversational-AI helpers below are now stubs. They return inert values
// so any leftover caller that wasn't migrated yet does not throw. Replace these
// with a complete removal once the renderer + preload no longer reference them.

function sanitizeForPrompt() { return ''; }
async function checkOllama() {
  sendToRenderer('ollama-status', { available: false, model: null, disabled: true });
}
async function pullOllamaModel() { /* no-op */ }
async function callOllama() { return null; }
function parseOllamaJson() { return null; }
function parseSpanishAmount() { return null; }
function extractIntentFallback() { return { intent: 'unknown', suggestedReply: null }; }
async function processSingleBotMessage() { /* no-op */ }
async function handleLoadCreditsIntent() { /* no-op */ }
async function handleClaimPrizeIntent() { /* no-op */ }
async function handleCheckStatusIntent() { /* no-op */ }
async function handleBotImageMessage() { /* no-op */ }
async function emitBotReply() { /* no-op */ }
async function generateSuggestedReplies() { return null; }
async function analyzeFailure() { return null; }

function startOllamaHealthCheck() {
  // Disabled: conversational AI removed from operator panel.
}

function connectToBackend() {
  if (!state.config.backendUrl || !state.config.apiKey) {
    console.log('[Main] No config, skipping connection');
    return;
  }

  if (isConnecting) {
    console.log('[Main] Already connecting, skipping duplicate call');
    return;
  }
  isConnecting = true;

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  console.log('[Main] Connecting to:', state.config.backendUrl);

  try {
    socket = io(`${state.config.backendUrl}/operator`, {
      auth: {
        apiKey: state.config.apiKey,
        operatorName: state.config.operatorName || `operator-${require('os').hostname()}`,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      transports: ['websocket', 'polling'],
    });
  } catch (err) {
    console.error('[Main] Failed to create socket connection:', err.message);
    isConnecting = false;
    sendToRenderer('connection-status', { connected: false, error: `Invalid connection config: ${err.message}` });
    return;
  }

  socket.on('connect', () => {
    console.log('[Main] Connected to backend');
    isConnecting = false;
    state.connected = true;
    state.lastUpdate = new Date().toISOString();
    updateTrayMenu();
    sendToRenderer('connection-status', { connected: true, lastUpdate: state.lastUpdate });
    logActivity('CONNECTED', { server: state.config.backendUrl });

    socket.emit('get_initial_data');
  });

  socket.on('disconnect', (reason) => {
    console.log('[Main] Disconnected:', reason);
    isConnecting = false;
    state.connected = false;
    state.botStatus = 'offline';
    updateTrayMenu();
    sendToRenderer('connection-status', { connected: false, reason });
    logActivity('DISCONNECTED', { reason });

    // Only notify for server-initiated disconnects; transient disconnects
    // (e.g. 'transport close') are handled silently by Socket.IO auto-reconnect.
    if (reason === 'io server disconnect') {
      showNotification(
        'Conexión perdida',
        'El servidor cerró la conexión',
        'normal',
        'connection'
      );
    }
  });

  socket.on('connect_error', (error) => {
    console.error('[Main] Connection error:', error.message);
    isConnecting = false;
    state.connected = false;
    updateTrayMenu();
    sendToRenderer('connection-status', { connected: false, error: error.message });
  });

  socket.io.on('reconnect', (attempt) => {
    console.log(`[Main] Reconnected after ${attempt} attempt(s)`);
    logActivity('RECONNECTED', { attempts: attempt });
    showNotification(
      'Conexión restaurada',
      `Reconectado al servidor después de ${attempt} intento(s).`,
      'normal',
      'connection'
    );
  });

  // ---- Event handlers ----

  socket.on('initial_data', (data) => {
    console.log('[Main] Received initial data');
    store.failures = data.failures || [];
    store.jobs = data.jobs || [];
    store.chats = data.chats || [];
    store.wallets = data.wallets || [];
    store.stats = data.stats || store.stats;
    store.trends = data.trends || [];

    // Store system settings for renderer
    if (data.settings) {
      store.settings = data.settings;
    }

    // Extract bot status from stats if available
    if (data.stats?.system?.botStatus) {
      state.botStatus = data.stats.system.botStatus;
    }

    // Load kill switch state from initial data
    if (typeof data.killSwitch === 'boolean') {
      state.killSwitchActive = data.killSwitch;
    }

    // Load validator status from initial data
    if (data.validatorStatus) {
      state.validatorConnected = data.validatorStatus.connected;
      sendToRenderer('validator-status', { connected: data.validatorStatus.connected });
    }

    // Load bot status from initial data
    if (data.botStatus) {
      state.botStatus = data.botStatus.connected ? 'online' : 'offline';
    }

    // Load panels list from initial data (for settings panel selector)
    if (data.panels) {
      store.panels = data.panels;
    }

    // Load prize claims from initial data
    if (data.prizeClaims) {
      store.prizeClaims = data.prizeClaims;
      sendToRenderer('prize-claims-loaded', data.prizeClaims);
    }

    if (data.outboundPayments) store.outboundPayments = data.outboundPayments;

    // Fix 85: Seed processed failure IDs from initial data
    for (const f of store.failures) {
      processedFailureIds.add(f.id);
    }

    state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;
    state.pendingChats = store.chats.filter(c => c.unreadCount > 0 || c.unread > 0).length;
    state.lastUpdate = new Date().toISOString();

    updateTrayBadge();
    pruneStore();
    sendToRenderer('data-update', { store, state, notificationSettings, quickReplies });
  });

  socket.on('validation_failed', (failure) => {
    // Normalize: real-time events send requestId but no id
    if (!failure.id && failure.requestId) failure.id = failure.requestId;
    if (!failure.createdAt) failure.createdAt = failure.timestamp || new Date().toISOString();
    console.log('[Main] New validation failure:', failure.id);

    // Fix 85: Deduplicate — skip if already in queue or previously processed
    if (store.failures.some(f => f.id === failure.id) || processedFailureIds.has(failure.id)) {
      console.log('[Main] Duplicate failure ignored:', failure.id);
      return;
    }

    processedFailureIds.add(failure.id);
    if (processedFailureIds.size > MAX_PROCESSED_FAILURE_IDS) {
      const first = processedFailureIds.values().next().value;
      processedFailureIds.delete(first);
    }

    store.failures.unshift(failure);
    state.pendingFailures++;
    state.lastUpdate = new Date().toISOString();
    pruneStore();
    state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;

    updateTrayBadge();
    sendToRenderer('new-failure', failure);
    logActivity('VALIDATION_FAILED', { id: failure.id, username: failure.targetUsername });

    showNotification(
      '⚠️ Nueva validación fallida',
      `${failure.targetUsername} - $${failure.amount}\n${failure.validationError || failure.reason || 'Error de validación'}`,
      'critical',
      'validation_failure'
    );
  });

  socket.on('job_failed', (job) => {
    // Normalize: real-time events send jobId but no id
    if (!job.id && job.jobId) job.id = job.jobId;
    if (!job.createdAt) job.createdAt = job.timestamp || new Date().toISOString();
    console.log('[Main] Job failed:', job.id);

    // Fix 85: Deduplicate — skip if already in queue or previously processed
    if (store.failures.some(f => f.id === job.id) || processedFailureIds.has(job.id)) {
      console.log('[Main] Duplicate job failure ignored:', job.id);
      return;
    }

    processedFailureIds.add(job.id);
    if (processedFailureIds.size > MAX_PROCESSED_FAILURE_IDS) {
      const first = processedFailureIds.values().next().value;
      processedFailureIds.delete(first);
    }

    store.failures.unshift({
      ...job,
      type: 'JOB_FAILURE'
    });
    state.pendingFailures++;
    state.lastUpdate = new Date().toISOString();
    pruneStore();
    state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;

    updateTrayBadge();
    sendToRenderer('job-failed', job);
    logActivity('JOB_FAILED', { id: job.id, error: job.error });

    showNotification(
      '❌ Trabajo fallido',
      `${job.targetUsername || job.request?.targetUsername} - $${job.amount || job.request?.amount}\n${job.error}`,
      'critical',
      'job_failure'
    );
  });

  socket.on('job_status', (job) => {
    console.log('[Main] Job status update:', job.id, job.status);
    const index = store.jobs.findIndex(j => j.id === job.id);
    if (index >= 0) {
      store.jobs[index] = job;
    } else {
      store.jobs.unshift(job);
    }
    state.lastUpdate = new Date().toISOString();
    pruneStore();

    // Update bot status based on job
    if (job.status === 'PROCESSING') {
      state.botStatus = 'busy';
    } else if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      state.botStatus = 'online';
    }

    updateTrayMenu();
    sendToRenderer('job-update', job);

    if (job.status === 'COMPLETED') {
      logActivity('JOB_COMPLETED', { id: job.id });
      showNotification(
        '✅ Trabajo completado',
        `${job.targetUsername || job.request?.targetUsername} - $${job.amount || job.request?.amount}`,
        'normal',
        'job_completed'
      );
    }
  });

  socket.on('chat:new', (chat) => {
    // Normalize chat ID
    chat.id = chat.id || chat.chatId;
    console.log('[Main] New chat created:', chat.id);
    // Add to store if not already present
    const exists = store.chats.some(c => c.id === chat.id);
    if (!exists) {
      store.chats.unshift(chat);
      state.pendingChats = store.chats.filter(c => (c.unread || 0) > 0 || (c.unreadCount || 0) > 0).length;
      state.lastUpdate = new Date().toISOString();
      updateTrayBadge();
      sendToRenderer('data-update', { store, state, notificationSettings, quickReplies });
      showNotification('💬 Nuevo chat', 'Un usuario inició una nueva conversación', 'normal', 'new_chat');
    }
  });

  // Another operator took a chat — update local store so this panel does not
  // keep showing it as unassigned. Backend emits to all operators via /operator.
  socket.on('chat:assigned', (data) => {
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.operatorId = data.operatorId;
      chat.operatorName = data.operatorName;
      chat.assignedAt = data.assignedAt || new Date().toISOString();
      state.lastUpdate = new Date().toISOString();
      sendToRenderer('data-update', { store, state, notificationSettings, quickReplies });
    }
  });

  socket.on('new_message', (message) => {
    console.log(`[Main] New chat message: chatId=${message.chatId}, type=${message.type}, content="${(message.content || '').substring(0, 50)}"`);
    state.lastUpdate = new Date().toISOString();
    sendToRenderer('new-message', message);

    let chat = store.chats.find(c => c.id === message.chatId);
    if (!chat) {
      // Chat not in store (e.g. request chat created after initial_data).
      // Create a minimal entry so the renderer can display it.
      chat = {
        id: message.chatId,
        status: 'OPEN',
        user: message.sender || {},
        lastMessage: message,
        unread: 0,
        unreadCount: 0,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      };
      store.chats.unshift(chat);
      console.log(`[Main] Added unknown chat ${message.chatId} to store from new_message`);
    }
    chat.lastMessage = message;

    // Only notify for non-operator messages
    if (message.type !== 'OPERATOR') {
      showNotification(
        '💬 Nuevo mensaje',
        (message.content || '').substring(0, 100),
        'normal',
        'new_message'
      );
    }

    // Bot AI removed: users no longer send free-text messages.
    // Proof images are processed by the validator (OCR + Ollama fallback).
  });

  // User explicitly tapped "Necesito ayuda" — mark chat in store, alert
  // operator with distinct sound + persistent toast.
  socket.on('chat:help_requested', (data) => {
    console.log('[Main] HELP requested:', data.chatId, 'context:', data.context);
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.needsHelp = true;
      chat.helpContext = data.context;
      chat.helpRequestedAt = data.requestedAt;
    } else {
      // Chat not yet in store — push minimal entry so the sidebar shows the
      // help request immediately.
      store.chats.unshift({
        id: data.chatId,
        status: 'OPEN',
        user: { id: data.userId, username: data.username },
        needsHelp: true,
        helpContext: data.context,
        helpRequestedAt: data.requestedAt,
        unread: 1,
        unreadCount: 1,
        lastMessage: { content: data.message, createdAt: data.requestedAt, type: 'USER' },
        createdAt: data.requestedAt,
        updatedAt: data.requestedAt,
      });
    }
    state.lastUpdate = new Date().toISOString();
    sendToRenderer('data-update', { store, state, notificationSettings, quickReplies });
    sendToRenderer('chat-help-requested', data);
    const contextLabel = data.context === 'prize' ? 'cobro de premio' : 'chat';
    showNotification(
      '🙋 AYUDA solicitada',
      `${data.username} pidió ayuda con ${contextLabel}`,
      'critical',
      'validation_failure', // reuse the urgent "alert" sound mapping
    );
  });

  socket.on('chat:help_cleared', (data) => {
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.needsHelp = false;
      chat.helpContext = null;
      chat.helpRequestedAt = null;
      sendToRenderer('data-update', { store, state, notificationSettings, quickReplies });
      sendToRenderer('chat-help-cleared', data);
    }
  });

  socket.on('messages:read', (data) => {
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.unread = 0;
      chat.unreadCount = 0;
      state.pendingChats = store.chats.filter(c => (c.unread || c.unreadCount) > 0).length;
      updateTrayMenu();
    }
    sendToRenderer('messages-read', data);
  });

  socket.on('validator:status', (data) => {
    console.log('[Main] Validator status:', data.connected ? 'online' : 'offline');
    state.validatorConnected = data.connected;
    sendToRenderer('validator-status', { connected: data.connected });

    if (!data.connected) {
      showNotification(
        '⚠️ Validator Offline',
        'El validador se desconectó. Las validaciones requerirán revisión manual.',
        'critical',
        'connection'
      );
    } else {
      showNotification(
        '✅ Validator Online',
        'El validador se conectó correctamente.',
        'normal',
        'connection'
      );
    }
  });

  socket.on('auth_warning', (data) => {
    console.warn('[Main] Auth warning:', data.message);
    sendToRenderer('auth-warning', data);
    showNotification(
      '⚠️ Advertencia de autenticación',
      data.message,
      'critical',
      'connection'
    );
  });

  socket.on('user_typing', (data) => {
    sendToRenderer('user-typing', data);
  });

  socket.on('stats_update', (stats) => {
    store.stats = { ...store.stats, ...stats };
    state.lastUpdate = new Date().toISOString();

    if (stats.system?.botStatus) {
      state.botStatus = stats.system.botStatus;
      updateTrayMenu();
    }

    sendToRenderer('stats-update', { stats: store.stats, lastUpdate: state.lastUpdate });
  });

  socket.on('bot_status', (data) => {
    console.log('[Main] Bot status:', data.status, data.panelId ? `(panel: ${data.panelId})` : '');
    state.botStatus = data.status;
    // Store per-panel status
    if (!state.botStatusPerPanel) state.botStatusPerPanel = {};
    if (data.panelId) {
      state.botStatusPerPanel[data.panelId] = data.status;
    }
    updateTrayMenu();
    sendToRenderer('bot-status', data);
  });

  socket.on('kill_switch', (data) => {
    const active = typeof data === 'boolean' ? data : data.active;
    state.killSwitchActive = active;
    state.lastUpdate = new Date().toISOString();
    updateTrayMenu();
    sendToRenderer('kill-switch', { active });
    logActivity(active ? 'KILL_SWITCH_ACTIVATED' : 'KILL_SWITCH_DEACTIVATED', {});

    if (active) {
      showNotification(
        '🛑 KILL SWITCH ACTIVADO',
        'Toda la automatización ha sido detenida',
        'critical',
        'connection'
      );
    }
  });

  // Discovery events
  socket.on('discovery_started', (data) => {
    console.log('[Main] Discovery started:', data.targetUsername, 'panels:', data.queriedPanels);
    sendToRenderer('discovery-started', data);
  });

  socket.on('discovery_completed', (data) => {
    console.log('[Main] Discovery completed:', data.targetUsername, 'found on panel:', data.foundPanelId);
    sendToRenderer('discovery-completed', data);
  });

  socket.on('discovery_failed', (data) => {
    console.warn('[Main] Discovery failed:', data.targetUsername, data.reason);
    sendToRenderer('discovery-failed', data);
    showNotification(
      'Usuario no encontrado',
      `"${data.targetUsername}" no se encontró en ningún panel`,
      'warning',
      'job'
    );
  });

  socket.on('dispatch_blocked', (data) => {
    console.warn('[Main] Dispatch blocked:', data.reason, 'jobId:', data.jobId);
    sendToRenderer('dispatch-blocked', data);
  });

  socket.on('system_alert', (data) => {
    console.warn(`[Main] System alert (${data.severity}): ${data.message}`);
    sendToRenderer('system-alert', data);
    // Play alert sound for critical/warning alerts
    if (data.severity === 'critical' || data.severity === 'warning') {
      sendToRenderer('play-sound', { type: 'alert' });
    }
  });

  socket.on('failure_resolved', (data) => {
    console.log('[Main] Failure resolved:', data.failureId);
    const failure = store.failures.find(f => f.id === data.failureId);
    if (failure) {
      failure.resolvedAt = data.timestamp;
      failure.resolution = data.action;
    }
    state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;
    state.lastUpdate = new Date().toISOString();
    updateTrayBadge();
    sendToRenderer('failure-resolved', data);
  });

  socket.on('validation_completed', (data) => {
    console.log('[Main] Validation completed:', data.requestId);
    // Remove from failures list if it was there (auto-approved)
    const idx = store.failures.findIndex(f => f.id === data.requestId);
    if (idx >= 0) {
      store.failures.splice(idx, 1);
      state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;
      updateTrayBadge();
    }
    sendToRenderer('validation-completed', data);
  });

  socket.on('chat_closed', (data) => {
    console.log('[Main] Chat closed:', data.chatId);
    const chatIdx = store.chats.findIndex(c => c.id === data.chatId);
    if (chatIdx >= 0) {
      store.chats[chatIdx].status = 'CLOSED';
      store.chats[chatIdx].closedAt = data.timestamp;
    }
    sendToRenderer('chat-closed', data);
  });

  socket.on('job_retried', (data) => {
    console.log('[Main] Job retried:', data.jobId);
    sendToRenderer('job-retried', data);
    logActivity('JOB_RETRIED', `Trabajo ${(data.jobId || '').slice(0, 8)} reintentado`);
  });

  // ---- Extension events ----

  socket.on('extension:heartbeat', (data) => {
    sendToRenderer('extension-heartbeat', data);
  });

  socket.on('extension:log', (data) => {
    sendToRenderer('extension-log', data);
  });

  socket.on('extension:circuit_breaker', (data) => {
    sendToRenderer('extension-circuit-breaker', data);
    showNotification('Circuit Breaker', `Extension ${data.extensionId || 'desconocida'} pausada por ${data.errors || 0} errores`, 'warning', 'alert');
  });

  socket.on('extension:selector_health', (data) => {
    sendToRenderer('extension-selector-health', data);
    if (data?.failed > 0) {
      showNotification('Selectores', `${data.failed} selectores rotos en ${data.extensionId || 'extension'}`, 'warning', 'alert');
    }
  });

  // ---- Wallet events ----

  // Per-wallet timestamp guard to avoid dropping unrelated wallet events
  const walletEventTimes = new Map();
  function isStaleWalletEvent(data) {
    const eventTime = data?.timestamp ? new Date(data.timestamp).getTime() : Date.now();
    const walletId = data?.id || '_global';
    const lastTime = walletEventTimes.get(walletId) || 0;
    if (eventTime < lastTime) {
      console.log('[Main] Stale wallet event ignored for wallet', walletId);
      return true;
    }
    walletEventTimes.set(walletId, eventTime);
    // Cap map size to prevent unbounded growth
    if (walletEventTimes.size > 100) {
      const firstKey = walletEventTimes.keys().next().value;
      walletEventTimes.delete(firstKey);
    }
    return false;
  }

  socket.on('wallet_created', (wallet) => {
    if (isStaleWalletEvent(wallet)) return;
    console.log('[Main] Wallet created:', wallet.id);
    store.wallets.unshift(wallet);
    sendToRenderer('wallet-created', wallet);
  });

  socket.on('wallet_updated', (wallet) => {
    if (isStaleWalletEvent(wallet)) return;
    console.log('[Main] Wallet updated:', wallet.id);
    const index = store.wallets.findIndex(w => w.id === wallet.id);
    if (index >= 0) {
      store.wallets[index] = wallet;
    } else {
      store.wallets.unshift(wallet);
    }
    sendToRenderer('wallet-updated', wallet);
  });

  socket.on('wallet_selected', (data) => {
    if (isStaleWalletEvent(data)) return;
    console.log('[Main] Wallet selected:', data.wallet?.id);
    // Update all wallets: deselect all, select the chosen one
    store.wallets.forEach(w => {
      w.isSelected = w.id === data.wallet?.id;
    });
    sendToRenderer('wallet-selected', data);
  });

  socket.on('wallet_deleted', (data) => {
    if (isStaleWalletEvent(data)) return;
    console.log('[Main] Wallet deleted:', data.id);
    store.wallets = store.wallets.filter(w => w.id !== data.id);
    sendToRenderer('wallet-deleted', data);
  });

  socket.on('wallet_emptied', (data) => {
    if (isStaleWalletEvent(data.wallet || data)) return;
    console.log('[Main] Wallet emptied:', data.wallet?.id);
    const idx = store.wallets.findIndex(w => w.id === data.wallet?.id);
    if (idx >= 0) {
      store.wallets[idx] = data.wallet;
    }
    sendToRenderer('wallet-emptied', data);
  });

  socket.on('wallets_all_full', (data) => {
    console.log('[Main] ALL WALLETS FULL!');
    sendToRenderer('wallets-all-full', data);
    // Show system notification
    if (Notification.isSupported()) {
      new Notification({
        title: 'BILLETERAS LLENAS',
        body: 'Todas las billeteras superaron su límite. Vaciar alguna billetera.',
        urgency: 'critical',
      }).show();
    }
  });

  socket.on('balance_error', (data) => {
    console.log('[Main] Balance error:', data?.requestId);
    sendToRenderer('balance-error', data);
    if (Notification.isSupported()) {
      new Notification({
        title: 'ERROR DE BALANCE',
        body: `No se pudo acreditar $${data?.amount} al usuario. Revisar manualmente.`,
        urgency: 'critical',
      }).show();
    }
  });

  socket.on('user_updated', (data) => {
    console.log('[Main] User updated:', data?.id);
    sendToRenderer('user-updated', data);
  });

  // Prize claims
  socket.on('new_prize_claim', (data) => {
    store.prizeClaims = store.prizeClaims || [];
    // Dedup
    if (!store.prizeClaims.find(c => c.id === data.id)) {
      store.prizeClaims.unshift(data);
    }
    sendToRenderer('new-prize-claim', data);
    showNotification('Nuevo Premio', `${data.targetUsername} quiere cobrar $${Number(data.amount).toLocaleString('es-AR')}`, 'normal');
    logActivity('NEW_PRIZE_CLAIM', data);
  });

  socket.on('prize_claim_updated', (data) => {
    if (store.prizeClaims) {
      const idx = store.prizeClaims.findIndex(c => c.id === data.id);
      if (idx >= 0) {
        store.prizeClaims[idx] = { ...store.prizeClaims[idx], ...data };
      }
    }
    sendToRenderer('prize-claim-updated', data);
  });

  socket.on('outbound_payment_created', (payment) => {
    // Dedup: ignore if we already have this payment.
    if (store.outboundPayments.some(p => p.id === payment.id)) return;
    store.outboundPayments.unshift(payment);
    sendToRenderer('data-update', { store, state });
  });

  socket.on('outbound_payment_updated', (payment) => {
    const idx = store.outboundPayments.findIndex(p => p.id === payment.id);
    if (idx >= 0) {
      // Skip stale updates: incoming `updatedAt` must be newer than what we have.
      const current = store.outboundPayments[idx];
      const incomingTs = Date.parse(payment.updatedAt) || 0;
      const currentTs = Date.parse(current.updatedAt) || 0;
      if (incomingTs && currentTs && incomingTs < currentTs) return;
      store.outboundPayments[idx] = { ...current, ...payment };
    } else {
      store.outboundPayments.unshift(payment);
    }
    sendToRenderer('data-update', { store, state });
  });

  socket.on('outbound_payment_completed', (payment) => {
    const idx = store.outboundPayments.findIndex(p => p.id === (payment.id || payment.prizeClaimId));
    if (idx >= 0) store.outboundPayments[idx] = { ...store.outboundPayments[idx], ...payment, status: 'COMPLETED' };
    sendToRenderer('data-update', { store, state });
    showNotification('Pago Completado', `Pago de $${payment.amount || ''} completado (Op: ${payment.operationNumber || 'N/A'})`);
  });

  socket.on('outbound_payment_failed', (payment) => {
    const idx = store.outboundPayments.findIndex(p => p.id === payment.id);
    if (idx >= 0) store.outboundPayments[idx] = { ...store.outboundPayments[idx], ...payment, status: 'FAILED' };
    sendToRenderer('data-update', { store, state });
    showNotification('Pago Fallido', `Error: ${payment.error || 'desconocido'}`, true);
  });

  socket.on('settings_updated', (data) => {
    console.log('[Main] Settings updated from another operator');
    if (data.settings) store.settings = data.settings;
    sendToRenderer('settings-updated', data);
  });

  socket.on('proof:uploaded', (data) => {
    console.log('[Main] Proof uploaded:', data.requestId || 'unknown');
    sendToRenderer('proof-uploaded', data);
  });

  socket.on('panel_balance_alert_muted', (data) => {
    console.log('[Main] Balance alert muted for panel:', data.panelId);
    sendToRenderer('panel-balance-alert-muted', data);
  });
}

function sendToRenderer(channel, data) {
  if (!mainWindow || !mainWindow.webContents || !rendererReady) {
    if (pendingRendererMessages.length >= MAX_PENDING_RENDERER_MESSAGES) {
      pendingRendererMessages.shift();
    }
    pendingRendererMessages.push({ channel, data });
    return;
  }

  mainWindow.webContents.send(channel, data);
}

function flushPendingMessages() {
  if (!mainWindow || !mainWindow.webContents) return;

  const messages = pendingRendererMessages.splice(0);
  console.log(`[Main] Flushing ${messages.length} queued messages to renderer`);

  const BATCH_SIZE = 20;
  let i = 0;

  function sendBatch() {
    const batch = messages.slice(i, i + BATCH_SIZE);
    for (const { channel, data } of batch) {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send(channel, data);
      }
    }
    i += BATCH_SIZE;
    if (i < messages.length) {
      setTimeout(sendBatch, 10);
    }
  }

  sendBatch();
}

// ============================================
// IPC HANDLERS
// ============================================

// ---- Auto-Update ----
ipcMain.handle('check-update', async () => {
  const currentVersion = app.getVersion();
  const backendUrl = state.config?.backendUrl;
  if (!backendUrl) return null;
  return await checkForUpdate(backendUrl, currentVersion, 'operator-panel');
});

ipcMain.handle('download-update', async (event, downloadUrl) => {
  const tempDir = app.getPath('temp');
  const ext = process.platform === 'darwin' ? '.dmg' : '.exe';
  const destPath = path.join(tempDir, `operator-panel-update${ext}`);
  try { fs.unlinkSync(destPath); } catch {}

  try {
    await downloadUpdate(downloadUrl, destPath, (percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-progress', { percent });
      }
    });
    return { success: true, filePath: destPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', async (event, filePath) => {
  try {
    shell.openPath(filePath);
    setTimeout(() => {
      app.isQuitting = true;
      app.quit();
    }, 1500);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

// ---- QR Pairing window ----
// Opens the standalone qr-pairing.html in a new BrowserWindow with a tiny preload that exposes
// only the qrcode generator. Used to onboard a new Android wallet-listener phone.
let qrPairingWindow = null;
function openQrPairingWindow() {
  if (qrPairingWindow && !qrPairingWindow.isDestroyed()) {
    qrPairingWindow.focus();
    return { ok: true };
  }
  qrPairingWindow = new BrowserWindow({
    width: 880,
    height: 700,
    title: 'Vincular celular — Tio Rico Listener',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload-qr-pairing.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // we need require() in the preload to load qrcode
    },
  });
  // Pre-fill backendUrl + apiKey from the operator's saved config so the operator only needs to
  // type walletId + walletType for each new phone.
  const params = new URLSearchParams({
    backendUrl: state.config?.backendUrl || '',
    apiKey: state.config?.apiKey || '',
  }).toString();
  qrPairingWindow.loadFile(path.join(__dirname, 'qr-pairing.html'), { search: params });
  qrPairingWindow.on('closed', () => { qrPairingWindow = null; });
  return { ok: true };
}
ipcMain.handle('open-qr-pairing', () => openQrPairingWindow());

// ---- State ----
ipcMain.handle('get-state', () => {
  return { state, store, notificationSettings, quickReplies };
});

ipcMain.handle('save-config', async (event, config) => {
  console.log('[Main] save-config called with:', JSON.stringify({
    backendUrl: config?.backendUrl,
    hasApiKey: !!config?.apiKey,
    operatorName: config?.operatorName,
  }));

  try {
    if (!config || !config.backendUrl || !config.apiKey) {
      console.error('[Main] Invalid config received');
      return { success: false, error: 'Configuración inválida - faltan campos requeridos' };
    }

    state.config = config;
    saveConfig();
    connectToBackend();

    console.log('[Main] Config saved and connection initiated');
    return { success: true };
  } catch (error) {
    console.error('[Main] save-config error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-connection', async (event, config) => {
  return new Promise((resolve) => {
    const testSocket = io(`${config.backendUrl}/operator`, {
      auth: { apiKey: config.apiKey },
      reconnection: false,
      timeout: 10000
    });

    const timeout = setTimeout(() => {
      testSocket.disconnect();
      resolve({ success: false, error: 'Timeout - El servidor no respondió' });
    }, 10000);

    testSocket.on('connect', () => {
      clearTimeout(timeout);
      testSocket.disconnect();
      resolve({ success: true });
    });

    testSocket.on('connect_error', (error) => {
      clearTimeout(timeout);
      testSocket.disconnect();
      resolve({ success: false, error: error.message || 'Error de conexión' });
    });

    testSocket.on('error', (data) => {
      clearTimeout(timeout);
      testSocket.disconnect();
      resolve({ success: false, error: data.message || 'Error del servidor' });
    });
  });
});

ipcMain.handle('save-notification-settings', async (event, settings) => {
  notificationSettings = { ...notificationSettings, ...settings };
  saveConfig();
  sendToRenderer('notification-settings-updated', notificationSettings);
  return { success: true };
});

ipcMain.handle('get-notification-settings', () => {
  return notificationSettings;
});

ipcMain.handle('get-quick-replies', () => {
  return quickReplies;
});

ipcMain.handle('save-quick-replies', async (event, replies) => {
  quickReplies = replies;
  saveConfig();
  sendToRenderer('quick-replies-updated', quickReplies);
  return { success: true };
});

// Fix 37: Helper to emit socket events with a timeout to prevent infinite hangs
function emitWithTimeout(event, data, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ success: false, error: 'No conectado al servidor' });
      return;
    }
    const timer = setTimeout(() => {
      console.warn(`[Main] Socket emit '${event}' timed out after ${timeoutMs / 1000}s`);
      resolve({
        success: false,
        error: `Sin respuesta del backend tras ${timeoutMs / 1000}s. Probá de nuevo en unos segundos o revisá la conexión.`,
      });
    }, timeoutMs);
    socket.emit(event, data, (response) => {
      clearTimeout(timer);
      resolve(response || { success: false, error: 'No response from server' });
    });
  });
}

ipcMain.handle('approve-failure', async (event, { failureId, note, approvedAmount }) => {
  // approve hace transacción Serializable + accumulation + job creation + dispatch,
  // que puede tardar más de 30s en picos. Subimos timeout para no abortar prematuramente.
  const response = await emitWithTimeout('approve_failure', { failureId, note, approvedAmount }, 60000);
  if (response && response.success) {
    const failure = store.failures.find(f => f.id === failureId);
    if (failure) {
      failure.resolvedAt = new Date().toISOString();
      failure.resolution = 'APPROVED';
      state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;
      updateTrayBadge();
    }
    logActivity('FAILURE_APPROVED', { id: failureId, note });
  }
  return response;
});

ipcMain.handle('reject-failure', async (event, { failureId, reason }) => {
  const response = await emitWithTimeout('reject_failure', { failureId, reason });
  if (response && response.success) {
    const failure = store.failures.find(f => f.id === failureId);
    if (failure) {
      failure.resolvedAt = new Date().toISOString();
      failure.resolution = 'REJECTED';
      state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;
      updateTrayBadge();
    }
    logActivity('FAILURE_REJECTED', { id: failureId, reason });
  }
  return response;
});

ipcMain.handle('send-message', async (event, { chatId, content, imageUrl }) => {
  const payload = { chatId, content };
  if (imageUrl) payload.imageUrl = imageUrl;
  const response = await emitWithTimeout('send_message', payload);
  if (response && response.success) {
    logActivity('MESSAGE_SENT', { chatId });
  }
  return response;
});

ipcMain.handle('upload-chat-image', async (event, { buffer, filename, mimeType }) => {
  if (!state.config?.backendUrl || !state.config?.apiKey) {
    return { error: 'Not configured' };
  }
  try {
    const boundary = '----FormBoundary' + Date.now().toString(16);
    const fileBuffer = Buffer.from(buffer);

    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(header),
      fileBuffer,
      Buffer.from(footer),
    ]);

    const url = `${state.config.backendUrl}/api/uploads/operator/chat-image`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Operator-API-Key': state.config.apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      console.error('[Main] upload-chat-image failed:', response.status);
      return { error: `Upload failed: ${response.status}` };
    }

    const data = await response.json();
    return { url: data.url };
  } catch (error) {
    console.error('[Main] upload-chat-image error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('send-typing', async (event, chatId) => {
  if (socket && socket.connected) {
    socket.emit('typing', { chatId });
  }
  return { success: true };
});

ipcMain.handle('toggle-kill-switch', async () => {
  return toggleKillSwitch();
});

ipcMain.handle('update-system-settings', async (event, settings) => {
  try {
    const response = await emitWithTimeout('update_system_settings', settings);
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reset-circuit-breaker', async (event, extensionId) => {
  try {
    return await emitWithTimeout('reset_circuit_breaker', { extensionId });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-panels', async () => {
  try {
    return await emitWithTimeout('get_panels', {});
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-panel', async (event, name) => {
  try {
    return await emitWithTimeout('create_panel', { name });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-panel', async (event, id, data) => {
  try {
    return await emitWithTimeout('update_panel', { id, ...data });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-panel', async (event, id) => {
  try {
    return await emitWithTimeout('delete_panel', { id });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

async function toggleKillSwitch() {
  const newState = !state.killSwitchActive;
  const response = await emitWithTimeout('set_kill_switch', { active: newState });
  if (response && response.success) {
    state.killSwitchActive = newState;
    updateTrayMenu();
    sendToRenderer('kill-switch', { active: newState });
  }
  return response;
}

ipcMain.handle('mark-chat-read', async (event, chatId) => {
  const chat = store.chats.find(c => c.id === chatId);
  if (chat) {
    chat.unread = 0;
    chat.unreadCount = 0;
    state.pendingChats = store.chats.filter(c => (c.unread || c.unreadCount) > 0).length;
    updateTrayMenu();
  }
  if (socket && socket.connected) {
    socket.emit('mark_read', { chatId });
  }
  return { success: true };
});

ipcMain.handle('get-chat-messages', async (event, { chatId, cursor }) => {
  return emitWithTimeout('get_chat_messages', { chatId, cursor });
});

ipcMain.handle('get-pending-summary', async (event, chatId) => {
  return emitWithTimeout('get_pending_summary', { chatId });
});

ipcMain.handle('close-chat', async (event, { chatId, reason }) => {
  const response = await emitWithTimeout('close_chat', { chatId, reason });
  if (response && response.success) {
    const chat = store.chats.find(c => c.id === chatId);
    if (chat) {
      chat.status = 'CLOSED';
    }
    logActivity('CHAT_CLOSED', { chatId, reason });
  }
  return response;
});

ipcMain.handle('fetch-proof-image', async (event, proofUrl) => {
  console.log('[Main] fetch-proof-image called:', {
    proofUrl,
    hasBackendUrl: !!state.config?.backendUrl,
    hasApiKey: !!state.config?.apiKey,
  });

  if (!proofUrl || !state.config?.backendUrl || !state.config?.apiKey) {
    const reason = !proofUrl ? 'No proofUrl' : !state.config?.backendUrl ? 'No backendUrl' : 'No apiKey';
    console.warn('[Main] fetch-proof-image blocked:', reason);
    return { error: `Not configured: ${reason}` };
  }
  try {
    // If proofUrl is a full Cloudinary URL, fetch directly (saves backend bandwidth)
    let url;
    if (proofUrl.startsWith('http')) {
      url = proofUrl;
      console.log('[Main] Fetching proof directly from Cloudinary:', url);
    } else {
      // Legacy: /uploads/{id} format — go through backend
      const fileId = proofUrl.split('/').pop();
      if (!fileId) return { error: 'Invalid proof URL' };
      url = `${state.config.backendUrl}/api/uploads/operator/${fileId}`;
      console.log('[Main] Fetching proof via backend:', url);
    }
    const headers = proofUrl.startsWith('http') ? {} : { 'X-Operator-API-Key': state.config.apiKey };
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.warn('[Main] Proof fetch failed:', response.status, response.statusText);
      return { error: `HTTP ${response.status} ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString('base64');
    return { dataUrl: `data:${contentType};base64,${base64}` };
  } catch (err) {
    console.error('[Main] Failed to fetch proof image:', err.message);
    return { error: err.message };
  }
});

ipcMain.handle('retry-job', async (event, jobId) => {
  const response = await emitWithTimeout('retry_job', { jobId });
  if (response && response.success) {
    logActivity('JOB_RETRIED', { jobId });
  }
  return response;
});

ipcMain.handle('retry-failed-request', async (event, requestId) => {
  const response = await emitWithTimeout('retry_failed_request', { requestId });
  if (response && response.success) {
    logActivity('RETRY_FAILED_REQUEST', { requestId });
  }
  return response;
});

ipcMain.handle('publish-app-update', async (event, { version, apkUrl, changelog }) => {
  if (!socket?.connected) {
    return { success: false, error: 'No conectado al backend' };
  }
  return new Promise((resolve) => {
    socket.emit('publish_app_update', { version, apkUrl, changelog }, (response) => {
      resolve(response || { success: false, error: 'Sin respuesta del backend' });
    });
    setTimeout(() => resolve({ success: false, error: 'Timeout' }), 10000);
  });
});

ipcMain.handle('broadcast-promo', async (event, { title, message }) => {
  if (!socket?.connected) {
    return { success: false, error: 'No conectado al backend' };
  }
  return new Promise((resolve) => {
    socket.emit('broadcast_promo', { title, message }, (response) => {
      resolve(response || { success: false, error: 'Sin respuesta del backend' });
    });
    // Timeout fallback
    setTimeout(() => resolve({ success: false, error: 'Timeout' }), 10000);
  });
});

ipcMain.handle('get-activity-log', () => {
  return store.activityLog;
});

ipcMain.handle('export-data', async (event, type) => {
  let data;
  let filename;

  switch (type) {
    case 'failures':
      data = store.failures;
      filename = `failures-${new Date().toISOString().split('T')[0]}.json`;
      break;
    case 'jobs':
      data = store.jobs;
      filename = `jobs-${new Date().toISOString().split('T')[0]}.json`;
      break;
    case 'activity':
      data = store.activityLog;
      filename = `activity-${new Date().toISOString().split('T')[0]}.json`;
      break;
    default:
      return { success: false, error: 'Unknown export type' };
  }

  return { success: true, data, filename };
});

ipcMain.handle('open-external', async (event, url) => {
  shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('reconnect', async () => {
  connectToBackend();
  logActivity('RECONNECT_REQUESTED', {});
  return { success: true };
});

// ============================================
// OLLAMA AI IPC HANDLERS — DISABLED
// ============================================
// All handlers respond with a "disabled" payload so the renderer can render the
// off state without breaking on missing IPC channels. UI controls for Ollama
// should be hidden by the renderer; these are defensive stubs only.

ipcMain.handle('get-ollama-status', () => {
  return { available: false, model: null, config: ollamaConfig, disabled: true };
});

ipcMain.handle('set-ollama-config', async (_event, config) => {
  ollamaConfig = { ...ollamaConfig, ...config };
  saveConfig();
  return { success: true, config: ollamaConfig, disabled: true };
});

ipcMain.handle('test-ollama', async () => {
  return { success: false, error: 'Ollama está deshabilitado en este panel.' };
});

ipcMain.handle('toggle-bot', async (_event, _enabled) => {
  // No-op: the conversational bot has been removed.
  return { success: false, error: 'Bot conversacional removido.' };
});

ipcMain.handle('get-suggested-replies', async () => {
  return { success: false, data: null, disabled: true };
});

ipcMain.handle('get-failure-analysis', async () => {
  return { success: false, data: null, disabled: true };
});

// ============================================
// WALLET MANAGEMENT
// ============================================

ipcMain.handle('get-wallets', async () => {
  return emitWithTimeout('get_wallets', {});
});

ipcMain.handle('create-wallet', async (event, data) => {
  const response = await emitWithTimeout('create_wallet', data);
  if (response && response.success) {
    logActivity('WALLET_CREATED', { type: data.type, label: data.label });
  }
  return response;
});

ipcMain.handle('update-wallet', async (event, data) => {
  const response = await emitWithTimeout('update_wallet', data);
  if (response && response.success) {
    logActivity('WALLET_UPDATED', { id: data.id });
  }
  return response;
});

ipcMain.handle('select-wallet', async (event, id) => {
  const response = await emitWithTimeout('select_wallet', { id });
  if (response && response.success) {
    logActivity('WALLET_SELECTED', { id });
  }
  return response;
});

ipcMain.handle('delete-wallet', async (event, id) => {
  const response = await emitWithTimeout('delete_wallet', { id });
  if (response && response.success) {
    logActivity('WALLET_DELETED', { id });
  }
  return response;
});

ipcMain.handle('empty-wallet', async (event, id) => {
  const response = await emitWithTimeout('empty_wallet', { id });
  if (response && response.success) {
    logActivity('WALLET_EMPTIED', { id });
  }
  return response;
});

ipcMain.handle('get-clients', async () => {
  const response = await emitWithTimeout('get_clients', {});
  return response;
});

ipcMain.handle('get-requests', async (event, params = {}) => {
  const response = await emitWithTimeout('get_requests', params);
  return response;
});

ipcMain.handle('toggle-user-active', async (event, userId, isActive) => {
  const response = await emitWithTimeout('toggle_user_active', { userId, isActive });
  if (response && response.success) {
    logActivity('USER_TOGGLED', { userId, isActive });
  }
  return response;
});

ipcMain.handle('create-panel-user', async (event, targetUsername) => {
  const response = await emitWithTimeout('create_panel_user', { targetUsername });
  if (response && response.success) {
    logActivity('CREATE_PANEL_USER', { targetUsername });
  }
  return response;
});

// --- Preloaded users (CSV bulk import) — HTTP, not socket ---

ipcMain.handle('bulk-import-preloaded', async (event, entries) => {
  try {
    if (!state.config?.backendUrl || !state.config?.apiKey) {
      return { error: 'Backend no configurado' };
    }
    const url = `${state.config.backendUrl}/api/users/preloaded/bulk`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Operator-API-Key': state.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    const data = await response.json();
    logActivity('PRELOAD_USERS_IMPORTED', {
      created: data.created,
      updated: data.updated,
      errors: data.errors?.length || 0,
    });
    return { success: true, data };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('list-preloaded-users', async () => {
  try {
    if (!state.config?.backendUrl || !state.config?.apiKey) {
      return { error: 'Backend no configurado' };
    }
    const url = `${state.config.backendUrl}/api/users/preloaded`;
    const response = await fetch(url, {
      headers: { 'X-Operator-API-Key': state.config.apiKey },
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('unflag-preloaded-user', async (event, userId) => {
  try {
    if (!state.config?.backendUrl || !state.config?.apiKey) {
      return { error: 'Backend no configurado' };
    }
    const url = `${state.config.backendUrl}/api/users/preloaded/${encodeURIComponent(userId)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Operator-API-Key': state.config.apiKey },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ============================================
// PRIZE CLAIM IPC HANDLERS
// ============================================

ipcMain.handle('process-prize-claim', async (event, claimId) => {
  return emitWithTimeout('operator:process_prize_claim', { claimId });
});

ipcMain.handle('complete-prize-claim', async (event, claimId, proofUrl, proofType) => {
  return emitWithTimeout('operator:complete_prize_claim', { claimId, proofUrl, proofType });
});

// Abre un file picker (imagen o PDF) y sube el comprobante al backend.
// Devuelve { url, type } listo para pasarle a operator:complete_prize_claim.
// Si el operador cancela el diálogo, devuelve { cancelled: true }.
ipcMain.handle('pick-and-upload-payout-proof', async () => {
  if (!state.config?.backendUrl || !state.config?.apiKey) {
    return { error: 'Operator panel no está configurado (backend URL / API key).' };
  }

  const result = await dialog.showOpenDialog({
    title: 'Adjuntá el comprobante de la transferencia',
    properties: ['openFile'],
    filters: [
      { name: 'Comprobante (imagen o PDF)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic', 'pdf'] },
      { name: 'Imagen', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] },
      { name: 'PDF', extensions: ['pdf'] },
    ],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { cancelled: true };
  }

  const filePath = result.filePaths[0];
  let fileBuffer;
  try {
    fileBuffer = await fsPromises.readFile(filePath);
  } catch (err) {
    return { error: `No pude leer el archivo: ${err.message}` };
  }

  if (fileBuffer.length === 0) {
    return { error: 'El archivo está vacío.' };
  }
  if (fileBuffer.length > 10 * 1024 * 1024) {
    return { error: 'El archivo supera 10 MB.' };
  }

  const filename = filePath.split(/[\\/]/).pop() || 'comprobante.bin';
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    heic: 'image/heic',
    pdf: 'application/pdf',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  try {
    const boundary = '----PayoutProofBoundary' + Date.now().toString(16);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);

    const url = `${state.config.backendUrl}/api/uploads/operator/payout-proof`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Operator-API-Key': state.config.apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[Main] payout-proof upload failed:', response.status, text);
      return { error: `Upload falló (HTTP ${response.status}). ${text || ''}`.trim() };
    }

    const data = await response.json();
    return { url: data.url, type: data.type };
  } catch (error) {
    console.error('[Main] pick-and-upload-payout-proof error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('reject-prize-claim', async (event, claimId, reason) => {
  return emitWithTimeout('operator:reject_prize_claim', { claimId, reason });
});

ipcMain.handle('get-prize-claims', async () => {
  return emitWithTimeout('get_prize_claims', {});
});

ipcMain.handle('get-user-panel-info', async (event, userId) => {
  return emitWithTimeout('operator:get_user_panel_info', { userId });
});

ipcMain.handle('set-user-target-username', async (event, userId, savedTargetUsername) => {
  return emitWithTimeout('operator:set_user_target_username', { userId, savedTargetUsername });
});

ipcMain.handle('confirm-outbound-payment', async (event, paymentId) => {
  return emitWithTimeout('confirm_outbound_payment', { paymentId });
});

ipcMain.handle('cancel-outbound-payment', async (event, paymentId, reason) => {
  return emitWithTimeout('cancel_outbound_payment', { paymentId, reason });
});

ipcMain.handle('retry-outbound-payment', async (event, paymentId) => {
  return emitWithTimeout('retry_outbound_payment', { paymentId });
});

ipcMain.handle('buy-crypto', async (event, walletId, amount) => {
  return emitWithTimeout('buy_crypto', { walletId, amount });
});

// ============================================
// APP LIFECYCLE
// ============================================

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();

  // Ollama health check disabled: conversational AI removed from operator panel.
  // (Validator app still uses Ollama as OCR fallback — that's a different process.)

  // Auto-connect if config exists
  if (state.config.backendUrl && state.config.apiKey) {
    setTimeout(() => connectToBackend(), 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  isConnecting = false;
  if (ollamaHealthInterval) {
    clearInterval(ollamaHealthInterval);
    ollamaHealthInterval = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

console.log('[Main] Operator Panel starting...');
