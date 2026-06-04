// services/notifications.ts — In-app notification vibration
// Simplified: vibration only, no audio dependencies

import { Platform, Vibration } from 'react-native';

export type NotificationSound = 'alert' | 'message' | 'critical' | 'success';

// Vibration patterns (ms): [wait, vibrate, wait, vibrate, ...]
const VIBRATION_PATTERNS: Record<NotificationSound, number[]> = {
  alert: [0, 200, 100, 200],
  message: [0, 150],
  critical: [0, 300, 100, 300, 100, 300],
  success: [0, 100, 50, 100],
};

// Settings
let soundEnabled = false;
let vibrationEnabled = true;

export function setSoundEnabled(enabled: boolean) { soundEnabled = enabled; }
export function getSoundEnabled() { return soundEnabled; }
export function setVibrationEnabled(enabled: boolean) { vibrationEnabled = enabled; }
export function getVibrationEnabled() { return vibrationEnabled; }

export function notify(type: NotificationSound = 'alert') {
  if (!vibrationEnabled || Platform.OS === 'web') return;
  const pattern = VIBRATION_PATTERNS[type];
  if (pattern) Vibration.vibrate(pattern);
}

export const notifyAlert = () => notify('alert');
export const notifyMessage = () => notify('message');
export const notifyCritical = () => notify('critical');
export const notifySuccess = () => notify('success');

export async function cleanupSounds() {}
