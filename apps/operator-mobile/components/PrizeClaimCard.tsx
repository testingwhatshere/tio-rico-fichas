import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { parseAmount, formatAmount } from '@/utils/amount';

interface PrizeClaimCardProps {
  claim: any;
  onPress: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  PENDING: { label: 'Pendiente', color: colors.textMuted, icon: 'time-outline' },
  VERIFIED: { label: 'Verificado', color: colors.warning, icon: 'checkmark-circle-outline' },
  VERIFICATION_FAILED: { label: 'Verif. fallida', color: colors.chipFailed, icon: 'alert-circle-outline' },
  PROCESSING: { label: 'Procesando', color: colors.chipProcessing, icon: 'sync-outline' },
  CHIPS_WITHDRAWN: { label: 'Fichas listas', color: colors.chipPending, icon: 'wallet-outline' },
  COMPLETED: { label: 'Pagado', color: colors.chipCompleted, icon: 'checkmark-done-outline' },
  REJECTED: { label: 'Rechazado', color: colors.chipFailed, icon: 'close-circle-outline' },
  FAILED: { label: 'Fallido', color: colors.chipFailed, icon: 'alert-circle-outline' },
};

function getRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'ahora';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'recién';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  return `${days}d`;
}

export default function PrizeClaimCard({ claim, onPress }: PrizeClaimCardProps) {
  const amount = parseAmount(claim.amount);
  const targetUsername = claim?.targetUsername || claim?.user?.savedTargetUsername || '-';
  const timestamp = claim.createdAt || '';
  const status = claim.status || 'PENDING';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: config.color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.icon, { backgroundColor: config.color + '18' }]}>
        <Ionicons name={config.icon as any} size={22} color={config.color} />
      </View>

      <View style={styles.center}>
        <Text style={styles.username} numberOfLines={1}>
          {targetUsername}
        </Text>
        <Text style={styles.amount}>${formatAmount(amount)}</Text>
      </View>

      <View style={styles.right}>
        <Text style={[styles.status, { color: config.color }]} numberOfLines={1}>
          {config.label}
        </Text>
        <Text style={styles.timestamp}>{getRelativeTime(timestamp)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 12,
    borderLeftWidth: 3,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    flex: 1,
    minWidth: 0,
  },
  username: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  amount: {
    fontSize: 14,
    color: colors.primary,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: 90,
  },
  status: {
    fontSize: 11,
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
