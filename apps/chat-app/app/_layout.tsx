import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Platform, Image, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ShareIntentProvider } from 'expo-share-intent';
import { useAuthStore } from '@/stores/auth.store';
import { useNetwork } from '@/hooks/useNetwork';
import * as Notifications from 'expo-notifications';
import { registerForPushNotifications, setupNotificationListeners } from '@/services/notifications';
import { checkForUpdate, type UpdateInfo } from '@/services/appUpdate';
import OfflineBanner from '@/components/OfflineBanner';
import UpdateBlocker from '@/components/UpdateBlocker';
import ErrorBoundary from '@/components/ErrorBoundary';
import InstallPrompt from '@/components/InstallPrompt';
import colors from '@/constants/colors';

const ONBOARDING_KEY = '@tiorico:onboarding_seen';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, hasCheckedAuth, checkAuth } = useAuthStore();
  const { isOffline } = useNetwork();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(Platform.OS === 'android');

  useEffect(() => {
    checkAuth();
  }, []);

  // Check for app update on launch (Android only)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    checkForUpdate()
      .then((info) => setUpdateInfo(info))
      .finally(() => setCheckingUpdate(false));
  }, []);

  useEffect(() => {
    if (!hasCheckedAuth || !segments[0]) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Check if user has seen onboarding
      AsyncStorage.getItem(ONBOARDING_KEY).then((seen) => {
        if (seen) {
          router.replace('/home');
        } else {
          router.replace('/onboarding');
        }
      }).catch(() => router.replace('/home'));
    }
  }, [isAuthenticated, hasCheckedAuth, segments]);

  // Setup push notifications when authenticated (native only, not web)
  useEffect(() => {
    if (!isAuthenticated || Platform.OS === 'web') return;

    registerForPushNotifications().catch((error) => {
      console.error('[App] Failed to register for push notifications:', error);
    });

    const cleanup = setupNotificationListeners();

    // Handle cold-start notification (app was killed when user tapped)
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = response.notification.request.content.data;
        if (data?.requestId) {
          router.push(`/request/${data.requestId}`);
        }
      }
    });

    return cleanup;
  }, [isAuthenticated]);

  // Show update blocker if update is available (blocks entire app)
  if (updateInfo) {
    return <UpdateBlocker updateInfo={updateInfo} />;
  }

  if (!hasCheckedAuth || checkingUpdate) {
    return (
      <View style={styles.loadingContainer}>
        <Image
          source={require('@/assets/icon.png')}
          style={styles.splashIcon}
          resizeMode="contain"
        />
        <Text style={styles.splashTitle}>TIO RICO</Text>
        <Text style={styles.splashSubtitle}>FICHAS</Text>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <ShareIntentProvider>
      <ErrorBoundary>
        <View style={styles.container}>
          {isOffline && <OfflineBanner />}
          <Slot />
          <InstallPrompt />
        </View>
      </ErrorBoundary>
    </ShareIntentProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  splashIcon: {
    width: 120,
    height: 120,
    borderRadius: 24,
    marginBottom: 16,
  },
  splashTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.accent,
    letterSpacing: 4,
  },
  splashSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentLight,
    letterSpacing: 8,
    marginTop: 2,
  },
});
