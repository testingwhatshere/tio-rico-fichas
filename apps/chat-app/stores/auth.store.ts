import { create } from 'zustand';
import { api, authApi, getToken } from '@/services/api';
import { connectSocket, disconnectSocket } from '@/services/socket';

// User type
export interface User {
  id: string;
  email?: string; // For OPERATOR/ADMIN users
  username?: string; // For CLIENT users
  role: string;
  balance?: number;
  savedTargetUsername?: string;
}

// Auth store state
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasCheckedAuth: boolean;
  error: string | null;
  balance: number; // Current user balance

  // Actions
  login: (username: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  refreshBalance: () => Promise<void>;
  setBalance: (balance: number) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  isLoading: false,
  hasCheckedAuth: false,
  error: null,
  balance: 0,

  // Login action - username + optional phone for first-time registration
  login: async (username: string, phone?: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await authApi.clientAuth(username, phone);

      set({
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        balance: response.user.balance || 0,
      });

      // Connect socket after successful login
      const token = await getToken();
      if (token) {
        connectSocket(token);
      }
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.message || 'Error al iniciar sesión';

      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: errorMessage,
      });

      throw error;
    }
  },

  // Logout action
  logout: async () => {
    set({ isLoading: true });

    try {
      // Disconnect socket BEFORE clearing token
      disconnectSocket();
      await authApi.logout();
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        hasCheckedAuth: true,
        error: null,
        balance: 0,
      });

      // Clear other stores to prevent data leakage between sessions
      try {
        const { useRequestStore, clearModuleMaps } = require('@/stores/request.store');
        useRequestStore.setState({
          requests: {},
          messages: {},
          messageCursors: {},
          messageHasMore: {},
          typingIndicators: {},
          isLoading: false,
          error: null,
        });
        clearModuleMaps();
      } catch (e) {
        console.warn('Failed to clear request store on logout:', e);
      }

      try {
        const { useChatStore } = require('@/stores/chat.store');
        useChatStore.setState({
          unreadCount: 0,
          supportChatId: null,
          supportMessages: [],
          supportMessageCursor: undefined,
          supportMessageHasMore: false,
        });
      } catch (e) {
        console.warn('Failed to clear chat store on logout:', e);
      }
    }
  },

  // Check if user is authenticated (on app startup)
  checkAuth: async () => {
    set({ isLoading: true });

    try {
      // Check if token exists in SecureStore
      const token = await getToken();

      if (!token) {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          hasCheckedAuth: true,
        });
        return;
      }

      // Token exists, verify it's valid by fetching user data
      const userData = await authApi.me();

      set({
        user: userData,
        isAuthenticated: true,
        isLoading: false,
        hasCheckedAuth: true,
        error: null,
        balance: userData.balance || 0,
      });

      // Connect socket after successful auth check
      connectSocket(token);
    } catch (error) {
      console.error('Error checking auth:', error);

      // Token invalid or expired
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        hasCheckedAuth: true,
        error: null,
      });
    }
  },

  // Clear error
  clearError: () => {
    set({ error: null });
  },

  // Refresh balance from API
  refreshBalance: async () => {
    try {
      const response = await api.get('/users/me/balance');
      set({ balance: response.data.balance });
    } catch (error) {
      console.error('Failed to refresh balance:', error);
    }
  },

  // Set balance directly (for socket updates)
  setBalance: (balance: number) => {
    set({ balance });
  },
}));

export default useAuthStore;
