const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object (security best practice)
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.send('get-config'),
  saveConfig: (config) => ipcRenderer.send('save-config', config),

  // Connection
  connect: () => ipcRenderer.send('connect'),
  disconnect: () => ipcRenderer.send('disconnect'),

  // Ollama
  checkOllama: () => ipcRenderer.send('check-ollama'),
  installOllama: () => ipcRenderer.send('install-ollama'),
  startOllama: () => ipcRenderer.send('start-ollama'),
  pullModel: (modelName) => ipcRenderer.send('pull-model', modelName),
  openOllamaSite: () => ipcRenderer.send('open-ollama-site'),

  // Model selection
  selectModel: (modelName) => ipcRenderer.send('select-model', modelName),

  // Prompt
  getDefaultPrompt: () => ipcRenderer.send('get-default-prompt'),

  // Logs
  getLogsPath: () => ipcRenderer.send('get-logs-path'),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  getRecentLogs: () => ipcRenderer.send('get-recent-logs'),

  // Queue
  getQueueStatus: () => ipcRenderer.send('get-queue-status'),
  clearQueue: () => ipcRenderer.send('clear-queue'),
  confirmClearQueue: () => ipcRenderer.invoke('confirm-clear-queue'),

  // OCR Sandbox
  ocrAnalyze: (imageBase64) => ipcRenderer.invoke('ocr-analyze', imageBase64),
  ollamaAnalyze: (imageBase64) => ipcRenderer.invoke('ollama-analyze', imageBase64),
  ocrSaveExample: (example) => ipcRenderer.invoke('ocr-save-example', example),
  ocrGetExamples: () => ipcRenderer.invoke('ocr-get-examples'),
  ocrExportExamples: () => ipcRenderer.invoke('ocr-export-examples'),
  ocrImportExamples: () => ipcRenderer.invoke('ocr-import-examples'),

  // Auto-update
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: (downloadUrl) => ipcRenderer.invoke('download-update', downloadUrl),
  installUpdate: (filePath) => ipcRenderer.invoke('install-update', filePath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Event listeners - only allow specific channels
  on: (channel, callback) => {
    const validChannels = [
      'ollama-checking',
      'ollama-status',
      'ollama-starting',
      'install-progress',
      'model-progress',
      'connection-status',
      'log',
      'config',
      'config-saved',
      'validating',
      'validation-done',
      'logs-path',
      'recent-logs',
      'queue-status',
      'model-selected',
      'model-auto-switched',
      'validation-queue-status',
      'auto-download-started',
      'auto-download-complete',
      'auto-download-failed',
      'default-prompt',
      'update-progress',
      'open-wizard',
      'validator-stats',
    ];
    if (!validChannels.includes(channel)) return () => {};
    // Cap listeners per channel to detect leaks early. 5 is generous for a single-window app.
    const MAX_LISTENERS_PER_CHANNEL = 5;
    if (!_listenerCounts) _listenerCounts = new Map();
    const count = _listenerCounts.get(channel) || 0;
    if (count >= MAX_LISTENERS_PER_CHANNEL) {
      console.warn(`[preload] Listener cap reached for "${channel}" (${count}). Possible leak.`);
    }
    _listenerCounts.set(channel, count + 1);
    const subscription = (event, ...args) => {
      try { callback(...args); } catch (err) { console.error(`[preload] listener error on ${channel}:`, err); }
    };
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
      const c = _listenerCounts.get(channel) || 1;
      _listenerCounts.set(channel, Math.max(0, c - 1));
    };
  },

  // Remove all listeners for a channel
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
    if (_listenerCounts) _listenerCounts.set(channel, 0);
  },
});

// Module-scoped listener counter (not exposed to renderer).
let _listenerCounts = null;
