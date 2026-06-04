import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { api } from './api';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const registerForPushNotifications = async (): Promise<string | null> => {
  if (!Device.isDevice) {
    console.log('[Notifications] Push notifications only work on physical devices');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission denied');
    return null;
  }

  try {
    // Get native FCM token (Android) or APNs token (iOS) instead of Expo push token.
    // expo-notifications handles FCM/APNs natively in production builds.
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const token = tokenData.data;

    console.log('[Notifications] Device push token obtained:', token);

    // Send native FCM/APNs token to backend
    await api.post('/users/me/push-token', { token });

    // Configure Android channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10B981',
      });
    }

    return token;
  } catch (error) {
    console.error('[Notifications] Error getting push token:', error);
    return null;
  }
};

export const setupNotificationListeners = () => {
  // Handle notification received while app is in foreground
  const foregroundSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      console.log('[Notifications] Received in foreground:', notification);
    },
  );

  // Handle user tapping on notification
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data;
      console.log('[Notifications] User tapped notification:', data);

      // Navigate based on notification data
      if (data.requestId) {
        router.push(`/request/${data.requestId}`);
      }
    },
  );

  return () => {
    foregroundSubscription.remove();
    responseSubscription.remove();
  };
};

export const getNotificationData = (
  lastNotificationResponse: Notifications.NotificationResponse | null,
) => {
  return lastNotificationResponse?.notification.request.content.data;
};
