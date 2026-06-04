// api-mock.js — Browser-compatible mock of Electron's IPC bridge (preload.js)
// Connects directly to Socket.IO /operator namespace instead of going through main.js

const BACKEND_URL = 'https://tiorico-api.onrender.com';
const API_KEY = 'Narciso';
const OPERATOR_NAME = 'E2E_TestOperator';

// --- Internal state (mirrors main.js) ---
const _state = {
  connected: false,
  config: { backendUrl: BACKEND_URL, apiKey: API_KEY, operatorName: OPERATOR_NAME },
  pendingFailures: 0,
  pendingChats: 0,
  killSwitchActive: false,
  botStatus: 'offline',
  validatorConnected: false,
  lastUpdate: null,
};

const _store = {
  failures: [],
  jobs: [],
  chats: [],
  wallets: [],
  stats: {},
  activityLog: [],
  trends: [],
};

let _notificationSettings = {};
let _quickReplies = null;
const _processedFailureIds = new Set();

// --- Callback registry ---
const _callbacks = {};
function _register(channel, cb) {
  if (!_callbacks[channel]) _callbacks[channel] = [];
  _callbacks[channel].push(cb);
  return () => { _callbacks[channel] = _callbacks[channel].filter(fn => fn !== cb); };
}
function _fire(channel, data) {
  (_callbacks[channel] || []).forEach(cb => { try { cb(data); } catch (e) { console.error(`[Mock] callback error on ${channel}:`, e); } });
}

// --- Socket connection ---
let _socket = null;

