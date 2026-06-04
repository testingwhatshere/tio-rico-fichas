declare module '@env' {
  export const EXPO_PUBLIC_API_URL: string;
  export const EXPO_PUBLIC_SOCKET_URL: string;
  export const EXPO_PUBLIC_API_TIMEOUT: string;
}

// Extend process.env with Expo public variables
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_SOCKET_URL?: string;
    EXPO_PUBLIC_API_TIMEOUT?: string;
    EXPO_PUBLIC_MAX_FILE_SIZE_MB?: string;
    EXPO_PUBLIC_APP_NAME?: string;
    EXPO_PUBLIC_APP_VERSION?: string;
  }
}
