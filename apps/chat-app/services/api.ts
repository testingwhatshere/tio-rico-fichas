/**
 * API Service - Production Ready
 *
 * Configuración centralizada de Axios con:
 * - Token management via expo-secure-store
 * - Request/Response interceptors
 * - Typed API helpers para todos los endpoints
 * - Manejo centralizado de errores
 *
 * @see docs/frontend/FRONTEND_DEV_GUIDE.md para documentación de endpoints
 */

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { Platform } from 'react-native';
import { getStoredToken, setStoredToken, removeStoredToken } from './tokenStorage';
import { parseAmount } from '@/utils/amount';
import { withCache } from '@/services/cache';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Base URL del backend API desde variables de entorno */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

/** Timeout para requests en milisegundos */
const API_TIMEOUT = parseInt(process.env.EXPO_PUBLIC_API_TIMEOUT || '30000', 10);

/** Guard to prevent cascading 401 handling during socket reconnect */
// Promise singleton: ensures only one logout flow runs at a time even when many
// in-flight requests respond 401 in the same tick.
let logout401Promise: Promise<void> | null = null;

// =============================================================================
// AXIOS INSTANCE
// =============================================================================

/**
 * Instancia de Axios configurada con baseURL, timeout y headers por defecto
 */
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// =============================================================================
// INTERCEPTORS
// =============================================================================

/**
 * Request Interceptor
 * - Agrega JWT token a todas las requests si existe
 * - Log en desarrollo para debugging
 */
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const token = await getStoredToken();

      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.warn('[API] Error reading token:', error);
    }

    // Debug logging en desarrollo
    if (__DEV__) {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    }

    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor
 * - Maneja errores 401 (token expirado/inválido)
 * - Limpia el token automáticamente en caso de 401
 * - Log de errores en desarrollo
 */
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error: AxiosError) => {
    const status = error.response?.status;

    // Token expirado o inválido - limpiar storage + reset auth store (Fix 38)
    // Using a Promise singleton: if a logout is already in progress, concurrent
    // 401s await the same promise instead of each kicking off another reset.
    if (status === 401) {
      if (!logout401Promise) {
        logout401Promise = (async () => {
          try {
            await removeStoredToken();
            console.log('[API] Token cleared due to 401 response');

            const { useAuthStore } = await import('@/stores/auth.store');
            const authState = useAuthStore.getState();
            if (authState.isAuthenticated) {
              useAuthStore.setState({
                user: null,
                isAuthenticated: false,
                isLoading: false,
                error: null,
                balance: 0,
                hasCheckedAuth: true,
              });
              const { disconnectSocket } = await import('@/services/socket');
              disconnectSocket();
              console.log('[API] Auth store reset and socket disconnected due to 401');
            }
          } catch (e) {
            console.warn('[API] Error handling 401:', e);
          } finally {
            // Release after a small delay so a brand-new 401 after a successful
            // login doesn't immediately re-trigger logout for the user.
            setTimeout(() => { logout401Promise = null; }, 1000);
          }
        })();
      }
      // Concurrent 401s wait for the in-flight logout to settle; we still reject
      // the original error so callers can react to "you got kicked out".
      await logout401Promise;
    }

    // Debug logging en desarrollo
    if (__DEV__) {
      console.error(`[API] Error ${status}:`, error.response?.data || error.message);
    }

    return Promise.reject(error);
  }
);

// =============================================================================
// TOKEN HELPERS
// =============================================================================

/**
 * Guarda el token de autenticación en SecureStore
 * @param token - JWT token a guardar
 */
export const saveToken = async (token: string): Promise<void> => {
  try {
    await setStoredToken(token);
  } catch (error) {
    console.error('[API] Error saving token:', error);
    throw new Error('No se pudo guardar la sesión');
  }
};

/**
 * Obtiene el token de autenticación desde SecureStore
 * @returns Token o null si no existe
 */
export const getToken = async (): Promise<string | null> => {
  try {
    return await getStoredToken();
  } catch (error) {
    console.warn('[API] Error getting token:', error);
    return null;
  }
};

/**
 * Elimina el token de autenticación de SecureStore
 */
export const removeToken = async (): Promise<void> => {
  try {
    await removeStoredToken();
  } catch (error) {
    console.error('[API] Error removing token:', error);
    throw new Error('No se pudo cerrar la sesión');
  }
};

