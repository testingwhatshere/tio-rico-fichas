import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getSocket } from '@/services/socket';
import { useExport } from '@/hooks/useExport';
import ActivityItem, { getActionCategory } from '@/components/ActivityItem';

type FilterTab = 'all' | 'approval' | 'rejection' | 'message';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'approval', label: 'Aprobaciones' },
  { key: 'rejection', label: 'Rechazos' },
  { key: 'message', label: 'Mensajes' },
];

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const stats = useOperatorStore((s) => s.stats);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [activityLog, setActivityLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { exportData } = useExport();

  // Load activity log on mount and when refreshing
  const fetchActivity = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) {
      setLoading(false);
      return;
    }

    socket.emit('get_activity_log', {}, (response: any) => {
      if (response?.data && Array.isArray(response.data)) {
        setActivityLog(response.data);
      } else if (response?.logs && Array.isArray(response.logs)) {
        setActivityLog(response.logs);
      } else if (Array.isArray(response)) {
        setActivityLog(response);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchActivity();

    // Listen for new activity events
    const socket = getSocket();
    const handleNewActivity = (entry: any) => {
      setActivityLog((prev) => {
        // Dedup
        if (prev.some((item) => item.id === entry.id)) return prev;
        return [entry, ...prev];
      });
    };

    socket?.on('activity_log', handleNewActivity);
    socket?.on('new_activity', handleNewActivity);

    return () => {
      socket?.off('activity_log', handleNewActivity);
      socket?.off('new_activity', handleNewActivity);
    };
  }, [fetchActivity]);

  const filteredActivity = activeFilter === 'all'
    ? activityLog
    : activityLog.filter((item) => getActionCategory(item.action) === activeFilter);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchActivity();
    setTimeout(() => setRefreshing(false), 1000);
  }, [fetchActivity]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => <ActivityItem item={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: any, index: number) => item.id || `activity-${index}`,
    [],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Text style={styles.headerTitle}>Actividad</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            {activityLog.length} registro{activityLog.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.exportButton}
          onPress={() => exportData(filteredActivity, 'csv', 'Actividad')}
          activeOpacity={0.7}
        >
          <Ionicons name="download-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.key;
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
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List */}
      <FlatList
        data={filteredActivity}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredActivity.length === 0 && styles.listContentEmpty,
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
                name={loading ? 'hourglass-outline' : 'time-outline'}
                size={56}
                color={colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {loading ? 'Cargando...' : 'Sin actividad reciente'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {loading
                ? 'Obteniendo registros de actividad'
                : 'Las acciones de los operadores apareceran aqui'}
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
