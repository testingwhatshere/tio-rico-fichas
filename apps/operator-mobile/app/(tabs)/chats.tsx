import React, { useState, useCallback, useEffect } from 'react';
import { View, FlatList, Text, StyleSheet, RefreshControl, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useOperatorStore } from '@/stores/operator.store';
import ChatListItem from '@/components/ChatListItem';
import colors from '@/constants/colors';

export default function ChatsScreen() {
  const router = useRouter();
  const chats = useOperatorStore((s) => s.chats);
  const lastUpdate = useOperatorStore((s) => s.lastUpdate);
  const [loading, setLoading] = useState(!lastUpdate);

  useEffect(() => {
    if (lastUpdate) setLoading(false);
  }, [lastUpdate]);

  const handlePressChat = useCallback(
    (chatId: string) => {
      router.push(`/chat/${chatId}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <ChatListItem
        chat={item}
        onPress={() => handlePressChat(item.id)}
      />
    ),
    [handlePressChat],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const { getSocket } = require('@/services/socket');
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('get_chats', {}, () => setRefreshing(false));
      setTimeout(() => setRefreshing(false), 3000);
    } else {
      setRefreshing(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Image source={require('@/assets/icon.png')} style={styles.headerIcon} />
        <Text style={styles.headerTitle}>Chats</Text>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>{chats.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando chats...</Text>
        </View>
      ) : (
        <FlatList
          data={chats}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={chats.length === 0 ? styles.emptyContainer : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Image source={require('@/assets/icon.png')} style={styles.emptyImage} />
              <Text style={styles.emptyTitle}>Sin chats activos</Text>
              <Text style={styles.emptySubtitle}>
                Los chats con usuarios apareceran aqui
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor: colors.background,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerBadge: {
    marginLeft: 10,
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 12,
    minWidth: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerBadgeText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 12,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyImage: {
    width: 64,
    height: 64,
    borderRadius: 16,
    opacity: 0.5,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