/**
 * Verifica si existe un token guardado
 * @returns true si hay token, false si no
 */
export const hasToken = async (): Promise<boolean> => {
  const token = await getToken();
  return token !== null && token.length > 0;
};

// =============================================================================
// TYPES & ENUMS
// =============================================================================

/** Roles de usuario en el sistema */
export enum UserRole {
  CLIENT = 'CLIENT',
  OPERATOR = 'OPERATOR',
  SENIOR_OPERATOR = 'SENIOR_OPERATOR',
  ADMIN = 'ADMIN',
}

/** Estados posibles de un request */
export enum RequestStatus {
  PENDING_PROOF = 'PENDING_PROOF',
  VALIDATING = 'VALIDATING',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  APPROVED = 'APPROVED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** Estados posibles de un job */
export enum JobStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** Tipos de mensaje en chat */
export enum MessageType {
  USER = 'USER',
  OPERATOR = 'OPERATOR',
  SYSTEM = 'SYSTEM',
}

/** Usuario autenticado */
export interface User {
  id: string;
  email?: string; // For OPERATOR/ADMIN users
  username?: string; // For CLIENT users
  role: UserRole | string;
}

/** Respuesta de autenticación (login/register) */
export interface AuthResponse {
  user: User;
  token: string;
}

/** Request de carga de fichas */
export interface Request {
  id: string;
  userId: string;
  user?: { email: string };
  targetUsername: string;
  amount: number;
  status: RequestStatus;
  proofUrl?: string;
  proofHash?: string;
  validationScore?: number;
  validationError?: string;
  manuallyApproved?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  // Campos de chat integrado
  unreadCount?: number;
  hasOperatorMessage?: boolean;
  lastMessage?: string;
  chatId?: string;
  // Job relacionado
  job?: Job;
}

/** Request creado con instrucciones de pago */
export interface RequestWithPaymentInstructions extends Request {
  paymentInstructions: {
    provider: string;
    alias: string;
    reference: string;
  };
}

/** Respuesta paginada de requests */
export interface PaginatedRequestsResponse {
  data: Request[];
  meta: {
    total: number;
    page: number;
    totalPages: number;
  };
}

/** Job de automatización */
export interface Job {
  id: string;
  requestId: string;
  bullmqJobId?: string;
  status: JobStatus;
  result?: string;
  error?: string;
  screenshot?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Mensaje de chat */
export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  type: MessageType;
  createdAt: string;
}

/** Chat/Conversación */
export interface Chat {
  id: string;
  userId: string;
  requestId?: string;
  type: 'SUPPORT' | 'REQUEST';
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
  unreadCount?: number;
  lastMessage?: Message;
}

/** Configuración de pago (legacy) */
export interface PaymentConfig {
  provider: string;
  alias: string;
  name: string;
  instructions?: string;
}

/** Tipos de billetera */
export type WalletType = 'MERCADOPAGO' | 'CBU' | 'CVU';

/** Billetera activa para pagos */
export interface Wallet {
  id: string;
  type: WalletType;
  label: string;
  holderName: string;
  details: {
    alias?: string;
    cbu?: string;
    cvu?: string;
    bank?: string;
  };
}

/** Estadísticas del dashboard */
export interface DashboardStats {
  pendingProof: number;
  validating: number;
  validationFailed: number;
  processing: number;
  completedToday: number;
  failedToday: number;
}

/** Estado del kill switch */
export interface KillSwitchStatus {
  enabled: boolean;
}

/** Archivo para upload */
export interface UploadFile {
  uri: string;
  type?: string;
  name?: string;
  file?: File;
}

/** DTO para crear request */
export interface CreateRequestDto {
  amount: number;
  // Note: targetUsername is auto-populated from the user's username on the backend
}

/** DTO para rechazar request */
export interface RejectRequestDto {
  reason: string;
}

/** DTO para enviar mensaje */
export interface SendMessageDto {
  chatId: string;
  content: string;
}

/** Query params para listar requests */
export interface RequestsQueryParams {
  status?: RequestStatus;
  page?: number;
  limit?: number;
}

// =============================================================================
// AUTH API
// =============================================================================

export const authApi = {
  /**
   * Autenticación simple para clientes - solo username (sin contraseña)
   * Crea usuario si no existe, devuelve token si existe
   * Este es el método principal de auth para la chat app
   */
  clientAuth: async (username: string, phone?: string): Promise<AuthResponse> => {
    const response = await api.post<{ accessToken: string; user: User }>('/auth/client', {
      username,
      ...(phone ? { phone } : {}),
    });

    // Guardar token automáticamente
    await saveToken(response.data.accessToken);

    return {
      user: response.data.user,
      token: response.data.accessToken,
    };
  },

  /**
   * Login de usuario (legacy - para operadores)
   * Guarda el token automáticamente en SecureStore
   */
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await api.post<{ accessToken: string; user: User }>('/auth/login', {
      email,
      password,
    });

    // Guardar token automáticamente
    await saveToken(response.data.accessToken);

    return {
      user: response.data.user,
      token: response.data.accessToken,
    };
  },

