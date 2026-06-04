import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getSocket, emitWithTimeout } from '@/services/socket';
import PaymentCard from '@/components/PaymentCard';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';

type FilterTab = 'pending' | 'processing' | 'completed' | 'failed' | 'all';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'processing', label: 'En proceso' },
  { key: 'completed', label: 'Completados' },
  { key: 'failed', label: 'Fallidos' },
  { key: 'all', label: 'Todos' },
];

function filterPayments(payments: any[], filter: FilterTab): any[] {
  if (filter === 'all') return payments;
  if (filter === 'pending') return payments.filter((p) => p.status === 'PENDING' || p.status === 'CONFIRMED');
  if (filter === 'processing') return payments.filter((p) => p.status === 'QUEUED' || p.status === 'PROCESSING');
  if (filter === 'completed') return payments.filter((p) => p.status === 'COMPLETED');
  if (filter === 'failed') return payments.filter((p) => p.status === 'FAILED');
  return payments;
}

function countByFilter(payments: any[], filter: FilterTab): number {
  return filterPayments(payments, filter).length;
}

export default function PaymentsScreen() {
  const insets = useSafeAreaInsets();
  const outboundPayments = useOperatorStore((s) => s.outboundPayments);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('pending');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = filterPayments(outboundPayments, activeFilter);
  const pendingCount = countByFilter(outboundPayments, 'pending');

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('get_initial_data');
    }
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleConfirm = useCallback(async (payment: any) => {
    try {
      await emitWithTimeout('confirm_outbound_payment', { paymentId: payment.id }, 15000);
      hapticSuccess();
      toast.success('Pago confirmado');
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'Error al confirmar');
    }
  }, []);

  const handleRetry = useCallback(async (payment: any) => {
    try {
      await emitWithTimeout('retry_outbound_payment', { paymentId: payment.id }, 15000);
      hapticSuccess();
      toast.success('Reintentando pago');
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'Error al reintentar');
    }
  }, []);

  const handleCancel = useCallback((payment: any) => {
    Alert.prompt(
      'Cancelar pago',
      'Ingresa el motivo de la cancelacion:',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Cancelar pago',
          style: 'destructive',
          onPress: async (reason) => {
            try {
              await emitWithTimeout('cancel_outbound_payment', {
                paymentId: payment.id,
                reason: reason || 'Cancelado por operador',
              }, 15000);
              hapticSuccess();
              toast.success('Pago cancelado');
            } catch (err: any) {
              hapticError();
              toast.error(err?.message || 'Error al cancelar');
            }
          },
        },
      ],
      'plain-text',
      '',
    );
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <PaymentCard
        payment={item}
        onConfirm={item.status === 'PENDING' ? () => handleConfirm(item) : undefined}
        onRetry={item.status === 'FAILED' ? () => handleRetry(item) : undefined}
        onCancel={item.status === 'PENDING' || item.status === 'CONFIRMED' ? () => handleCancel(item) : undefined}
      />
    ),
    [handleConfirm, handleRetry, handleCancel],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const getTabCount = (key: FilterTab): number | undefined => {
    const c = countByFilter(outboundPayments, key);
    return c > 0 ? c : undefined;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Text style={styles.headerTitle}>Pagos</Text>
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
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filtered.length === 0 && styles.listContentEmpty,
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
                name={activeFilter === 'pending' ? 'checkmark-circle' : 'cash-outline'}
                size={56}
                color={activeFilter === 'pending' ? colors.success : colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {activeFilter === 'pending'
                ? 'Sin pagos pendientes'
                : activeFilter === 'failed'
                  ? 'Sin pagos fallidos'
                  : activeFilter === 'completed'
                    ? 'Sin pagos completados'
                    : 'Sin pagos registrados'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === 'pending'
                ? 'Los pagos de premios apareceran aqui'
                : 'Los pagos apareceran aqui cuando se generen'}
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
    flexWrap: 'wrap',
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
