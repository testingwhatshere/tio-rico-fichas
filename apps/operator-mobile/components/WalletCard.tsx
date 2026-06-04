import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { parseAmount, formatAmount } from '@/utils/amount';

interface WalletCardProps {
  wallet: any;
  onSelect: () => void;
  onEdit: () => void;
  onEmpty: () => void;
  onDelete: () => void;
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  MERCADOPAGO: { label: 'MercadoPago', icon: 'phone-portrait-outline', color: '#00BCFF' },
  CBU: { label: 'CBU', icon: 'business-outline', color: '#48BB78' },
  CVU: { label: 'CVU', icon: 'card-outline', color: '#9F7AEA' },
  RIPIO: { label: 'Ripio', icon: 'logo-bitcoin', color: '#00D395' },
  FIWIND: { label: 'Fiwind', icon: 'globe-outline', color: '#6366F1' },
  PREX: { label: 'Prex', icon: 'wallet-outline', color: '#F59E0B' },
};

export default function WalletCard({ wallet, onSelect, onEdit, onEmpty, onDelete }: WalletCardProps) {
  const isSelected = wallet.isSelected === true;
  const accumulated = parseAmount(wallet.accumulatedAmount);
  const limit = parseAmount(wallet.amountLimit);
  const hasLimit = limit > 0;
  const progress = hasLimit ? Math.min(accumulated / limit, 1) : 0;

  const typeInfo = TYPE_CONFIG[wallet.type] || { label: wallet.type || 'Otro', icon: 'wallet-outline' as const, color: colors.textMuted };

  const details = wallet.details || {};
  const displayIdentifier = wallet.type === 'MERCADOPAGO'
    ? details.alias
    : wallet.type === 'CBU'
      ? details.cbu
      : wallet.type === 'CVU'
        ? details.cvu
        : details.alias || details.accountId || null;

  return (
    <View style={[styles.card, isSelected && styles.cardSelected]}>
      {/* Header: type badge + selected indicator */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.typeBadge, { backgroundColor: typeInfo.color + '20' }]}>
            <Ionicons name={typeInfo.icon} size={14} color={typeInfo.color} />
            <Text style={[styles.typeBadgeText, { color: typeInfo.color }]}>{typeInfo.label}</Text>
          </View>
          {wallet.label && (
            <Text style={styles.label} numberOfLines={1}>{wallet.label}</Text>
          )}
        </View>
        {isSelected && (
          <View style={styles.selectedBadge}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
            <Text style={styles.selectedText}>Activa</Text>
          </View>
        )}
      </View>

      {/* Holder info */}
      <View style={styles.holderSection}>
        <View style={styles.holderRow}>
          <Ionicons name="person-outline" size={13} color={colors.textMuted} />
          <Text style={styles.holderName} numberOfLines={1}>
            {wallet.holderName || '-'}
          </Text>
        </View>
        {wallet.holderDni && (
          <View style={styles.holderRow}>
            <Ionicons name="id-card-outline" size={13} color={colors.textMuted} />
            <Text style={styles.holderDetail}>DNI: {wallet.holderDni}</Text>
          </View>
        )}
      </View>

      {/* Identifier: alias / CBU / CVU */}
      {displayIdentifier && (
        <View style={styles.identifierSection}>
          <Text style={styles.identifierLabel}>
            {wallet.type === 'MERCADOPAGO' ? 'Alias' : wallet.type === 'CBU' ? 'CBU' : 'CVU'}
          </Text>
          <Text style={styles.identifierValue} numberOfLines={1} selectable>
            {displayIdentifier}
          </Text>
        </View>
      )}

      {/* Bank name */}
      {(details.bankName || details.bank) && (
        <View style={styles.bankRow}>
          <Ionicons name="business-outline" size={12} color={colors.textMuted} />
          <Text style={styles.bankName}>{details.bankName || details.bank}</Text>
        </View>
      )}

      {/* Accumulation bar */}
      <View style={styles.accumulationSection}>
        <View style={styles.accumulationHeader}>
          <Text style={styles.accumulationLabel}>Acumulado</Text>
          <Text style={styles.accumulationValues}>
            <Text style={styles.accumulatedText}>${formatAmount(accumulated)}</Text>
            {hasLimit && (
              <Text style={styles.limitText}> / ${formatAmount(limit)}</Text>
            )}
          </Text>
        </View>
        {hasLimit && (
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.round(progress * 100)}%`,
                    backgroundColor: progress >= 0.9
                      ? colors.error
                      : progress >= 0.7
                        ? colors.warning
                        : colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
          </View>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionButton, isSelected && styles.actionButtonActive]}
          onPress={onSelect}
          activeOpacity={0.7}
        >
          <Ionicons
            name={isSelected ? 'star' : 'star-outline'}
            size={16}
            color={isSelected ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.actionText, isSelected && styles.actionTextActive]}>
            {isSelected ? 'Activa' : 'Seleccionar'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={onEdit} activeOpacity={0.7}>
          <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
          <Text style={styles.actionText}>Editar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={onEmpty} activeOpacity={0.7}>
          <Ionicons name="refresh-outline" size={16} color={colors.textMuted} />
          <Text style={styles.actionText}>Vaciar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={onDelete} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={16} color={colors.error} />
          <Text style={[styles.actionText, { color: colors.error }]}>Eliminar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  cardSelected: {
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.15,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  selectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryGlow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  selectedText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  holderSection: {
    gap: 4,
    marginBottom: 10,
  },
  holderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  holderName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  holderDetail: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  identifierSection: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  identifierLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  identifierValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  bankName: {
    fontSize: 12,
    color: colors.textMuted,
  },
  accumulationSection: {
    marginBottom: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  accumulationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  accumulationLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  accumulationValues: {
    fontSize: 13,
  },
  accumulatedText: {
    fontWeight: '700',
    color: colors.primary,
  },
  limitText: {
    fontWeight: '500',
    color: colors.textMuted,
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    width: 36,
    textAlign: 'right',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  actionButtonActive: {
    backgroundColor: colors.primaryGlow,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  actionTextActive: {
    color: colors.primary,
  },
});
