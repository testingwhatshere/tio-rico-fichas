/**
 * Browser-compatible mock for Electron's electronAPI (preload.js)
 * Replaces IPC communication with direct Socket.IO calls
 * Used for E2E testing the validator app in a browser context
 */
(function() {
'use strict';

const BACKEND_URL = 'https://tiorico-api.onrender.com';
const API_KEY = 'Narciso';

// Event callback registry
const _listeners = {};

function _fire(channel, ...args) {
  if (_listeners[channel]) {
    _listeners[channel].forEach(cb => {
      try { cb(...args); } catch (e) { console.error(`[Mock] Error in ${channel} listener:`, e); }
    });
  }
}

function _on(channel, callback) {
  if (!_listeners[channel]) _listeners[channel] = [];
  _listeners[channel].push(callback);
  return () => {
    _listeners[channel] = _listeners[channel].filter(cb => cb !== callback);
  };
}

// State
let socket = null;
let isConnected = false;
let ollamaSimulated = false; // We'll simulate Ollama as available
let modelSimulated = false;
let config = {
  backendUrl: BACKEND_URL,
  apiKey: API_KEY,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llava'
};

// Offline queue (in-memory for browser)
let offlineQueue = [];

// Socket connection
function connectToBackend() {
  if (socket) {
    socket.disconnect();
  }

  console.log('[Mock] Connecting to', config.backendUrl + '/validator');
  _fire('log', { message: `Conectando a ${config.backendUrl}...`, type: 'info' });

  socket = io(config.backendUrl + '/validator', {
    auth: { apiKey: config.apiKey },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: 10
  });

  socket.on('connect', () => {
    console.log('[Mock] Connected! Socket ID:', socket.id);
    isConnected = true;
    _fire('connection-status', { connected: true });
    _fire('log', { message: 'Conectado al backend', type: 'success' });

    // Process offline queue
    if (offlineQueue.length > 0) {
      _fire('log', { message: `Procesando ${offlineQueue.length} solicitudes en cola...`, type: 'info' });
      processOfflineQueue();
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('[Mock] Disconnected:', reason);
    isConnected = false;
    _fire('connection-status', { connected: false, error: `Desconectado: ${reason}` });
    _fire('log', { message: `Desconectado: ${reason}`, type: 'warning' });
  });

  socket.on('connect_error', (err) => {
    console.log('[Mock] Connection error:', err.message);
    isConnected = false;
    _fire('connection-status', { connected: false, error: err.message });
    _fire('log', { message: `Error de conexión: ${err.message}`, type: 'error' });
  });

  // Validation request from backend
  socket.on('validate', (request) => {
    console.log('[Mock] Validation request received:', request.id);
    _fire('log', { message: `Solicitud de validación recibida: ${request.id}`, type: 'info' });
    _fire('validating', { id: request.id });
    _fire('validation-queue-status', { count: 0, processing: true });

    // Simulate validation (since no Ollama in browser)
    simulateValidation(request);
  });

  socket.on('error', (err) => {
    console.error('[Mock] Socket error:', err);
    _fire('log', { message: `Error: ${err.message || err}`, type: 'error' });
  });
}

function disconnectFromBackend() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  isConnected = false;
  _fire('connection-status', { connected: false });
  _fire('log', { message: 'Desconectado manualmente', type: 'info' });
}

// Simulate a validation result (no Ollama available in browser)
function simulateValidation(request) {
  const startTime = Date.now();

  // Simulate processing time (2-4 seconds)
  setTimeout(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Create a mock validation result
    const result = {
      id: request.id,
      requestId: request.requestId,
      isValid: true,
      confidence: 0.85,
      extractedAmount: request.expectedAmount || null,
      extractedDate: new Date().toISOString().split('T')[0],
      extractedTime: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      paymentMethod: 'Transferencia',
      transactionId: 'SIM-' + Math.random().toString(36).substr(2, 8).toUpperCase(),
      referenceNumber: null,
      senderName: 'E2E Test User',
      senderDniCuit: null,
      recipientName: request.expectedWallet?.holderName || null,
      recipientAccount: request.expectedWallet?.cbu || request.expectedWallet?.alias || null,
      recipientMatch: true,
      bankName: 'Mercado Pago',
      transactionStatus: 'ACREDITADA',
      authenticityChecks: {
        has_proper_formatting: true,
        has_consistent_fonts: true,
        has_bank_logo: true,
        has_transaction_id: true,
        screenshot_quality: 'good',
        editing_signs: 'none'
      },
      reasoning: `[SIMULADO - E2E Test] Comprobante analizado en ${elapsed}s. Monto y destinatario coinciden.`,
      flags: []
    };

    // Emit result back to backend
    if (socket && socket.connected) {
      socket.emit('validation_result', result);
      _fire('log', { message: `Validación completada (${elapsed}s): ${result.isValid ? 'VÁLIDO' : 'INVÁLIDO'} (confianza: ${(result.confidence * 100).toFixed(0)}%)`, type: result.isValid ? 'success' : 'warning' });
    } else {
      // Add to offline queue
      offlineQueue.push({ request, result });
      _fire('log', { message: `Resultado guardado en cola offline (sin conexión)`, type: 'warning' });
      _fire('queue-status', { count: offlineQueue.length });
    }

    _fire('validation-done', { id: request.id });
    _fire('validation-queue-status', { count: 0, processing: false });
  }, 2000 + Math.random() * 2000);
}

function processOfflineQueue() {
  while (offlineQueue.length > 0) {
    const item = offlineQueue.shift();
    if (socket && socket.connected) {
      socket.emit('validation_result', item.result);
      _fire('log', { message: `Cola: enviado resultado para ${item.request.id}`, type: 'success' });
    }
  }
  _fire('queue-status', { count: 0 });
}

// Expose the mock electronAPI
window.electronAPI = {
  // Config
  getConfig: () => {
    setTimeout(() => _fire('config', config), 100);
  },
  saveConfig: (newConfig) => {
    config = { ...config, ...newConfig };
    _fire('config-saved', config);
    _fire('log', { message: 'Configuración guardada', type: 'success' });
  },

  // Connection
  connect: () => {
    connectToBackend();
  },
  disconnect: () => {
    disconnectFromBackend();
  },

  // Ollama (simulated - no real Ollama in browser)
  checkOllama: () => {
    _fire('ollama-checking');
    _fire('log', { message: 'Verificando Ollama...', type: 'info' });

    // Simulate check delay
    setTimeout(() => {
      ollamaSimulated = true;
      modelSimulated = true;
      _fire('ollama-status', {
        installed: true,
        running: true,
        hasVisionModel: true,
        visionModels: ['llava', 'llama3.2-vision'],
        selectedModel: 'llava',
        error: null
      });
      _fire('log', { message: '[SIMULADO] Ollama corriendo con modelo llava', type: 'success' });
    }, 1500);
  },

  installOllama: () => {
    _fire('log', { message: '[SIMULADO] Instalando Ollama...', type: 'info' });
    let progress = 0;
    const interval = setInterval(() => {
      progress += 20;
      _fire('install-progress', {
        step: progress >= 100 ? 'done' : 'downloading',
        progress,
        message: progress >= 100 ? 'Ollama instalado (simulado)' : `Descargando... ${progress}%`
      });
      if (progress >= 100) clearInterval(interval);
    }, 500);
  },

  startOllama: () => {
    _fire('ollama-starting');
    _fire('log', { message: '[SIMULADO] Iniciando Ollama...', type: 'info' });
    setTimeout(() => {
      ollamaSimulated = true;
      _fire('ollama-status', {
        installed: true,
        running: true,
        hasVisionModel: true,
        visionModels: ['llava'],
        selectedModel: 'llava',
        error: null
      });
      _fire('log', { message: '[SIMULADO] Ollama iniciado', type: 'success' });
    }, 2000);
  },

  pullModel: (modelName) => {
    _fire('log', { message: `[SIMULADO] Descargando modelo ${modelName}...`, type: 'info' });
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      _fire('model-progress', {
        step: progress >= 100 ? 'done' : 'downloading',
        progress,
        message: progress >= 100 ? `Modelo ${modelName} listo!` : `Descargando ${modelName}... ${progress}%`
      });
      if (progress >= 100) {
        clearInterval(interval);
        modelSimulated = true;
      }
    }, 300);
  },

  openOllamaSite: () => {
    window.open('https://ollama.com', '_blank');
  },

  selectModel: (modelName) => {
    _fire('model-selected', { model: modelName });
    _fire('log', { message: `Modelo cambiado a: ${modelName}`, type: 'info' });
  },

  // Logs
  getLogsPath: () => {
    _fire('logs-path', { path: '/browser/mock/logs/' });
  },
  openLogsFolder: () => {
    _fire('log', { message: 'No disponible en modo browser', type: 'warning' });
  },
  getRecentLogs: () => {
    _fire('recent-logs', []);
  },

  // Queue
  getQueueStatus: () => {
    _fire('queue-status', { count: offlineQueue.length });
  },
  clearQueue: () => {
    offlineQueue = [];
    _fire('queue-status', { count: 0 });
    _fire('log', { message: 'Cola limpiada', type: 'success' });
  },

  // Event listeners
  on: (channel, callback) => {
    return _on(channel, callback);
  },

  removeAllListeners: (channel) => {
    _listeners[channel] = [];
  }
};

console.log('[Mock] electronAPI mock loaded for E2E testing');
console.log('[Mock] Backend URL:', BACKEND_URL);

})(); // End IIFE
