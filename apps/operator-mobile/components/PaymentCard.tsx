import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string; borderColor: string }> = {
  PENDING: { label: 'Pendiente', color: colors.warning, icon: 'hourglass-outline', borderColor: colors.warning },
  CONFIRMED: { label: 'Confirmado', color: colors.info, icon: 'checkmark-outline', borderColor: colors.info },
  QUEUED: { label: 'En cola', color: colors.info, icon: 'list-outline', borderColor: colors.info },
  PROCESSING: { label: 'Procesando', color: colors.primary, icon: 'sync-outline', borderColor: colors.primary },
  COMPLETED: { label: 'Completado', color: colors.success, icon: 'checkmark-circle', borderColor: colors.success },
  FAILED: { label: 'Fallido', color: colors.error, icon: 'close-circle', borderColor: colors.error },
  CANCELLED: { label: 'Cancelado', color: colors.textMuted, icon: 'ban-outline', borderColor: colors.textMuted },
};

const WALLET_ICONS: Record<string, string> = {
  MERCADOPAGO: 'logo-usd',
  FIWIND: 'trending-up-outline',
  RIPIO: 'diamond-outline',
  PREX: 'card-outline',
};

function formatAmount(amount: number | string | null): string {
  if (!amount) return '$0';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0';
  return `$${num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d`;
}

interface PaymentCardProps {
  payment: any;
  onPress?: () => void;
  onConfirm?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
}

export default function PaymentCard({ payment, onPress, onConfirm, onRetry, onCancel }: PaymentCardProps) {
  const status = STATUS_CONFIG[payment.status] || STATUS_CONFIG.PENDING;
  const walletIcon = WALLET_ICONS[payment.walletType] || 'wallet-outline';

  const destination = payment.paymentDetails?.alias || payment.paymentDetails?.cbu || '—';
  const accountHolder = payment.paymentDetails?.accountHolder || '';

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: status.borderColor }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Left: Icon */}
      <View style={[styles.iconContainer, { backgroundColor: status.color + '20' }]}>
        <Ionicons name={walletIcon as any} size={22} color={status.color} />
      </View>

      {/* Center: Content */}
      <View style={styles.centerSection}>
        {/* Status badge + wallet type */}
        <View style={styles.topRow}>
          <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
            <Ionicons name={status.icon as any} size={10} color={status.color} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
          {payment.walletType && (
            <Text style={styles.walletType}>{payment.walletType}</Text>
          )}
        </View>

        {/* Amount */}
        <Text style={styles.amount}>{formatAmount(payment.amount)}</Text>

        {/* Destination */}
        <Text style={styles.destination} numberOfLines={1}>
          {accountHolder ? `${accountHolder} · ` : ''}{destination}
        </Text>

        {/* Operation number (if completed) */}
        {payment.operationNumber && (
          <Text style={styles.operationNumber}>Op: {payment.operationNumber}</Text>
        )}

        {/* Error (if failed) */}
        {payment.status === 'FAILED' && payment.error && (
          <Text style={styles.errorText} numberOfLines={2}>{payment.error}</Text>
        )}
      </View>

      {/* Right: Time + Actions */}
      <View style={styles.rightSection}>
        <Text style={styles.timeText}>
          {getRelativeTime(payment.createdAt)}
        </Text>

        {/* Action buttons */}
        {payment.status === 'PENDING' && onConfirm && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.success + '20' }]} onPress={onConfirm}>
            <Ionicons name="checkmark" size={16} color={colors.success} />
          </TouchableOpacity>
        )}
        {payment.status === 'FAILED' && onRetry && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.warning + '20' }]} onPress={onRetry}>
            <Ionicons name="refresh" size={16} color={colors.warning} />
          </TouchableOpacity>
        )}
        {(payment.status === 'PENDING' || payment.status === 'CONFIRMED') && onCancel && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.error + '20' }]} onPress={onCancel}>
            <Ionicons name="close" size={16} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
    gap: 12,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerSection: {
    flex: 1,
    gap: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  walletType: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  amount: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  destination: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  operationNumber: {
    fontSize: 11,
    color: colors.success,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 11,
    color: colors.error,
    marginTop: 2,
  },
  rightSection: {
    alignItems: 'flex-end',
    gap: 6,
  },
  timeText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
