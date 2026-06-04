import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { parseAmount, formatAmount } from '@/utils/amount';
import StatusBadge from './StatusBadge';

interface UserCardProps {
  user: any;
  onToggleActive: (userId: string, isActive: boolean) => void;
}

const ROLE_LABELS: Record<string, string> = {
  CLIENT: 'Cliente',
  OPERATOR: 'Operador',
  SENIOR_OPERATOR: 'Senior',
  ADMIN: 'Admin',
};

const ROLE_COLORS: Record<string, string> = {
  CLIENT: colors.textMuted,
  OPERATOR: colors.info,
  SENIOR_OPERATOR: colors.primary,
  ADMIN: colors.warning,
};

export default function UserCard({ user, onToggleActive }: UserCardProps) {
  const balance = parseAmount(user.balance || user.wallet?.balance);
  const role = user.role || 'CLIENT';
  const isActive = user.isActive !== false;
  const username = user.username || user.name || user.email?.split('@')[0] || '-';
  const email = user.email || '-';
  const roleColor = ROLE_COLORS[role] || colors.textMuted;
  const roleLabel = ROLE_LABELS[role] || role;

  const [toggling, setToggling] = useState(false);

  const handleToggle = (value: boolean) => {
    setToggling(true);
    onToggleActive(user.id, value);
    // Reset toggling state after a brief delay (the store update will re-render)
    setTimeout(() => setToggling(false), 1500);
  };

  return (
    <View style={[styles.card, !isActive && styles.cardInactive]}>
      {/* Avatar */}
      <View style={[styles.avatar, { borderColor: isActive ? colors.primary + '40' : colors.textMuted + '30' }]}>
        <Ionicons
          name="person"
          size={22}
          color={isActive ? colors.primary : colors.textMuted}
        />
      </View>

      {/* Info */}
      <View style={styles.centerSection}>
        <View style={styles.nameRow}>
          <Text style={[styles.username, !isActive && styles.textInactive]} numberOfLines={1}>
            {username}
          </Text>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + '20' }]}>
            <Text style={[styles.roleText, { color: roleColor }]}>{roleLabel}</Text>
          </View>
        </View>

        <View style={styles.detailRow}>
          <Ionicons name="mail-outline" size={12} color={colors.textMuted} />
          <Text style={styles.detailText} numberOfLines={1}>
            {email}
          </Text>
        </View>

        <View style={styles.balanceRow}>
          <Ionicons name="wallet-outline" size={12} color={colors.primary} />
          <Text style={styles.balanceSymbol}>$</Text>
          <Text style={styles.balanceValue}>{formatAmount(balance)}</Text>
        </View>

        {user.savedTargetUsername && (
          <View style={styles.detailRow}>
            <Ionicons name="game-controller-outline" size={12} color={colors.textMuted} />
            <Text style={styles.detailText} numberOfLines={1}>
              {user.savedTargetUsername}
            </Text>
          </View>
        )}
      </View>

      {/* Toggle */}
      <View style={styles.rightSection}>
        <StatusBadge status={isActive ? 'active' : 'inactive'} size="sm" />
        <Switch
          value={isActive}
          onValueChange={handleToggle}
          disabled={toggling}
          trackColor={{ false: colors.backgroundTertiary, true: colors.success + '60' }}
          thumbColor={isActive ? colors.success : colors.textMuted}
          ios_backgroundColor={colors.backgroundTertiary}
          style={styles.switch}
        />
      </View>
    </View>
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
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  cardInactive: {
    opacity: 0.65,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  centerSection: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  username: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  textInactive: {
    color: colors.textMuted,
  },
  roleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
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
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  balanceSymbol: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  balanceValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rightSection: {
    alignItems: 'center',
    gap: 6,
  },
  switch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
});
