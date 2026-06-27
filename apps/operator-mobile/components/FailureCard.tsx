import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { parseAmount, formatAmount } from '@/utils/amount';
import { isFailureResolved } from '@/stores/operator.store';

interface FailureCardProps {
  failure: any;
  onPress: () => void;
}

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

export default function FailureCard({ failure, onPress }: FailureCardProps) {
  const amount = parseAmount(failure.amount || failure.request?.amount);
  const targetUsername = failure.targetUsername || failure.request?.targetUsername || '-';
  const timestamp = failure.createdAt || failure.request?.createdAt || '';
  const proofUrl = failure.proofUrl || failure.request?.proofUrl;
  const isResolved = isFailureResolved(failure);

  return (
    <TouchableOpacity
      style={[styles.card, isResolved && styles.cardResolved]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {proofUrl ? (
        <Image source={{ uri: proofUrl }} style={styles.thumbnail} resizeMode="cover" />
      ) : (
        <View style={styles.thumbnailPlaceholder}>
          <Ionicons name="document-text-outline" size={22} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.center}>
        <Text style={styles.username} numberOfLines={1}>
          {targetUsername}
        </Text>
        <Text style={styles.amount}>${formatAmount(amount)}</Text>
      </View>

      <View style={styles.right}>
        {isResolved ? (
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        ) : null}
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
    borderLeftColor: colors.error,
  },
  cardResolved: {
    borderLeftColor: colors.success,
    opacity: 0.55,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
  },
  thumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
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
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
