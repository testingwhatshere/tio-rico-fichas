import { create } from 'zustand';
import { messagesApi } from '@/services/api';

interface Message {
  id: string;
  type: 'USER' | 'OPERATOR' | 'SYSTEM';
  content: string;
  senderId: string;
  chatId: string;
  createdAt: string;
}

// Chat store state
interface ChatState {
  unreadCount: number;
  supportChatId: string | null;
  supportMessages: Message[];
  supportMessageCursor: string | undefined;
  supportMessageHasMore: boolean;
  isLoadingMoreSupport: boolean;

  // Actions
  setUnreadCount: (count: number) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
  setSupportChatId: (chatId: string) => void;
  setSupportMessages: (messages: Message[]) => void;
  addSupportMessage: (message: Message) => void;
  loadMoreSupportMessages: () => Promise<void>;
  setSupportPagination: (cursor: string | undefined, hasMore: boolean) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  unreadCount: 0,
  supportChatId: null,
  supportMessages: [],
  supportMessageCursor: undefined,
  supportMessageHasMore: false,
  isLoadingMoreSupport: false,

  // Set unread count
  setUnreadCount: (count: number) => {
    set({ unreadCount: count });
  },

  // Increment unread count
  incrementUnread: () => {
    set((state) => ({ unreadCount: state.unreadCount + 1 }));
  },

  // Clear unread count
  clearUnread: () => {
    set({ unreadCount: 0 });
  },

  // Set support chat ID
  setSupportChatId: (chatId) => set({ supportChatId: chatId }),

  // Set support messages (merge to avoid losing real-time messages during reconnect)
  setSupportMessages: (messages) => set((state) => {
    const incomingIds = new Set(messages.map(m => m.id));
    const realtimeOnly = state.supportMessages.filter(m => !incomingIds.has(m.id));
    const merged = [...realtimeOnly, ...messages];
    // Sort newest first. Guard against invalid `createdAt`: Date.parse() returns NaN
    // for malformed strings, which corrupts every comparison in Array.sort.
    merged.sort((a, b) => {
      const tb = Date.parse(b.createdAt as any);
      const ta = Date.parse(a.createdAt as any);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return { supportMessages: merged };
  }),

  // Add support message (real-time)
  addSupportMessage: (message) => {
    set((state) => {
      if (state.supportMessages.some(m => m.id === message.id)) return state;
      return { supportMessages: [message, ...state.supportMessages] };
    });
  },

  // Set support pagination
  setSupportPagination: (cursor, hasMore) => {
    set({ supportMessageCursor: cursor, supportMessageHasMore: hasMore });
  },

  // Load more support messages
  loadMoreSupportMessages: async () => {
    const state = get();
    if (!state.supportChatId || !state.supportMessageHasMore || state.isLoadingMoreSupport) return;

    set({ isLoadingMoreSupport: true });
    try {
      const response = await messagesApi.getByChatId(state.supportChatId, {
        cursor: state.supportMessageCursor,
        limit: 20,
      });

      const newMessages = [...response.messages].reverse();
      set((state) => {
        const existingIds = new Set(state.supportMessages.map(m => m.id));
        const uniqueNew = newMessages.filter(m => !existingIds.has(m.id));
        return {
          supportMessages: [...state.supportMessages, ...uniqueNew],
        };
      });

      get().setSupportPagination(response.nextCursor, response.hasMore);
    } catch (error) {
      console.error('[ChatStore] Failed to load more support messages:', error);
      // Don't set hasMore=false on network errors — let user retry
    } finally {
      set({ isLoadingMoreSupport: false });
    }
  },
}));

export default useChatStore;
