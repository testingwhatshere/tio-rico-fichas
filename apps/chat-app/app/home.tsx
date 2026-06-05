import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Keyboard,
  RefreshControl,
  ImageBackground,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/stores/auth.store';
import { settingsApi, chatsApi, messagesApi, requestsApi, authApi, prizeClaimsApi } from '@/services/api';
import { sendMessage as sendSocketMessage, getSocket } from '@/services/socket';
import { hapticLight } from '@/utils/haptics';
import { formatAmount } from '@/utils/amount';
import { crossAlert, crossConfirm } from '@/utils/dialog';
import colors from '@/constants/colors';
import PrizeClaimCard from '@/components/cards/PrizeClaimCard';

const GAME_URL = 'https://tioricojuegos.co';

interface ChatMessage {
  id: string;
  content: string;
  type: 'USER' | 'SYSTEM' | 'OPERATOR';
  createdAt: string;
  imageUrl?: string;
}

const ACTIVE_STATUSES = ['PENDING_PROOF', 'VALIDATING', 'PENDING_MP_VERIFICATION', 'APPROVED', 'PROCESSING', 'VALIDATION_FAILED'];

const STATUS_LABELS: Record<string, { emoji: string; text: string }> = {
  PENDING_PROOF: { emoji: '📤', text: 'Esperando comprobante' },
  VALIDATING: { emoji: '⏳', text: 'Verificando pago' },
  PENDING_MP_VERIFICATION: { emoji: '🏦', text: 'Verificando recepcion' },
  APPROVED: { emoji: '✅', text: 'Pago verificado' },
  PROCESSING: { emoji: '🔄', text: 'Cargando fichas' },
  VALIDATION_FAILED: { emoji: '⚠️', text: 'En revision manual' },
  CANCELLED: { emoji: '🔙', text: 'Cancelada' },
};