function _connectSocket() {
  if (_socket) { _socket.removeAllListeners(); _socket.disconnect(); }

  console.log('[Mock] Connecting to', BACKEND_URL + '/operator');
  _socket = io(BACKEND_URL + '/operator', {
    auth: { apiKey: API_KEY, operatorName: OPERATOR_NAME },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    timeout: 20000,
    transports: ['websocket', 'polling'],
  });

  _socket.on('connect', () => {
    console.log('[Mock] Connected');
    _state.connected = true;
    _state.lastUpdate = new Date().toISOString();
    _fire('connection-status', { connected: true, lastUpdate: _state.lastUpdate });
    _socket.emit('get_initial_data');
  });

  _socket.on('disconnect', (reason) => {
    console.log('[Mock] Disconnected:', reason);
    _state.connected = false;
    _state.botStatus = 'offline';
    _fire('connection-status', { connected: false, reason });
  });

  _socket.on('connect_error', (error) => {
    console.error('[Mock] Connection error:', error.message);
    _state.connected = false;
    _fire('connection-status', { connected: false, error: error.message });
  });

  // --- Event handlers (mirror main.js:494-895) ---

  _socket.on('initial_data', (data) => {
    console.log('[Mock] initial_data received');
    _store.failures = data.failures || [];
    _store.jobs = data.jobs || [];
    _store.chats = data.chats || [];
    _store.wallets = data.wallets || [];
    _store.stats = data.stats || _store.stats;
    _store.trends = data.trends || [];

    if (data.stats?.system?.botStatus) _state.botStatus = data.stats.system.botStatus;
    if (typeof data.killSwitch === 'boolean') _state.killSwitchActive = data.killSwitch;
    if (data.validatorStatus) {
      _state.validatorConnected = data.validatorStatus.connected;
      _fire('validator-status', { connected: data.validatorStatus.connected });
    }
    if (data.botStatus) _state.botStatus = data.botStatus.connected ? 'online' : 'offline';

    _store.failures.forEach(f => _processedFailureIds.add(f.id));
    _state.pendingFailures = _store.failures.filter(f => !f.resolvedAt).length;
    _state.pendingChats = _store.chats.filter(c => (c.unreadCount || 0) > 0 || (c.unread || 0) > 0).length;
    _state.lastUpdate = new Date().toISOString();

    _fire('data-update', { store: _store, state: _state, notificationSettings: _notificationSettings, quickReplies: _quickReplies });
  });

  _socket.on('validation_failed', (failure) => {
    if (!failure.id && failure.requestId) failure.id = failure.requestId;
    if (!failure.createdAt) failure.createdAt = failure.timestamp || new Date().toISOString();
    if (_store.failures.some(f => f.id === failure.id) || _processedFailureIds.has(failure.id)) return;
    _processedFailureIds.add(failure.id);
    _store.failures.unshift(failure);
    _state.pendingFailures = _store.failures.filter(f => !f.resolvedAt).length;
    _state.lastUpdate = new Date().toISOString();
    _fire('new-failure', failure);
  });

  _socket.on('job_failed', (job) => {
    if (!job.id && job.jobId) job.id = job.jobId;
    if (!job.createdAt) job.createdAt = job.timestamp || new Date().toISOString();
    if (_store.failures.some(f => f.id === job.id) || _processedFailureIds.has(job.id)) return;
    _processedFailureIds.add(job.id);
    _store.failures.unshift({ ...job, type: 'JOB_FAILURE' });
    _state.pendingFailures = _store.failures.filter(f => !f.resolvedAt).length;
    _state.lastUpdate = new Date().toISOString();
    _fire('job-failed', job);
  });

  _socket.on('job_status', (job) => {
    const idx = _store.jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) _store.jobs[idx] = job; else _store.jobs.unshift(job);
    _state.lastUpdate = new Date().toISOString();
    if (job.status === 'PROCESSING') _state.botStatus = 'busy';
    else if (job.status === 'COMPLETED' || job.status === 'FAILED') _state.botStatus = 'online';
    _fire('job-update', job);
  });

  _socket.on('chat:new', (chat) => {
    chat.id = chat.id || chat.chatId;
    if (!_store.chats.some(c => c.id === chat.id)) {
      _store.chats.unshift(chat);
      _state.pendingChats = _store.chats.filter(c => (c.unread || 0) > 0 || (c.unreadCount || 0) > 0).length;
      _state.lastUpdate = new Date().toISOString();
      _fire('data-update', { store: _store, state: _state, notificationSettings: _notificationSettings, quickReplies: _quickReplies });
    }
  });

  _socket.on('new_message', (message) => {
    _state.lastUpdate = new Date().toISOString();
    let chat = _store.chats.find(c => c.id === message.chatId);
    if (!chat) {
      chat = { id: message.chatId, status: 'OPEN', user: message.sender || {}, lastMessage: message, unread: 0, unreadCount: 0, createdAt: message.createdAt, updatedAt: message.createdAt };
      _store.chats.unshift(chat);
    }
    chat.lastMessage = message;
    _fire('new-message', message);
  });

  _socket.on('messages:read', (data) => {
    const chat = _store.chats.find(c => c.id === data.chatId);
    if (chat) { chat.unread = 0; chat.unreadCount = 0; }
    _fire('messages-read', data);
  });

  _socket.on('validator:status', (data) => { _state.validatorConnected = data.connected; _fire('validator-status', { connected: data.connected }); });
  _socket.on('auth_warning', (data) => _fire('auth-warning', data));
  _socket.on('user_typing', (data) => _fire('user-typing', data));
  _socket.on('stats_update', (stats) => { _store.stats = { ..._store.stats, ...stats }; _state.lastUpdate = new Date().toISOString(); _fire('stats-update', { stats: _store.stats, lastUpdate: _state.lastUpdate }); });
  _socket.on('bot_status', (data) => { _state.botStatus = data.status; _fire('bot-status', data); });
  _socket.on('kill_switch', (data) => { const active = typeof data === 'boolean' ? data : data.active; _state.killSwitchActive = active; _state.lastUpdate = new Date().toISOString(); _fire('kill-switch', { active }); });
  _socket.on('dispatch_blocked', (data) => _fire('dispatch-blocked', data));
  _socket.on('failure_resolved', (data) => { const f = _store.failures.find(x => x.id === data.failureId); if (f) { f.resolvedAt = data.timestamp; f.resolution = data.action; } _state.pendingFailures = _store.failures.filter(x => !x.resolvedAt).length; _fire('failure-resolved', data); });
  _socket.on('validation:completed', (data) => { const idx = _store.failures.findIndex(f => f.id === data.requestId); if (idx >= 0) { _store.failures.splice(idx, 1); _state.pendingFailures = _store.failures.filter(f => !f.resolvedAt).length; } _fire('validation-completed', data); });

  // Wallet events
  _socket.on('wallet_created', (w) => { _store.wallets.unshift(w); _fire('wallet-created', w); });
  _socket.on('wallet_updated', (w) => { const i = _store.wallets.findIndex(x => x.id === w.id); if (i >= 0) _store.wallets[i] = w; else _store.wallets.unshift(w); _fire('wallet-updated', w); });
  _socket.on('wallet_selected', (d) => { _store.wallets.forEach(w => w.isSelected = w.id === d.wallet?.id); _fire('wallet-selected', d); });
  _socket.on('wallet_deleted', (d) => { _store.wallets = _store.wallets.filter(w => w.id !== d.id); _fire('wallet-deleted', d); });
  _socket.on('wallet_emptied', (d) => { const i = _store.wallets.findIndex(w => w.id === d.wallet?.id); if (i >= 0) _store.wallets[i] = d.wallet; _fire('wallet-emptied', d); });
  _socket.on('wallets_all_full', (d) => _fire('wallets-all-full', d));
  _socket.on('user_updated', (d) => _fire('user-updated', d));
}

