import { Alert, Platform } from 'react-native';

const webGlobal: any = Platform.OS === 'web' ? (globalThis as any) : null;

export function crossAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    if (webGlobal && typeof webGlobal.alert === 'function') {
      webGlobal.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

export function crossConfirm(
  title: string,
  message: string | undefined,
  options: { confirmText?: string; cancelText?: string; destructive?: boolean }
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmText = options.confirmText || 'OK';
    const cancelText = options.cancelText || 'Cancelar';
    if (Platform.OS === 'web') {
      if (webGlobal && typeof webGlobal.confirm === 'function') {
        const ok = webGlobal.confirm(message ? `${title}\n\n${message}` : title);
        resolve(!!ok);
      } else {
        resolve(false);
      }
      return;
    }
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmText,
        style: options.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
