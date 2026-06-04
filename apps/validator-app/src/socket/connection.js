const { io } = require('socket.io-client');

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_ACK_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_IMAGE_PREFIXES = ['image/', 'application/pdf', 'application/octet-stream'];

function isValidProofUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  let parsed;
  try { parsed = new URL(raw); } catch (_) { return false; }
  // Only http(s) — never data:, file:, chrome:, javascript:
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function isValidValidationPayload(req) {
  if (!req || typeof req !== 'object') return { ok: false, reason: 'payload_not_object' };
  if (!req.id || typeof req.id !== 'string') return { ok: false, reason: 'missing_id' };
  // Must have either imageUrl or imageBase64.
  if (req.imageUrl !== undefined && !isValidProofUrl(req.imageUrl)) {
    return { ok: false, reason: 'invalid_imageUrl_scheme' };
  }
  if (req.imageBase64 !== undefined && typeof req.imageBase64 !== 'string') {
    return { ok: false, reason: 'invalid_imageBase64' };
  }
  if (!req.imageUrl && !req.imageBase64) {
    return { ok: false, reason: 'missing_image' };
  }
  if (req.expectedAmount !== undefined && req.expectedAmount !== null) {
    const n = Number(req.expectedAmount);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'invalid_expectedAmount' };
  }
  return { ok: true };
}

