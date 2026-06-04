import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestsApi, messagesApi } from '@/services/api';
import { parseAmount } from '@/utils/amount';

import { Platform } from 'react-native';
import { WIDGET_DATA_KEY } from '@/widgets';

const HIDDEN_REQUESTS_KEY = '@tiorico/hidden_requests';

const MAX_BUFFER_PER_CHAT = 50;
const BUFFER_EXPIRE_MS = 300000; // 5 minutes

// Sync active request state to AsyncStorage for Android widgets
const ACTIVE_STATUSES_FOR_WIDGET = ['PENDING_PROOF', 'VALIDATING', 'PENDING_MP_VERIFICATION', 'APPROVED', 'PROCESSING', 'VALIDATION_FAILED', 'FAILED'];

function syncWidgetData(requests: Record<string, any>) {
  if (Platform.OS !== 'android') return;
  try {
    const active = Object.values(requests).find(
      (r: any) => ACTIVE_STATUSES_FOR_WIDGET.includes(r.status),
    );
    const widgetData = active
      ? { status: active.status, amount: String(active.amount || ''), targetUsername: active.targetUsername || '' }
      : {};
    AsyncStorage.setItem(WIDGET_DATA_KEY, JSON.stringify(widgetData)).then(() => {
      // Trigger widget update if library is available
      try {
        const { requestWidgetUpdate } = require('react-native-android-widget');
        requestWidgetUpdate({ widgetName: 'Status' }).catch(() => {});
        requestWidgetUpdate({ widgetName: 'Dashboard' }).catch(() => {});
      } catch { /* widget lib not available on web/ios */ }
    }).catch(() => {});
  } catch { /* ignore sync errors */ }
}

interface InteractiveCard {
  type: 'AMOUNT_SELECTOR' | 'PAYMENT_DETAILS' | 'PROOF_UPLOAD' | 'STATUS_TRACKER' | 'GAME_LINK';
  props: any;
  isDisabled?: boolean;
}

interface Message {
  id: string;
  type: 'SYSTEM' | 'USER' | 'OPERATOR';
  content: string;
  imageUrl?: string;
  senderId: string;
  chatId?: string;
  createdAt: string;
  isRead?: boolean;
  interactiveCard?: InteractiveCard;
  sender?: {
    id: string;
    email: string;
    role: string;
    displayName?: string;
  };
}

interface Request {
  id: string;
  targetUsername: string;
  amount: number;
  status: string;
  proofUrl?: string;
  validationScore?: number;
  validationError?: string;
  chatId?: string;
  panelId?: string;
  discoveryStatus?: 'SEARCHING' | 'FOUND' | 'NOT_FOUND' | 'NO_BOTS';
  discoveryMessage?: string;
  createdAt: string;
  unreadCount?: number;
  hasOperatorMessage?: boolean;
}

interface RequestState {
  requests: Record<string, Request>;
  messages: Record<string, Message[]>;
  messageCursors: Record<string, string | undefined>;
  messageHasMore: Record<string, boolean>;
  hiddenRequestIds: Set<string>;
  typingIndicators: Record<string, boolean>;
  connectionError: boolean;
  isLoading: boolean;
  error: string | null;

  // Previously module-level maps, now in store
  chatToRequestMap: Record<string, string>;
  pendingMessageBuffer: Record<string, Message[]>;
  // Timer IDs stored as numbers (ReturnType<typeof setTimeout>) — managed outside
  // of Zustand state to avoid serialization issues. We keep a record of chatIds
  // that have active timers so clearBuffers can cancel them.
  _bufferTimerIds: Record<string, ReturnType<typeof setTimeout>>;