const PRIZE_STATUS_LABELS: Record<string, { emoji: string; text: string }> = {
  PENDING_PAYMENT_DETAILS: { emoji: '📝', text: 'Esperando datos de pago' },
  PENDING_VERIFICATION: { emoji: '⏳', text: 'Verificando premio' },
  AWAITING_PAYMENT: { emoji: '💰', text: 'Esperando que el operador pague' },
  PROCESSING_PAYMENT: { emoji: '🔄', text: 'Pagando premio' },
  COMPLETED: { emoji: '✅', text: 'Premio pagado' },
  REJECTED: { emoji: '❌', text: 'Premio rechazado' },
  VERIFICATION_FAILED: { emoji: '⚠️', text: 'En revision manual' },
  FAILED: { emoji: '⚠️', text: 'En revision manual' },
};

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [supportPhone, setSupportPhone] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [recentMessages, setRecentMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [loadingChat, setLoadingChat] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeRequest, setActiveRequest] = useState<any>(null);
  const [activePrizeClaim, setActivePrizeClaim] = useState<any>(null);
  const [usernameCopied, setUsernameCopied] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showPrizeModal, setShowPrizeModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const chatInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const successBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccessBanner = useCallback((text: string) => {
    setSuccessBanner(text);
    if (successBannerTimerRef.current) clearTimeout(successBannerTimerRef.current);
    successBannerTimerRef.current = setTimeout(() => setSuccessBanner(null), 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (successBannerTimerRef.current) clearTimeout(successBannerTimerRef.current);
    };
  }, []);

  const loadData = useCallback(async () => {
    // Settings
    settingsApi.getPublic().then((s) => {
      if (s.supportPhoneNumber) setSupportPhone(s.supportPhoneNumber);
    }).catch(() => {});

    // Active request
    requestsApi.getMy().then((requests) => {
      const active = requests.find((r: any) => ACTIVE_STATUSES.includes(r.status));
      setActiveRequest(active || null);
    }).catch(() => {});

    // Active prize claim
    prizeClaimsApi.getMyActive().then((claim) => {
      setActivePrizeClaim(claim || null);
    }).catch(() => {});

    // Recent messages
    await loadRecentMessages();
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time refresh of the active prize claim when socket events update it.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => {
      prizeClaimsApi.getMyActive().then((claim) => setActivePrizeClaim(claim || null)).catch(() => {});
    };
    socket.on('prize_claim:status_update', refresh);
    socket.on('prize_claim:payment_sent', refresh);
    socket.on('prize_claim:rejected', refresh);

    // In-app banner for password change result. Fires regardless of which
    // screen the user is on, so it complements the system message in the chat
    // and the native push notification.
    const onPasswordChanged = (data: any) => {
      const msg = data?.success
        ? '✅ Tu contraseña fue cambiada. Ya podés usar la nueva para ingresar al panel.'
        : `❌ No pudimos cambiar tu contraseña. ${data?.error || 'Contactá a soporte.'}`;
      showSuccessBanner(msg);
    };
    socket.on('password:changed', onPasswordChanged);

    return () => {
      socket.off('prize_claim:status_update', refresh);
      socket.off('prize_claim:payment_sent', refresh);
      socket.off('prize_claim:rejected', refresh);
      socket.off('password:changed', onPasswordChanged);
    };
  }, [showSuccessBanner]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const copyUsername = async () => {
    if (!user?.savedTargetUsername) return;
    await Clipboard.setStringAsync(user.savedTargetUsername);
    hapticLight();
    setUsernameCopied(true);
    setTimeout(() => setUsernameCopied(false), 2000);
  };

  const loadRecentMessages = async () => {
    try {
      const chat = await chatsApi.getSupport();
      setChatId(chat.id);
      const response = await messagesApi.getByChatId(chat.id, { limit: 2 });
      const msgs = response.messages || [];
      setRecentMessages(msgs.reverse()); // chronological order
    } catch {
      // Silent — chat might not exist yet
    } finally {
      setLoadingChat(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || sendingChat || !chatId) return;
    const content = chatInput.trim();
    setChatInput('');
    Keyboard.dismiss();
    setSendingChat(true);

    try {
      const socket = getSocket();
      if (socket?.connected) {
        sendSocketMessage(chatId, content, undefined, undefined);
        // Add optimistic message
        setRecentMessages((prev) => [
          ...prev.slice(-1), // keep only last 1
          { id: `temp-${Date.now()}`, content, type: 'USER', createdAt: new Date().toISOString() },
        ]);
      }
    } catch {
      // Silent
    } finally {
      setSendingChat(false);
    }
  };

  const handleLoadCredits = () => router.push({ pathname: '/chat', params: { action: 'load' } });
  const handleClaimPrize = () => setShowPrizeModal(true);
  const handleClosePrizeModal = () => {
    setShowPrizeModal(false);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
  };
  const handleClosePasswordModal = () => {
    setShowPasswordModal(false);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
  };
  const handlePlayGame = () => Linking.openURL(GAME_URL);
  const handleSupport = () => {
    if (!supportPhone) return;
    const tel = supportPhone.replace(/[^\d+]/g, '');
    Linking.openURL(`https://wa.me/${tel}`);
  };
  const handleLogout = async () => {
    const { user, logout } = useAuthStore.getState();
    const displayName = user?.username || 'Usuario';
    const ok = await crossConfirm(displayName, 'Cerrar sesion?', {
      confirmText: 'Cerrar sesion',
      cancelText: 'Cancelar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await logout();
      router.replace('/(auth)/login');
    } catch {
      crossAlert('Error', 'No pudimos cerrar sesion. Intenta de nuevo.');
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      crossAlert('Error', 'La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      crossAlert('Error', 'Las contraseñas no coinciden');
      return;
    }
    setChangingPassword(true);
    try {
      const result = await authApi.changePassword(newPassword, confirmPassword);
      setShowPasswordModal(false);
      setNewPassword('');
      setConfirmPassword('');
      const msg = result.message || 'Tu cambio de contraseña se está procesando. Te avisamos por el chat cuando esté listo.';
      showSuccessBanner(msg);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Error al cambiar contraseña';
      crossAlert('Error', msg);
    } finally {
      setChangingPassword(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
    <ImageBackground
      source={require('@/assets/casino-bg.png')}
      style={styles.bgImage}
      resizeMode="stretch"
    >
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {successBanner ? (
        <View style={styles.successBanner} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={20} color="#0F2D14" />
          <Text style={styles.successBannerText}>{successBanner}</Text>
          <TouchableOpacity
            onPress={() => setSuccessBanner(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={18} color="#0F2D14" />
          </TouchableOpacity>
        </View>
      ) : null}
      {/* Top Bar: WhatsApp + Settings */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleSupport} style={styles.whatsappButton} activeOpacity={0.7}>
          <Ionicons name="logo-whatsapp" size={22} color="#FFFFFF" />
          <Text style={styles.whatsappText}>Soporte</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={() => setShowPasswordModal(true)} style={styles.topBarButton} activeOpacity={0.7}>
            <Ionicons name="key-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={styles.topBarButton} activeOpacity={0.7}>
            <Ionicons name="settings-outline" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!showPrizeModal && !showPasswordModal}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* Header with duck icon */}
        <View style={styles.header}>
          <Image
            source={require('@/assets/icon.png')}
            style={styles.duckIcon}
            resizeMode="contain"
          />
          <Text style={styles.title}>TIO RICO</Text>
          <Text style={styles.titleSecondary}>FICHAS</Text>
          <View style={styles.divider} />
          <Text style={styles.welcome}>
            Bienvenido, <Text style={styles.username}>{user?.username || 'jugador'}</Text>
          </Text>

          {/* Game username chip */}
          {user?.savedTargetUsername ? (
            <TouchableOpacity onPress={copyUsername} style={styles.usernameChip} activeOpacity={0.7}>
              <Ionicons name="game-controller" size={14} color={colors.accent} />
              <Text style={styles.usernameChipText}>{user.savedTargetUsername}</Text>
              <Ionicons
                name={usernameCopied ? 'checkmark-circle' : 'copy-outline'}
                size={14}
                color={usernameCopied ? colors.success : colors.textMuted}
              />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Active Request Banner */}
        {activeRequest && (
          <TouchableOpacity
            style={styles.statusBanner}
            onPress={() => router.push('/chat')}
            activeOpacity={0.7}
          >
            <Text style={styles.statusBannerEmoji}>
              {STATUS_LABELS[activeRequest.status]?.emoji || '📋'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerText}>
                {STATUS_LABELS[activeRequest.status]?.text || 'En proceso'}
              </Text>
              <Text style={styles.statusBannerAmount}>
                ${formatAmount(Number(activeRequest.amount))}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Active Prize Claim Banner */}
        {activePrizeClaim && (
          <TouchableOpacity
            style={styles.statusBanner}
            onPress={() => router.push('/chat')}
            activeOpacity={0.7}
          >
            <Text style={styles.statusBannerEmoji}>
              {PRIZE_STATUS_LABELS[activePrizeClaim.status]?.emoji || '🏆'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerText}>
                Premio · {PRIZE_STATUS_LABELS[activePrizeClaim.status]?.text || 'En proceso'}
              </Text>
              <Text style={styles.statusBannerAmount}>
                ${formatAmount(Number(activePrizeClaim.amount))}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Action Cards */}
        <View style={styles.cardsContainer}>
          <TouchableOpacity style={[styles.card, styles.cardHighlight]} onPress={handlePlayGame} activeOpacity={0.7}>
            <View style={[styles.cardIconCircle, { backgroundColor: colors.goldGlow }]}>
              <Ionicons name="game-controller-outline" size={32} color={colors.accent} />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Ir a Jugar</Text>
              <Text style={styles.cardSubtitle}>Abrir tioricojuegos.co</Text>
            </View>
            <Ionicons name="open-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.card} onPress={handleLoadCredits} activeOpacity={0.7}>
            <View style={[styles.cardIconCircle, { backgroundColor: colors.goldGlow }]}>
              <Ionicons name="cash-outline" size={32} color={colors.accent} />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Cargar Fichas</Text>
              <Text style={styles.cardSubtitle}>Compra fichas para jugar en el panel</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.card} onPress={handleClaimPrize} activeOpacity={0.7}>
            <View style={[styles.cardIconCircle, { backgroundColor: colors.goldGlow }]}>
              <Ionicons name="trophy-outline" size={32} color={colors.accentLight} />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Cobrar Premio</Text>
              <Text style={styles.cardSubtitle}>Retira tus ganancias a tu cuenta</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* Password Change Overlay (manual, not RN Modal — avoids platform quirks) */}
      {showPasswordModal && (
        <View style={pwStyles.overlay} pointerEvents="box-none">
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleClosePasswordModal}
          />
          <View style={pwStyles.card}>
            <View style={pwStyles.header}>
              <Ionicons name="key" size={24} color={colors.accent} />
              <Text style={pwStyles.title}>Cambiar Contraseña</Text>
              <TouchableOpacity onPress={handleClosePasswordModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={pwStyles.description}>
              Ingresa tu nueva contraseña para el panel de juego.
            </Text>
            <TextInput
              style={pwStyles.input}
              placeholder="Nueva contraseña"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              autoCapitalize="none"
            />
            <TextInput
              style={pwStyles.input}
              placeholder="Confirmar contraseña"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoCapitalize="none"
              onSubmitEditing={handleChangePassword}
            />
            <TouchableOpacity
              style={[pwStyles.button, changingPassword && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={changingPassword}
              activeOpacity={0.8}
            >
              {changingPassword ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={pwStyles.buttonText}>Cambiar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Prize Claim Overlay (manual, not RN Modal) */}
      {showPrizeModal && (
        <View style={prizeModalStyles.overlay} pointerEvents="box-none">
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleClosePrizeModal}
          />
          <View style={prizeModalStyles.card}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <PrizeClaimCard onCancel={handleClosePrizeModal} />
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
    </ImageBackground>
    </>
  );
}

const prizeModalStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    maxHeight: '85%',
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
});

const pwStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginLeft: 10,
  },
  description: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 16,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
});

const styles = StyleSheet.create({
  bgImage: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#5BD17A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2E7D3F',
  },
  successBannerText: {
    flex: 1,
    color: '#0F2D14',
    fontSize: 14,
    fontWeight: '600',
  },
  topBarButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(212, 160, 32, 0.5)',
  },
  whatsappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#25D366',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 6,
  },
  whatsappText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 20,
  },
  duckIcon: {
    width: 180,
    height: 180,
    borderRadius: 36,
    marginBottom: 16,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 3,
    borderColor: 'rgba(212, 160, 32, 0.6)',
  },
  title: {
    fontSize: 38,
    fontWeight: '900',
    color: colors.accent,
    letterSpacing: 5,
    textShadowColor: '#000000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 1,
  },
  titleSecondary: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.accentLight,
    letterSpacing: 10,
    marginTop: 2,
    textShadowColor: '#000000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
  divider: {
    width: 60,
    height: 3,
    backgroundColor: colors.accent,
    marginTop: 14,
    marginBottom: 14,
    borderRadius: 2,
  },
  welcome: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  username: {
    color: colors.accentLight,
    fontWeight: '800',
  },
  usernameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.goldGlowSubtle,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  usernameChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentLight,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 26, 20, 0.92)',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    gap: 10,
  },
  statusBannerEmoji: {
    fontSize: 20,
  },
  statusBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statusBannerAmount: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '700',
    marginTop: 1,
  },
  cardsContainer: {
    marginTop: 12,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 26, 20, 0.92)',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  cardHighlight: {
    borderLeftColor: colors.accentLight,
  },
  cardIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 3,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Chat Preview Widget
  chatPreview: {
    marginTop: 20,
    backgroundColor: 'rgba(18, 26, 20, 0.92)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  chatPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  chatPreviewIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  chatPreviewTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  chatPreviewMessages: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 50,
    justifyContent: 'center',
  },
  chatPreviewEmpty: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  chatPreviewMsg: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    gap: 8,
  },
  chatPreviewMsgIcon: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  chatPreviewMsgText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  chatPreviewMsgTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  chatPreviewInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  chatPreviewInput: {
    flex: 1,
    height: 36,
    backgroundColor: colors.input,
    borderRadius: 18,
    paddingHorizontal: 14,
    fontSize: 13,
    color: colors.textPrimary,
  },
  chatPreviewSend: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },

});
