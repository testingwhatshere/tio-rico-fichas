import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { toast } from './Toast';
import { formatMoney } from '@/utils/amount';
import { timeAgo } from '@/utils/time';
import { colors, space, radius, text, alpha } from '@/constants/theme';
import { CopyableText, CopyButton } from '@/components/Copyable';

interface UserCardProps {
  user: any;
  onToggleActive: (userId: string, isActive: boolean) => void;
  onEditPhone?: (user: any) => void;
}

/** El CBU/CVU/alias vive en `payoutDetails`, que es Json y cambia de forma según
 *  cómo lo cargó el usuario. */
function extractPayout(details: any): { label: string; value: string } | null {
  if (!details) return null;
  if (typeof details === 'string') return { label: 'CBU', value: details };
  const keys = ['cbu', 'CBU', 'cvu', 'CVU', 'cbuCvu', 'alias', 'ALIAS', 'account'];
  for (const k of keys) {
    if (details[k]) {
      const label = /alias/i.test(k) ? 'Alias' : 'CBU';
      return { label, value: String(details[k]) };
    }
  }
  const first = Object.entries(details).find(([, v]) => v);
  return first ? { label: String(first[0]), value: String(first[1]) } : null;
}

/** Teléfono argentino canónico ("5493755690960") a algo leíble. */
function prettyPhone(raw?: string): string {
  if (!raw) return 'sin teléfono';
  const d = raw.replace(/\D/g, '');
  const m = d.match(/^54(9)?(\d{2,4})(\d{6,8})$/);
  if (!m) return raw;
  return `${m[2]} ${m[3]}`;
}