  // Actions
  setConnectionError: (connectionError: boolean) => void;
  setRequests: (requests: Request[]) => void;
  updateRequest: (requestId: string, updates: Partial<Request>) => void;
  addMessage: (requestId: string, message: Message) => void;
  updateMessage: (requestId: string, messageId: string, updates: Partial<Message>) => void;
  setMessages: (requestId: string, messages: Message[]) => void;
  clearMessages: (requestId: string) => void;
  fetchRequests: () => Promise<void>;
  handleNewMessage: (message: Message) => void;
  registerChatForRequest: (chatId: string, requestId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  loadMoreMessages: (requestId: string) => Promise<void>;
  setMessagePagination: (requestId: string, cursor: string | undefined, hasMore: boolean) => void;
  setTypingIndicator: (chatId: string, isTyping: boolean) => void;
  // Hidden requests actions
  hideRequest: (requestId: string) => Promise<void>;
  unhideRequest: (requestId: string) => Promise<void>;
  loadHiddenRequests: () => Promise<void>;
  isRequestHidden: (requestId: string) => boolean;
  // Buffer/map management actions
  bufferMessage: (chatId: string, message: Message) => void;
  flushBuffer: (chatId: string, requestId: string) => void;
  clearAllMaps: () => void;
}

export const useRequestStore = create<RequestState>((set, get) => ({
  requests: {},
  messages: {},
  messageCursors: {},
  messageHasMore: {},
  hiddenRequestIds: new Set(),
  typingIndicators: {},
  connectionError: false,
  isLoading: false,
  error: null,

  // Previously module-level maps
  chatToRequestMap: {},
  pendingMessageBuffer: {},
  _bufferTimerIds: {},

  setConnectionError: (connectionError) => set({ connectionError }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  // Load hidden requests from AsyncStorage
  loadHiddenRequests: async () => {
    try {
      const stored = await AsyncStorage.getItem(HIDDEN_REQUESTS_KEY);
      if (stored) {
        const ids = JSON.parse(stored) as string[];
        set({ hiddenRequestIds: new Set(ids) });
      }
    } catch (error) {
      console.error('[RequestStore] Failed to load hidden requests:', error);
    }
  },

  // Hide a request (soft delete)
  hideRequest: async (requestId) => {
    try {
      const { hiddenRequestIds } = get();
      const newHiddenIds = new Set(hiddenRequestIds);
      newHiddenIds.add(requestId);

      // Save to AsyncStorage
      await AsyncStorage.setItem(
        HIDDEN_REQUESTS_KEY,
        JSON.stringify(Array.from(newHiddenIds))
      );

      set({ hiddenRequestIds: newHiddenIds });
    } catch (error) {
      console.error('[RequestStore] Failed to hide request:', error);
      throw error;
    }
  },

  // Unhide a request
  unhideRequest: async (requestId) => {
    try {
      const { hiddenRequestIds } = get();
      const newHiddenIds = new Set(hiddenRequestIds);
      newHiddenIds.delete(requestId);

      // Save to AsyncStorage
      await AsyncStorage.setItem(
        HIDDEN_REQUESTS_KEY,
        JSON.stringify(Array.from(newHiddenIds))
      );

      set({ hiddenRequestIds: newHiddenIds });
    } catch (error) {
      console.error('[RequestStore] Failed to unhide request:', error);
      throw error;
    }
  },

  // Check if a request is hidden
  isRequestHidden: (requestId) => {
    return get().hiddenRequestIds.has(requestId);
  },

  // Fetch requests from API
  fetchRequests: async () => {
    set({ isLoading: true, error: null });
    try {
      const requests = await requestsApi.getMy();
      const existing = get().requests;
      const chatMapUpdates: Record<string, string> = {};
      const requestsMap = requests.reduce((acc, req) => {
        const chatId = req.chatId || (req as any).chat?.id || existing[req.id]?.chatId;
        acc[req.id] = {
          ...existing[req.id],  // preserve existing fields (chatId, unreadCount)
          ...req,
          amount: parseAmount(req.amount),
          chatId,
        };
        if (chatId) {
          chatMapUpdates[chatId] = req.id;
        }
        return acc;
      }, {} as Record<string, Request>);

      // CA10: Merge with existing, don't replace — keep requests not returned by API
      set((state) => ({
        requests: { ...state.requests, ...requestsMap },
        chatToRequestMap: { ...state.chatToRequestMap, ...chatMapUpdates },
        isLoading: false,
      }));
    } catch (error: any) {
      console.error('[RequestStore] Failed to fetch requests:', error);
      set({ error: error.message || 'Failed to fetch requests', isLoading: false });
    }
  },

  // Set multiple requests (merges into existing map to avoid wiping other requests)
  setRequests: (requests) => {
    const existing = get().requests;
    const chatMapUpdates: Record<string, string> = {};
    const requestsMap = requests.reduce((acc, req) => {
      // Extract chatId from nested chat object if present
      const chatId = req.chatId || (req as any).chat?.id || existing[req.id]?.chatId;

      acc[req.id] = {
        ...existing[req.id],
        ...req,
        amount: parseAmount(req.amount),
        chatId, // Ensure chatId is set for message routing
      };

      // Register chat-request mapping if chatId exists
      if (chatId) {
        chatMapUpdates[chatId] = req.id;
      }

      return acc;
    }, {} as Record<string, Request>);

    set((state) => ({
      requests: { ...state.requests, ...requestsMap },
      chatToRequestMap: { ...state.chatToRequestMap, ...chatMapUpdates },
    }));
  },

  // Update a single request
  updateRequest: (requestId, updates) => {
    set((state) => {
      const existingRequest = state.requests[requestId];
      if (!existingRequest) {
        // Request doesn't exist yet, create a minimal entry
        console.warn(`[RequestStore] Updating non-existent request: ${requestId}`);
        return state;
      }

      // Extract chatId from nested chat object if present
      const chatId = updates.chatId || (updates as any).chat?.id || existingRequest.chatId;

      // Register chat-request mapping if chatId exists
      const chatMapUpdate: Record<string, string> = {};
      if (chatId && !state.chatToRequestMap[chatId]) {
        chatMapUpdate[chatId] = requestId;
      }

      return {
        requests: {
          ...state.requests,
          [requestId]: {
            ...existingRequest,
            ...updates,
            chatId,
          },
        },
        chatToRequestMap: { ...state.chatToRequestMap, ...chatMapUpdate },
      };
    });

    // Sync to Android widgets when status changes
    if (updates.status) {
      syncWidgetData(useRequestStore.getState().requests);
    }
  },

  // Buffer a message for an unregistered chatId
  bufferMessage: (chatId, message) => {
    set((state) => {
      const existing = state.pendingMessageBuffer[chatId] || [];
      // Cap buffer at MAX_BUFFER_PER_CHAT messages per chatId to prevent unbounded growth
      const buffer = existing.length >= MAX_BUFFER_PER_CHAT
        ? [...existing.slice(1), message]
        : [...existing, message];

      return {
        pendingMessageBuffer: {
          ...state.pendingMessageBuffer,
          [chatId]: buffer,
        },
      };
    });

    // Auto-expire buffer after BUFFER_EXPIRE_MS. Reset the timer on every new
    // buffered message so a slowly-arriving stream doesn't get truncated by an
    // ancient first-message timeout.
    const { _bufferTimerIds } = get();
    const existingTimer = _bufferTimerIds[chatId];
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      const expiring = get().pendingMessageBuffer[chatId];
      if (expiring && expiring.length > 0) {
        console.warn(`[RequestStore] Buffer expired for chatId ${chatId} — dropping ${expiring.length} undelivered messages:`, expiring.map(m => m.id));
      }
      set((state) => {
        const newBuffer = { ...state.pendingMessageBuffer };
        delete newBuffer[chatId];
        const newTimers = { ...state._bufferTimerIds };
        delete newTimers[chatId];
        return {
          pendingMessageBuffer: newBuffer,
          _bufferTimerIds: newTimers,
        };
      });
    }, BUFFER_EXPIRE_MS);

    set((state) => ({
      _bufferTimerIds: { ...state._bufferTimerIds, [chatId]: timer },
    }));
  },

  // Flush buffered messages for a chatId into a request — atomic batch update
  flushBuffer: (chatId, requestId) => {
    const { _bufferTimerIds } = get();

    // Cancel timer outside the set call (side effect)
    const timer = _bufferTimerIds[chatId];
    if (timer) clearTimeout(timer);

    set((state) => {
      const buffered = state.pendingMessageBuffer[chatId];
      const currentMessages = state.messages[requestId] || [];

      // Build the new messages array in one pass: dedup by id + handle temp-id replacement.
      let updatedMessages = currentMessages;
      let didChange = false;

      if (buffered && buffered.length > 0) {
        const existingIds = new Set(currentMessages.map((m) => m.id));
        const tempByContent = new Map<string, number>();
        currentMessages.forEach((m, idx) => {
          if (m.id.startsWith('temp-')) {
            tempByContent.set(`${m.senderId}:${m.content}`, idx);
          }
        });

        const next = [...currentMessages];
        for (const msg of buffered) {
          if (existingIds.has(msg.id)) continue;
          const tempKey = `${msg.senderId}:${msg.content}`;
          const tempIdx = tempByContent.get(tempKey);
          if (tempIdx !== undefined) {
            next[tempIdx] = msg;
            tempByContent.delete(tempKey);
            existingIds.add(msg.id);
          } else {
            next.unshift(msg);
            existingIds.add(msg.id);
          }
          didChange = true;
        }
        if (didChange) {
          updatedMessages = next;
          console.log(
            `[RequestStore] Flushed ${buffered.length} buffered messages for chatId=${chatId} into requestId=${requestId}`,
          );
        }
      }

      const newBuffer = { ...state.pendingMessageBuffer };
      delete newBuffer[chatId];
      const newTimers = { ...state._bufferTimerIds };
      delete newTimers[chatId];

      return {
        pendingMessageBuffer: newBuffer,
        _bufferTimerIds: newTimers,
        ...(didChange ? { messages: { ...state.messages, [requestId]: updatedMessages } } : {}),
      };
    });
  },

  // Clear all module-level maps (called on logout)
  clearAllMaps: () => {
    // Cancel all pending buffer timers
    const { _bufferTimerIds } = get();
    for (const timer of Object.values(_bufferTimerIds)) {
      clearTimeout(timer);
    }

    set({
      chatToRequestMap: {},
      pendingMessageBuffer: {},
      _bufferTimerIds: {},
    });
  },

  // Register chat-request mapping
  registerChatForRequest: (chatId, requestId) => {
    set((state) => {
      // Only update the request entry if it exists; avoid creating a corrupt partial entry
      if (!state.requests[requestId]) {
        return {
          chatToRequestMap: { ...state.chatToRequestMap, [chatId]: requestId },
        };
      }
      return {
        chatToRequestMap: { ...state.chatToRequestMap, [chatId]: requestId },
        requests: {
          ...state.requests,
          [requestId]: {
            ...state.requests[requestId],
            chatId,
          },
        },
      };
    });

    // Flush any buffered messages for this chatId
    get().flushBuffer(chatId, requestId);
  },

  // Handle new message from socket (by chatId)
  handleNewMessage: (message) => {
    const { chatId } = message;
    if (!chatId) {
      console.warn('[RequestStore] Message without chatId:', message);
      return;
    }

    // Find the request associated with this chat
    const { chatToRequestMap } = get();
    const requestId = chatToRequestMap[chatId];
    if (requestId) {
      get().addMessage(requestId, message);

      // Update unread count if message is from operator
      if (message.type === 'OPERATOR') {
        set((state) => ({
          requests: {
            ...state.requests,
            [requestId]: {
              ...state.requests[requestId],
              unreadCount: (state.requests[requestId]?.unreadCount || 0) + 1,
              hasOperatorMessage: true,
            },
          },
        }));
      }
    } else {
      // Try to find request by chatId in the requests map
      const state = get();
      const requestEntry = Object.entries(state.requests).find(
        ([_, req]) => req.chatId === chatId
      );

      if (requestEntry) {
        const [foundRequestId] = requestEntry;
        // Cache the mapping for future lookups
        set((prevState) => ({
          chatToRequestMap: { ...prevState.chatToRequestMap, [chatId]: foundRequestId },
        }));
        get().addMessage(foundRequestId, message);

        // Update unread count if message is from operator (same as primary path above)
        if (message.type === 'OPERATOR') {
          set((state) => ({
            requests: {
              ...state.requests,
              [foundRequestId]: {
                ...state.requests[foundRequestId],
                unreadCount: (state.requests[foundRequestId]?.unreadCount || 0) + 1,
                hasOperatorMessage: true,
              },
            },
          }));
        }
      } else {
        // Buffer the message — chat-request mapping may not be registered yet
        console.log('[RequestStore] Buffering message for unregistered chatId:', chatId);
        get().bufferMessage(chatId, message);
      }
    }
  },

  // Add a message to a request
  addMessage: (requestId, message) => {
    set((state) => {
      const currentMessages = state.messages[requestId] || [];

      // Check if message already exists (prevent duplicates)
      if (currentMessages.some(m => m.id === message.id)) {
        return state;
      }

      // Check for matching temp message (handles optimistic add race condition:
      // socket echo arrives with server UUID before ack callback replaces temp ID)
      const tempIdx = currentMessages.findIndex(m =>
        m.id.startsWith('temp-') && m.senderId === message.senderId && m.content === message.content
      );
      if (tempIdx !== -1) {
        const updated = [...currentMessages];
        updated[tempIdx] = message;
        return { messages: { ...state.messages, [requestId]: updated } };
      }

      // Add message to the beginning (for inverted FlatList)
      const updatedMessages = [message, ...currentMessages];

      return {
        messages: {
          ...state.messages,
          [requestId]: updatedMessages,
        },
      };
    });
  },

  // Update an existing message
  updateMessage: (requestId, messageId, updates) => {
    set((state) => {
      const currentMessages = state.messages[requestId] || [];
      const updatedMessages = currentMessages.map(msg =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      );

      return {
        messages: {
          ...state.messages,
          [requestId]: updatedMessages,
        },
      };
    });
  },

  // Set messages for a request (merges with existing to prevent losing real-time messages)
  setMessages: (requestId, messages) => {
    set((state) => {
      const existing = state.messages[requestId] || [];
      if (existing.length === 0) {
        return { messages: { ...state.messages, [requestId]: messages } };
      }
      // Merge: use incoming as base, append any existing messages not in incoming set
      const incomingIds = new Set(messages.map(m => m.id));
      const extraMessages = existing.filter(m => !incomingIds.has(m.id));
      // Extra messages (received via socket during fetch) go to the front (newest first)
      const merged = [...extraMessages, ...messages];
      return { messages: { ...state.messages, [requestId]: merged } };
    });
  },

  // Clear messages for a request
  clearMessages: (requestId) => {
    set((state) => {
      const newMessages = { ...state.messages };
      delete newMessages[requestId];
      return { messages: newMessages };
    });
  },

  // Set pagination state for a request
  setMessagePagination: (requestId, cursor, hasMore) => {
    set((state) => ({
      messageCursors: { ...state.messageCursors, [requestId]: cursor },
      messageHasMore: { ...state.messageHasMore, [requestId]: hasMore },
    }));
  },

  // Load more messages for a request
  loadMoreMessages: async (requestId) => {
    const state = get();
    const cursor = state.messageCursors[requestId];
    const hasMore = state.messageHasMore[requestId];

    if (!hasMore) return;

    try {
      const response = await messagesApi.getByRequestId(requestId, {
        cursor,
        limit: 20,
      });

      const newMessages = response.messages;

      set((state) => {
        const currentMessages = state.messages[requestId] || [];
        const existingIds = new Set(currentMessages.map(m => m.id));
        const uniqueNew = newMessages.filter(m => !existingIds.has(m.id)).reverse();
        return {
          messages: {
            ...state.messages,
            [requestId]: [...currentMessages, ...uniqueNew],
          },
        };
      });

      get().setMessagePagination(requestId, response.nextCursor, response.hasMore);
    } catch (error: any) {
      console.error('[RequestStore] Failed to load more messages:', error);
      // Only disable hasMore for server errors (4xx/5xx), keep true for network errors
      // so the user can retry when connectivity returns
      const isNetworkError = !error?.response;
      if (!isNetworkError) {
        set((state) => ({
          messageHasMore: { ...state.messageHasMore, [requestId]: false },
        }));
      }
    }
  },

  // Set typing indicator for a chat
  setTypingIndicator: (chatId, isTyping) => {
    const { chatToRequestMap } = get();
    const requestId = chatToRequestMap[chatId];
    if (!requestId) return;
    set((state) => ({
      typingIndicators: { ...state.typingIndicators, [requestId]: isTyping },
    }));
  },
}));

// Selector for external access to chatToRequestMap
export function useChatToRequestMap(): Record<string, string> {
  return useRequestStore((state) => state.chatToRequestMap);
}

// Get requestId for a given chatId (used by socket.ts for messages:read)
// Non-hook version for use outside React components
export function getRequestIdForChat(chatId: string): string | undefined {
  return useRequestStore.getState().chatToRequestMap[chatId];
}

// CA1: Export cleanup function — delegates to store action
export function clearModuleMaps() {
  useRequestStore.getState().clearAllMaps();
}
