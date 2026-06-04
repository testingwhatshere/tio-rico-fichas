import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getSocket, emitWithTimeout } from '@/services/socket';
import { useExport } from '@/hooks/useExport';
import JobCard from '@/components/JobCard';

type FilterTab = 'all' | 'processing' | 'completed' | 'failed';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'processing', label: 'Procesando' },
  { key: 'completed', label: 'Completados' },
  { key: 'failed', label: 'Fallidos' },
];

const FILTER_STATUSES: Record<FilterTab, string[]> = {
  all: [],
  processing: ['QUEUED', 'PROCESSING'],
  completed: ['COMPLETED'],
  failed: ['FAILED'],
};

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const jobs = useOperatorStore((s) => s.jobs);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { exportData } = useExport();
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const filteredJobs = activeFilter === 'all'
    ? jobs
    : jobs.filter((j) => FILTER_STATUSES[activeFilter].includes(j.status));

  const processingCount = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'PROCESSING').length;
  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failedCount = jobs.filter((j) => j.status === 'FAILED').length;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('get_initial_data');
    }
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleRetry = useCallback(async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      const result = await emitWithTimeout<any>('retry_job', { jobId });
      if (result?.error) {
        hapticError();
        toast.error(result.error);
      } else {
        hapticSuccess();
        toast.success('Job reencolado correctamente');
      }
    } catch (err: any) {
      hapticError();
      toast.error(err.message || 'No se pudo reintentar el job');
    } finally {
      setRetryingJobId(null);
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <JobCard job={item} onRetry={handleRetry} />
    ),
    [handleRetry],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const getTabCount = (key: FilterTab): number | undefined => {
    if (key === 'processing') return processingCount > 0 ? processingCount : undefined;
    if (key === 'completed') return completedCount > 0 ? completedCount : undefined;
    if (key === 'failed') return failedCount > 0 ? failedCount : undefined;
    return undefined;
  };

  const emptyIcon = activeFilter === 'completed'
    ? 'checkmark-done-outline'
    : activeFilter === 'failed'
      ? 'alert-circle-outline'
      : activeFilter === 'processing'
        ? 'rocket-outline'
        : 'briefcase-outline';

  const emptyTitle = activeFilter === 'completed'
    ? 'Sin jobs completados'
    : activeFilter === 'failed'
      ? 'Sin jobs fallidos'
      : activeFilter === 'processing'
        ? 'Sin jobs en proceso'
        : 'Sin jobs registrados';

  const emptySubtitle = activeFilter === 'processing'
    ? 'No hay jobs procesando actualmente'
    : activeFilter === 'failed'
      ? 'No hay jobs fallidos'
      : 'Los jobs apareceran aqui cuando se encolen';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Text style={styles.headerTitle}>Jobs</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            {jobs.length} total &middot; {processingCount} en proceso
          </Text>
        </View>
        <TouchableOpacity
          style={styles.exportButton}
          onPress={() => exportData(filteredJobs, 'csv', 'Jobs')}
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
        data={filteredJobs}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredJobs.length === 0 && styles.listContentEmpty,
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
              <Ionicons name={emptyIcon as any} size={56} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
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
