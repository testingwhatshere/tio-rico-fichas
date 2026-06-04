/**
 * Token Storage - Web (localStorage)
 *
 * Platform-specific module for token persistence in browsers.
 * Metro resolves this file on web instead of tokenStorage.ts.
 */

const SECURE_STORE_PREFIX = process.env.EXPO_PUBLIC_SECURE_STORE_KEY_PREFIX || 'game_automation_';
const TOKEN_KEY = `${SECURE_STORE_PREFIX}auth_token`;

export const getStoredToken = async (): Promise<string | null> => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setStoredToken = async (token: string): Promise<void> => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    console.warn('[TokenStorage] Failed to save token to localStorage');
  }
};

export const removeStoredToken = async (): Promise<void> => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    console.warn('[TokenStorage] Failed to remove token from localStorage');
  }
};
