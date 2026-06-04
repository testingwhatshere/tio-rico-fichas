/**
 * Notifications - Web
 *
 * Uses the browser Notification API for in-browser notifications.
 * Works when the app is in a background tab (not when browser is closed).
 */

let permissionGranted = false;

export const registerForPushNotifications = async (): Promise<string | null> => {
  if (!('Notification' in window)) {
    console.log('[Notifications.web] Browser does not support notifications');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    permissionGranted = permission === 'granted';

    if (permissionGranted) {
      console.log('[Notifications.web] Browser notification permission granted');
    } else {
      console.log('[Notifications.web] Browser notification permission denied');
    }
  } catch (err) {
    console.warn('[Notifications.web] Failed to request permission:', err);
  }

  // No push token for web — browser notifications are local only
  return null;
};

/**
 * Show a browser notification (for when the tab is in background).
 * Called from socket event handlers.
 */
export function showBrowserNotification(title: string, body: string, data?: Record<string, any>) {
  if (!permissionGranted || !('Notification' in window)) return;

  // Only show if tab is not focused (avoid duplicate with in-app UI)
  if (document.hasFocus()) return;

  try {
    const notification = new Notification(title, {
      body,
      icon: '/assets/icon.png',
      badge: '/assets/icon.png',
      tag: data?.requestId || 'tiorico', // Replaces previous notification with same tag
      silent: false,
    });

    // Focus the tab when notification is clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Auto-close after 8 seconds
    setTimeout(() => notification.close(), 8000);
  } catch (err) {
    console.warn('[Notifications.web] Failed to show notification:', err);
  }
}

export const setupNotificationListeners = () => {
  return () => {};
};

export const getNotificationData = (
  _lastNotificationResponse: unknown,
) => {
  return undefined;
};
