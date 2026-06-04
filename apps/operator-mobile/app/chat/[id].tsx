import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOperatorStore, DEFAULT_QUICK_REPLIES } from '@/stores/operator.store';
import { getSocket, emitWithTimeout, isConnected } from '@/services/socket';
import { useNetwork } from '@/hooks/useNetwork';
import ChatBubble from '@/components/ChatBubble';
import ChatInput from '@/components/ChatInput';
import QuickReplyChip from '@/components/QuickReplyChip';
import { hapticLight, hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import colors from '@/constants/colors';

const PAGE_SIZE = 30;

export default function ChatDetailScreen() {
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isOffline } = useNetwork();

  // Store selectors
  const chat = useOperatorStore((s) => s.chats.find((c) => c.id === chatId));
  const messages = useOperatorStore((s) => s.chatMessages[chatId!] || []);
  const storeQuickReplies = useOperatorStore((s) => s.quickReplies);
  const quickReplies = storeQuickReplies.length > 0 ? storeQuickReplies : DEFAULT_QUICK_REPLIES;
  const hasMore = useOperatorStore((s) => s.chatMessageHasMore[chatId!] ?? true);
  const cursor = useOperatorStore((s) => s.chatMessageCursors[chatId!]);
  const setSelectedChat = useOperatorStore((s) => s.setSelectedChat);
  const setChatMessages = useOperatorStore((s) => s.setChatMessages);
  const appendOlderMessages = useOperatorStore((s) => s.appendOlderMessages);
  const addMessage = useOperatorStore((s) => s.addMessage);
  const updateChat = useOperatorStore((s) => s.updateChat);

  // Local state
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [userTyping, setUserTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatIdRef = useRef(chatId);
  const flatListRef = useRef<FlatList>(null);

  // Keep chatId ref fresh
  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  // ---- Mark as read + set selected chat on mount ----
  useEffect(() => {
    if (!chatId) return;

    setSelectedChat(chatId);

    // Mark as read via socket
    const socket = getSocket();
    if (socket?.connected) {
      emitWithTimeout('mark_read', { chatId }).catch(() => {});
    }

    return () => {
      setSelectedChat(null);
      // Clean up typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [chatId, setSelectedChat]);

  // ---- Load initial messages ----
  useEffect(() => {
    if (!chatId) return;
    loadInitialMessages();
  }, [chatId]);

  // ---- Socket event listeners for this chat ----
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = (data: any) => {
      if (!data || data.chatId !== chatIdRef.current) return;
      addMessage(data.chatId, data.message || data);
      // Auto-scroll to bottom on new message
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    };

    const handleTyping = (data: any) => {
      if (!data || data.chatId !== chatIdRef.current) return;
      // Only show typing for user messages (not our own)
      if (data.type === 'OPERATOR' || data.senderType === 'OPERATOR') return;

      setUserTyping(true);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        setUserTyping(false);
      }, 3000);
    };

    socket.on('new_message', handleNewMessage);
    socket.on('typing', handleTyping);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('typing', handleTyping);
    };
  }, [addMessage]);

  // ---- Message loading ----
  const loadInitialMessages = useCallback(async () => {
    if (!chatId) return;
    setIsLoadingInitial(true);

    try {
      const response = await emitWithTimeout<any>('get_chat_messages', {
        chatId,
        limit: PAGE_SIZE,
      });

      if (chatIdRef.current !== chatId) return; // stale guard

      // Backend returns { success, data: { messages, cursor } }
      const payload = response?.data || response;
      const msgs: any[] = payload?.messages || [];
      const nextCursor = payload?.cursor || undefined;
      const moreAvailable = msgs.length >= PAGE_SIZE;

      // Messages come newest-first from backend; store in chronological order
      const chronological = [...msgs].reverse();
      setChatMessages(chatId, chronological, nextCursor, moreAvailable);
    } catch (err) {
      console.warn('[Chat] Failed to load messages:', err);
    } finally {
      setIsLoadingInitial(false);
    }
  }, [chatId, setChatMessages]);

  const loadMoreMessages = useCallback(async () => {
    if (!chatId || !hasMore || isLoadingMore || isOffline) return;

    setIsLoadingMore(true);
    try {
      const response = await emitWithTimeout<any>('get_chat_messages', {
        chatId,
        cursor,
        limit: PAGE_SIZE,
      });

      if (chatIdRef.current !== chatId) return;

      // Backend returns { success, data: { messages, cursor } }
      const payload = response?.data || response;
      const msgs: any[] = payload?.messages || [];
      const nextCursor = payload?.cursor || undefined;
      const moreAvailable = msgs.length >= PAGE_SIZE;

      // Older messages in chronological order
      const chronological = [...msgs].reverse();
      appendOlderMessages(chatId, chronological, nextCursor, moreAvailable);
    } catch (err) {
      console.warn('[Chat] Failed to load more messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [chatId, cursor, hasMore, isLoadingMore, isOffline, appendOlderMessages]);

  // ---- Send message ----
  const handleSend = useCallback(
    async (text: string) => {
      if (!chatId || !text.trim()) return;

      if (!isConnected()) {
        Alert.alert('Sin conexion', 'No se puede enviar el mensaje. Verifica tu conexion.');
        return;
      }

      try {
        const response = await emitWithTimeout<any>('send_message', {
          chatId,
          content: text.trim(),
        });

        if (response?.error || response?.success === false) {
          hapticError();
          toast.error(response?.error || 'No se pudo enviar el mensaje');
        } else {
          hapticLight();
        }
      } catch (err: any) {
        hapticError();
        toast.error(err?.message || 'No se pudo enviar el mensaje');
      }
    },
    [chatId],
  );

  // ---- Typing indicator emit ----
  const handleTyping = useCallback(() => {
    if (!chatId) return;
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('typing', { chatId });
    }
  }, [chatId]);

  // ---- Quick reply tap (auto-send) ----
  const handleQuickReply = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  // ---- Close chat ----
  const handleCloseChat = useCallback(() => {
    Alert.alert(
      'Cerrar chat',
      'Seguro que queres cerrar este chat?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar',
          style: 'destructive',
          onPress: async () => {
            try {
              await emitWithTimeout('close_chat', { chatId });
              hapticSuccess();
              toast.success('Chat cerrado');
              updateChat(chatId!, { status: 'CLOSED' });
              router.back();
            } catch (err: any) {
              hapticError();
              toast.error(err?.message || 'No se pudo cerrar el chat');
            }
          },
        },
      ],
    );
  }, [chatId, router, updateChat]);

  // ---- Render helpers ----
  const username =
    chat?.user?.username || chat?.user?.email || 'Usuario';

  // FlatList is inverted: newest messages at index 0
  const invertedMessages = [...messages].reverse();

  const renderMessage = useCallback(
    ({ item }: { item: any }) => <ChatBubble message={item} />,
    [],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const renderFooter = useCallback(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [isLoadingMore]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={26} color={colors.primary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerUsername} numberOfLines={1}>
              {username}
            </Text>
            {userTyping && (
              <Text style={styles.typingText}>escribiendo...</Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleCloseChat}
            activeOpacity={0.7}
          >
            <Text style={styles.closeButtonText}>Cerrar</Text>
          </TouchableOpacity>
        </View>

        {/* Offline banner */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color={colors.white} />
            <Text style={styles.offlineBannerText}>Sin conexion</Text>
          </View>
        )}

        {/* Messages */}
        {isLoadingInitial ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={invertedMessages}
            renderItem={renderMessage}
            keyExtractor={keyExtractor}
            inverted
            contentContainerStyle={styles.messagesList}
            ListFooterComponent={renderFooter}
            onEndReached={loadMoreMessages}
            onEndReachedThreshold={0.3}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                <Text style={styles.emptyMessagesText}>
                  No hay mensajes aun
                </Text>
              </View>
            }
          />
        )}

        {/* Typing indicator bar */}
        {userTyping && !isLoadingInitial && (
          <View style={styles.typingBar}>
            <View style={styles.typingDots}>
              <View style={[styles.typingDot, styles.typingDot1]} />
              <View style={[styles.typingDot, styles.typingDot2]} />
              <View style={[styles.typingDot, styles.typingDot3]} />
            </View>
            <Text style={styles.typingBarText}>{username} esta escribiendo...</Text>
          </View>
        )}

        {/* Quick replies */}
        {quickReplies.length > 0 && !isOffline && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickRepliesContainer}
            keyboardShouldPersistTaps="handled"
          >
            {quickReplies.map((qr) => (
              <QuickReplyChip
                key={qr.id}
                icon={qr.icon}
                label={qr.label}
                onPress={() => handleQuickReply(qr.text)}
              />
            ))}
          </ScrollView>
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          onTyping={handleTyping}
          disabled={isOffline || !isConnected()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    marginLeft: 4,
  },
  headerUsername: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  typingText: {
    fontSize: 12,
    color: colors.primary,
    fontStyle: 'italic',
    marginTop: 1,
  },
  closeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.error + '20',
    borderRadius: 8,
  },
  closeButtonText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },

  // Offline banner
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
    paddingVertical: 6,
    gap: 6,
  },
  offlineBannerText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },

  // Messages list
  messagesList: {
    paddingVertical: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingMore: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyMessages: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    // In inverted FlatList, empty component is also inverted
    transform: [{ scaleY: -1 }],
  },
  emptyMessagesText: {
    color: colors.textMuted,
    fontSize: 15,
  },

  // Typing indicator bar
  typingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: colors.backgroundSecondary,
    gap: 8,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 3,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    opacity: 0.6,
  },
  typingDot1: {
    opacity: 0.4,
  },
  typingDot2: {
    opacity: 0.6,
  },
  typingDot3: {
    opacity: 0.9,
  },
  typingBarText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },

  // Quick replies
  quickRepliesContainer: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.backgroundSecondary,
  },
});
