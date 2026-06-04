import { Platform } from 'react-native';

let Haptics: any = null;
try {
  Haptics = require('expo-haptics');
} catch {}

const isNative = Platform.OS !== 'web';

const safe = (fn: () => void) => { try { fn(); } catch {} };

export const hapticLight = () => { if (isNative && Haptics) safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)); };
export const hapticMedium = () => { if (isNative && Haptics) safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)); };
export const hapticSuccess = () => { if (isNative && Haptics) safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)); };
export const hapticError = () => { if (isNative && Haptics) safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)); };
