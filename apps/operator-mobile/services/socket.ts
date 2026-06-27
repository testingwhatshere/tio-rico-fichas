import { io, Socket } from 'socket.io-client';

// ============================================
// Types
// ============================================

export interface SocketConfig {
  backendUrl: string;
  apiKey: string;
  operatorName: string;
}

// ============================================
// Module state
// ============================================

let socket: Socket | null = null;
let currentConfig: SocketConfig | null = null;

// ============================================
// Connection management
// ============================================

/**
 * Create and connect a Socket.IO client to the /operator namespace.
 * If already connected, disconnects the existing socket first.
 *
 * Returns the socket instance.
 */
export function connectSocket(config: SocketConfig, autoStart = true): Socket {
  // Tear down existing connection
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  currentConfig = config;

  const url = `${config.backendUrl.replace(/\/+$/, '')}/operator`;

  socket = io(url, {
    auth: {
      apiKey: config.apiKey,
      operatorName: config.operatorName,
    },
    // Allow fallback to long-polling on networks that block WebSocket upgrades
    // (some corporate / mobile carriers do). Without this the app silently
    // never connects even though HTTP works fine.
    transports: ['websocket', 'polling'],
    reconnection: true,
    // Infinity: si el teléfono pierde red un rato largo, el socket tiene que
    // volver solo — con un límite, la app quedaba muda hasta reiniciarla.
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    timeout: 20000,
    // Prevent auto-connect; we call connect() explicitly below
    // so callers can attach handlers before connection fires.
    autoConnect: false,
  });

  // ---- Logging (non-intrusive) ----
  socket.on('connect', () => {
    console.log('[Socket] Connected to /operator');
    // Request initial data payload from backend
    socket?.emit('get_initial_data');
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  socket.io.on('reconnect', (attempt) => {
    console.log('[Socket] Reconnected after', attempt, 'attempts');
    // Re-request fresh data after reconnect
    socket?.emit('get_initial_data');
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    console.log('[Socket] Reconnect attempt', attempt);
  });

  socket.io.on('reconnect_failed', () => {
    console.warn('[Socket] Reconnection failed after max attempts');
  });

  // Connect now unless caller wants to register listeners first
  if (autoStart) {
    socket.connect();
  }

  return socket;
}

/**
 * Cleanly disconnect the current socket.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  currentConfig = null;
}

/**
 * Get the current socket instance, or null if not connected.
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Returns true if the socket exists and is currently connected.
 */
export function isConnected(): boolean {
  return !!socket?.connected;
}

// ============================================
// Emit with timeout
// ============================================

/**
 * Emit an event and wait for a server acknowledgement.
 * Rejects if no ack is received within `timeoutMs`.
 *
 * Usage:
 *   const result = await emitWithTimeout('approve_request', { requestId });
 */
export function emitWithTimeout<T = any>(
  event: string,
  data: any,
  timeoutMs: number = 10000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      return reject(new Error('Socket not connected'));
    }

    const timer = setTimeout(() => {
      reject(new Error(`Timeout: no ack for "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.emit(event, data, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

// ============================================
// Test connection (one-shot)
// ============================================

/**
 * Test socket connectivity by creating a temporary socket, waiting for
 * connect or error, then immediately disconnecting. Useful for the
 * login/setup screen before committing to a full connection.
 */
export function testSocketConnection(
  config: SocketConfig,
  timeoutMs: number = 10000,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const url = `${config.backendUrl.replace(/\/+$/, '')}/operator`;

    const testSocket = io(url, {
      auth: {
        apiKey: config.apiKey,
        operatorName: config.operatorName,
      },
      // Allow fallback to long-polling on networks that block WebSocket upgrades
    // (some corporate / mobile carriers do). Without this the app silently
    // never connects even though HTTP works fine.
    transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: timeoutMs,
    });

    const timer = setTimeout(() => {
      testSocket.disconnect();
      resolve({ success: false, error: 'Connection timed out' });
    }, timeoutMs);

    testSocket.on('connect', () => {
      clearTimeout(timer);
      testSocket.disconnect();
      resolve({ success: true });
    });

    testSocket.on('connect_error', (err) => {
      clearTimeout(timer);
      testSocket.disconnect();
      resolve({ success: false, error: err.message || 'Connection failed' });
    });

    testSocket.on('error', (data: any) => {
      clearTimeout(timer);
      testSocket.disconnect();
      resolve({
        success: false,
        error: data?.message || 'Server error',
      });
    });
  });
}
