const { io } = require('socket.io-client');

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_ACK_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_IMAGE_PREFIXES = ['image/', 'application/pdf', 'application/octet-stream'];
const IMAGE_FETCH_TIMEOUT_MS = 30_000;
// Reintentos de la DESCARGA de la imagen (no de la validación ni de una carga):
// un microcorte de red dejaba cada comprobante en revisión manual (2026-10-13).
const IMAGE_FETCH_RETRY_DELAYS_MS = [2_000, 5_000];
// Margen que se deja antes del timeout del backend para poder contestar a tiempo.
const BACKEND_DEADLINE_MARGIN_MS = 15_000;
const DEFAULT_BACKEND_TIMEOUT_MS = 60_000;

// Los 4xx (salvo 408/429) no se arreglan reintentando: el archivo no está o no es válido.
class NonRetryableFetchError extends Error {}

/**
 * Momento (epoch ms) en que hay que tener la respuesta lista. El backend manda su
 * timeout en `validationTimeoutMs`; se descuenta un margen para que la respuesta
 * llegue antes de que él corte.
 */
function computeDeadline(request, receivedAt) {
  const backendTimeout = Number(request?.validationTimeoutMs) > 0
    ? Number(request.validationTimeoutMs)
    : DEFAULT_BACKEND_TIMEOUT_MS;
  return receivedAt + Math.max(backendTimeout - BACKEND_DEADLINE_MARGIN_MS, 10_000);
}

