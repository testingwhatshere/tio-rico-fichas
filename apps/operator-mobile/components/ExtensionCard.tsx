import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  online: { label: 'Online', color: colors.success, icon: 'checkmark-circle' },
  busy: { label: 'Procesando', color: colors.warning, icon: 'sync-outline' },
  error: { label: 'Error', color: colors.error, icon: 'close-circle' },
  offline: { label: 'Offline', color: colors.textMuted, icon: 'cloud-offline-outline' },
  degraded: { label: 'Degradado', color: colors.warning, icon: 'warning-outline' },
};

const TYPE_CONFIG: Record<string, { label: string; icon: string }> = {
  automation: { label: 'Automatizacion', icon: 'game-controller-outline' },
  'mp-verifier': { label: 'Verificador MP', icon: 'shield-checkmark-outline' },
  'fiwind-verifier': { label: 'Verificador Fiwind', icon: 'shield-outline' },
  'ripio-verifier': { label: 'Verificador Ripio', icon: 'shield-outline' },
  'prex-verifier': { label: 'Verificador Prex', icon: 'shield-outline' },
  'mp-payment': { label: 'Pago MP', icon: 'cash-outline' },
  'fiwind-payment': { label: 'Pago Fiwind', icon: 'cash-outline' },
  'ripio-payment': { label: 'Pago Ripio', icon: 'cash-outline' },
  'prex-payment': { label: 'Pago Prex', icon: 'cash-outline' },
};

function getRelativeTime(dateStr: string): string {
  if (!dateStr) return '--';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function formatUptime(minutes: number): string {
  if (!minutes || minutes < 1) return '--';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface ExtensionCardProps {
  extension: any;
  onResetCircuitBreaker?: () => void;
}

export default function ExtensionCard({ extension, onResetCircuitBreaker }: ExtensionCardProps) {
  const ext = extension;
  const status = STATUS_CONFIG[ext.status] || STATUS_CONFIG.offline;
  const typeInfo = TYPE_CONFIG[ext.type] || { label: ext.type || 'Desconocido', icon: 'extension-puzzle-outline' };
  const isCircuitBroken = ext.circuitBreakerActive || (ext.consecutiveErrors || 0) >= 3;

  return (
    <View style={[styles.card, { borderLeftColor: status.color }]}>
      {/* Header: type + status */}
      <View style={styles.header}>
        <View style={styles.typeRow}>
          <View style={[styles.iconContainer, { backgroundColor: status.color + '20' }]}>
            <Ionicons name={typeInfo.icon as any} size={20} color={status.color} />
          </View>
          <Text style={styles.typeLabel}>{typeInfo.label}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {/* Body: info rows */}
      <View style={styles.body}>
        {ext.panelId && (
          <InfoRow label="Panel" value={ext.panelId} />
        )}
        {ext.walletId && (
          <InfoRow label="Wallet" value={ext.walletId} />
        )}
        {ext.currentUrl && (
          <InfoRow label="URL" value={ext.currentUrl.length > 35 ? ext.currentUrl.substring(0, 35) + '...' : ext.currentUrl} />
        )}
        <InfoRow
          label="Sesion"
          value={ext.sessionValid === true ? 'Valida' : ext.sessionValid === false ? 'Expirada' : '--'}
          valueColor={ext.sessionValid === true ? colors.success : ext.sessionValid === false ? colors.error : colors.textMuted}
        />
        <InfoRow label="Heartbeat" value={getRelativeTime(ext.receivedAt)} />
        <InfoRow label="Ultimo job" value={ext.lastJobAt ? getRelativeTime(ext.lastJobAt) : '--'} />
        <InfoRow
          label="Errores"
          value={String(ext.consecutiveErrors || 0)}
          valueColor={(ext.consecutiveErrors || 0) > 0 ? colors.error : colors.textMuted}
        />
        {ext.version && <InfoRow label="Version" value={ext.version} />}
        {ext.uptimeMinutes > 0 && <InfoRow label="Uptime" value={formatUptime(ext.uptimeMinutes)} />}
        {ext.selectorHealth && (
          <InfoRow
            label="Selectores"
            value={`${ext.selectorHealth.matched}/${ext.selectorHealth.total} OK${ext.selectorHealth.failed > 0 ? ` (${ext.selectorHealth.failed} fallaron)` : ''}`}
            valueColor={ext.selectorHealth.failed > 0 ? colors.error : colors.success}
          />
        )}
      </View>

      {/* Footer: circuit breaker */}
      {isCircuitBroken && (
        <View style={styles.footer}>
          <View style={styles.circuitBadge}>
            <Ionicons name="pause-circle" size={14} color={colors.error} />
            <Text style={styles.circuitText}>PAUSADO</Text>
          </View>
          {onResetCircuitBreaker && (
            <TouchableOpacity style={styles.resetBtn} onPress={onResetCircuitBreaker}>
              <Ionicons name="play" size={14} color={colors.success} />
              <Text style={styles.resetText}>Reactivar</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  body: {
    gap: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  circuitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.error + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  circuitText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.error,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.success + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  resetText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.success,
  },
});