// --- Emit with timeout helper ---
function _emitWithTimeout(event, data, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (!_socket || !_socket.connected) {
      resolve({ success: false, error: 'No conectado al servidor' });
      return;
    }
    const timer = setTimeout(() => resolve({ success: false, error: 'Timeout' }), timeoutMs);
    _socket.emit(event, data, (response) => {
      clearTimeout(timer);
      resolve(response || { success: false, error: 'No response' });
    });
  });
}

// --- Expose window.api (mirrors preload.js exactly) ---
window.api = {
  // State
  getState: () => Promise.resolve({ state: _state, store: _store, notificationSettings: _notificationSettings, quickReplies: _quickReplies }),

  // Config
  saveConfig: (config) => {
    _state.config = config;
    localStorage.setItem('op_config', JSON.stringify(config));
    // Reconnect not needed in mock — already connected
    return Promise.resolve({ success: true });
  },
  testConnection: (config) => {
    return new Promise((resolve) => {
      const testSocket = io((config.backendUrl || BACKEND_URL) + '/operator', {
        auth: { apiKey: config.apiKey },
        reconnection: false,
        timeout: 10000,
      });
      const t = setTimeout(() => { testSocket.disconnect(); resolve({ success: false, error: 'Timeout' }); }, 10000);
      testSocket.on('connect', () => { clearTimeout(t); testSocket.disconnect(); resolve({ success: true }); });
      testSocket.on('connect_error', (e) => { clearTimeout(t); testSocket.disconnect(); resolve({ success: false, error: e.message }); });
    });
  },

  // Notification Settings
  getNotificationSettings: () => Promise.resolve(_notificationSettings),
  saveNotificationSettings: (s) => { _notificationSettings = { ..._notificationSettings, ...s }; localStorage.setItem('op_notif', JSON.stringify(_notificationSettings)); _fire('notification-settings-updated', _notificationSettings); return Promise.resolve({ success: true }); },

  // Quick Replies
  getQuickReplies: () => Promise.resolve(_quickReplies),
  saveQuickReplies: (r) => { _quickReplies = r; localStorage.setItem('op_qr', JSON.stringify(r)); _fire('quick-replies-updated', _quickReplies); return Promise.resolve({ success: true }); },

  // Failures
  approveFailure: (failureId, note, approvedAmount) => _emitWithTimeout('approve_failure', { failureId, note, approvedAmount }),
  rejectFailure: (failureId, reason) => _emitWithTimeout('reject_failure', { failureId, reason }),

  // Chat
  sendMessage: (chatId, content, imageUrl) => { const p = { chatId, content }; if (imageUrl) p.imageUrl = imageUrl; return _emitWithTimeout('send_message', p); },
  uploadChatImage: (buffer, filename, mimeType) => {
    // In browser we can't easily do multipart like Node; return stub
    console.warn('[Mock] uploadChatImage not fully supported in browser');
    return Promise.resolve({ error: 'Not supported in browser mock' });
  },
  markChatRead: (chatId) => { const c = _store.chats.find(x => x.id === chatId); if (c) { c.unread = 0; c.unreadCount = 0; } if (_socket?.connected) _socket.emit('mark_read', { chatId }); return Promise.resolve({ success: true }); },
  getChatMessages: (chatId, cursor) => _emitWithTimeout('get_chat_messages', { chatId, cursor }),
  closeChat: (chatId, reason) => _emitWithTimeout('close_chat', { chatId, reason }),
  sendTyping: (chatId) => { if (_socket?.connected) _socket.emit('typing', { chatId }); return Promise.resolve({ success: true }); },

  // Jobs
  retryJob: (jobId) => _emitWithTimeout('retry_job', { jobId }),

  // Wallets
  getWallets: () => _emitWithTimeout('get_wallets', {}),
  createWallet: (data) => _emitWithTimeout('create_wallet', data),
  updateWallet: (data) => _emitWithTimeout('update_wallet', data),
  selectWallet: (id) => _emitWithTimeout('select_wallet', { id }),
  deleteWallet: (id) => _emitWithTimeout('delete_wallet', { id }),
  emptyWallet: (id) => _emitWithTimeout('empty_wallet', { id }),

  // Users
  getClients: () => _emitWithTimeout('get_clients', {}),
  toggleUserActive: (userId, isActive) => _emitWithTimeout('toggle_user_active', { userId, isActive }),

  // Activity Log
  getActivityLog: () => Promise.resolve(_store.activityLog),

  // Export
  exportData: (type) => {
    const map = { failures: _store.failures, jobs: _store.jobs, activity: _store.activityLog };
    const data = map[type];
    if (!data) return Promise.resolve({ success: false, error: 'Unknown type' });
    return Promise.resolve({ success: true, data, filename: `${type}-${new Date().toISOString().split('T')[0]}.json` });
  },

  // Actions
  toggleKillSwitch: () => {
    const newState = !_state.killSwitchActive;
    return _emitWithTimeout('set_kill_switch', { active: newState }).then(r => {
      if (r?.success) { _state.killSwitchActive = newState; _fire('kill-switch', { active: newState }); }
      return r;
    });
  },
  reconnect: () => { _connectSocket(); return Promise.resolve({ success: true }); },
  openExternal: (url) => { window.open(url, '_blank'); return Promise.resolve({ success: true }); },

  // Proof image fetch
  fetchProofImage: async (proofUrl) => {
    if (!proofUrl) return { error: 'No proofUrl' };
    try {
      const fileId = proofUrl.split('/').pop();
      const url = `${BACKEND_URL}/api/uploads/operator/${fileId}`;
      const res = await fetch(url, { headers: { 'X-Operator-API-Key': API_KEY } });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({ dataUrl: reader.result });
        reader.readAsDataURL(blob);
      });
    } catch (e) { return { error: e.message }; }
  },

  // Event listeners (mirror preload.js on* methods)
  onConnectionStatus: (cb) => _register('connection-status', cb),
  onDataUpdate: (cb) => _register('data-update', cb),
  onNewFailure: (cb) => _register('new-failure', cb),
  onJobFailed: (cb) => _register('job-failed', cb),
  onJobUpdate: (cb) => _register('job-update', cb),
  onNewMessage: (cb) => _register('new-message', cb),
  onStatsUpdate: (cb) => _register('stats-update', cb),
  onKillSwitch: (cb) => _register('kill-switch', cb),
  onNavigate: (cb) => _register('navigate', cb),
  onActivityLog: (cb) => _register('activity-log', cb),
  onBotStatus: (cb) => _register('bot-status', cb),
  onFailureResolved: (cb) => _register('failure-resolved', cb),
  onNotificationSettingsUpdated: (cb) => _register('notification-settings-updated', cb),
  onQuickRepliesUpdated: (cb) => _register('quick-replies-updated', cb),
  onPlaySound: (cb) => _register('play-sound', cb),
  onWalletCreated: (cb) => _register('wallet-created', cb),
  onWalletUpdated: (cb) => _register('wallet-updated', cb),
  onWalletSelected: (cb) => _register('wallet-selected', cb),
  onWalletDeleted: (cb) => _register('wallet-deleted', cb),
  onWalletEmptied: (cb) => _register('wallet-emptied', cb),
  onWalletsAllFull: (cb) => _register('wallets-all-full', cb),
  onUserTyping: (cb) => _register('user-typing', cb),
  onAuthWarning: (cb) => _register('auth-warning', cb),
  onValidatorStatus: (cb) => _register('validator-status', cb),
  onValidationCompleted: (cb) => _register('validation-completed', cb),
  onUserUpdated: (cb) => _register('user-updated', cb),
  onDispatchBlocked: (cb) => _register('dispatch-blocked', cb),
  onMessagesRead: (cb) => _register('messages-read', cb),
};

// --- Boot ---
_connectSocket();
console.log('[Mock] api-mock.js loaded — window.api ready');
