import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { parseAmount, formatAmount } from '@/utils/amount';
import StatusBadge from './StatusBadge';

interface JobCardProps {
  job: any;
  onRetry?: (jobId: string) => void;
}

const STATUS_ICONS: Record<string, { name: string; color: string }> = {
  QUEUED: { name: 'time-outline', color: colors.chipPending },
  PROCESSING: { name: 'sync-outline', color: colors.chipProcessing },
  COMPLETED: { name: 'checkmark-circle-outline', color: colors.chipCompleted },
  FAILED: { name: 'close-circle-outline', color: colors.chipFailed },
};

const BORDER_COLORS: Record<string, string> = {
  QUEUED: colors.chipPending,
  PROCESSING: colors.chipProcessing,
  COMPLETED: colors.chipCompleted,
  FAILED: colors.chipFailed,
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

function getDuration(job: any): string | null {
  if (job.status !== 'COMPLETED' && job.status !== 'FAILED') return null;
  const start = job.createdAt || job.startedAt;
  const end = job.completedAt || job.updatedAt;
  if (!start || !end) return null;

  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (diffMs < 0) return null;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}m ${remainingSec}s`;
}

export default function JobCard({ job, onRetry }: JobCardProps) {
  const amount = parseAmount(job.amount || job.request?.amount);
  const targetUsername = job.targetUsername || job.request?.targetUsername || '-';
  const timestamp = job.createdAt || '';
  const status = job.status || 'QUEUED';
  const statusIcon = STATUS_ICONS[status] || STATUS_ICONS.QUEUED;
  const borderColor = BORDER_COLORS[status] || colors.textMuted;
  const duration = getDuration(job);
  const errorPreview = job.error || job.result?.error || null;
  const isFailed = status === 'FAILED';

  return (
    <View style={[styles.card, { borderLeftColor: borderColor }]}>
      {/* Left icon */}
      <View style={[styles.iconContainer, { backgroundColor: statusIcon.color + '18' }]}>
        <Ionicons name={statusIcon.name as any} size={24} color={statusIcon.color} />
      </View>

      {/* Center content */}
      <View style={styles.centerSection}>
        <View style={styles.topRow}>
          <StatusBadge status={status} size="sm" />
          {duration && (
            <View style={styles.durationBadge}>
              <Ionicons name="timer-outline" size={10} color={colors.textMuted} />
              <Text style={styles.durationText}>{duration}</Text>
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
          {job.panelId && job.panel?.name && (
            <View style={styles.panelBadge}>
              <Ionicons name="server-outline" size={9} color={colors.info} />
              <Text style={styles.panelBadgeText}>{job.panel.name}</Text>
            </View>
          )}
        </View>

        {isFailed && errorPreview && (
          <View style={styles.errorRow}>
            <Ionicons name="warning-outline" size={11} color={colors.error} />
            <Text style={styles.errorText} numberOfLines={2}>
              {errorPreview}
            </Text>
          </View>
        )}
      </View>

      {/* Right section */}
      <View style={styles.rightSection}>
        <Text style={styles.timestamp}>{getRelativeTime(timestamp)}</Text>

        {isFailed && onRetry && (
          <TouchableOpacity
            style={styles.retryButton}
            activeOpacity={0.7}
            onPress={() => onRetry(job.id)}
          >
            <Ionicons name="refresh-outline" size={14} color={colors.primary} />
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  durationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.backgroundTertiary + '60',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  durationText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
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
  panelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.info + '18',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  panelBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.info,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 2,
    backgroundColor: colors.error + '10',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  errorText: {
    fontSize: 11,
    color: colors.error,
    flex: 1,
    lineHeight: 15,
  },
  rightSection: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '18',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  retryText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
});
