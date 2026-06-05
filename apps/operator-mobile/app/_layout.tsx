import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Alert, ActivityIndicator, Text, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useOperatorStore } from '@/stores/operator.store';
import { connectSocket, getSocket } from '@/services/socket';
import { setApiConfig } from '@/services/api';
import { notifyAlert, notifyMessage, notifyCritical } from '@/services/notifications';
import { useAuthStore } from '@/stores/auth.store';
import ToastContainer from '@/components/Toast';
import ConnectionBar from '@/components/ConnectionBar';
import colors from '@/constants/colors';

// Honour EXPO_PUBLIC_* env vars when present (E2E + local dev override).
// Falls back to the production URLs so existing builds keep working.
const BACKEND_URL = process.env.EXPO_PUBLIC_DEFAULT_API_URL || 'https://tiorico-api.onrender.com';
const API_KEY = process.env.EXPO_PUBLIC_OPERATOR_API_KEY || 'Narciso';

// Prevent auto-hide so we control when splash disappears
SplashScreen.preventAutoHideAsync();

/**
 * Register all socket event listeners on the given socket instance.
 * Must be called BEFORE socket.connect() so no events are missed.
 */
function registerSocketListeners(socket: ReturnType<typeof getSocket>) {
  if (!socket) return () => {};

  const store = useOperatorStore.getState;

  socket.on('initial_data', (data: any) => {
    console.log('[App] Received initial_data event, keys:', data ? Object.keys(data) : 'null');
    store().setInitialData(data);
    useAuthStore.getState().setConnected(true);
  });
  socket.on('connect', () => {
    console.log('[App] Socket connected (listener in registerSocketListeners)');
    useAuthStore.getState().setConnected(true);
  });
  socket.on('disconnect', (reason: string) => {
    console.log('[App] Socket disconnected:', reason);
    useAuthStore.getState().setConnected(false);
  });
  socket.on('error', (err: any) => {
    console.error('[App] Socket error event:', err);
  });
  socket.on('connect_error', (err: any) => {
    console.error('[App] Socket connect_error (listener):', err?.message);
  });

  socket.on('validation_failed', (data: any) => { store().addFailure({ ...data, type: 'VALIDATION_FAILURE' }); notifyAlert(); });
  socket.on('job_failed', (data: any) => { store().addFailure({ ...data, type: 'JOB_FAILURE' }); notifyAlert(); });
  socket.on('failure_resolved', (data: any) => store().resolveFailure(data.failureId, data.action));
  socket.on('validation_completed', (data: any) => store().resolveFailure(data.requestId, 'auto_approved'));
  socket.on('request:rejected', (data: any) => store().resolveFailure(data.requestId || data.failureId, 'REJECTED'));
  socket.on('job_status', (data: any) => store().updateJob(data));
  socket.on('chat:new', (data: any) => { store().addChat(data); notifyMessage(); });
  socket.on('new_message', (data: any) => {
    if (data.chatId) {
      store().addMessage(data.chatId, data);
      if (data.type === 'USER' || data.senderType === 'USER') notifyMessage();
    }
  });
  // User tapped "Necesito ayuda" — high-priority alert. addChat upserts so it
  // works even if the chat isn't loaded yet.
  socket.on('chat:help_requested', (data: any) => {
    if (!data.chatId) return;
    const contextLabel = data.context === 'prize' ? 'cobro de premio' : 'soporte';
    store().addChat({
      id: data.chatId,
      userId: data.userId,
      user: { id: data.userId, username: data.username },
      needsHelp: true,
      helpContext: data.context,
      helpRequestedAt: data.requestedAt,
      updatedAt: data.requestedAt,
      lastMessage: { content: data.message, type: 'USER', createdAt: data.requestedAt },
    });
    notifyCritical();
    Alert.alert('🙋 AYUDA solicitada', `${data.username} pidió ayuda con ${contextLabel}`);
  });
  socket.on('chat:help_cleared', (data: any) => {
    if (data.chatId) {
      store().updateChat(data.chatId, { needsHelp: false, helpContext: null, helpRequestedAt: null });
    }
  });
  socket.on('stats_update', (data: any) => store().updateStats(data));
  socket.on('kill_switch', (data: any) => store().setKillSwitch(data.active));
  socket.on('bot_status', (data: any) => {
    store().setBotStatus(data.status || (data.connected ? 'online' : 'offline'));
    if (data.panelId) store().setBotStatusForPanel(data.panelId, data.status);
    if (data.connectedPerPanel) store().setConnectedPerPanel(data.connectedPerPanel);
  });
  socket.on('validator:status', (data: any) => store().setValidatorConnected(data.connected));
  socket.on('discovery_failed', (data: any) => {
    store().addFailure({ id: `discovery-${data.requestId}`, type: 'DISCOVERY_FAILURE', requestId: data.requestId, targetUsername: data.targetUsername, reason: data.reason, timestamp: new Date().toISOString() });
    notifyAlert();
  });
  socket.on('new_prize_claim', (data: any) => { store().addPrizeClaim(data); notifyAlert(); });
  socket.on('prize_claim_updated', (data: any) => { if (data.id) store().updatePrizeClaim(data.id, data); });
  socket.on('wallet_created', (data: any) => store().addWallet(data));
  socket.on('wallet_updated', (data: any) => store().updateWallet(data));
  socket.on('wallet_selected', (data: any) => { if (data.wallet) store().updateWallet({ ...data.wallet, isSelected: true }); });
  socket.on('wallet_deleted', (data: any) => store().removeWallet(data.id));
  socket.on('wallet_emptied', (data: any) => store().updateWallet(data.wallet || data));
  socket.on('user_updated', (data: any) => {
    const clients = useOperatorStore.getState().clients;
    const idx = clients.findIndex((c: any) => c.id === data.id);
    if (idx >= 0) { const updated = [...clients]; updated[idx] = { ...updated[idx], ...data }; store().setClients(updated); }
  });
  socket.on('settings_updated', (data: any) => { if (data.settings) store().setSettings(data.settings); });
  socket.on('chat_closed', (data: any) => {
    const chats = useOperatorStore.getState().chats;
    const idx = chats.findIndex((c: any) => c.id === data.chatId);
    if (idx >= 0) { const updated = [...chats]; updated[idx] = { ...updated[idx], status: 'CLOSED', closedAt: data.timestamp }; store().setChats(updated); }
  });
  socket.on('messages:read', (data: any) => { if (data.chatId) store().markChatRead(data.chatId); });
  socket.on('wallets_all_full', () => { notifyCritical(); Alert.alert('Billeteras Llenas', 'Todas las billeteras alcanzaron su limite.'); });
  socket.on('system_alert', (data: any) => {
    if (data.severity === 'critical' || data.severity === 'warning') {
      data.severity === 'critical' ? notifyCritical() : notifyAlert();
      Alert.alert(data.severity === 'critical' ? 'ALERTA CRITICA' : 'Advertencia', data.message);
    }
  });
  // Outbound payment events
  socket.on('outbound_payment_created', (data: any) => { store().addOutboundPayment(data); notifyAlert(); });
  socket.on('outbound_payment_updated', (data: any) => { if (data.id) store().updateOutboundPayment(data.id, data); });
  socket.on('outbound_payment_completed', (data: any) => { if (data.id) store().updateOutboundPayment(data.id, { ...data, status: 'COMPLETED' }); notifyMessage(); });
  socket.on('outbound_payment_failed', (data: any) => { if (data.id) store().updateOutboundPayment(data.id, { ...data, status: 'FAILED' }); notifyCritical(); });
  // Extension monitoring events
  socket.on('extension:heartbeat', (data: any) => { if (data.extensionId) store().upsertExtension(data); });
  socket.on('extension:circuit_breaker', (data: any) => {
    if (data.extensionId) store().upsertExtension({ extensionId: data.extensionId, status: 'error', circuitBreakerActive: true, consecutiveErrors: data.errors });
    notifyCritical();
    Alert.alert('Circuit Breaker', `Extension ${data.extensionId || ''} pausada por ${data.errors || 0} errores consecutivos`);
  });
  socket.on('extension:selector_health', (data: any) => {
    if (data.extensionId && data.failed > 0) {
      notifyAlert();
      Alert.alert('Selectores', `${data.failed} selectores rotos en ${data.extensionId}`);
    }
  });

  const events = [
    'initial_data', 'connect', 'disconnect', 'validation_failed', 'job_failed',
    'failure_resolved', 'validation_completed', 'request:rejected', 'job_status',
    'chat:new', 'new_message', 'stats_update', 'kill_switch', 'bot_status',
    'validator:status', 'discovery_failed', 'new_prize_claim', 'prize_claim_updated',
    'wallet_created', 'wallet_updated', 'wallet_selected', 'wallet_deleted', 'wallet_emptied',
    'user_updated', 'settings_updated', 'chat_closed', 'messages:read',
    'wallets_all_full', 'system_alert',
    'outbound_payment_created', 'outbound_payment_updated', 'outbound_payment_completed', 'outbound_payment_failed',
    'extension:heartbeat', 'extension:circuit_breaker', 'extension:selector_health',
  ];

  return () => events.forEach((ev) => socket.off(ev));
}

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setApiConfig({ backendUrl: BACKEND_URL, apiKey: API_KEY });
        // Create socket but DON'T connect yet
        connectSocket({ backendUrl: BACKEND_URL, apiKey: API_KEY, operatorName: 'Admin' }, false);
        useAuthStore.getState().setConnected(false);

        // Register listeners BEFORE connecting so no events are missed
        const socket = getSocket();
        if (socket) {
          cleanupRef.current = registerSocketListeners(socket);
          socket.connect(); // NOW connect — listeners are ready

          // Retry logic: request initial data with exponential backoff
          // Handles cold starts (Render free tier) and race conditions
          const requestInitialData = (attempt = 1, maxAttempts = 5) => {
            const delay = attempt === 1 ? 1500 : attempt * 2000;
            setTimeout(() => {
              if (!socket.connected) return;
              // Skip if we already have data
              if (useOperatorStore.getState().chats.length > 0 || useOperatorStore.getState().jobs.length > 0) {
                console.log('[App] Already have data, skipping retry');
                return;
              }
              console.log(`[App] Requesting initial data (attempt ${attempt}/${maxAttempts})...`);
              socket.emit('get_initial_data', {}, (response: any) => {
                if (response?.success && response?.data) {
                  console.log('[App] Got initial data via callback');
                  useOperatorStore.getState().setInitialData(response.data);
                  useAuthStore.getState().setConnected(true);
                } else {
                  console.warn('[App] get_initial_data failed:', response?.error);
                  if (attempt < maxAttempts) {
                    requestInitialData(attempt + 1, maxAttempts);
                  }
                }
              });
            }, delay);
          };

          socket.on('connect', () => requestInitialData());

          // Also handle backend error from handleConnection failure
          socket.on('error', (err: any) => {
            if (err?.message === 'Failed to load initial data') {
              console.log('[App] Backend failed initial data, will retry...');
              requestInitialData(2); // Start at attempt 2 (slightly longer delay)
            }
          });
        }
      } catch (err) {
        console.error('[App] Init error:', err);
      } finally {
        setAppReady(true);
        await SplashScreen.hideAsync();
      }
    })();

    return () => {
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    };
  }, []);

  if (!appReady) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={loadingStyles.text}>Conectando...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="light" />
      <ConnectionBar />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="failure/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="prize/[id]" options={{ presentation: 'card' }} />
      </Stack>
      <ToastContainer />
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 12,
  },
});
