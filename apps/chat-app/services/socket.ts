import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import { useRequestStore, getRequestIdForChat } from '@/stores/request.store';
import { getToken } from '@/services/api';

// Browser notification helper — only active on web
function notifyBrowser(title: string, body: string, data?: Record<string, any>) {
  if (Platform.OS !== 'web') return;
  try {
    const { showBrowserNotification } = require('@/services/notifications.web');
    showBrowserNotification(title, body, data);
  } catch { /* web module not available */ }
}

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'http://localhost:3000';
const SOCKET_PATH = process.env.EXPO_PUBLIC_SOCKET_PATH || '/socket.io';
const SOCKET_RECONNECTION = process.env.EXPO_PUBLIC_SOCKET_RECONNECTION !== 'false';
const SOCKET_RECONNECTION_ATTEMPTS = parseInt(process.env.EXPO_PUBLIC_SOCKET_RECONNECTION_ATTEMPTS ?? '15', 10);
const SOCKET_RECONNECTION_DELAY = parseInt(process.env.EXPO_PUBLIC_SOCKET_RECONNECTION_DELAY || '1000', 10);
const SOCKET_RECONNECTION_DELAY_MAX = 30000;

let socket: Socket | null = null;
let typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Event types
export interface RequestStatusUpdate {
  requestId: string;
  status: string;
  proofUrl?: string;
  validationScore?: number;
  reason?: string;
  discoveryStatus?: 'SEARCHING' | 'FOUND' | 'NOT_FOUND' | 'NO_BOTS';
  message?: string;
}

export interface MessageReceived {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  imageUrl?: string;
  type: 'USER' | 'OPERATOR' | 'SYSTEM';
  createdAt: string;
  isRead?: boolean;
  sender?: {
    id: string;
    email: string;
    role: string;
  };
}

export interface ValidationEvent {
  requestId: string;
  score?: number;
  error?: string;
}

export interface JobEvent {
  requestId: string;
  jobId: string;
  status: string;
  result?: string;
  error?: string;
}

