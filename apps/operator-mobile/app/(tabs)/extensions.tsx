import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getSocket, emitWithTimeout } from '@/services/socket';
import ExtensionCard from '@/components/ExtensionCard';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';

export default function ExtensionsScreen() {
  const insets = useSafeAreaInsets();
  const extensions = useOperatorStore((s) => s.extensions);
  const [refreshing, setRefreshing] = useState(false);

  const onlineCount = extensions.filter((e: any) => e.status === 'online' || e.status === 'busy').length;
  const errorCount = extensions.filter((e: any) => e.status === 'error').length;
  const offlineCount = extensions.filter((e: any) => e.status === 'offline').length;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('get_initial_data');
    }
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleResetCircuitBreaker = useCallback(async (extensionId: string) => {
    try {
      await emitWithTimeout('reset_circuit_breaker', { extensionId }, 15000);
      hapticSuccess();
      toast.success('Extension reactivada');
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'Error al reactivar');
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <ExtensionCard
        extension={item}
        onResetCircuitBreaker={
          item.circuitBreakerActive || (item.consecutiveErrors || 0) >= 3
            ? () => handleResetCircuitBreaker(item.extensionId)
            : undefined
        }
      />
    ),
    [handleResetCircuitBreaker],
  );

  const keyExtractor = useCallback((item: any) => item.extensionId || item.id || Math.random().toString(), []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Text style={styles.headerTitle}>Extensiones</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            {onlineCount} online · {errorCount > 0 ? `${errorCount} error · ` : ''}{offlineCount} offline
          </Text>
        </View>
      </View>

      {/* Summary badges */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryBadge, { backgroundColor: colors.success + '20' }]}>
          <View style={[styles.summaryDot, { backgroundColor: colors.success }]} />
          <Text style={[styles.summaryText, { color: colors.success }]}>{onlineCount} Online</Text>
        </View>
        {errorCount > 0 && (
          <View style={[styles.summaryBadge, { backgroundColor: colors.error + '20' }]}>
            <View style={[styles.summaryDot, { backgroundColor: colors.error }]} />
            <Text style={[styles.summaryText, { color: colors.error }]}>{errorCount} Error</Text>
          </View>
        )}
        <View style={[styles.summaryBadge, { backgroundColor: colors.textMuted + '20' }]}>
          <View style={[styles.summaryDot, { backgroundColor: colors.textMuted }]} />
          <Text style={[styles.summaryText, { color: colors.textMuted }]}>{offlineCount} Offline</Text>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={extensions}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          extensions.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
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
            <View style={styles.emptyIconContainer}>
              <Ionicons name="extension-puzzle-outline" size={56} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Sin extensiones conectadas</Text>
            <Text style={styles.emptySubtitle}>
              Las extensiones aparecen aqui cuando se conectan al servidor
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 14,
    gap: 8,
  },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 100,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.cardBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