function createConnection(deps) {
  const { config, logger, sendToRenderer, queueManager, updateTray, ollamaManager } = deps;

  let socket = null;
  let isConnected = false;
  let isConnecting = false;
  let reconnectionAttempt = 0;
  let validatorHeartbeatInterval = null;
  let lastHeartbeatAckAt = 0;

  function connectToBackend() {
    if (isConnecting) {
      logger.info('CONNECTION', 'Connection attempt already in progress, skipping');
      return;
    }
    isConnecting = true;

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }

    if (!config.backendUrl || !config.apiKey) {
      isConnecting = false;
      sendToRenderer('connection-status', {
        connected: false,
        error: 'Falta configuracion',
      });
      return;
    }

    const wsUrl = config.backendUrl.replace(/\/$/, '');

    // Configure logger with backend
    logger.setBackendConfig(config.backendUrl, config.apiKey);
    logger.logAppEvent('Connecting to backend', { url: wsUrl });

    sendToRenderer('log', { message: 'Conectando al servidor...', type: 'info' });

    socket = io(`${wsUrl}/validator`, {
      auth: { apiKey: config.apiKey },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000, // Start with 1 second
      reconnectionDelayMax: 30000, // Max 30 seconds
      reconnectionAttempts: Infinity, // Critical service — never stop retrying
      timeout: 10000,
    });

    socket.on('connect', () => {
      isConnecting = false;
      isConnected = true;
      reconnectionAttempt = 0; // Reset on successful connection
      updateTray();
      logger.logConnection('connected', { socketId: socket.id });
      sendToRenderer('connection-status', { connected: true });
      sendToRenderer('log', { message: 'Conectado al servidor!', type: 'success' });

      // Start heartbeat emission with ACK timeout — drop the socket if the server stops acking.
      if (validatorHeartbeatInterval) clearInterval(validatorHeartbeatInterval);
      lastHeartbeatAckAt = Date.now();
      validatorHeartbeatInterval = setInterval(() => {
        if (!socket?.connected) return;
        let acked = false;
        const ackTimer = setTimeout(() => {
          if (acked) return;
          logger.warn('CONNECTION', `Heartbeat timeout (no ACK in ${HEARTBEAT_ACK_TIMEOUT_MS}ms) — forcing reconnect`);
          sendToRenderer('log', { message: 'Servidor no responde, reconectando...', type: 'warning' });
          try { socket.disconnect(); } catch (_) {}
          // socket.io will fire reconnect_attempt automatically.
        }, HEARTBEAT_ACK_TIMEOUT_MS);
        try {
          socket.emit('heartbeat', { timestamp: new Date().toISOString() }, () => {
            acked = true;
            lastHeartbeatAckAt = Date.now();
            clearTimeout(ackTimer);
          });
        } catch (err) {
          clearTimeout(ackTimer);
          logger.warn('CONNECTION', `Heartbeat emit failed: ${err.message}`);
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    // Track reconnection attempts with exponential backoff
    socket.io.on('reconnect_attempt', (attempt) => {
      reconnectionAttempt = attempt;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      logger.info('CONNECTION', `Reconnection attempt ${attempt}, next delay: ${delay}ms`);
      sendToRenderer('log', {
        message: `Intentando reconectar (${attempt})...`,
        type: 'warning'
      });

      // Show notification after 5 failed attempts
      if (attempt === 5) {
        sendToRenderer('log', {
          message: 'Multiples fallos de conexion. Verifica que el backend este en linea.',
          type: 'error'
        });
      }
    });

    socket.on('disconnect', (reason) => {
      // Clear timer first — before any await — so a racing reconnect doesn't double-register it.
      if (validatorHeartbeatInterval) {
        clearInterval(validatorHeartbeatInterval);
        validatorHeartbeatInterval = null;
      }
      isConnected = false;
      updateTray();
      logger.logConnection('disconnected', { reason });
      sendToRenderer('connection-status', { connected: false, error: `Desconectado: ${reason}` });
    });

    socket.on('connect_error', (error) => {
      isConnecting = false;
      isConnected = false;
      updateTray();
      logger.error('CONNECTION', 'Connection error', { error: error.message });
      sendToRenderer('connection-status', { connected: false, error: error.message });
      sendToRenderer('log', { message: `Error de conexion: ${error.message}`, type: 'error' });
    });

    socket.on('error', (error) => {
      logger.error('SOCKET', 'Socket error', { error: error.message });
      sendToRenderer('log', { message: `Error: ${error.message}`, type: 'error' });
    });

    socket.on('connected', (data) => {
      logger.success('CONNECTION', 'Authenticated with backend', data);
      sendToRenderer('log', { message: 'Autenticado correctamente', type: 'success' });

      // Process offline queue if any
      const offlineQueue = queueManager.getOfflineQueue();
      if (offlineQueue.length > 0) {
        sendToRenderer('log', { message: `Hay ${offlineQueue.length} solicitudes en cola`, type: 'info' });
        setTimeout(() => queueManager.processOfflineQueue(), 2000);
      }
    });

    socket.on('validate', async (request) => {
      // 1. Strict payload validation — never trust the wire blindly.
      const validation = isValidValidationPayload(request);
      if (!validation.ok) {
        logger.warn('VALIDATION', `Invalid validate payload (${validation.reason})`, {
          requestId: request?.id,
          hasUrl: !!request?.imageUrl,
          hasBase64: !!request?.imageBase64,
        });
        // Only emit if we at least know the request id; otherwise drop silently to avoid amplifying garbage.
        if (request?.id && typeof request.id === 'string') {
          queueManager.emitValidationResult(request, {
            isValid: false,
            confidence: 0,
            error: `Invalid payload: ${validation.reason}`,
            flags: ['INVALID_PAYLOAD'],
          });
        }
        sendToRenderer('log', { message: `Solicitud invalida (${validation.reason})`, type: 'warning' });
        return;
      }

      // 2. Fetch proof from URL if we don't have base64 already.
      if (request.imageUrl && !request.imageBase64) {
        try {
          logger.info('VALIDATION', `Fetching proof image from URL for ${request.id}`, { url: (request.imageUrl || '').substring(0, 80) });
          sendToRenderer('log', { message: `Descargando imagen desde Cloudinary...`, type: 'info' });

          const fetchController = new AbortController();
          const fetchTimeoutId = setTimeout(() => fetchController.abort(), 30000);
          let fetchResp;
          try {
            fetchResp = await fetch(request.imageUrl, { signal: fetchController.signal, redirect: 'follow' });
          } finally {
            clearTimeout(fetchTimeoutId);
          }
          if (!fetchResp.ok) {
            throw new Error(`HTTP ${fetchResp.status} fetching image from Cloudinary`);
          }
          // Validate Content-Type before downloading the body.
          const contentType = (fetchResp.headers.get('content-type') || '').toLowerCase();
          const ctOk = ALLOWED_IMAGE_PREFIXES.some(prefix => contentType.startsWith(prefix));
          if (!ctOk) {
            throw new Error(`Tipo de archivo no soportado: ${contentType || 'desconocido'}`);
          }
          // Validate Content-Length up front when present — saves us downloading bytes we'll reject.
          const declaredLen = parseInt(fetchResp.headers.get('content-length') || '0', 10);
          if (declaredLen > 0 && declaredLen > MAX_IMAGE_BYTES) {
            throw new Error(`Imagen demasiado grande (${Math.round(declaredLen / 1024 / 1024)}MB, max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
          }
          const arrayBuffer = await fetchResp.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
            throw new Error(`Imagen demasiado grande (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB, max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
          }
          request.imageBase64 = Buffer.from(arrayBuffer).toString('base64');
          // Carry the discovered MIME so downstream PDF detection works even if backend didn't tag it.
          if (!request.mimeType) {
            if (contentType.startsWith('application/pdf')) request.mimeType = 'application/pdf';
            else if (contentType.startsWith('image/')) request.mimeType = contentType;
          }

          logger.info('VALIDATION', `Image fetched (${Math.round(arrayBuffer.byteLength / 1024)}KB, ${contentType})`, { requestId: request.id });
        } catch (fetchError) {
          logger.error('VALIDATION', `Failed to fetch image from URL: ${fetchError.message}`, { requestId: request.id });
          queueManager.emitValidationResult(request, {
            isValid: false,
            confidence: 0,
            error: `Failed to download proof image: ${fetchError.message}`,
            flags: ['IMAGE_FETCH_ERROR'],
          });
          sendToRenderer('log', { message: `Error descargando imagen: ${fetchError.message}`, type: 'error' });
          return;
        }
      }

      // 3. Final guard — should be covered by step 1 but defense-in-depth.
      if (!request.imageBase64) {
        logger.warn('VALIDATION', 'Received validation request with no image data', { requestId: request.id });
        queueManager.emitValidationResult(request, {
          isValid: false,
          confidence: 0,
          error: 'No image data provided',
          flags: ['NO_IMAGE'],
        });
        sendToRenderer('log', { message: `Solicitud ${(request.id || '').slice(0, 8)} sin imagen, rechazada`, type: 'warning' });
        return;
      }

      // 4. OCR-first flow always runs (works without Ollama). Ollama is only needed as fallback;
      //    the pipeline decides per-job whether to fall back. So we don't gate the entire request
      //    on ollama availability anymore — let the pipeline try OCR first.
      queueManager.addToValidationQueue(request);
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      isConnected = false;
      if (validatorHeartbeatInterval) {
        clearInterval(validatorHeartbeatInterval);
        validatorHeartbeatInterval = null;
      }
      updateTray();
      sendToRenderer('connection-status', { connected: false });
    }
  }

  function getSocket() {
    return socket;
  }

  function getIsConnected() {
    return isConnected;
  }

  return {
    connectToBackend,
    disconnect,
    getSocket,
    getIsConnected,
  };
}

module.exports = { createConnection };