async function fetchProofOnce(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!resp.ok) {
      const msg = `HTTP ${resp.status} fetching image from Cloudinary`;
      const retryable = resp.status >= 500 || resp.status === 408 || resp.status === 429;
      throw retryable ? new Error(msg) : new NonRetryableFetchError(msg);
    }
    // Validate Content-Type before downloading the body.
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ALLOWED_IMAGE_PREFIXES.some(prefix => contentType.startsWith(prefix))) {
      throw new NonRetryableFetchError(`Tipo de archivo no soportado: ${contentType || 'desconocido'}`);
    }
    // Validate Content-Length up front when present — saves us downloading bytes we'll reject.
    const declaredLen = parseInt(resp.headers.get('content-length') || '0', 10);
    if (declaredLen > 0 && declaredLen > MAX_IMAGE_BYTES) {
      throw new NonRetryableFetchError(`Imagen demasiado grande (${Math.round(declaredLen / 1024 / 1024)}MB, max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
    }
    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new NonRetryableFetchError(`Imagen demasiado grande (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB, max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
    }
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Descarga el comprobante reintentando ante errores de red / 5xx, siempre que el
 * reintento termine antes de `deadline`. Devuelve también los intentos hechos.
 */
async function fetchProofWithRetry(url, { deadline, logger, requestId } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const res = await fetchProofOnce(url);
      return { ...res, attempts: attempt };
    } catch (err) {
      const delay = IMAGE_FETCH_RETRY_DELAYS_MS[attempt - 1];
      const hasTime = deadline == null || Date.now() + delay + 5_000 < deadline;
      if (err instanceof NonRetryableFetchError || delay === undefined || !hasTime) {
        err.attempts = attempt;
        throw err;
      }
      logger?.warn('VALIDATION', `Image fetch attempt ${attempt} failed (${err.message}), retrying in ${delay}ms`, { requestId });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

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
  let heartbeatAckTimer = null;
  let lastHeartbeatAckAt = 0;
  // socket.io does NOT auto-reconnect after a manual socket.disconnect()
  // (Manager sets skipReconnect=true) NOR when the server closes us
  // ('io server disconnect'). Both cases would leave the app dead until the
  // operator clicks "Reconectar". We re-arm the connection ourselves — see
  // scheduleSelfReconnect() and its two call sites (heartbeat-ACK timeout and
  // the disconnect handler).
  let manualReconnectTimer = null;
  let manualReconnectAttempt = 0;
  let lastServerRejectionWasAuth = false;
  // Apagado definitivo (modo servidor, SIGTERM): no reconectar nunca más.
  let stopped = false;
  // Otro validador tomó el lugar: no reconectar solo. Un connectToBackend()
  // explícito (botón "Reconectar", reinicio) lo vuelve a habilitar.
  let replacedPause = false;
  // Desde cuándo está desconectado (null = conectado). Lo mira el vigilante del modo servidor.
  let disconnectedSince = Date.now();
  const MANUAL_RECONNECT_BASE_MS = 3_000;
  const MANUAL_RECONNECT_MAX_MS = 15_000;

  function clearManualReconnect() {
    if (manualReconnectTimer) {
      clearTimeout(manualReconnectTimer);
      manualReconnectTimer = null;
    }
  }

  // Re-arm the SAME socket after a disconnect that socket.io won't recover from
  // on its own. socket.connect() resets the Manager's skipReconnect and opens a
  // fresh engine; if that open fails the Manager's own retry loop takes over.
  // Backoff (shared attempt counter, reset on a successful 'connect') keeps us
  // from hammering the server while the stale peer is still being reaped.
  function scheduleSelfReconnect(context) {
    if (stopped || replacedPause) return;
    manualReconnectAttempt += 1;
    const delay = Math.min(
      MANUAL_RECONNECT_BASE_MS * Math.pow(2, manualReconnectAttempt - 1),
      MANUAL_RECONNECT_MAX_MS,
    );
    logger.warn('CONNECTION', `${context} — self-reconnecting in ${delay}ms (attempt ${manualReconnectAttempt})`);
    sendToRenderer('log', { message: 'Reconectando automaticamente...', type: 'info' });
    clearManualReconnect();
    manualReconnectTimer = setTimeout(() => {
      manualReconnectTimer = null;
      if (socket && !socket.connected) socket.connect();
    }, delay);
  }

  function connectToBackend() {
    if (stopped) return;
    replacedPause = false;
    // Any pending self-driven reconnect is now moot — we're (re)connecting.
    clearManualReconnect();
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
      disconnectedSince = null;
      reconnectionAttempt = 0; // Reset on successful connection
      // We're in — drop any self-driven reconnect state.
      manualReconnectAttempt = 0;
      lastServerRejectionWasAuth = false;
      clearManualReconnect();
      updateTray();
      logger.logConnection('connected', { socketId: socket.id });
      sendToRenderer('connection-status', { connected: true });
      sendToRenderer('log', { message: 'Conectado al servidor!', type: 'success' });

      // Start heartbeat emission with ACK timeout — drop the socket if the server stops acking.
      if (validatorHeartbeatInterval) clearInterval(validatorHeartbeatInterval);
      if (heartbeatAckTimer) { clearTimeout(heartbeatAckTimer); heartbeatAckTimer = null; }
      lastHeartbeatAckAt = Date.now();
      validatorHeartbeatInterval = setInterval(() => {
        if (!socket?.connected) return;
        // Interval (30s) > ACK timeout (10s), so at most one ack is ever in
        // flight; track it at socket scope so the disconnect handler can cancel
        // a stale one (otherwise it could fire ~10s after an unrelated
        // transport-close and kill a freshly reconnected socket).
        if (heartbeatAckTimer) { clearTimeout(heartbeatAckTimer); heartbeatAckTimer = null; }
        let acked = false;
        heartbeatAckTimer = setTimeout(() => {
          heartbeatAckTimer = null;
          if (acked || !socket?.connected) return;
          logger.warn('CONNECTION', `Heartbeat timeout (no ACK in ${HEARTBEAT_ACK_TIMEOUT_MS}ms) — forcing reconnect`);
          sendToRenderer('log', { message: 'Servidor no responde, reconectando...', type: 'warning' });
          try { socket.disconnect(); } catch (_) {}
          // socket.disconnect() sets skipReconnect=true — socket.io will NOT
          // auto-reconnect. Re-arm it ourselves.
          scheduleSelfReconnect('Heartbeat sin ACK del servidor');
        }, HEARTBEAT_ACK_TIMEOUT_MS);
        try {
          socket.emit('heartbeat', { timestamp: new Date().toISOString() }, () => {
            acked = true;
            lastHeartbeatAckAt = Date.now();
            if (heartbeatAckTimer) { clearTimeout(heartbeatAckTimer); heartbeatAckTimer = null; }
          });
        } catch (err) {
          if (heartbeatAckTimer) { clearTimeout(heartbeatAckTimer); heartbeatAckTimer = null; }
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
      // Clear timers first — before any await — so a racing reconnect doesn't
      // double-register them, and so a stale ack timer can't fire post-disconnect.
      if (validatorHeartbeatInterval) {
        clearInterval(validatorHeartbeatInterval);
        validatorHeartbeatInterval = null;
      }
      if (heartbeatAckTimer) { clearTimeout(heartbeatAckTimer); heartbeatAckTimer = null; }
      isConnected = false;
      if (disconnectedSince == null) disconnectedSince = Date.now();
      updateTray();
      logger.logConnection('disconnected', { reason });
      sendToRenderer('connection-status', { connected: false, error: `Desconectado: ${reason}` });

      // socket.io does NOT auto-reconnect when the server closed us
      // ('io server disconnect'). This happens when the gateway rejects a
      // reconnecting socket while a stale zombie of ourselves is still
      // registered (single-validator guard). Drive the reconnect ourselves.
      // Skip only auth rejections — retrying an invalid API key can't help.
      // (Other reasons — 'transport close', 'ping timeout' — are engine-level
      // and socket.io recovers on its own, so we don't touch those.)
      if (reason === 'io server disconnect' && !lastServerRejectionWasAuth) {
        scheduleSelfReconnect(`Server closed the socket ('${reason}')`);
      }
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
      const msg = error?.message || '';
      // 'Invalid API key' is terminal — reconnecting can't fix it, so flag it
      // to suppress the self-reconnect in the disconnect handler. Other server
      // rejections (e.g. 'Another validator is already connected') are transient
      // and SHOULD keep retrying until the stale peer is reaped and we take over.
      lastServerRejectionWasAuth = /invalid api key/i.test(msg);
      logger.error('SOCKET', 'Socket error', { error: msg });
      sendToRenderer('log', { message: `Error: ${msg}`, type: 'error' });
    });

    // El backend avisa que otro validador tomó el lugar (p. ej. la instancia nueva
    // de un deploy). No se reconecta: si se reconectara le sacaría el lugar a la
    // nueva y se pelearían. En modo servidor el vigilante reinicia el proceso si
    // queda mucho tiempo sin conexión, y ahí vuelve a entrar.
    socket.on('replaced', (data) => {
      replacedPause = true;
      clearManualReconnect();
      logger.warn('CONNECTION', 'Otro validador tomo el lugar; no se reconecta', data || {});
      sendToRenderer('log', { message: 'Otro validador se conecto y tomo el lugar. Este queda en pausa.', type: 'warning' });
      if (typeof deps.onReplaced === 'function') {
        try { deps.onReplaced(data); } catch (_) {}
      }
    });

    socket.on('connected', (data) => {
      logger.success('CONNECTION', 'Authenticated with backend', data);
      sendToRenderer('log', { message: 'Autenticado correctamente', type: 'success' });

      // Modo servidor: resultados que terminaron con el socket caído.
      if (typeof queueManager.flushPendingResults === 'function') {
        queueManager.flushPendingResults();
      }

      // Process offline queue if any
      const offlineQueue = queueManager.getOfflineQueue();
      if (offlineQueue.length > 0) {
        sendToRenderer('log', { message: `Hay ${offlineQueue.length} solicitudes en cola`, type: 'info' });
        setTimeout(() => queueManager.processOfflineQueue(), 2000);
      }
    });

    socket.on('validate', async (request) => {
      const receivedAt = Date.now();
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
            reasoning: `Pedido de validacion invalido (${validation.reason}). Requiere revision manual.`,
            error: `Invalid payload: ${validation.reason}`,
            flags: ['INVALID_PAYLOAD', 'REQUIRES_MANUAL_REVIEW'],
          });
        }
        sendToRenderer('log', { message: `Solicitud invalida (${validation.reason})`, type: 'warning' });
        return;
      }

      // Plazo para contestar (lo usa también el pipeline para cortar el OCR a tiempo).
      request._deadline = computeDeadline(request, receivedAt);

      // Ya resuelto o en curso: la cola se encarga (reenvía el resultado o lo ignora)
      // sin volver a descargar la imagen.
      if (typeof queueManager.isKnownValidation === 'function' && queueManager.isKnownValidation(request.id)) {
        queueManager.addToValidationQueue(request);
        return;
      }

      // 2. Fetch proof from URL if we don't have base64 already.
      if (request.imageUrl && !request.imageBase64) {
        try {
          logger.info('VALIDATION', `Fetching proof image from URL for ${request.id}`, { url: (request.imageUrl || '').substring(0, 80) });
          sendToRenderer('log', { message: `Descargando imagen desde Cloudinary...`, type: 'info' });

          const { buffer, contentType, attempts } = await fetchProofWithRetry(request.imageUrl, {
            deadline: request._deadline,
            logger,
            requestId: request.requestId,
          });
          request.imageBase64 = buffer.toString('base64');
          // Carry the discovered MIME so downstream PDF detection works even if backend didn't tag it.
          if (!request.mimeType) {
            if (contentType.startsWith('application/pdf')) request.mimeType = 'application/pdf';
            else if (contentType.startsWith('image/')) request.mimeType = contentType;
          }

          logger.info('VALIDATION', `Image fetched (${Math.round(buffer.length / 1024)}KB, ${contentType}, ${attempts} attempt(s))`, { requestId: request.id });
        } catch (fetchError) {
          logger.error('VALIDATION', `Failed to fetch image from URL: ${fetchError.message}`, {
            requestId: request.id,
            attempts: fetchError.attempts,
          });
          queueManager.emitValidationResult(request, {
            isValid: false,
            confidence: 0,
            reasoning: `No se pudo descargar el comprobante (${fetchError.message}). Requiere revision manual.`,
            error: `Failed to download proof image: ${fetchError.message}`,
            flags: ['IMAGE_FETCH_ERROR', 'REQUIRES_MANUAL_REVIEW'],
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
          reasoning: 'El pedido llego sin imagen. Requiere revision manual.',
          error: 'No image data provided',
          flags: ['NO_IMAGE', 'REQUIRES_MANUAL_REVIEW'],
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

  function disconnect({ permanent = false } = {}) {
    // Intentional disconnect — cancel any pending self-reconnect so we don't
    // race back up after the caller asked us to go down.
    if (permanent) stopped = true;
    clearManualReconnect();
    if (socket) {
      socket.disconnect();
      isConnected = false;
      if (validatorHeartbeatInterval) {
        clearInterval(validatorHeartbeatInterval);
        validatorHeartbeatInterval = null;
      }
      if (heartbeatAckTimer) { clearTimeout(heartbeatAckTimer); heartbeatAckTimer = null; }
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
    getDisconnectedSince: () => disconnectedSince,
  };
}

module.exports = { createConnection, computeDeadline, fetchProofWithRetry };
