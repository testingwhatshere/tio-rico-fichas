const { contextBridge, ipcRenderer } = require('electron');

// IPC invoke with timeout to prevent frozen UI when main process hangs
const IPC_TIMEOUT_MS = 15000;
function invokeWithTimeout(channel, ...args) {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`IPC call "${channel}" timed out after ${IPC_TIMEOUT_MS / 1000}s`)), IPC_TIMEOUT_MS)
    ),
  ]);
}

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('api', {
  // State
  getState: () => ipcRenderer.invoke('get-state'),

  // Config
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  testConnection: (config) => invokeWithTimeout('test-connection', config),

  // Notification Settings
  getNotificationSettings: () => ipcRenderer.invoke('get-notification-settings'),
  saveNotificationSettings: (settings) => ipcRenderer.invoke('save-notification-settings', settings),

  // Quick Replies
  getQuickReplies: () => ipcRenderer.invoke('get-quick-replies'),
  saveQuickReplies: (replies) => ipcRenderer.invoke('save-quick-replies', replies),

  // Failures
  approveFailure: (failureId, note, approvedAmount) => invokeWithTimeout('approve-failure', { failureId, note, approvedAmount }),
  rejectFailure: (failureId, reason) => invokeWithTimeout('reject-failure', { failureId, reason }),

  // Chat
  sendMessage: (chatId, content, imageUrl) => invokeWithTimeout('send-message', { chatId, content, imageUrl }),
  uploadChatImage: (buffer, filename, mimeType) => invokeWithTimeout('upload-chat-image', { buffer, filename, mimeType }),
  markChatRead: (chatId) => invokeWithTimeout('mark-chat-read', chatId),
  getChatMessages: (chatId, cursor) => invokeWithTimeout('get-chat-messages', { chatId, cursor }),
  closeChat: (chatId, reason) => invokeWithTimeout('close-chat', { chatId, reason }),
  sendTyping: (chatId) => ipcRenderer.invoke('send-typing', chatId),

  // Jobs
  retryJob: (jobId) => invokeWithTimeout('retry-job', jobId),
  retryFailedRequest: (requestId) => invokeWithTimeout('retry-failed-request', requestId),

  // Wallets
  getWallets: () => invokeWithTimeout('get-wallets'),
  createWallet: (data) => invokeWithTimeout('create-wallet', data),
  updateWallet: (data) => invokeWithTimeout('update-wallet', data),
  selectWallet: (id) => invokeWithTimeout('select-wallet', id),
  deleteWallet: (id) => invokeWithTimeout('delete-wallet', id),
  emptyWallet: (id) => invokeWithTimeout('empty-wallet', id),

  // Requests
  getRequests: (params) => invokeWithTimeout('get-requests', params || {}),

  // Users management
  getClients: () => invokeWithTimeout('get-clients'),
  toggleUserActive: (userId, isActive) => invokeWithTimeout('toggle-user-active', userId, isActive),
  createPanelUser: (targetUsername) => invokeWithTimeout('create-panel-user', targetUsername),

  // Preloaded users (CSV bulk import)
  bulkImportPreloaded: (entries) => invokeWithTimeout('bulk-import-preloaded', entries),
  listPreloadedUsers: () => invokeWithTimeout('list-preloaded-users'),
  unflagPreloadedUser: (userId) => invokeWithTimeout('unflag-preloaded-user', userId),

  // Promotions
  broadcastPromo: (title, message) => invokeWithTimeout('broadcast-promo', { title, message }),

  // App Updates
  publishAppUpdate: (version, apkUrl, changelog) => invokeWithTimeout('publish-app-update', { version, apkUrl, changelog }),

  // Activity Log
  getActivityLog: () => ipcRenderer.invoke('get-activity-log'),

  // Export
  exportData: (type) => ipcRenderer.invoke('export-data', type),

  // System Settings
  updateSystemSettings: (settings) => ipcRenderer.invoke('update-system-settings', settings),

  // Panels
  getPanels: () => ipcRenderer.invoke('get-panels'),
  createPanel: (name) => ipcRenderer.invoke('create-panel', name),
  updatePanel: (id, data) => ipcRenderer.invoke('update-panel', id, data),
  deletePanel: (id) => ipcRenderer.invoke('delete-panel', id),

  // Actions
  toggleKillSwitch: () => invokeWithTimeout('toggle-kill-switch'),
  reconnect: () => invokeWithTimeout('reconnect'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Open the QR pairing window used to onboard a new Android wallet-listener phone.
  openQrPairing: () => ipcRenderer.invoke('open-qr-pairing'),

  // Event listeners
  onConnectionStatus: (callback) => {
    ipcRenderer.on('connection-status', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('connection-status');
  },

  onDataUpdate: (callback) => {
    ipcRenderer.on('data-update', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('data-update');
  },

  onNewFailure: (callback) => {
    ipcRenderer.on('new-failure', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('new-failure');
  },

  onJobFailed: (callback) => {
    ipcRenderer.on('job-failed', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('job-failed');
  },

  onJobUpdate: (callback) => {
    ipcRenderer.on('job-update', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('job-update');
  },

  onNewMessage: (callback) => {
    ipcRenderer.on('new-message', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('new-message');
  },

  onChatHelpRequested: (callback) => {
    ipcRenderer.on('chat-help-requested', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('chat-help-requested');
  },

  onChatHelpCleared: (callback) => {
    ipcRenderer.on('chat-help-cleared', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('chat-help-cleared');
  },

  onStatsUpdate: (callback) => {
    ipcRenderer.on('stats-update', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('stats-update');
  },

  onKillSwitch: (callback) => {
    ipcRenderer.on('kill-switch', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('kill-switch');
  },

  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (event, view) => callback(view));
    return () => ipcRenderer.removeAllListeners('navigate');
  },

  onActivityLog: (callback) => {
    ipcRenderer.on('activity-log', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('activity-log');
  },

  onBotStatus: (callback) => {
    ipcRenderer.on('bot-status', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('bot-status');
  },

  onDiscoveryStarted: (callback) => {
    ipcRenderer.on('discovery-started', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('discovery-started');
  },

  onDiscoveryCompleted: (callback) => {
    ipcRenderer.on('discovery-completed', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('discovery-completed');
  },

  onDiscoveryFailed: (callback) => {
    ipcRenderer.on('discovery-failed', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('discovery-failed');
  },

  onFailureResolved: (callback) => {
    ipcRenderer.on('failure-resolved', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('failure-resolved');
  },

  onNotificationSettingsUpdated: (callback) => {
    ipcRenderer.on('notification-settings-updated', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('notification-settings-updated');
  },

  onQuickRepliesUpdated: (callback) => {
    ipcRenderer.on('quick-replies-updated', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('quick-replies-updated');
  },

  onPlaySound: (callback) => {
    ipcRenderer.on('play-sound', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('play-sound');
  },

  // Wallet events
  onWalletCreated: (callback) => {
    ipcRenderer.on('wallet-created', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('wallet-created');
  },

  onWalletUpdated: (callback) => {
    ipcRenderer.on('wallet-updated', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('wallet-updated');
  },

  onWalletSelected: (callback) => {
    ipcRenderer.on('wallet-selected', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('wallet-selected');
  },

  onWalletDeleted: (callback) => {
    ipcRenderer.on('wallet-deleted', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('wallet-deleted');
  },

  onWalletEmptied: (callback) => {
    ipcRenderer.on('wallet-emptied', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('wallet-emptied');
  },

  onWalletsAllFull: (callback) => {
    ipcRenderer.on('wallets-all-full', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('wallets-all-full');
  },

  // Typing indicator
  onUserTyping: (callback) => {
    ipcRenderer.on('user-typing', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('user-typing');
  },

  // Auth warning
  onAuthWarning: (callback) => {
    ipcRenderer.on('auth-warning', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('auth-warning');
  },

  // Validator status
  onValidatorStatus: (callback) => {
    ipcRenderer.on('validator-status', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('validator-status');
  },

  // Validation completed
  onValidationCompleted: (callback) => {
    ipcRenderer.on('validation-completed', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('validation-completed');
  },

  // Chat closed
  onChatClosed: (callback) => {
    ipcRenderer.on('chat-closed', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('chat-closed');
  },

  // Job retried
  onJobRetried: (callback) => {
    ipcRenderer.on('job-retried', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('job-retried');
  },

  // User events
  onUserUpdated: (callback) => {
    ipcRenderer.on('user-updated', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('user-updated');
  },

  // Dispatch blocked
  onDispatchBlocked: (callback) => {
    ipcRenderer.on('dispatch-blocked', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('dispatch-blocked');
  },

  // System alerts
  onSystemAlert: (callback) => {
    ipcRenderer.on('system-alert', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('system-alert');
  },

  // Proof image fetch (IPC bridge for authenticated image loading)
  fetchProofImage: (proofUrl) => ipcRenderer.invoke('fetch-proof-image', proofUrl),

  // Messages read
  onMessagesRead: (callback) => {
    ipcRenderer.on('messages-read', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('messages-read');
  },

  // Prize Claims
  processPrizeClaim: (claimId) => ipcRenderer.invoke('process-prize-claim', claimId),
  completePrizeClaim: (claimId) => ipcRenderer.invoke('complete-prize-claim', claimId),
  rejectPrizeClaim: (claimId, reason) => ipcRenderer.invoke('reject-prize-claim', claimId, reason),
  getPrizeClaims: () => ipcRenderer.invoke('get-prize-claims'),
  confirmOutboundPayment: (paymentId) => ipcRenderer.invoke('confirm-outbound-payment', paymentId),
  cancelOutboundPayment: (paymentId, reason) => ipcRenderer.invoke('cancel-outbound-payment', paymentId, reason),
  retryOutboundPayment: (paymentId) => ipcRenderer.invoke('retry-outbound-payment', paymentId),
  buyCrypto: (walletId, amount) => ipcRenderer.invoke('buy-crypto', walletId, amount),
  onOutboundPaymentCreated: (callback) => ipcRenderer.on('outbound-payment-created', (_, data) => callback(data)),
  onOutboundPaymentUpdated: (callback) => ipcRenderer.on('outbound-payment-updated', (_, data) => callback(data)),
  onNewPrizeClaim: (cb) => {
    ipcRenderer.on('new-prize-claim', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('new-prize-claim');
  },
  onPrizeClaimUpdated: (cb) => {
    ipcRenderer.on('prize-claim-updated', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('prize-claim-updated');
  },
  onPrizeClaimsLoaded: (cb) => {
    ipcRenderer.on('prize-claims-loaded', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('prize-claims-loaded');
  },

  // Settings updated (from other operators)
  onSettingsUpdated: (callback) => {
    ipcRenderer.on('settings-updated', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('settings-updated');
  },

  // Proof uploaded
  onProofUploaded: (callback) => {
    ipcRenderer.on('proof-uploaded', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('proof-uploaded');
  },

  // Panel balance alert muted
  onPanelBalanceAlertMuted: (callback) => {
    ipcRenderer.on('panel-balance-alert-muted', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('panel-balance-alert-muted');
  },

  // Auto-update
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: (downloadUrl) => ipcRenderer.invoke('download-update', downloadUrl),
  installUpdate: (filePath) => ipcRenderer.invoke('install-update', filePath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('update-progress');
  },

  // Ollama AI
  getOllamaStatus: () => ipcRenderer.invoke('get-ollama-status'),
  setOllamaConfig: (config) => ipcRenderer.invoke('set-ollama-config', config),
  testOllama: () => ipcRenderer.invoke('test-ollama'),
  toggleBot: (enabled) => ipcRenderer.invoke('toggle-bot', enabled),
  getSuggestedReplies: (chatId, messages) => ipcRenderer.invoke('get-suggested-replies', { chatId, messages }),
  getFailureAnalysis: (failureData) => ipcRenderer.invoke('get-failure-analysis', failureData),

  onOllamaStatus: (callback) => {
    ipcRenderer.on('ollama-status', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('ollama-status');
  },

  // Extension events
  onExtensionHeartbeat: (callback) => {
    ipcRenderer.on('extension-heartbeat', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('extension-heartbeat');
  },
  onExtensionLog: (callback) => {
    ipcRenderer.on('extension-log', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('extension-log');
  },
  onExtensionCircuitBreaker: (callback) => {
    ipcRenderer.on('extension-circuit-breaker', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('extension-circuit-breaker');
  },
  resetCircuitBreaker: (extensionId) => ipcRenderer.invoke('reset-circuit-breaker', extensionId),
  onExtensionSelectorHealth: (callback) => {
    ipcRenderer.on('extension-selector-health', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('extension-selector-health');
  },
});
