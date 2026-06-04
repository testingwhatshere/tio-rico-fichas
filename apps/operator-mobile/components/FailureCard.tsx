import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { parseAmount, formatAmount } from '@/utils/amount';
import StatusBadge from './StatusBadge';
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
  if (seconds < 60) return 'hace un momento';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  return `hace ${days}d`;
}

function getScoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return colors.textMuted;
  if (score >= 0.8) return colors.success;
  if (score >= 0.5) return colors.warning;
  return colors.error;
}

export default function FailureCard({ failure, onPress }: FailureCardProps) {
  const amount = parseAmount(failure.amount || failure.request?.amount);
  const score = failure.validationScore ?? failure.request?.validationScore;
  const scoreColor = getScoreColor(score);
  const targetUsername = failure.targetUsername || failure.request?.targetUsername || '-';
  const userEmail = failure.userEmail || failure.user?.email || failure.request?.user?.email || '-';
  const timestamp = failure.createdAt || failure.request?.createdAt || '';
  const proofUrl = failure.proofUrl || failure.request?.proofUrl;
  const failureType = failure.type || (failure.jobId ? 'JOB_FAILURE' : 'VALIDATION_FAILURE');
  const isResolved = isFailureResolved(failure);

  return (
    <TouchableOpacity
      style={[styles.card, isResolved && styles.cardResolved]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Left: proof thumbnail or icon */}
      <View style={styles.leftSection}>
        {proofUrl ? (
          <Image
            source={{ uri: proofUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <Ionicons name="document-text-outline" size={24} color={colors.textMuted} />
          </View>
        )}
      </View>

      {/* Center: details */}
      <View style={styles.centerSection}>
        <View style={styles.topRow}>
          <StatusBadge status={failureType} size="sm" />
          {score !== null && score !== undefined && (
            <View style={[styles.scoreBadge, { backgroundColor: scoreColor + '20' }]}>
              <Text style={[styles.scoreText, { color: scoreColor }]}>
                {(score * 100).toFixed(0)}%
              </Text>
            </View>
          )}
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

        <View style={styles.detailRow}>
          <Ionicons name="mail-outline" size={12} color={colors.textMuted} />
          <Text style={styles.detailText} numberOfLines={1}>
            {userEmail}
          </Text>
        </View>
      </View>

      {/* Right: time + chevron */}
      <View style={styles.rightSection}>
        <Text style={styles.timestamp}>{getRelativeTime(timestamp)}</Text>
        {isResolved && (
          <View style={styles.resolvedIndicator}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          </View>
        )}
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
    borderLeftColor: colors.error,
    // Shadow
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  cardResolved: {
    borderLeftColor: colors.success,
    opacity: 0.7,
  },
  leftSection: {
    width: 50,
    height: 50,
  },
  thumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
  },
  thumbnailPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
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
  scoreBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  scoreText: {
    fontSize: 10,
    fontWeight: '700',
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
  resolvedIndicator: {
    marginVertical: 2,
  },
});
