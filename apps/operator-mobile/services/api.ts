import axios, { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================
// Constants
// ============================================

const BACKEND_URL = 'https://tiorico-api.onrender.com';
const API_KEY = 'Narciso';
const STORAGE_KEY = 'operator_name';

// ============================================
// Types
// ============================================

export interface ApiConfig {
  backendUrl: string;
  apiKey: string;
}

interface FullConfig extends ApiConfig {
  operatorName: string;
}

// ============================================
// In-memory config + axios instance
// ============================================

let currentConfig: ApiConfig | null = null;
let apiInstance: AxiosInstance | null = null;

// ============================================
// Config persistence (AsyncStorage)
// ============================================

export async function saveConfig(config: FullConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, config.operatorName);
  setApiConfig({ backendUrl: config.backendUrl, apiKey: config.apiKey });
}

export async function loadConfig(): Promise<FullConfig | null> {
  try {
    const operatorName = await AsyncStorage.getItem(STORAGE_KEY);
    if (!operatorName) return null;
    const config: FullConfig = { backendUrl: BACKEND_URL, apiKey: API_KEY, operatorName };
    setApiConfig({ backendUrl: config.backendUrl, apiKey: config.apiKey });
    return config;
  } catch {
    return null;
  }
}

export async function clearConfig(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  currentConfig = null;
  apiInstance = null;
}

// ============================================
// Axios instance management
// ============================================

export function setApiConfig(config: ApiConfig): void {
  currentConfig = config;

  let baseURL = config.backendUrl.replace(/\/+$/, '');
  if (!baseURL.endsWith('/api')) {
    baseURL += '/api';
  }

  apiInstance = axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
      'X-Operator-API-Key': config.apiKey,
    },
  });

  apiInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        const msg =
          error.response.data?.message ||
          error.response.data?.error ||
          `HTTP ${error.response.status}`;
        return Promise.reject(new Error(msg));
      }
      if (error.code === 'ECONNABORTED') {
        return Promise.reject(new Error('Request timed out'));
      }
      return Promise.reject(
        new Error(error.message || 'Network error'),
      );
    },
  );
}

export function getApi(): AxiosInstance {
  if (!apiInstance || !currentConfig) {
    throw new Error('API not configured. Call setApiConfig() first.');
  }
  return apiInstance;
}

export function isConfigured(): boolean {
  return !!apiInstance && !!currentConfig;
}

// ============================================
// Connection test
// ============================================

export async function testConnection(
  config: ApiConfig,
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${config.backendUrl.replace(/\/+$/, '')}/api/health`;
    await axios.get(url, {
      timeout: 10000,
      headers: { 'X-Operator-API-Key': config.apiKey },
    });
    return { success: true };
  } catch (error: any) {
    const msg =
      error.response?.data?.message ||
      error.message ||
      'Connection failed';
    return { success: false, error: msg };
  }
}

// ============================================
// File upload helper
// ============================================

export async function uploadChatImage(
  uri: string,
  filename: string,
  mimeType: string = 'image/jpeg',
): Promise<{ url?: string; error?: string }> {
  if (!currentConfig || !apiInstance) {
    return { error: 'API not configured' };
  }

  try {
    const formData = new FormData();
    formData.append('file', {
      uri,
      name: filename,
      type: mimeType,
    } as any);

    const response = await apiInstance.post(
      '/uploads/operator/chat-image',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000,
      },
    );

    return { url: response.data?.url };
  } catch (error: any) {
    return { error: error.message || 'Upload failed' };
  }
}
