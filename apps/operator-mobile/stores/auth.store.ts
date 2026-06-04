import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { connectSocket, disconnectSocket } from '@/services/socket';
import { setApiConfig } from '@/services/api';
import { useOperatorStore } from '@/stores/operator.store';

const BACKEND_URL = 'https://tiorico-api.onrender.com';
const API_KEY = 'Narciso';
const STORAGE_KEY = 'operator_name';

interface OperatorConfig {
  backendUrl: string;
  apiKey: string;
  operatorName: string;
}

interface AuthState {
  config: OperatorConfig | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasCheckedAuth: boolean;
  isConnected: boolean;
  error: string | null;

  login: (operatorName: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setConnected: (connected: boolean) => void;
}

function buildConfig(operatorName: string): OperatorConfig {
  return { backendUrl: BACKEND_URL, apiKey: API_KEY, operatorName };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  config: null,
  isAuthenticated: false,
  isLoading: false,
  hasCheckedAuth: false,
  isConnected: false,
  error: null,

  login: async (operatorName: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await axios.get(`${BACKEND_URL}/api/health`, {
        headers: { 'X-Operator-API-Key': API_KEY },
        timeout: 10000,
      });

      if (response.status !== 200) {
        throw new Error('Backend health check failed');
      }

      const config = buildConfig(operatorName.trim());

      await AsyncStorage.setItem(STORAGE_KEY, operatorName.trim());

      setApiConfig({ backendUrl: config.backendUrl, apiKey: config.apiKey });
      connectSocket(config);

      set({
        config,
        isAuthenticated: true,
        isLoading: false,
        hasCheckedAuth: true,
        error: null,
      });
    } catch (err: any) {
      let errorMessage = 'Error de conexion';

      if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK') {
        errorMessage = 'No se puede conectar al servidor.';
      } else if (err.response?.status === 401 || err.response?.status === 403) {
        errorMessage = 'API key invalida.';
      } else if (err.code === 'ECONNABORTED') {
        errorMessage = 'Timeout al conectar.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      set({
        config: null,
        isAuthenticated: false,
        isLoading: false,
        hasCheckedAuth: true,
        error: errorMessage,
      });
    }
  },

  logout: async () => {
    disconnectSocket();
    useOperatorStore.getState().reset();

    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}

    set({
      config: null,
      isAuthenticated: false,
      isLoading: false,
      isConnected: false,
      error: null,
    });
  },

  checkAuth: async () => {
    const config = buildConfig('Admin');
    setApiConfig({ backendUrl: config.backendUrl, apiKey: config.apiKey });
    connectSocket(config);

    set({
      config,
      isAuthenticated: true,
      isLoading: false,
      hasCheckedAuth: true,
      error: null,
    });
  },

  setConnected: (connected: boolean) => {
    set({ isConnected: connected });
  },
}));
