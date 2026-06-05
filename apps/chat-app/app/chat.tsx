import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Image,
  ImageBackground,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { requestsApi, chatsApi, messagesApi, paymentApi, settingsApi, api, getErrorMessage } from '@/services/api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { sendMessage as sendSocketMessage, sendTyping, getSocket, joinChat, isSocketConnected } from '@/services/socket';
import { useNetwork } from '@/hooks/useNetwork';
import { hapticLight, hapticMedium } from '@/utils/haptics';
import { formatAmount } from '@/utils/amount';
import { crossAlert, crossConfirm } from '@/utils/dialog';
import ChatBubble, { Message, InteractiveCard } from '@/components/chat/ChatBubble';
import TypingIndicator from '@/components/chat/TypingIndicator';
import colors from '@/constants/colors';
// FloatingParticles removed from chat (only used in login)

import { useShareIntentContext } from 'expo-share-intent';
import { useChatFlow, ACTIVE_STATUSES } from '@/hooks/useChatFlow';
import { useMessages } from '@/hooks/useMessages';
import { useSocketHandlers } from '@/hooks/useSocketHandlers';
import { useProofUpload } from '@/hooks/useProofUpload';

const DEFAULT_SUPPORT_PHONE = '+54 9 11 6596-3996';

const CANCELABLE_STATUSES = new Set([
  'PENDING_PROOF',
  'VALIDATING',
  'VALIDATION_FAILED',
  'PENDING_MP_VERIFICATION',
  'APPROVED',
]);