  /**
   * Registro de nuevo usuario (legacy - para operadores)
   * Guarda el token automáticamente en SecureStore
   */
  register: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await api.post<{ accessToken: string; user: User }>('/auth/register', {
      email,
      password,
    });

    // Guardar token automáticamente
    await saveToken(response.data.accessToken);

    return {
      user: response.data.user,
      token: response.data.accessToken,
    };
  },

  /**
   * Obtiene datos del usuario actual
   * Útil para verificar si el token es válido
   */
  me: async (): Promise<User> => {
    const response = await api.get<User>('/auth/me');
    return response.data;
  },

  /**
   * Logout - elimina el token de SecureStore
   */
  logout: async (): Promise<void> => {
    await removeToken();
  },

  /**
   * Solicita un cambio de contraseña en el panel de juego.
   * Crea un job CHANGE_PASSWORD para la extension de automatización.
   */
  changePassword: async (newPassword: string, confirmPassword: string): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<{ success: boolean; message: string }>('/users/me/change-password', {
      newPassword,
      confirmPassword,
    });
    return response.data;
  },
};

// =============================================================================
// REQUESTS API
// =============================================================================

export const requestsApi = {
  /**
   * Obtiene todos los requests del usuario actual
   * Para operadores, puede filtrar por status
   */
  getMy: async (params?: RequestsQueryParams): Promise<Request[]> => {
    const response = await api.get<Request[] | PaginatedRequestsResponse>('/requests', {
      params,
    });

    // El backend puede devolver array simple o paginado
    const data = Array.isArray(response.data) ? response.data : response.data.data;

    // Ensure amount is always a number (backend may return Decimal as string)
    return data.map((req) => ({
      ...req,
      amount: parseAmount(req.amount),
    }));
  },

  /**
   * Obtiene requests con paginación completa
   */
  getMyPaginated: async (params?: RequestsQueryParams): Promise<PaginatedRequestsResponse> => {
    const response = await api.get<PaginatedRequestsResponse>('/requests', {
      params,
    });

    return {
      ...response.data,
      data: response.data.data.map((req) => ({
        ...req,
        amount: parseAmount(req.amount),
      })),
    };
  },

  /**
   * Obtiene un request por ID
   */
  getOne: async (id: string): Promise<Request> => {
    const response = await api.get<Request>(`/requests/${id}`);
    return {
      ...response.data,
      amount: parseAmount(response.data.amount),
    };
  },

  /**
   * Crea un nuevo request de carga de fichas
   * Note: targetUsername is auto-populated from the user's username on the backend
   */
  create: async (amount: number): Promise<RequestWithPaymentInstructions> => {
    const response = await api.post<RequestWithPaymentInstructions>('/requests', {
      amount,
    });

    return {
      ...response.data,
      amount: parseAmount(response.data.amount),
    };
  },

  /**
   * Sube comprobante de pago directamente a Cloudinary (3-step flow):
   * 1. Compute file hash client-side
   * 2. Get signed upload params from backend (validates auth, duplicates, size)
   * 3. Upload directly to Cloudinary CDN
   * 4. Confirm upload to backend with resulting URL
   */
  uploadProof: async (
    requestId: string,
    file: UploadFile,
    onProgress?: (progress: number) => void,
  ): Promise<Request> => {
    const { computeFileHash, getFileSize } = await import('@/utils/fileHash');

    // Step 1: Compute file hash and size client-side
    const [fileHash, fileSize] = await Promise.all([
      computeFileHash(file),
      getFileSize(file),
    ]);
    const mimeType = file.type || 'image/jpeg';

    // Step 2: Get signed upload params from backend
    // This validates auth, checks duplicates, verifies file size/type
    const signResponse = await api.post<{
      signature: string;
      timestamp: number;
      cloudName: string;
      apiKey: string;
      folder: string;
      publicId: string;
      resourceType: string;
    }>('/uploads/sign-proof', {
      requestId,
      fileHash,
      fileSize,
      mimeType,
    });
    const params = signResponse.data;

    // Step 3: Upload directly to Cloudinary
    // Use resource_type from backend (e.g., 'raw' for PDFs, 'image' for images)
    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${params.cloudName}/${params.resourceType}/upload`;
    const uploadFormData = new FormData();

    const defaultFilename = mimeType === 'application/pdf' ? 'proof.pdf' : 'proof.jpg';
    if (Platform.OS === 'web' && file.file) {
      uploadFormData.append('file', file.file);
    } else if (Platform.OS === 'web') {
      const resp = await fetch(file.uri);
      const blob = await resp.blob();
      (uploadFormData as any).append('file', blob, file.name || defaultFilename);
    } else {
      uploadFormData.append('file', {
        uri: file.uri,
        type: mimeType,
        name: file.name || defaultFilename,
      } as any);
    }

    uploadFormData.append('api_key', params.apiKey);
    uploadFormData.append('timestamp', String(params.timestamp));
    uploadFormData.append('signature', params.signature);
    uploadFormData.append('folder', params.folder);
    uploadFormData.append('public_id', params.publicId);
    // resource_type is in the URL, NOT as a form param (including it breaks the signature)

    const cloudinaryResponse = await axios.post(cloudinaryUrl, uploadFormData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: API_TIMEOUT * 2,
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress) {
          onProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
        }
      },
    });

    const secureUrl = cloudinaryResponse.data?.secure_url;
    const publicId = cloudinaryResponse.data?.public_id;
    if (!secureUrl || !publicId) {
      throw new Error('Respuesta invalida de Cloudinary');
    }

    // Step 4: Confirm upload to backend
    const confirmResponse = await api.post<Request>(
      `/requests/${requestId}/proof/confirm`,
      {
        cloudinaryUrl: secureUrl,
        cloudinaryPublicId: publicId,
        fileHash,
      },
    );

    return confirmResponse.data;
  },

  /**
   * Aprueba manualmente un request (solo SENIOR_OPERATOR+)
   */
  manualApprove: async (requestId: string): Promise<Request> => {
    const response = await api.post<Request>(`/requests/${requestId}/approve`);
    return {
      ...response.data,
      amount: parseAmount(response.data.amount),
    };
  },

  /**
   * Rechaza un request (solo SENIOR_OPERATOR+)
   */
  reject: async (requestId: string, reason: string): Promise<Request> => {
    const response = await api.post<Request>(`/requests/${requestId}/reject`, {
      reason,
    });

    return {
      ...response.data,
      amount: parseAmount(response.data.amount),
    };
  },

  /**
   * Cancela un request en estado PENDING_PROOF
   */
  cancel: async (requestId: string): Promise<{ success: boolean }> => {
    const response = await api.delete<{ success: boolean }>(`/requests/${requestId}`);
    return response.data;
  },
};

// =============================================================================
// PRIZE CLAIMS API (HTTP fallback for socket-based claims)
// =============================================================================

export const prizeClaimsApi = {
  create: async (data: {
    amount: number;
    paymentMethod: string;
    paymentDetails: { cbu?: string; alias?: string; accountHolder: string };
  }) => {
    const response = await api.post('/prize-claims', data);
    return response.data;
  },
};

// =============================================================================
// CHATS API
// =============================================================================

export const chatsApi = {
  /**
   * Obtiene lista de chats del usuario
   */
  getAll: async (): Promise<Chat[]> => {
    const response = await api.get<Chat[]>('/chats');
    return response.data;
  },

  /**
   * Obtiene o crea el chat de soporte general
   */
  getSupport: async (): Promise<Chat> => {
    const response = await api.get<Chat>('/chats/support');
    return response.data;
  },

  /**
   * Obtiene un chat por ID
   */
  getOne: async (chatId: string): Promise<Chat> => {
    const response = await api.get<Chat>(`/chats/${chatId}`);
    return response.data;
  },
};

// =============================================================================
// MESSAGES API
// =============================================================================

export const messagesApi = {
  /**
   * Obtiene mensajes de un chat
   */
  getByChatId: async (
    chatId: string,
    params?: { cursor?: string; limit?: number }
  ): Promise<{ messages: Message[]; hasMore: boolean; nextCursor?: string }> => {
    const response = await api.get<{ messages: Message[]; hasMore: boolean; nextCursor?: string }>(
      `/messages/chat/${chatId}`,
      { params }
    );
    return response.data;
  },

  /**
   * Obtiene mensajes de un request (chat contextual)
   * This endpoint resolves the request's associated chat automatically
   */
  getByRequestId: async (
    requestId: string,
    params?: { cursor?: string; limit?: number }
  ): Promise<{ messages: Message[]; hasMore: boolean; nextCursor?: string }> => {
    const response = await api.get<{ messages: Message[]; hasMore: boolean; nextCursor?: string }>(
      `/requests/${requestId}/messages`,
      { params }
    );
    return response.data;
  },

  /**
   * Envía un mensaje
   */
  send: async (chatId: string, content: string): Promise<Message> => {
    const response = await api.post<Message>('/messages', {
      chatId,
      content,
    });

    return response.data;
  },

  /**
   * Envía un mensaje en el contexto de un request
   * This endpoint resolves the request's associated chat automatically
   */
  sendToRequest: async (requestId: string, content: string): Promise<Message> => {
    const response = await api.post<Message>(`/requests/${requestId}/messages`, {
      content,
    });

    return response.data;
  },

  /**
   * Marca mensajes como leídos
   */
  markAsRead: async (chatId: string): Promise<{ count: number }> => {
    const response = await api.post<{ count: number }>(`/messages/chat/${chatId}/read`);
    return response.data;
  },

  /**
   * Obtiene el conteo de mensajes no leídos
   */
  getUnreadCount: async (): Promise<{ count: number }> => {
    const response = await api.get<{ count: number }>('/messages/unread/count');
    return response.data;
  },
};

// =============================================================================
// JOBS API (Operator Panel)
// =============================================================================

export const jobsApi = {
  /**
   * Obtiene lista de jobs (solo OPERATOR+)
   */
  getAll: async (): Promise<Job[]> => {
    const response = await api.get<{ data: Job[] }>('/jobs');
    return response.data.data;
  },

  /**
   * Obtiene un job por ID
   */
  getOne: async (jobId: string): Promise<Job> => {
    const response = await api.get<Job>(`/jobs/${jobId}`);
    return response.data;
  },
};

// =============================================================================
// DASHBOARD API (Operator Panel)
// =============================================================================

export const dashboardApi = {
  /**
   * Obtiene estadísticas del dashboard (solo OPERATOR+)
   */
  getStats: async (): Promise<DashboardStats> => {
    const response = await api.get<DashboardStats>('/dashboard/stats');
    return response.data;
  },
};

// =============================================================================
// PAYMENT API
// =============================================================================

export const paymentApi = {
  /**
   * Obtiene la billetera activa para pagos
   * Puede ser MercadoPago (alias), CBU, o CVU
   */
  getActiveWallet: async (): Promise<Wallet | null> => {
    return withCache('payments:activeWallet', 60_000, async () => {
      try {
        const response = await api.get<Wallet>('/payments/wallet');
        return response.data;
      } catch (error) {
        // 404 means no wallet configured
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    });
  },

  /**
   * @deprecated Use getActiveWallet instead
   * Mantiene compatibilidad con código legacy
   */
  getConfig: async (): Promise<PaymentConfig> => {
    const wallet = await paymentApi.getActiveWallet();
    if (!wallet) {
      throw new Error('No hay método de pago configurado');
    }
    // Map wallet to legacy PaymentConfig format
    return {
      provider: wallet.type,
      alias: wallet.details.alias || wallet.details.cbu || wallet.details.cvu || '',
      name: wallet.holderName,
      instructions: undefined,
    };
  },
};

// =============================================================================
// SETTINGS API (Operator Panel)
// =============================================================================

export const settingsApi = {
  /**
   * Obtiene configuracion publica (no requiere auth)
   */
  getPublic: async (): Promise<{ maxRequestsPerUserPerHour: number; supportPhoneNumber: string }> => {
    return withCache('settings:public', 30_000, async () => {
      const response = await api.get('/settings/public');
      return response.data;
    });
  },

  /**
   * Obtiene estado del kill switch
   */
  getKillSwitch: async (): Promise<KillSwitchStatus> => {
    const response = await api.get<KillSwitchStatus>('/settings/killswitch/status');
    return response.data;
  },

  /**
   * Activa el kill switch (solo ADMIN)
   */
  activateKillSwitch: async (): Promise<KillSwitchStatus> => {
    const response = await api.post<KillSwitchStatus>('/settings/killswitch/activate');
    return response.data;
  },

  /**
   * Desactiva el kill switch (solo ADMIN)
   */
  deactivateKillSwitch: async (): Promise<KillSwitchStatus> => {
    const response = await api.post<KillSwitchStatus>('/settings/killswitch/deactivate');
    return response.data;
  },

  /**
   * Actualiza estado del kill switch (solo ADMIN)
   * @deprecated Use activateKillSwitch or deactivateKillSwitch instead
   */
  setKillSwitch: async (enabled: boolean): Promise<KillSwitchStatus> => {
    if (enabled) {
      return settingsApi.activateKillSwitch();
    }
    return settingsApi.deactivateKillSwitch();
  },
};

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Extrae un mensaje de error user-friendly de cualquier error
 *
 * @param error - Error de axios o cualquier otro error
 * @returns Mensaje en español, amigable para el usuario
 *
 * @example
 * try {
 *   await authApi.login(email, password);
 * } catch (error) {
 *   Alert.alert('Error', getErrorMessage(error));
 * }
 */
export const getErrorMessage = (error: unknown): string => {
  // Error de Axios
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ message?: string; error?: string }>;

    // Sin respuesta del servidor (error de red)
    if (!axiosError.response) {
      // Timeout
      if (axiosError.code === 'ECONNABORTED') {
        return 'La solicitud tardó demasiado. Intentá de nuevo.';
      }

      // Error de conexión
      if (axiosError.code === 'ERR_NETWORK') {
        return 'Sin conexión a internet. Revisá tu conexión.';
      }

      // Otro error de red
      return 'Error de conexión. Revisá tu internet e intentá de nuevo.';
    }

    // Con respuesta del servidor
    const status = axiosError.response.status;
    const serverMessage =
      axiosError.response.data?.message || axiosError.response.data?.error;

    // Mensajes por código de estado HTTP
    switch (status) {
      case 400:
        return serverMessage || 'Datos incorrectos. Revisá la información ingresada.';

      case 401:
        return 'Sesión expirada. Por favor, volvé a iniciar sesión.';

      case 403:
        return 'No tenés permisos para realizar esta acción.';

      case 404:
        return 'El recurso solicitado no fue encontrado.';

      case 409:
        return serverMessage || 'Ya existe un registro con estos datos.';

      case 413:
        return 'El archivo es demasiado grande. Intentá con uno más pequeño.';

      case 422:
        return serverMessage || 'Los datos enviados no son válidos.';

      case 429:
        return 'Demasiados intentos. Esperá un momento antes de reintentar.';

      case 500:
        return 'Error del servidor. Estamos trabajando para solucionarlo.';

      case 502:
      case 503:
      case 504:
        return 'Servicio temporalmente no disponible. Intentá en unos minutos.';

      default:
        return serverMessage || 'Algo salió mal. Intentá de nuevo.';
    }
  }

  // Error con mensaje
  if (error instanceof Error) {
    return error.message || 'Error inesperado. Intentá de nuevo.';
  }

  // Error desconocido
  return 'Error inesperado. Intentá de nuevo.';
};

/**
 * Verifica si un error es de tipo "sin conexión"
 */
export const isNetworkError = (error: unknown): boolean => {
  if (axios.isAxiosError(error)) {
    return (
      !error.response ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ERR_NETWORK'
    );
  }
  return false;
};

/**
 * Verifica si un error es 401 (no autorizado)
 */
export const isUnauthorizedError = (error: unknown): boolean => {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 401;
  }
  return false;
};

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

/**
 * URL base de la API (útil para WebSocket y otros)
 */
export const API_URL = API_BASE_URL;

/**
 * Timeout configurado de la API
 */
export const TIMEOUT = API_TIMEOUT;

// Export default de la instancia de axios
export default api;
