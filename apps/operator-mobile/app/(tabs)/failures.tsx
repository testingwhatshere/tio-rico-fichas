import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useFirstLoad } from '@/hooks/useFirstLoad';
import { EmptyState } from '@/components/ui';
import { useOperatorStore, isFailureResolved } from '@/stores/operator.store';
import { getSocket } from '@/services/socket';
import { useExport } from '@/hooks/useExport';
import FailureCard from '@/components/FailureCard';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import { emitWithTimeout } from '@/services/socket';

type FilterTab = 'pending' | 'resolved' | 'all';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'resolved', label: 'Resueltos' },
  { key: 'all', label: 'Todos' },
];

export default function FailuresScreen() {
  const { isLoadingFirst, isConnected } = useFirstLoad();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const failures = useOperatorStore((s) => s.failures);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('pending');
  const [refreshing, setRefreshing] = useState(false);
  const { exportData } = useExport();

  const filteredFailures = failures.filter((f) => {
    if (activeFilter === 'pending') return !isFailureResolved(f);
    if (activeFilter === 'resolved') return isFailureResolved(f);
    return true;
  });

  const pendingCount = failures.filter((f) => !isFailureResolved(f)).length;
  const resolvedCount = failures.filter((f) => isFailureResolved(f)).length;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const socket = getSocket();
    if (socket?.connected) {
      // The backend answers get_initial_data via ACK callback, it does NOT
      // broadcast an `initial_data` event — so a fire-and-forget emit did
      // nothing and the Fallos list never refreshed. Use the ack callback.
      socket.emit('get_initial_data', {}, (response: any) => {
        if (response?.success && response?.data) {
          useOperatorStore.getState().setInitialData(response.data);
        }
        setRefreshing(false);
      });
      // Safety timeout in case no ack arrives.
      setTimeout(() => setRefreshing(false), 8000);
    } else {
      setRefreshing(false);
    }
  }, []);

  const handleFailurePress = useCallback(
    (failure: any) => {
      router.push(`/failure/${failure.id}`);
    },
    [router],
  );



  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <FailureCard failure={item} onPress={() => handleFailurePress(item)} />
    ),
    [handleFailurePress],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const getTabCount = (key: FilterTab): number | undefined => {
    if (key === 'pending') return pendingCount > 0 ? pendingCount : undefined;
    if (key === 'resolved') return resolvedCount > 0 ? resolvedCount : undefined;
    return undefined;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/logo.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Text style={styles.headerTitle}>Fallos</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.exportButton}
          onPress={() => exportData(filteredFailures, 'csv', 'Fallos')}
          activeOpacity={0.7}
        >
          <Ionicons name="download-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
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
        data={filteredFailures}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredFailures.length === 0 && styles.listContentEmpty,
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
          isLoadingFirst ? (
            <EmptyState loading connected={isConnected} title="" />
          ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons
                name={activeFilter === 'pending' ? 'checkmark-circle' : 'folder-open-outline'}
                size={56}
                color={activeFilter === 'pending' ? colors.success : colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {activeFilter === 'pending'
                ? 'Sin fallos pendientes'
                : activeFilter === 'resolved'
                  ? 'Sin fallos resueltos'
                  : 'Sin fallos registrados'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === 'pending'
                ? 'Todo el sistema funciona correctamente'
                : 'Los fallos apareceran aqui cuando ocurran'}
            </Text>
          </View>
          )
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
  exportButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
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
