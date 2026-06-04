/**
 * Token Storage - Native (expo-secure-store)
 *
 * Platform-specific module for secure token persistence on iOS/Android.
 * On web, Metro resolves tokenStorage.web.ts instead.
 */

import * as SecureStore from 'expo-secure-store';

const SECURE_STORE_PREFIX = process.env.EXPO_PUBLIC_SECURE_STORE_KEY_PREFIX || 'game_automation_';
const TOKEN_KEY = `${SECURE_STORE_PREFIX}auth_token`;

export const getStoredToken = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(TOKEN_KEY);
};

export const setStoredToken = async (token: string): Promise<void> => {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

export const removeStoredToken = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
};