// Connect socket
export const connectSocket = (token: string) => {
  // Clean up existing socket completely
  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  // Connect to /chats namespace (dedicated for chat app)
  // Use auth function so Socket.IO fetches a fresh token on each reconnect attempt
  // (prevents stale JWT after long idle sessions).
  // If getToken() returns null the user was logged out — DON'T fall back to the
  // stale `token` captured at connect() time; pass null so backend rejects the
  // handshake instead of reauthorizing with a dead session.
  socket = io(`${SOCKET_URL}/chats`, {
    path: SOCKET_PATH,
    auth: async (cb) => {
      const freshToken = await getToken().catch(() => null);
      cb({ token: freshToken });
    },
    transports: ['websocket'],
    reconnection: SOCKET_RECONNECTION,
    reconnectionAttempts: SOCKET_RECONNECTION_ATTEMPTS,
    reconnectionDelay: SOCKET_RECONNECTION_DELAY,
    reconnectionDelayMax: SOCKET_RECONNECTION_DELAY_MAX,
  });

  // CA6: Ensure reconnection is enabled on fresh socket
  socket.io.opts.reconnection = SOCKET_RECONNECTION;

  // Connection events
  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket?.id);
    useRequestStore.getState().setConnectionError(false);
  });

  socket.on('connect_error', (error: any) => {
    console.error('[Socket] Connection error:', error.message || error);
    const msg = error.message || '';
    if (
      msg.includes('Authentication') ||
      msg.includes('Unauthorized') ||
      msg.includes('Invalid token') ||
      msg.includes('jwt')
    ) {
      console.warn('[Socket] Auth error, disconnecting');
      // CA6: Don't mutate Manager opts — just disconnect cleanly.
      // A fresh socket will be created on re-login via connectSocket().
      disconnectSocket();
      try {
        const { useAuthStore } = require('@/stores/auth.store');
        if (useAuthStore.getState().isAuthenticated) {
          useAuthStore.setState({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: 'Sesión expirada. Por favor, volvé a iniciar sesión.',
            balance: 0,
            hasCheckedAuth: true,
          });
        }
      } catch (e) {
        /* ignore */
      }
    }
  });

  socket.on('disconnect', (reason: string) => {
    console.log('[Socket] Disconnected:', reason);
  });

  // Reconnection events
  socket.io.on('reconnect', async (attempt: number) => {
    console.log(`[Socket] Reconnected after ${attempt} attempt(s)`);
    useRequestStore.getState().setConnectionError(false);
    // Refresh stale data after reconnection — await to prevent race conditions
    try {
      await Promise.all([
        useRequestStore.getState().fetchRequests(),
        (async () => {
          const { useAuthStore } = require('@/stores/auth.store');
          await useAuthStore.getState().refreshBalance();
        })(),
      ]);
    } catch (e) {
      console.warn('[Socket] Failed to refresh data on reconnect:', e);
    }
  });

  socket.io.on('reconnect_attempt', (attempt: number) => {
    console.log(`[Socket] Reconnection attempt #${attempt}`);
  });

  socket.io.on('reconnect_failed', () => {
    console.error('[Socket] Reconnection failed after all attempts');
    useRequestStore.getState().setConnectionError(true);
    // Don't reset auth — token may still be valid.
    // User can manually retry by pulling to refresh or navigating.
    // Socket will reconnect when connectSocket() is called again
    // (e.g., on app foreground, pull-to-refresh, or manual retry).
  });

  // ==========================================
  // REQUEST STATUS EVENTS
  // ==========================================

  // Legacy event name (for backward compatibility with /chats namespace)
  socket.on('request_status_update', (data: RequestStatusUpdate) => {
    console.log('[Socket] Request status update:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: data.status,
      proofUrl: data.proofUrl,
      validationScore: data.validationScore,
    });
  });

  // Standard event name (main namespace format)
  socket.on('request:updated', (data: RequestStatusUpdate) => {
    console.log('[Socket] Request updated:', data);
    const updates: Record<string, any> = {
      status: data.status,
      proofUrl: data.proofUrl,
      validationScore: data.validationScore,
    };
    if (data.discoveryStatus) {
      updates.discoveryStatus = data.discoveryStatus;
    }
    if (data.message) {
      updates.discoveryMessage = data.message;
    }
    useRequestStore.getState().updateRequest(data.requestId, updates);
  });

  socket.on('request:created', (data: any) => {
    console.log('[Socket] Request created:', data);
    // Refresh requests list
    useRequestStore.getState().fetchRequests();
  });

  socket.on('request:completed', (data: any) => {
    console.log('[Socket] Request completed:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'COMPLETED',
    });
    notifyBrowser('Fichas cargadas!', 'Tus fichas ya estan en tu cuenta.', { requestId: data.requestId });
  });

  // ==========================================
  // MESSAGE EVENTS
  // ==========================================

  // Legacy event name (for backward compatibility)
  socket.on('message_received', (data: { requestId: string; message: MessageReceived }) => {
    console.log('[Socket] Message received (legacy):', data);
    useRequestStore.getState().addMessage(data.requestId, data.message);
  });

  // Standard event name (main namespace format)
  socket.on('message:new', (message: MessageReceived) => {
    console.log('[Socket] New message:', message);
    useRequestStore.getState().handleNewMessage(message);
    // Browser notification for operator messages (when tab is in background)
    if (message.type === 'OPERATOR') {
      notifyBrowser('Nuevo mensaje', message.content || 'Tenes un mensaje nuevo', { chatId: message.chatId });
    }
  });

  // ==========================================
  // VALIDATION EVENTS
  // ==========================================

  socket.on('validation:started', (data: ValidationEvent) => {
    console.log('[Socket] Validation started:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'VALIDATING',
    });
  });

  socket.on('validation:completed', (data: ValidationEvent) => {
    console.log('[Socket] Validation completed:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'APPROVED',
      validationScore: data.score,
    });
  });

  socket.on('validation:failed', (data: ValidationEvent) => {
    console.log('[Socket] Validation failed:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'VALIDATION_FAILED',
      validationError: data.error,
    });
    notifyBrowser('Validacion fallida', 'No pudimos validar tu comprobante. Un operador lo revisara.', { requestId: data.requestId });
  });

  // Messages read (cross-device sync)
  socket.on('messages:read', (data: { chatId: string; readBy: string; count: number }) => {
    const requestId = getRequestIdForChat(data.chatId);
    if (requestId) {
      useRequestStore.getState().updateRequest(requestId, { unreadCount: 0 });
    }
  });

  // ==========================================
  // JOB EVENTS
  // ==========================================

  socket.on('job:started', (data: JobEvent) => {
    console.log('[Socket] Job started:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'PROCESSING',
    });
  });

  socket.on('job:progress', (data: { requestId: string; step?: string; progress?: number }) => {
    console.log('[Socket] Job progress:', data);
    if (data.requestId) {
      useRequestStore.getState().updateRequest(data.requestId, {
        jobProgress: data,
      });
    }
  });

  socket.on('job:completed', (data: JobEvent) => {
    console.log('[Socket] Job completed:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'COMPLETED',
    });
    notifyBrowser('Fichas cargadas!', 'Tus fichas ya estan en tu cuenta.', { requestId: data.requestId });
    // (Internal balance tracking removed — real balance is on the gaming panel.)
  });

  socket.on('job:failed', (data: JobEvent) => {
    console.log('[Socket] Job failed:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'FAILED',
    });
    notifyBrowser('Error en la carga', 'Hubo un problema. Un operador va a revisarlo.', { requestId: data.requestId });
  });

  // ==========================================
  // REJECTION EVENT
  // ==========================================

  socket.on('request:rejected', (data: RequestStatusUpdate) => {
    console.log('[Socket] Request rejected:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'REJECTED',
    });
    notifyBrowser('Solicitud rechazada', 'Tu solicitud fue rechazada. Revisa el chat.', { requestId: data.requestId });
  });

  // ==========================================
  // PROMO EVENTS
  // ==========================================

  socket.on('promo', (data: { title: string; message: string }) => {
    console.log('[Socket] Promo received:', data);
    // Show native alert when app is in foreground
    const { Alert } = require('react-native');
    Alert.alert(data.title || 'Tio Rico', data.message || '');
  });

  // ==========================================
  // PROOF EVENTS
  // ==========================================

  socket.on('proof:uploaded', (data: { requestId: string; proofUrl: string }) => {
    console.log('[Socket] Proof uploaded:', data);
    useRequestStore.getState().updateRequest(data.requestId, {
      status: 'VALIDATING',
      proofUrl: data.proofUrl,
    });
  });

  // NOTE: chat:operator_assigned listener removed — backend does not emit this event

  // ==========================================
  // PRIZE PAYMENT EVENTS
  // ==========================================

  socket.on('prize_claim:payment_sent', (data: { prizeClaimId: string; operationNumber?: string; message: string }) => {
    console.log('[Socket] Prize payment sent:', data);
    const { Alert } = require('react-native');
    Alert.alert(
      'Premio Pagado!',
      data.message || 'Tu premio fue transferido a tu cuenta.',
    );
  });

  // ==========================================
  // TYPING EVENTS
  // ==========================================

  socket.on('operator_typing', (data: { chatId: string; userId: string }) => {
    useRequestStore.getState().setTypingIndicator(data.chatId, true);
    // Auto-clear per chatId after 3 seconds of no further typing event
    const existing = typingTimers.get(data.chatId);
    if (existing) clearTimeout(existing);
    typingTimers.set(data.chatId, setTimeout(() => {
      useRequestStore.getState().setTypingIndicator(data.chatId, false);
      typingTimers.delete(data.chatId);
    }, 3000));
  });

  // ==========================================
  // ERROR HANDLING
  // ==========================================

  socket.on('unauthorized', (msg: string) => {
    console.warn('[Socket] Unauthorized:', msg);
    disconnectSocket();
    // Auth store should handle logout
  });

  socket.on('error', (error: any) => {
    console.error('[Socket] Error:', error);
  });
};