export default function UserCard({ user, onToggleActive, onEditPhone }: UserCardProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const isActive = user.isActive !== false;
  const username = user.username || user.email?.split('@')[0] || '—';
  const payout = extractPayout(user.payoutDetails);
  // El nickname del panel casi siempre es igual al usuario: repetirlo es ruido.
  // Los dos nombres tienen que ser iguales: `savedTargetUsername` es lo que la
  // extensión busca en el panel de juego. Si difieren, el bot busca un nombre
  // que no existe, así que se marca en rojo en vez de mostrarse como un dato más.
  const panelNick =
    user.savedTargetUsername && user.savedTargetUsername !== username
      ? user.savedTargetUsername
      : null;

  const hover =
    Platform.OS === 'web'
      ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
      : {};

  return (
    <View style={[s.card, hovered && s.cardHover, !isActive && s.cardBlocked]} {...(hover as any)}>
      <View style={s.head}>
        <View style={[s.avatar, !isActive && { backgroundColor: alpha(colors.error, 0.15) }]}>
          <Text style={[s.avatarText, !isActive && { color: colors.error }]}>
            {username.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={s.identity}>
          <CopyableText value={username} label="Usuario" style={s.username} iconSize={12} />
          {/* Se copia el teléfono completo, no el formateado: lo que sirve para
              pegar en WhatsApp es el número con código de país. */}
          <CopyableText
            value={user.phone}
            display={prettyPhone(user.phone)}
            label="Teléfono"
            style={s.phone}
            iconSize={11}
          />
        </View>

        {!isActive && <Text style={s.blocked}>bloqueado</Text>}
      </View>

      {/* Dónde cobrarle: el dato que el operador necesita a mano. */}
      <View style={[s.payout, !payout && s.payoutEmpty]}>
        <Ionicons
          name="card-outline"
          size={13}
          color={payout ? colors.primary : colors.textMuted}
        />
        <Text style={[s.payoutTag, !payout && { color: colors.textMuted }]}>
          {payout ? payout.label : 'CBU'}
        </Text>
        {payout ? (
          <CopyableText value={payout.value} label={payout.label} mono style={s.payoutValue} />
        ) : (
          <Text style={[s.payoutValue, s.payoutValueEmpty]}>sin cargar</Text>
        )}
      </View>

      <View style={s.meta}>
          {!!panelNick && (
            <View style={s.mismatch}>
              <Ionicons name="warning-outline" size={12} color={colors.error} />
              <CopyableText
                value={panelNick}
                display={`en el panel figura “${panelNick}”`}
                label="Nombre en el panel"
                style={s.mismatchText}
                iconSize={11}
              />
            </View>
          )}
          {user.panel?.name ? (
            <Meta icon="server-outline" value={user.panel.name} />
          ) : (
            // Sin panel no es un error: la primera carga dispara discovery y lo
            // resuelve. Se muestra igual porque explica por que el bot "lo busca
            // en el panel equivocado" — todavia no tiene panel propio.
            <Meta icon="help-circle-outline" value="sin panel · se define en la 1ª carga" />
          )}
          {!!user.completedCount && (
            <Meta
              icon="checkmark-done-outline"
              value={`${user.completedCount} · ${formatMoney(user.totalLoaded || 0)}`}
            />
          )}
          {!!user.lastLoadAt && <Meta icon="time-outline" value={timeAgo(user.lastLoadAt)} />}
      </View>

      <View style={s.actions}>
        {/* La ficha es donde está todo lo suyo — sus cargas, sus premios, su
            chat — y desde donde se le puede cargar sin depender de un pedido. */}
        <Pressable onPress={() => router.push(`/user/${user.id}` as any)} style={s.action}>
          <Ionicons name="albums-outline" size={13} color={colors.textSecondary} />
          <Text style={s.actionText}>Ficha</Text>
        </Pressable>
        {onEditPhone && (
          <Pressable onPress={() => onEditPhone(user)} style={s.action}>
            <Ionicons name="pencil" size={13} color={colors.textSecondary} />
            <Text style={s.actionText}>Editar</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => onToggleActive(user.id, !isActive)}
          style={[s.action, isActive ? s.blockBtn : s.unblockBtn]}
        >
          <Ionicons
            name={isActive ? 'ban-outline' : 'checkmark-circle-outline'}
            size={13}
            color={isActive ? colors.error : colors.success}
          />
          <Text style={[s.actionText, { color: isActive ? colors.error : colors.success }]}>
            {isActive ? 'Bloquear' : 'Desbloquear'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Meta({ icon, value }: { icon: any; value: string }) {
  return (
    <View style={s.metaItem}>
      <Ionicons name={icon} size={11} color={colors.textMuted} />
      <Text style={s.metaText} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space.lg,
    gap: space.md,
  },
  cardHover: { borderColor: colors.borderStrong },
  cardBlocked: { opacity: 0.6 },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 34, height: 34, borderRadius: radius.full,
    backgroundColor: alpha(colors.primary, 0.15),
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...text.bodyStrong, fontSize: 15, color: colors.primary },
  identity: { flex: 1, minWidth: 0, gap: 1 },
  username: { ...text.bodyStrong, fontSize: 15, color: colors.textPrimary },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  phone: { ...text.caption, color: colors.textSecondary },
  blocked: {
    ...text.caption, color: colors.error, textTransform: 'uppercase', fontWeight: '700',
    backgroundColor: alpha(colors.error, 0.14),
    paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm,
  },

  payout: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: alpha(colors.primary, 0.08),
    borderWidth: 1, borderColor: alpha(colors.primary, 0.18),
  },
  payoutEmpty: {
    backgroundColor: colors.surfaceElevated,
    borderColor: 'transparent',
  },
  payoutTag: { ...text.caption, color: colors.primary, fontWeight: '700' },
  payoutValue: { ...text.mono, color: colors.textPrimary, flex: 1 },
  payoutValueEmpty: { ...text.caption, color: colors.textMuted, fontFamily: undefined },

  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  mismatch: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingVertical: 2,
    borderRadius: radius.sm, backgroundColor: alpha(colors.error, 0.12),
  },
  mismatchText: { ...text.caption, color: colors.error, fontWeight: '600' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: '100%' },
  metaText: { ...text.caption, color: colors.textMuted },

  actions: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: space.md,
  },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.md, backgroundColor: colors.surfaceElevated,
  },
  actionText: { ...text.caption, color: colors.textSecondary, fontWeight: '600' },
  blockBtn: { backgroundColor: alpha(colors.error, 0.12) },
  unblockBtn: { backgroundColor: alpha(colors.success, 0.12) },
});
