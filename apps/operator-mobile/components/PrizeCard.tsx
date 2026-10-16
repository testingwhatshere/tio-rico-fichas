import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CopyableText, CopyButton } from '@/components/Copyable';
import { formatMoney } from '@/utils/amount';
import { timeAgo } from '@/utils/time';
import {
  PrizeAction,
  claimAmount,
  payoutLine,
  prizeAction,
  prizeReason,
  prizeStage,
  prizeStatusMeta,
  prizeUsername,
  urgencyColor,
  waitLabel,
} from '@/utils/prizes';
import { colors, space, radius, text, alpha } from '@/constants/theme';

/**
 * Un premio, como ficha.
 *
 * Reemplaza la fila de tabla: en una tabla el operador veía usuario, monto y
 * estado, y para saber a dónde transferirle tenía que abrir el detalle, copiar
 * el CBU y volver. Los dos datos que usa en el 90% de los casos —cuánto y a
 * dónde— están acá, y el CBU se copia de un toque.
 */
export default function PrizeCard({
  claim,
  onPress,
  onAction,
  busy,
  selected,
  compact,
}: {
  claim: any;
  onPress: () => void;
  /** Dispara la acción sugerida. La confirmación la maneja la pantalla. */
  onAction?: (claim: any, action: PrizeAction) => void;
  busy?: boolean;
  selected?: boolean;
  /** En la columna angosta (con el detalle abierto) se recorta a lo esencial. */
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const stage = prizeStage(claim);
  const status = prizeStatusMeta(claim.status);
  const action = prizeAction(claim);
  const payout = payoutLine(claim);
  const username = prizeUsername(claim);
  const age = urgencyColor(claim, stage);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        s.card,
        { borderLeftColor: status.color },
        hovered && s.cardHover,
        selected && s.cardSelected,
      ]}
    >
      <View style={s.top}>
        <View style={[s.avatar, { backgroundColor: alpha(status.color, 0.16) }]}>
          <Text style={[s.avatarText, { color: status.color }]}>
            {username.slice(0, 2).toUpperCase()}
          </Text>
        </View>

        <View style={s.identity}>
          <CopyableText value={username} label="Usuario" style={s.username} iconSize={12} />
          <View style={s.ageLine}>
            <Ionicons name="time-outline" size={11} color={age} />
            <Text style={[s.age, { color: age }]}>espera {waitLabel(claim)}</Text>
          </View>
        </View>

        <View style={s.amountRow}>
          <Text style={s.amount}>{formatMoney(claimAmount(claim))}</Text>
          <CopyButton value={claimAmount(claim)} label="Monto" size={12} />
        </View>
      </View>

      {!compact && !!payout && (
        <View style={s.payout}>
          <Text style={s.payoutLabel}>{payout.label}</Text>
          <CopyableText
            value={payout.value}
            label={payout.label}
            mono
            style={s.payoutValue}
          />
        </View>
      )}

      {!compact && <Text style={s.reason} numberOfLines={2}>{prizeReason(claim)}</Text>}

      {!!action && onAction && (
        <View style={s.actions}>
          <Pressable
            onPress={() => onAction(claim, action)}
            disabled={busy}
            style={[
              s.actionBtn,
              { backgroundColor: action.tone === 'success' ? colors.success : colors.primaryDark },
              busy && { opacity: 0.45 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name={action.icon as any} size={15} color={colors.textOnPrimary} />
                <Text style={s.actionText}>{action.label}</Text>
              </>
            )}
          </Pressable>
          <Pressable onPress={onPress} style={s.detailBtn}>
            <Text style={s.detailText}>Ficha</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

/** Fila del histórico: ya no hay nada que decidir, sólo consultar. */
export function ClosedPrizeRow({ claim, onPress }: { claim: any; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  const status = prizeStatusMeta(claim.status);
  const hasProof = Boolean(claim.payoutProofUrl);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[s.closedRow, hovered && s.cardHover]}
    >
      <View style={[s.closedDot, { backgroundColor: status.color }]} />
      <CopyableText value={prizeUsername(claim)} label="Usuario" style={s.closedUser} iconSize={11} />
      <Text style={[s.closedStatus, { color: status.color }]} numberOfLines={1}>
        {status.label}
      </Text>
      {hasProof && <Ionicons name="receipt-outline" size={13} color={colors.textMuted} />}
      <Text style={s.closedAmount}>{formatMoney(claimAmount(claim))}</Text>
      <Text style={s.closedAge}>{timeAgo(claim.updatedAt || claim.createdAt)}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderLeftWidth: 3,
    padding: space.md,
    gap: space.sm,
  },
  cardHover: { backgroundColor: colors.surfaceElevated },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceElevated },

  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...text.label, fontWeight: '700' },
  identity: { flex: 1, minWidth: 0, gap: 1 },
  username: { ...text.bodyStrong, color: colors.textPrimary },
  ageLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  age: { ...text.caption },
  amount: { ...text.title, color: colors.textPrimary },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },

  payout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs + 2,
  },
  payoutLabel: { ...text.caption, color: colors.textMuted },
  payoutValue: { ...text.mono, color: colors.textPrimary },

  reason: { ...text.caption, color: colors.textSecondary, lineHeight: 15 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  actionText: { ...text.label, color: colors.textOnPrimary, fontWeight: '700' },
  detailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  detailText: { ...text.caption, color: colors.textSecondary },

  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  closedDot: { width: 6, height: 6, borderRadius: radius.full },
  closedUser: { ...text.bodyStrong, color: colors.textPrimary, flex: 1, minWidth: 0 },
  closedStatus: { ...text.caption, width: 110 },
  closedAmount: { ...text.body, color: colors.textPrimary, width: 90, textAlign: 'right' },
  closedAge: { ...text.caption, color: colors.textMuted, width: 44, textAlign: 'right' },
});
