import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import colors from '@/constants/colors';
import { CopyableText, CopyButton } from '@/components/Copyable';
import { parseAmount, formatAmount } from '@/utils/amount';
import { isFailureResolved } from '@/stores/operator.store';
import ProofImage from '@/components/ProofImage';
import { proofTwinAlert } from '@/utils/proofTwins';
import { overpaidOfferTag } from '@/utils/overpaidOffer';

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
  const twin = proofTwinAlert(failure.proofTwins || failure.request?.proofTwins);
  const overpaid = overpaidOfferTag(failure.validationDetails?.overpaidOffer);

  return (
    <TouchableOpacity
      style={[styles.card, isResolved && styles.cardResolved]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {proofUrl ? (
        <ProofImage uri={proofUrl} style={styles.thumbnail} resizeMode="cover" compact />
      ) : (
        <View style={styles.thumbnailPlaceholder}>
          <Ionicons name="document-text-outline" size={22} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.center}>
        <CopyableText value={targetUsername} label="Usuario" style={styles.username} iconSize={11} />
        <View style={styles.copyRow}>
          <Text style={styles.amount}>${formatAmount(amount)}</Text>
          <CopyButton value={amount} label="Monto" size={11} />
          {!!twin && (
            <Text style={[styles.twinTag, twin.severe && { color: colors.error }]}>
              {twin.label.toLowerCase()}
            </Text>
          )}
        </View>
        {!!overpaid && (
          <Text style={[styles.twinTag, { color: overpaid.color }]}>{overpaid.label}</Text>
        )}
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
  twinTag: { fontSize: 11, fontWeight: '700', color: colors.warning },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
