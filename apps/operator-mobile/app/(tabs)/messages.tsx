import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Switch,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { emitWithTimeout, getSocket } from '@/services/socket';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from '@/components/Toast';
import { PageHeader, Card, Button, ConfirmDialog, EmptyState } from '@/components/ui';
import { colors, space, radius, text, alpha } from '@/constants/theme';

type Variant = { id: string; text: string; enabled: boolean; updatedAt?: string };
type Group = {
  key: string;
  label: string;
  help: string;
  /** Lo que se manda si no hay ninguna variante activa. Vive en el código. */
  fallback: string;
  variants: Variant[];
};

/**
 * Los datos que el sistema agrega abajo del texto, y que el operador no puede
 * romper porque no los escribe él. Se muestran acá para que sepa qué NO hace
 * falta poner en el mensaje.
 */
const SYSTEM_LINES: Record<string, string[]> = {
  PRIZE_PAID: ['Premio: $50.000'],
  PRIZE_REJECTED: ['Pedido: $50.000', 'Motivo: el que escribe el operador'],
  PROOF_REUPLOAD: ['Motivo: el que escribe el operador'],
};

/**
 * Mensajes automáticos.
 *
 * Cada mensaje puede tener varias variantes; el sistema sortea una en cada
 * envío para que el usuario no reciba siempre la misma frase palabra por
 * palabra. Sin ninguna variante escrita se manda el texto por defecto, así que
 * borrar todo nunca deja al cliente sin aviso.
 */
