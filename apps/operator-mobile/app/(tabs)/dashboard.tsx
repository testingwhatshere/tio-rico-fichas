import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore, isFailureResolved } from '@/stores/operator.store';
import { useAuthStore } from '@/stores/auth.store';
import StatCard from '@/components/StatCard';
import { getSocket } from '@/services/socket';

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isConnected = useAuthStore((s) => s.isConnected);

  const failures = useOperatorStore((s) => s.failures);
  const jobs = useOperatorStore((s) => s.jobs);
  const chats = useOperatorStore((s) => s.chats);
  const botStatus = useOperatorStore((s) => s.botStatus);
  const botStatusPerPanel = useOperatorStore((s) => s.botStatusPerPanel);
  const connectedPanels = useOperatorStore((s) => s.connectedPanels);
  const validatorConnected = useOperatorStore((s) => s.validatorConnected);
  const killSwitchActive = useOperatorStore((s) => s.killSwitchActive);
  const stats = useOperatorStore((s) => s.stats);

  // Computed values
  const pendingFailures = failures.filter((f) => !isFailureResolved(f)).length;
  const processingJobs = jobs.filter(
    (j) => j.status === 'PROCESSING' || j.status === 'QUEUED',
  ).length;
  const activeChats = chats.filter((c) => (c.unreadCount || 0) > 0).length;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const completedToday =
    stats?.completedToday ??
    jobs.filter(
      (j) => j.status === 'COMPLETED' && new Date(j.completedAt || j.updatedAt) >= todayStart,
    ).length;

  const panelCount = Object.keys(botStatusPerPanel).length;
  const onlinePanels = Object.values(botStatusPerPanel).filter(
    (s) => s === 'online' || s === 'busy',
  ).length;
  const hasPerPanel = panelCount > 0;
  const botConnected = hasPerPanel
    ? onlinePanels > 0
    : botStatus === 'connected' || botStatus === 'idle' || botStatus === 'online' || botStatus === 'busy';
  const botBusy = hasPerPanel
    ? Object.values(botStatusPerPanel).some((s) => s === 'busy')
    : botStatus === 'busy';

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Data refreshes automatically via socket initial_data
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('get_initial_data', {}, () => setRefreshing(false));
      setTimeout(() => setRefreshing(false), 3000); // fallback timeout
    } else {
      setRefreshing(false);
    }
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/icon.png')} style={{ width: 36, height: 36, borderRadius: 10 }} />
            <Text style={styles.headerTitle}>Tio Rico</Text>
          </View>
          <Text style={styles.headerSubtitle}>Panel de Operadores</Text>
        </View>
        <View style={styles.headerRight}>
          <View
            style={[
              styles.connectionDot,
              { backgroundColor: isConnected ? colors.onlineGreen : colors.error },
            ]}
          />
          <Text style={styles.connectionText}>
            {isConnected ? 'Conectado' : 'Desconectado'}
          </Text>
        </View>
      </View>

      {/* Kill switch warning */}
      {killSwitchActive && (
        <View style={styles.killSwitchBanner}>
          <Ionicons name="warning" size={18} color={colors.error} />
          <Text style={styles.killSwitchText}>
            Kill Switch ACTIVO - Automatizacion detenida
          </Text>
        </View>
      )}

      {/* Stat cards - 2x2 grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          <StatCard
            title="Fallos pendientes"
            value={pendingFailures}
            icon="alert-circle"
            color={pendingFailures > 0 ? colors.error : colors.success}
            onPress={() => router.push('/(tabs)/failures')}
          />
          <StatCard
            title="Jobs procesando"
            value={processingJobs}
            icon="rocket"
            color={colors.info}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard
            title="Chats activos"
            value={activeChats}
            icon="chatbubbles"
            color={colors.primary}
          />
          <StatCard
            title="Completados hoy"
            value={completedToday}
            icon="checkmark-done"
            color={colors.success}
          />
        </View>
      </View>

      {/* System health */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Estado del sistema</Text>
        <View style={styles.healthCard}>
          <HealthRow
            label="Bots de automatizacion"
            connected={botConnected}
            detail={
              hasPerPanel
                ? `${onlinePanels}/${panelCount} paneles online${botBusy ? ' (procesando)' : ''}`
                : botBusy
                  ? 'Procesando...'
                  : botConnected
                    ? 'Disponible'
                    : 'Desconectado'
            }
            icon="hardware-chip"
          />
          <View style={styles.healthSeparator} />
          <HealthRow
            label="Validador AI"
            connected={validatorConnected}
            detail={validatorConnected ? 'Conectado' : 'Desconectado'}
            icon="eye"
          />
          <View style={styles.healthSeparator} />
          <HealthRow
            label="Kill Switch"
            connected={!killSwitchActive}
            detail={killSwitchActive ? 'ACTIVADO' : 'Desactivado'}
            icon="power"
            dangerWhenActive
          />
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Acciones rapidas</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionFailures]}
            activeOpacity={0.7}
            onPress={() => router.push('/(tabs)/failures')}
          >
            <Ionicons name="alert-circle" size={22} color={colors.error} />
            <Text style={styles.actionButtonText}>Ver Fallos</Text>
            {pendingFailures > 0 && (
              <View style={styles.actionBadge}>
                <Text style={styles.actionBadgeText}>{pendingFailures}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionChats]}
            activeOpacity={0.7}
            onPress={() => router.push('/(tabs)/chats' as any)}
          >
            <Ionicons name="chatbubbles" size={22} color={colors.primary} />
            <Text style={styles.actionButtonText}>Ver Chats</Text>
            {activeChats > 0 && (
              <View style={styles.actionBadge}>
                <Text style={styles.actionBadgeText}>{activeChats}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ height: insets.bottom + 20 }} />
    </ScrollView>
  );
}

// ---- Sub-components ----

function HealthRow({
  label,
  connected,
  detail,
  icon,
  dangerWhenActive,
}: {
  label: string;
  connected: boolean;
  detail: string;
  icon: string;
  dangerWhenActive?: boolean;
}) {
  const dotColor = dangerWhenActive
    ? connected
      ? colors.success
      : colors.error
    : connected
      ? colors.onlineGreen
      : colors.error;

  return (
    <View style={healthStyles.row}>
      <View style={healthStyles.left}>
        <Ionicons name={icon as any} size={18} color={colors.textSecondary} />
        <Text style={healthStyles.label}>{label}</Text>
      </View>
      <View style={healthStyles.right}>
        <Text style={[healthStyles.detail, { color: dotColor }]}>{detail}</Text>
        <View style={[healthStyles.dot, { backgroundColor: dotColor }]} />
      </View>
    </View>
  );
}

const healthStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  detail: {
    fontSize: 13,
    fontWeight: '600',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

// ---- Main styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.cardBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  killSwitchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.error + '15',
    borderWidth: 1,
    borderColor: colors.error + '40',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  killSwitchText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.error,
    flex: 1,
  },
  statsGrid: {
    gap: 10,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  healthCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  healthSeparator: {
    height: 1,
    backgroundColor: colors.separator,
    marginHorizontal: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  actionFailures: {
    borderColor: colors.error + '30',
  },
  actionChats: {
    borderColor: colors.primary + '30',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actionBadge: {
    backgroundColor: colors.error,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  actionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
  },
});