export default function UnifiedChatScreen() {
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const flatListRef = useRef<FlatList>(null);
  const { isOffline } = useNetwork();
  const username = useAuthStore((s) => s.user?.username);

  const [chatId, setChatId] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  const [isOperatorTyping, setIsOperatorTyping] = useState(false);
  const [waitingForBot, setWaitingForBot] = useState(false);
  const waitingForBotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [supportPhone, setSupportPhone] = useState<string>(DEFAULT_SUPPORT_PHONE);

  // Refs for stale-closure prevention
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportPhoneRef = useRef(supportPhone);
  supportPhoneRef.current = supportPhone;

  // Custom hooks
  const {
    flowState,
    setFlowState,
    activeRequest,
    activeRequestRef,
    updateActiveRequest,
    wallet,
    setWallet,
    resetFlow,
    initFlowStateFromRequest,
  } = useChatFlow();

  const flowStateRef = useRef(flowState);
  flowStateRef.current = flowState;

  const {
    messages,
    setMessages,
    messagesRef,
    isLoadingMore,
    addBotMessage,
    addUserImageMessage,
    disableLastCard,
    loadMessages,
    loadMoreMessages,
    addIncomingMessage,
    replaceTempId,
    markMessagesAsRead,
  } = useMessages();

  const { handleProofUpload, isUploading: isProofUploading } = useProofUpload({
    activeRequestRef,
    disableLastCard,
    addBotMessage,
    addUserImageMessage,
    setFlowState,
  });

  // Refs for handlers declared further down (avoid temporal dead zone).
  const handleStartNewLoadRef = useRef<((prefillAmount?: number) => void) | null>(null);
  const handleAmountSelectedRef = useRef<((amount: number) => Promise<void> | void) | null>(null);

  // Socket handlers
  useSocketHandlers({
    chatIdRef,
    activeRequestRef,
    addIncomingMessage,
    addBotMessage,
    setFlowState,
    updateActiveRequest,
    setIsOperatorTyping,
    setWaitingForBot,
    setConnectionError,
    loadMessages,
    flowStateRef,
    markMessagesAsRead,
    handleProofUpload,
    handleStartNewLoad: (p) => handleStartNewLoadRef.current?.(p),
    handleAmountSelected: (a) => handleAmountSelectedRef.current?.(a),
  });

  // Glow animation for empty state
  const glowAnim = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.5, duration: 2000, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);
  }, []);

  // ==========================================
  // INITIALIZATION
  // ==========================================

  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      try {
        const chat = await chatsApi.getSupport();
        setChatId(chat.id);
        chatIdRef.current = chat.id;

        joinChat(chat.id);
        await loadMessages(chat.id);
        messagesApi.markAsRead(chat.id).catch(() => {});

        settingsApi.getPublic().then((s) => {
          if (s.supportPhoneNumber) setSupportPhone(s.supportPhoneNumber);
        }).catch(() => {});

        const allRequests = await requestsApi.getMy();
        const active = allRequests.find((r) => ACTIVE_STATUSES.includes(r.status));

        if (active) {
          updateActiveRequest(active);
          initFlowStateFromRequest(active, chat.id, addBotMessage, handlePaymentConfirmed, supportPhoneRef, handleProofUpload);
        } else {
          setFlowState('IDLE');
        }
      } catch (error) {
        console.error('[Chat] Initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initialize();
  }, []);

  // Auto-trigger action from home menu params (after initialization)
  const actionTriggered = useRef(false);
  useEffect(() => {
    if (isLoading || actionTriggered.current || !chatId) return;
    if (action === 'prize' && flowState === 'IDLE') {
      actionTriggered.current = true;
      addBotMessage('Completá los datos para cobrar tu premio:', {
        type: 'PRIZE_CLAIM',
        props: {},
      });
    } else if (action === 'load' && flowState === 'IDLE') {
      actionTriggered.current = true;
      handleStartNewLoad();
    }
  }, [isLoading, action, flowState, chatId]);

  // Handle share intent — user shared a receipt from another app (MercadoPago, bank, etc.)
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const shareProcessed = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || !shareIntent || shareProcessed.current || isLoading) return;
    shareProcessed.current = true;

    const processSharedFile = async () => {
      try {
        // Extract file from share intent
        const sharedFiles = shareIntent.files || [];
        if (sharedFiles.length === 0) {
          resetShareIntent();
          return;
        }

        const shared = sharedFiles[0];
        const fileUri = shared.path;
        const mimeType = shared.mimeType || 'image/jpeg';
        const fileName = shared.fileName || `comprobante-${Date.now()}.${mimeType === 'application/pdf' ? 'pdf' : 'jpg'}`;

        if (!fileUri) {
          resetShareIntent();
          return;
        }

        console.log('[Chat] Share intent received:', { fileUri, mimeType, fileName });

        // If there's an active request waiting for proof, upload directly
        if (activeRequestRef.current && (flowState === 'PROOF_PENDING' || flowState === 'PAYMENT_PENDING')) {
          addBotMessage('Comprobante recibido desde otra app! Subiendo...');
          await handleProofUpload({ uri: fileUri, type: mimeType, name: fileName });
        } else if (activeRequestRef.current) {
          // Request exists but not in AWAITING_PROOF state
          addBotMessage('Recibimos tu comprobante, pero tu solicitud actual no está esperando un comprobante en este momento.');
        } else {
          // No active request — guide user to create one first
          addBotMessage(
            'Recibimos tu comprobante! Para procesarlo, primero necesitas crear una solicitud de carga indicando el monto.',
            {
              type: 'AMOUNT_SELECTOR',
              props: { sharedFileUri: fileUri, sharedFileMimeType: mimeType, sharedFileName: fileName },
            },
          );
          setFlowState('INITIAL');
        }
      } catch (error: any) {
        console.error('[Chat] Share intent error:', error);
        addBotMessage('No pudimos procesar el archivo compartido. Intenta subirlo manualmente.');
      } finally {
        resetShareIntent();
      }
    };

    processSharedFile();
  }, [hasShareIntent, shareIntent, isLoading]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (waitingForBotTimer.current) clearTimeout(waitingForBotTimer.current);
    };
  }, []);

  // ==========================================
  // FLOW HANDLERS
  // ==========================================

  const handleStartNewLoad = (prefillAmount?: number) => {
    hapticMedium();
    setFlowState('INITIAL');
    addBotMessage('Hola! Vamos a cargar fichas. Cuanto queres cargar?', {
      type: 'AMOUNT_SELECTOR',
      props: {
        onAmountSelected: handleAmountSelected,
        ...(prefillAmount && prefillAmount >= 1000 ? { initialAmount: prefillAmount } : {}),
      },
    });
    scrollToBottom();
  };
  handleStartNewLoadRef.current = handleStartNewLoad;

  const handleAmountSelected = async (amount: number) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'USER',
      content: `$${formatAmount(amount)}`,
      senderId: 'current-user',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [userMessage, ...prev]);

    try {
      const req = await requestsApi.create(amount);
      disableLastCard();
      updateActiveRequest(req);

      // Fetch wallet separately — request already created, don't lose it
      let walletData;
      try {
        walletData = await paymentApi.getActiveWallet();
        if (!walletData) {
          addBotMessage('No hay billeteras disponibles en este momento. Tu solicitud fue creada. Intenta de nuevo en unos minutos.');
          setFlowState('PAYMENT_PENDING');
          return;
        }
        setWallet(walletData);
      } catch (walletError) {
        addBotMessage('No pudimos cargar los datos de pago. Tu solicitud fue creada. Contacta soporte o volve a intentar en unos minutos.');
        setFlowState('PAYMENT_PENDING');
        return;
      }

      const confirmMsg: Message = {
        id: Date.now().toString() + Math.random(),
        type: 'SYSTEM',
        content: `Genial! Vas a cargar $${formatAmount(amount)} en fichas.`,
        senderId: 'bot',
        createdAt: new Date().toISOString(),
      };

      const paymentDetailsMsg: Message = {
        id: Date.now().toString() + Math.random(),
        type: 'SYSTEM',
        content: 'Ahora hace la transferencia con estos datos:',
        senderId: 'bot',
        createdAt: new Date().toISOString(),
        interactiveCard: {
          type: 'PAYMENT_DETAILS',
          props: {
            wallet: walletData,
            amount,
            onPaymentConfirmed: handlePaymentConfirmed,
          },
        },
      };

      setMessages((prev) => [paymentDetailsMsg, confirmMsg, ...prev]);
      setFlowState('PAYMENT_PENDING');
    } catch (error) {
      addBotMessage('Error al crear la solicitud. Intenta de nuevo.');
      crossAlert('Error', getErrorMessage(error));
      setFlowState('IDLE');
    }
  };
  handleAmountSelectedRef.current = handleAmountSelected;

  const handleCancelRequest = async () => {
    const currentRequest = activeRequestRef.current;
    if (!currentRequest) {
      crossAlert('Sin solicitud activa', 'No encontramos una solicitud para cancelar.');
      return;
    }

    const ok = await crossConfirm(
      'Cancelar solicitud',
      'Estas seguro que queres cancelar la carga?',
      { confirmText: 'Si, cancelar', cancelText: 'No', destructive: true },
    );
    if (!ok) return;
    try {
      await requestsApi.cancel(currentRequest.id);
      addBotMessage('Solicitud cancelada.');
      resetFlow();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '';
      if (msg.includes('en proceso')) {
        addBotMessage('La carga ya está en proceso, no se puede cancelar.');
        crossAlert('No se pudo cancelar', 'La carga ya está en proceso.');
      } else {
        const errMsg = getErrorMessage(e);
        addBotMessage('No se pudo cancelar la solicitud.');
        crossAlert('No se pudo cancelar', errMsg);
      }
    }
  };

  const handlePaymentConfirmed = () => {
    disableLastCard();
    addBotMessage('Bien! Ahora necesitamos que subas una captura o foto del comprobante de pago:');
    addBotMessage('', {
      type: 'PROOF_UPLOAD',
      props: { onUpload: handleProofUpload },
    });
    setFlowState('PROOF_PENDING');
  };

  // ==========================================
  // IMAGE PICKER & SEND
  // ==========================================

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPendingImage(result.assets[0].uri);
    }
  };

  const sendImageMessage = async (imageUri: string) => {
    if (!chatId || sendingRef.current) return;

    sendingRef.current = true;
    setIsUploadingImage(true);
    try {
      const socket = getSocket();
      if (!socket?.connected) {
        crossAlert('Error', 'No se pudo enviar la imagen. Revisa tu conexion.');
        return;
      }

      const formData = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        (formData as any).append('file', blob, 'chat-image.jpg');
      } else {
        formData.append('file', {
          uri: imageUri,
          type: 'image/jpeg',
          name: 'chat-image.jpg',
        } as any);
      }

      const uploadResponse = await api.post('/uploads/chat-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      const imageUrl = uploadResponse.data.url;
      const content = messageText.trim() || ' ';
      const user = useAuthStore.getState().user;

      const tempId = `temp-${Date.now()}`;
      const optimisticMessage: Message = {
        id: tempId,
        type: 'USER',
        content,
        imageUrl,
        senderId: user?.id || 'current-user',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [optimisticMessage, ...prev]);
      setMessageText('');
      setPendingImage(null);
      Keyboard.dismiss();

      sendSocketMessage(chatId, content, activeRequest?.id, imageUrl, (ack: any) => {
        if (ack?.success && ack.message?.id) {
          replaceTempId(tempId, ack.message.id);
        }
      });

      scrollToBottom();
    } catch (error) {
      console.error('Error sending image:', error);
      crossAlert('Error', 'No se pudo enviar la imagen. Intenta de nuevo.');
    } finally {
      sendingRef.current = false;
      setIsUploadingImage(false);
    }
  };

  // ==========================================
  // TEXT MESSAGE SENDING
  // ==========================================

  const sendMessage = async () => {
    if (pendingImage) {
      hapticLight();
      return sendImageMessage(pendingImage);
    }

    if (!messageText.trim() || sendingRef.current || !chatId) return;

    hapticLight();
    sendingRef.current = true;
    setIsSending(true);
    try {
      const content = messageText.trim();

      const socket = getSocket();
      if (!socket?.connected) {
        crossAlert('Error', 'No se pudo enviar el mensaje. Revisa tu conexion.');
        return;
      }

      setMessageText('');
      Keyboard.dismiss();

      const user = useAuthStore.getState().user;
      const tempId = `temp-${Date.now()}`;
      const optimisticMessage: Message = {
        id: tempId,
        type: 'USER',
        content,
        senderId: user?.id || 'current-user',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [optimisticMessage, ...prev]);

      sendSocketMessage(chatId, content, activeRequest?.id, (ack: any) => {
        if (ack?.success && ack.message?.id) {
          replaceTempId(tempId, ack.message.id);
        }
      });

      // Block input until bot responds (prevents spam)
      setWaitingForBot(true);
      if (waitingForBotTimer.current) clearTimeout(waitingForBotTimer.current);
      waitingForBotTimer.current = setTimeout(() => setWaitingForBot(false), 30000);

      scrollToBottom();
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  // ==========================================
  // RENDER HELPERS
  // ==========================================

  const handleLoadMore = useCallback(() => {
    if (!chatId) return;
    loadMoreMessages(chatId, isOffline);
  }, [chatId, isOffline, loadMoreMessages]);

  const renderMessage = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const prevMessage = messagesRef.current[index + 1];
      return <ChatBubble message={item} previousMessage={prevMessage} />;
    },
    [],
  );

  const lastTypingSentRef = useRef(0);
  const handleTextChange = (text: string) => {
    setMessageText(text);
    if (chatId && text.trim()) {
      const now = Date.now();
      if (now - lastTypingSentRef.current > 500) {
        sendTyping(chatId);
        lastTypingSentRef.current = now;
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {}, 3000);
    }
  };

  // Help: two-option dialog → backend endpoint (notifies operators + Telegram)
  // or WhatsApp shortcut.
  const handleNeedHelp = async () => {
    hapticMedium();
    const wantsChat = await crossConfirm(
      '¿Cómo querés que te ayudemos?',
      'Podemos avisar al operador en este chat o abrir WhatsApp.',
      {
        confirmText: 'Avisar en el chat',
        cancelText: 'Abrir WhatsApp',
      },
    );
    if (wantsChat) {
      try {
        await chatsApi.requestHelp('chat');
        addBotMessage('Le avisamos al operador. Te respondemos por acá en unos minutos.');
        scrollToBottom();
      } catch (e: any) {
        const errMsg = getErrorMessage(e);
        crossAlert('No pudimos avisar', errMsg || 'Intentá de nuevo o probá por WhatsApp.');
      }
    } else {
      if (!supportPhone) {
        crossAlert('Sin numero', 'No hay un numero de soporte configurado.');
        return;
      }
      const tel = supportPhone.replace(/[^\d+]/g, '');
      const text = encodeURIComponent('Hola, necesito ayuda con mi carga/premio.');
      import('react-native').then(({ Linking }) => Linking.openURL(`https://wa.me/${tel}?text=${text}`));
    }
  };

  const handleSettings = async () => {
    hapticMedium();
    const { user, logout } = useAuthStore.getState();
    const displayName = user?.username || user?.email || 'Usuario';
    const ok = await crossConfirm(displayName, 'Cerrar sesion?', {
      confirmText: 'Cerrar Sesion',
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

  // ==========================================
  // LOADING STATE
  // ==========================================

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8, marginRight: 8 }} />
            <View>
              <Text style={styles.headerTitle}>TIO RICO</Text>
              <View style={styles.headerSubRow}>
                <Text style={styles.headerSubtitle}>FICHAS</Text>
                {username ? (
                  <>
                    <Text style={styles.headerDot}>·</Text>
                    <Ionicons name="person-circle" size={11} color={colors.textSecondary} />
                    <Text style={styles.headerUser} numberOfLines={1} ellipsizeMode="tail">
                      {username}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          </View>
        </View>
        <ImageBackground
          source={require('@/assets/chat-bg.png')}
          style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}
          resizeMode="cover"
        >
          <Image source={require('@/assets/icon.png')} style={{ width: 96, height: 96, borderRadius: 20, marginBottom: 20 }} />
          <ActivityIndicator size="large" color={colors.primary} />
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // ==========================================
  // RENDER
  // ==========================================

  const isInputDisabled = flowState === 'VALIDATING' || flowState === 'PROCESSING' || connectionError || waitingForBot;

  return (
    <ImageBackground
      source={require('@/assets/chat-bg.png')}
      style={styles.backgroundImage}
      resizeMode="cover"
    >
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/home');
              }}
              style={{ marginRight: 6 }}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8, marginRight: 8 }} />
            <View>
              <Text style={styles.headerTitle}>TIO RICO</Text>
              <View style={styles.headerSubRow}>
                <Text style={styles.headerSubtitle}>FICHAS</Text>
                {username ? (
                  <>
                    <Text style={styles.headerDot}>·</Text>
                    <Ionicons name="person-circle" size={11} color={colors.textSecondary} />
                    <Text style={styles.headerUser} numberOfLines={1} ellipsizeMode="tail">
                      {username}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleSettings}
            style={styles.headerButton}
            activeOpacity={0.7}
          >
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Offline Banner */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline" size={16} color={colors.warning} />
            <Text style={styles.offlineBannerText}>Sin conexion</Text>
          </View>
        )}

        {/* Connection Error Banner */}
        {connectionError && !isOffline && (
          <View style={styles.connectionErrorBanner}>
            <Ionicons name="warning" size={16} color={colors.error} />
            <Text style={styles.connectionErrorText}>Conexion perdida con el servidor</Text>
          </View>
        )}

        {/* Support Phone Banner */}
        {supportPhone ? (
          <TouchableOpacity
            style={styles.supportBanner}
            onPress={() => {
              const tel = supportPhone.replace(/[^\d+]/g, '');
              import('react-native').then(({ Linking }) => Linking.openURL(`tel:${tel}`));
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="call-outline" size={14} color={colors.white} />
            <Text style={styles.supportBannerText}>Soporte: {supportPhone}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          inverted
          style={styles.flatList}
          contentContainerStyle={[
            styles.messagesList,
            messages.length === 0 && styles.messagesListEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Image source={require('@/assets/icon.png')} style={{ width: 80, height: 80, borderRadius: 16, marginBottom: 8 }} />
              <Text style={styles.emptyTitle}>TIO RICO</Text>
              <Text style={styles.emptyTagline}>TU PORTAL DE FICHAS</Text>
              <View style={styles.emptyDivider} />
              <Text style={styles.emptySubtext}>
                Toca el boton de abajo para cargar fichas.{'\n'}
                Elegis el monto, pagas y listo!
              </Text>
            </View>
          }
        />

        {/* Typing Indicator */}
        <TypingIndicator isVisible={isOperatorTyping || waitingForBot} />

        {/* Cancel button — visible only when backend allows cancellation */}
        {!isOffline && activeRequest && CANCELABLE_STATUSES.has(activeRequest.status) && (
          <View style={styles.ctaContainer}>
            <TouchableOpacity
              style={[styles.ctaButton, { opacity: 0.8 }]}
              onPress={handleCancelRequest}
              activeOpacity={0.7}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.ctaButtonText, { color: colors.error, fontSize: 13 }]}>CANCELAR SOLICITUD</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action Footer: ask-for-help (in-chat) + WhatsApp shortcut. */}
        <View style={styles.actionFooter}>
          <TouchableOpacity
            testID="footer-help-button"
            accessibilityLabel="Necesito ayuda"
            style={styles.helpFooterButton}
            onPress={handleNeedHelp}
            activeOpacity={0.8}
          >
            <Ionicons name="help-circle" size={22} color={colors.textOnPrimary} />
            <Text style={styles.helpFooterText}>Necesito ayuda</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="footer-whatsapp-button"
            accessibilityLabel="Hablar por WhatsApp"
            style={styles.whatsappFooterButton}
            onPress={() => {
              if (!supportPhone) return;
              const tel = supportPhone.replace(/[^\d+]/g, '');
              import('react-native').then(({ Linking }) => Linking.openURL(`https://wa.me/${tel}`));
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="logo-whatsapp" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' ? { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' as const } : {}),
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    ...(Platform.OS === 'web' ? { overflow: 'hidden' as const } : {}),
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.textSecondary,
  },
  keyboardView: {
    flex: 1,
    ...(Platform.OS === 'web' ? { overflow: 'hidden' as const } : {}),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(18, 26, 20, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.accent,
    letterSpacing: 2,
    textShadowColor: colors.goldShadow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  headerSubtitle: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.accentLight,
    letterSpacing: 4,
    marginTop: -1,
  },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -1,
  },
  headerDot: {
    fontSize: 9,
    color: colors.textMuted,
    marginHorizontal: 2,
  },
  headerUser: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '600',
    maxWidth: 140,
  },
  headerButton: {
    padding: 4,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(237, 137, 54, 0.15)',
    paddingVertical: 6,
    gap: 6,
  },
  offlineBannerText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '500',
  },
  connectionErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 101, 101, 0.15)',
    paddingVertical: 6,
    gap: 6,
  },
  connectionErrorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '500',
  },
  supportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 6,
  },
  supportBannerText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  flatList: {
    flex: 1,
  },
  messagesList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  messagesListEmpty: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    transform: [{ rotate: '180deg' }],
  },
  emptyIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primaryGlow2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.accent,
    letterSpacing: 3,
    textShadowColor: colors.goldShadow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  emptyTagline: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accentLight,
    letterSpacing: 3,
    marginTop: 4,
  },
  emptyDivider: {
    width: 40,
    height: 2,
    backgroundColor: colors.chipBorder,
    marginVertical: 16,
    borderRadius: 1,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
  },
  ctaContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(18, 26, 20, 0.9)',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: colors.accent,
    paddingVertical: 16,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textOnPrimary,
    letterSpacing: 1.5,
  },
  pendingImageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pendingImageThumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  pendingImageRemove: {
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: 'rgba(18, 26, 20, 0.95)',
    gap: 8,
  },
  imagePickerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.input,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.buttonDisabled,
  },
  actionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: 'rgba(18, 26, 20, 0.95)',
    gap: 10,
  },
  primaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
    minHeight: 48,
  },
  primaryActionButtonDisabled: {
    backgroundColor: colors.buttonDisabled,
  },
  primaryActionText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  whatsappFooterButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#25D366',
    justifyContent: 'center',
    alignItems: 'center',
  },
  whatsappFooterText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  helpFooterButton: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  helpFooterText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.5,
  },
});
