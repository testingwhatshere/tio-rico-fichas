import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

interface ActivityItemProps {
  item: any;
}

const ACTION_CONFIG: Record<string, { icon: string; label: string; color: string; category: string }> = {
  APPROVED: { icon: 'checkmark-circle', label: 'Aprobado', color: colors.success, category: 'approval' },
  MANUAL_APPROVE: { icon: 'checkmark-circle', label: 'Aprobado manualmente', color: colors.success, category: 'approval' },
  REJECTED: { icon: 'close-circle', label: 'Rechazado', color: colors.error, category: 'rejection' },
  MANUAL_REJECT: { icon: 'close-circle', label: 'Rechazado manualmente', color: colors.error, category: 'rejection' },
  MESSAGE_SENT: { icon: 'chatbubble', label: 'Mensaje enviado', color: colors.info, category: 'message' },
  SEND_MESSAGE: { icon: 'chatbubble', label: 'Mensaje enviado', color: colors.info, category: 'message' },
  TRIGGERED_BOT: { icon: 'rocket', label: 'Bot activado', color: colors.chipProcessing, category: 'system' },
  KILL_SWITCH_ON: { icon: 'power', label: 'Kill switch activado', color: colors.error, category: 'system' },
  KILL_SWITCH_OFF: { icon: 'power', label: 'Kill switch desactivado', color: colors.success, category: 'system' },
  JOB_COMPLETED: { icon: 'checkmark-done', label: 'Job completado', color: colors.success, category: 'system' },
  JOB_FAILED: { icon: 'alert-circle', label: 'Job fallido', color: colors.error, category: 'system' },
  REQUEST_NEW_PROOF: { icon: 'document-attach', label: 'Nuevo comprobante solicitado', color: colors.warning, category: 'message' },
  WALLET_APPROVED: { icon: 'wallet', label: 'Wallet aprobada', color: colors.success, category: 'approval' },
  WALLET_REJECTED: { icon: 'wallet', label: 'Wallet rechazada', color: colors.error, category: 'rejection' },
  USER_ACTIVATED: { icon: 'person-add', label: 'Usuario activado', color: colors.success, category: 'system' },
  USER_DEACTIVATED: { icon: 'person-remove', label: 'Usuario desactivado', color: colors.warning, category: 'system' },
};

const DEFAULT_CONFIG = { icon: 'ellipse', label: 'Accion', color: colors.textMuted, category: 'system' };

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

export default function ActivityItem({ item }: ActivityItemProps) {
  const action = item.action || '';
  const config = ACTION_CONFIG[action] || { ...DEFAULT_CONFIG, label: action };
  const operatorName = item.operatorName || item.operator?.name || 'Sistema';
  const entityInfo = item.entityType
    ? `${item.entityType}${item.entityId ? ` #${item.entityId.slice(0, 8)}` : ''}`
    : '';
  const timestamp = item.timestamp || item.createdAt || '';

  return (
    <View style={styles.container}>
      {/* Icon */}
      <View style={[styles.iconContainer, { backgroundColor: config.color + '18' }]}>
        <Ionicons name={config.icon as any} size={18} color={config.color} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={[styles.actionLabel, { color: config.color }]} numberOfLines={1}>
            {config.label}
          </Text>
          <Text style={styles.timestamp}>{getRelativeTime(timestamp)}</Text>
        </View>

        <Text style={styles.operatorName} numberOfLines={1}>
          {operatorName}
        </Text>

        {entityInfo !== '' && (
          <Text style={styles.entityInfo} numberOfLines={1}>
            {entityInfo}
          </Text>
        )}

        {item.metadata?.note && (
          <Text style={styles.noteText} numberOfLines={1}>
            {item.metadata.note}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Returns the category string for a given action (used by filter in the screen). */
export function getActionCategory(action: string): string {
  return (ACTION_CONFIG[action] || DEFAULT_CONFIG).category;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
    flexShrink: 0,
  },
  operatorName: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  entityInfo: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  noteText: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