export default function MessagesScreen() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  /** Ediciones sin guardar, por id de variante (o `new:<key>` para las nuevas). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<{ id: string; key: string } | null>(null);
  const connected = useAuthStore((st) => st.isConnected);

  const load = useCallback(async (silent = false) => {
    // El socket tarda unos segundos en conectar (más si Render está frío) y la
    // pantalla se monta antes. Sin esto salía "no se pudieron cargar" apenas
    // entrabas, aunque no hubiera ningún problema: el listener de `connect`
    // vuelve a llamar acá cuando la conexión está lista.
    if (!getSocket()?.connected) {
      setLoading(true);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res: any = await emitWithTimeout('operator:get_message_templates', {}, 15000);
      if (res?.success) setGroups(res.data || []);
      else if (!silent) toast.error(res?.error || 'No se pudieron cargar los mensajes');
    } catch (e: any) {
      if (!silent) toast.error(e?.message || 'No se pudieron cargar los mensajes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Otro operador editando: que la lista no quede vieja.
    const socket = getSocket();
    const onUpdate = () => load(true);
    socket?.on('message_templates_updated', onUpdate);
    // También al (re)conectar: cubre el arranque y la vuelta de un deploy.
    socket?.on('connect', onUpdate);
    return () => {
      socket?.off('message_templates_updated', onUpdate);
      socket?.off('connect', onUpdate);
    };
  }, [load]);

  const save = async (key: string, draftId: string, id: string | null, enabled = true) => {
    const value = (drafts[draftId] ?? '').trim();
    if (!value) return toast.error('Escribí el mensaje');
    setBusyId(draftId);
    try {
      const res: any = await emitWithTimeout(
        'operator:save_message_template',
        { id: id || undefined, key, text: value, enabled },
        15000,
      );
      if (res?.success === false) throw new Error(res.error || 'No se pudo guardar');
      setDrafts((d) => {
        const next = { ...d };
        delete next[draftId];
        return next;
      });
      toast.success('Mensaje guardado');
      await load(true);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (key: string, variant: Variant, enabled: boolean) => {
    setBusyId(variant.id);
    try {
      const res: any = await emitWithTimeout(
        'operator:save_message_template',
        { id: variant.id, key, text: variant.text, enabled },
        15000,
      );
      if (res?.success === false) throw new Error(res.error || 'No se pudo guardar');
      await load(true);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    try {
      const res: any = await emitWithTimeout(
        'operator:delete_message_template',
        { id: toDelete.id, key: toDelete.key },
        15000,
      );
      if (res?.success === false) throw new Error(res.error || 'No se pudo borrar');
      toast.success('Variante borrada');
      await load(true);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo borrar');
    } finally {
      setBusyId(null);
      setToDelete(null);
    }
  };

  const activeCount = useMemo(
    () => groups.reduce((acc, g) => acc + g.variants.filter((v) => v.enabled).length, 0),
    [groups],
  );

  return (
    <View style={s.screen}>
      <PageHeader
        title="Mensajes"
        subtitle={
          loading
            ? 'Cargando…'
            : activeCount
              ? `${activeCount} ${activeCount === 1 ? 'variante escrita' : 'variantes escritas'} — el resto usa el texto por defecto`
              : 'Todos usan el texto por defecto'
        }
        right={
          <Pressable onPress={() => load()} style={s.refresh}>
            <Ionicons name="refresh" size={18} color={colors.textSecondary} />
          </Pressable>
        }
      />

      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={s.loadingText}>
            {connected ? 'Cargando los mensajes…' : 'Conectando con el servidor…'}
          </Text>
        </View>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No se pudieron cargar los mensajes"
          subtitle="Probá refrescar."
        />
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          <Text style={s.intro}>
            Estos son los mensajes que le llegan solos al cliente. Podés escribir varias
            variantes de cada uno: el sistema elige una al azar en cada envío, así no suena
            siempre igual. Los datos que cambian —monto, motivo— los agrega el sistema abajo
            del texto, no hace falta que los escribas.
          </Text>

          {groups.map((group) => {
            const newDraftId = `new:${group.key}`;
            const hasNew = drafts[newDraftId] !== undefined;
            const active = group.variants.filter((v) => v.enabled).length;

            return (
              <Card key={group.key} style={s.group}>
                <View style={s.groupHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.groupTitle}>{group.label}</Text>
                    <Text style={s.groupHelp}>{group.help}</Text>
                  </View>
                  <View style={[s.pill, active ? s.pillOn : null]}>
                    <Text style={[s.pillText, active ? s.pillTextOn : null]}>
                      {active ? `${active} en uso` : 'por defecto'}
                    </Text>
                  </View>
                </View>

                {!active && (
                  <View style={s.fallback}>
                    <Text style={s.fallbackLabel}>Hoy se manda:</Text>
                    <Text style={s.fallbackText}>{group.fallback}</Text>
                  </View>
                )}

                {group.variants.map((variant, i) => {
                  const draft = drafts[variant.id];
                  const value = draft ?? variant.text;
                  const dirty = draft !== undefined && draft.trim() !== variant.text;
                  return (
                    <View key={variant.id} style={s.variant}>
                      <View style={s.variantHead}>
                        <Text style={s.variantLabel}>Variante {i + 1}</Text>
                        <Switch
                          value={variant.enabled}
                          onValueChange={(v) => toggle(group.key, variant, v)}
                          trackColor={{ false: colors.border, true: alpha(colors.primary, 0.5) }}
                          thumbColor={variant.enabled ? colors.primary : colors.textMuted}
                        />
                        <Pressable
                          onPress={() => setToDelete({ id: variant.id, key: group.key })}
                          style={s.iconBtn}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                        </Pressable>
                      </View>
                      <TextInput
                        value={value}
                        onChangeText={(t) => setDrafts((d) => ({ ...d, [variant.id]: t }))}
                        multiline
                        style={[s.input, !variant.enabled && s.inputOff]}
                        placeholderTextColor={colors.placeholder}
                      />
                      {dirty && (
                        <Button
                          label="Guardar cambios"
                          tone="primary"
                          icon="save-outline"
                          loading={busyId === variant.id}
                          onPress={() => save(group.key, variant.id, variant.id, variant.enabled)}
                        />
                      )}
                    </View>
                  );
                })}

                {hasNew && (
                  <View style={s.variant}>
                    <Text style={s.variantLabel}>Nueva variante</Text>
                    <TextInput
                      value={drafts[newDraftId]}
                      onChangeText={(t) => setDrafts((d) => ({ ...d, [newDraftId]: t }))}
                      multiline
                      autoFocus
                      placeholder="Escribí el mensaje tal como querés que le llegue"
                      placeholderTextColor={colors.placeholder}
                      style={s.input}
                    />
                    <View style={s.newActions}>
                      <Button
                        label="Cancelar"
                        tone="neutral"
                        style={{ flex: 1 }}
                        onPress={() =>
                          setDrafts((d) => {
                            const next = { ...d };
                            delete next[newDraftId];
                            return next;
                          })
                        }
                      />
                      <Button
                        label="Guardar"
                        tone="primary"
                        style={{ flex: 1 }}
                        loading={busyId === newDraftId}
                        onPress={() => save(group.key, newDraftId, null)}
                      />
                    </View>
                  </View>
                )}

                {!hasNew && (
                  <Pressable
                    onPress={() => setDrafts((d) => ({ ...d, [newDraftId]: '' }))}
                    style={s.addBtn}
                  >
                    <Ionicons name="add" size={16} color={colors.primary} />
                    <Text style={s.addText}>Agregar variante</Text>
                  </Pressable>
                )}

                {!!SYSTEM_LINES[group.key] && (
                  <View style={s.system}>
                    <Text style={s.systemLabel}>El sistema agrega abajo:</Text>
                    {SYSTEM_LINES[group.key].map((line) => (
                      <Text key={line} style={s.systemLine}>{line}</Text>
                    ))}
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={Boolean(toDelete)}
        title="Borrar variante"
        message="Se borra este texto. Si era el último, el mensaje vuelve al texto por defecto."
        confirmLabel="Borrar"
        tone="danger"
        loading={busyId === toDelete?.id}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  refresh: { padding: space.sm, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  loadingText: { ...text.body, color: colors.textMuted },
  list: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    gap: space.lg,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  intro: { ...text.body, color: colors.textSecondary, lineHeight: 20 },

  group: { gap: space.md },
  groupHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  groupTitle: { ...text.title, color: colors.textPrimary },
  groupHelp: { ...text.caption, color: colors.textMuted, marginTop: 2, lineHeight: 15 },
  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
  },
  pillOn: { backgroundColor: alpha(colors.primary, 0.16) },
  pillText: { ...text.caption, color: colors.textMuted },
  pillTextOn: { color: colors.primary, fontWeight: '700' },

  fallback: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    paddingLeft: space.md,
    paddingVertical: space.xs,
  },
  fallbackLabel: { ...text.caption, color: colors.textMuted },
  fallbackText: { ...text.body, color: colors.textSecondary, marginTop: 2 },

  variant: { gap: space.sm },
  variantHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  variantLabel: { ...text.label, color: colors.textSecondary, flex: 1 },
  iconBtn: { padding: space.xs },
  input: {
    ...text.body,
    color: colors.textPrimary,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 64,
    outlineStyle: 'none',
  } as any,
  inputOff: { opacity: 0.5 },
  newActions: { flexDirection: 'row', gap: space.sm },

  addBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start' },
  addText: { ...text.label, color: colors.primary },

  system: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  systemLabel: { ...text.caption, color: colors.textMuted },
  systemLine: { ...text.mono, color: colors.textSecondary },
});
