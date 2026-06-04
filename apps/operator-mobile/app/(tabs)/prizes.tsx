import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getSocket } from '@/services/socket';
import PrizeClaimCard from '@/components/PrizeClaimCard';

type FilterTab = 'pending' | 'processing' | 'completed' | 'all';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'processing', label: 'Procesando' },
  { key: 'completed', label: 'Completados' },
  { key: 'all', label: 'Todos' },
];

const PENDING_STATUSES = ['VERIFIED', 'CHIPS_WITHDRAWN', 'FAILED'];
const PROCESSING_STATUSES = ['PROCESSING'];
const COMPLETED_STATUSES = ['COMPLETED', 'REJECTED'];

export default function PrizesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const prizeClaims = useOperatorStore((s) => s.prizeClaims);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('pending');
  const [refreshing, setRefreshing] = useState(false);

  const filteredClaims = prizeClaims.filter((c) => {
    if (activeFilter === 'pending') return PENDING_STATUSES.includes(c.status);
    if (activeFilter === 'processing') return PROCESSING_STATUSES.includes(c.status);
    if (activeFilter === 'completed') return COMPLETED_STATUSES.includes(c.status);
    return true;
  });

  const pendingCount = prizeClaims.filter((c) => PENDING_STATUSES.includes(c.status)).length;
  const processingCount = prizeClaims.filter((c) => PROCESSING_STATUSES.includes(c.status)).length;
  const completedCount = prizeClaims.filter((c) => COMPLETED_STATUSES.includes(c.status)).length;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('get_initial_data');
    }
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleClaimPress = useCallback(
    (claim: any) => {
      router.push(`/prize/${claim.id}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <PrizeClaimCard claim={item} onPress={() => handleClaimPress(item)} />
    ),
    [handleClaimPress],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const getTabCount = (key: FilterTab): number | undefined => {
    if (key === 'pending') return pendingCount > 0 ? pendingCount : undefined;
    if (key === 'processing') return processingCount > 0 ? processingCount : undefined;
    if (key === 'completed') return completedCount > 0 ? completedCount : undefined;
    return undefined;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Text style={styles.headerTitle}>Premios</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.key;
          const count = getTabCount(tab.key);
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.filterTab, isActive && styles.filterTabActive]}
              activeOpacity={0.7}
              onPress={() => setActiveFilter(tab.key)}
            >
              <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
                {tab.label}
              </Text>
              {count !== undefined && (
                <View style={[styles.filterBadge, isActive && styles.filterBadgeActive]}>
                  <Text style={[styles.filterBadgeText, isActive && styles.filterBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List */}
      <FlatList
        data={filteredClaims}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredClaims.length === 0 && styles.listContentEmpty,
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
              <Ionicons
                name={activeFilter === 'pending' ? 'trophy' : 'trophy-outline'}
                size={56}
                color={activeFilter === 'pending' ? colors.success : colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {activeFilter === 'pending'
                ? 'Sin premios pendientes'
                : activeFilter === 'processing'
                  ? 'Sin premios procesando'
                  : activeFilter === 'completed'
                    ? 'Sin premios completados'
                    : 'Sin reclamos de premios'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === 'pending'
                ? 'No hay retiros que requieran atencion'
                : 'Los reclamos de premios apareceran aqui'}
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
    marginBottom: 14,
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
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 14,
    gap: 8,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.cardBackground,
    gap: 6,
  },
  filterTabActive: {
    backgroundColor: colors.primary,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterTabTextActive: {
    color: colors.textOnPrimary,
  },
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeActive: {
    backgroundColor: colors.textOnPrimary + '30',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  filterBadgeTextActive: {
    color: colors.textOnPrimary,
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
