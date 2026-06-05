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
  PROCESSING: { label: 'Procesando', color: colors.chipProcessing, icon: 'sync-outline' },
  CHIPS_WITHDRAWN: { label: 'Fichas retiradas', color: colors.chipPending, icon: 'wallet-outline' },
  COMPLETED: { label: 'Completado', color: colors.chipCompleted, icon: 'checkmark-done-outline' },
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
  if (seconds < 60) return 'hace un momento';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  return `hace ${days}d`;
}

export default function PrizeClaimCard({ claim, onPress }: PrizeClaimCardProps) {
  const amount = parseAmount(claim.amount);
  const targetUsername = claim?.targetUsername || claim?.user?.savedTargetUsername || '-';
  const timestamp = claim.createdAt || '';
  const status = claim.status || 'PENDING';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const paymentMethod = claim.paymentMethod || '-';

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: config.color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Left icon */}
      <View style={[styles.iconContainer, { backgroundColor: config.color + '18' }]}>
        <Ionicons name={config.icon as any} size={24} color={config.color} />
      </View>

      {/* Center content */}
      <View style={styles.centerSection}>
        <View style={styles.topRow}>
          <View style={[styles.statusBadge, { backgroundColor: config.color + '25' }]}>
            <View style={[styles.statusDot, { backgroundColor: config.color }]} />
            <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
          </View>
        </View>

        <View style={styles.amountRow}>
          <Text style={styles.amountSymbol}>$</Text>
          <Text style={styles.amountValue}>{formatAmount(amount)}</Text>
        </View>

        <View style={styles.detailRow}>
          <Ionicons name="person-outline" size={12} color={colors.textMuted} />
          <Text style={styles.detailText} numberOfLines={1}>
            {targetUsername}
          </Text>
        </View>

        {paymentMethod !== '-' && (
          <View style={styles.detailRow}>
            <Ionicons name="card-outline" size={12} color={colors.textMuted} />
            <Text style={styles.detailText} numberOfLines={1}>
              {paymentMethod}
            </Text>
          </View>
        )}
      </View>

      {/* Right section */}
      <View style={styles.rightSection}>
        <Text style={styles.timestamp}>{getRelativeTime(timestamp)}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
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
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 12,
    borderLeftWidth: 3,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerSection: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 4,
    alignSelf: 'flex-start',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  amountSymbol: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  amountValue: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
  },
  rightSection: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
