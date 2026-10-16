/**
 * Ficha del cliente.
 *
 * Un solo lugar con todo lo de una persona: cómo se llama en el panel, sus
 * últimas cargas con el estado de cada una, sus premios, su chat, y los botones
 * para operar sin salir de acá — incluido cargarle fichas aunque no haya ningún
 * pedido esperando.
 *
 * Existe porque la pregunta más común del turno es "¿qué pasa con fulano?", y
 * contestarla obligaba a recorrer Seguimiento, Historial, Premios y Chats
 * buscando el mismo nombre en cuatro buscadores distintos.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useUserOverview } from '@/hooks/useUserOverview';
import { useLoadActions } from '@/hooks/useLoadActions';
import LoadActions from '@/components/LoadActions';
import AmountDialog from '@/components/AmountDialog';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { CopyableText } from '@/components/Copyable';
import { toast } from '@/components/Toast';
import { formatMoney, parseAmount } from '@/utils/amount';
import { formatClock, timeAgo } from '@/utils/time';
import { statusMeta } from '@/utils/history';
import { prizeStatusMeta } from '@/utils/prizes';
import { toActionable } from '@/utils/loadActions';
import { colors, space, radius, text } from '@/constants/theme';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, loading, error, refresh } = useUserOverview(id);
  const actions = useLoadActions();
  const [loadDialog, setLoadDialog] = useState(false);

  if (loading && !data) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={s.center}>
        <EmptyState
          icon="person-outline"
          title={error ? 'No se pudo traer la ficha' : 'Cliente no encontrado'}
          subtitle={error ?? undefined}
        />
        <Button label="Volver" tone="neutral" onPress={() => router.back()} />
      </View>
    );
  }

  const { user, loads, prizeClaims, chatId } = data;
  // El nombre que importa es el del panel: es el que el operador pega en el
  // buscador del casino. El de la app puede ser otro.
  const panelName = user.savedTargetUsername ?? user.username ?? '—';

  const cargar = async (amount: number, note?: string) => {
    const err = await actions.loadCredits(user.id, amount, note);
    if (err) return toast.error(err);
    toast.success(`Se le cargan ${formatMoney(amount)} a ${panelName}`);
    setLoadDialog(false);
    refresh();
  };

  return (
    <View style={s.screen}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.back}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backText}>Volver</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Card>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <CopyableText value={panelName} label="Usuario del panel" style={s.name} />
              <Text style={s.sub}>
                {user.username && user.username !== panelName ? `en la app: ${user.username} · ` : ''}
                {user.phone ? `tel ${user.phone}` : 'sin teléfono'}
                {user.panel?.name ? ` · ${user.panel.name}` : ' · sin panel asignado'}
              </Text>
            </View>
            {!user.isActive && <Badge label="Deshabilitado" color={colors.error} />}
          </View>

          <View style={s.actions}>
            <Button
              label="Cargar fichas"
              tone="success"
              icon="cash-outline"
              onPress={() => setLoadDialog(true)}
            />
            {!!chatId && (
              <Button
                label="Abrir chat"
                tone="neutral"
                icon="chatbubble-outline"
                onPress={() => router.push(`/chat/${chatId}` as any)}
              />
            )}
          </View>
        </Card>

        <Text style={s.sectionTitle}>Cargas</Text>
        {loads.length === 0 ? (
          <Text style={s.empty}>Todavía no pidió ninguna carga.</Text>
        ) : (
          loads.map((load) => {
            const meta = statusMeta(load.status);
            return (
              <Card key={load.id} accent={meta.color}>
                <View style={s.rowHead}>
                  <Text style={s.amount}>{formatMoney(parseAmount(load.amount))}</Text>
                  <Badge label={meta.label} color={meta.color} />
                  <Text style={s.when}>
                    {formatClock(load.createdAt)} · hace {timeAgo(load.createdAt)}
                  </Text>
                </View>
                {!!load.trail.stalled && (
                  <Text style={s.stalled}>
                    Sin moverse — {(load.trail.current?.label ?? '').toLowerCase()}
                  </Text>
                )}
                <LoadActions load={toActionable(load)} onDone={refresh} />
              </Card>
            );
          })
        )}

        {prizeClaims.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Premios</Text>
            {prizeClaims.map((claim) => {
              const meta = prizeStatusMeta(claim.status);
              return (
                <Card key={claim.id}>
                  <Pressable
                    style={s.rowHead}
                    onPress={() => router.push(`/prize/${claim.id}` as any)}
                  >
                    <Text style={s.amount}>{formatMoney(parseAmount(claim.amount))}</Text>
                    <Badge label={meta.label} color={meta.color} />
                    <Text style={s.when}>hace {timeAgo(claim.createdAt)}</Text>
                  </Pressable>
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>

      <AmountDialog
        visible={loadDialog}
        title={`Cargar fichas a ${panelName}`}
        username={panelName}
        requested={null}
        extracted={null}
        loading={actions.busy}
        onConfirm={(c) => cargar(c.amount, c.note)}
        onCancel={() => setLoadDialog(false)}
        noteLabel="Por qué (queda registrado)"
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  backText: { ...text.body, color: colors.textPrimary },

  body: { padding: space.lg, gap: space.md, maxWidth: 900, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  name: { ...text.display, color: colors.textPrimary },
  sub: { ...text.caption, color: colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },

  sectionTitle: { ...text.caption, color: colors.textSecondary, marginTop: space.md },
  empty: { ...text.body, color: colors.textMuted },

  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  amount: { ...text.title, color: colors.textPrimary },
  when: { ...text.caption, color: colors.textMuted, marginLeft: 'auto' },
  stalled: { ...text.caption, color: colors.warning, marginTop: space.xs },
});