// Disconnect socket
export const disconnectSocket = () => {
  // Clear all typing timers and reset indicators
  typingTimers.forEach((timer, chatId) => {
    clearTimeout(timer);
    useRequestStore.getState().setTypingIndicator(chatId, false);
  });
  typingTimers = new Map();

  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
    console.log('[Socket] Manually disconnected');
  }
};

// Send message via socket (with chatId, optionally tagged with requestId and/or imageUrl)
export const sendMessage = (
  chatId: string,
  content: string,
  requestId?: string,
  imageUrl?: string | ((ack: any) => void),
  callback?: (ack: any) => void
) => {
  // Support old 4-arg signature: sendMessage(chatId, content, requestId, callback)
  if (typeof imageUrl === 'function') {
    callback = imageUrl;
    imageUrl = undefined;
  }

  if (!socket?.connected) {
    console.error('[Socket] Not connected - cannot send message');
    return false;
  }

  socket.emit('send_message', {
    chatId,
    content,
    ...(requestId && { requestId }),
    ...(imageUrl && { imageUrl }),
  }, (ack: any) => {
    if (callback) callback(ack);
  });
  return true;
};

// Join a specific chat room
export const joinChat = (chatId: string) => {
  if (!socket?.connected) {
    console.error('[Socket] Not connected - cannot join chat');
    return false;
  }

  socket.emit('join_chat', { chatId });
  console.log('[Socket] Joined chat:', chatId);
  return true;
};

// Leave a specific chat room
export const leaveChat = (chatId: string) => {
  if (!socket?.connected) {
    return false;
  }

  socket.emit('leave_chat', { chatId });
  console.log('[Socket] Left chat:', chatId);
  return true;
};

// Send typing indicator
export const sendTyping = (chatId: string) => {
  if (!socket?.connected) {
    return false;
  }

  socket.emit('typing', { chatId });
  return true;
};

// Check connection
export const isSocketConnected = (): boolean => {
  return socket?.connected ?? false;
};

// Get socket instance (for advanced use)
export const getSocket = (): Socket | null => socket;
