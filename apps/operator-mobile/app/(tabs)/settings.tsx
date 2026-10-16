import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Switch, ActivityIndicator, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useOperatorStore, DEFAULT_QUICK_REPLIES, QuickReply } from '@/stores/operator.store';
import { useAuthStore } from '@/stores/auth.store';
import { emitWithTimeout, getSocket } from '@/services/socket';
import { getApiConfig } from '@/services/api';
import { toast } from '@/components/Toast';
import KillSwitchButton from '@/components/KillSwitchButton';
import { Button, ConfirmDialog, Card, PageHeader } from '@/components/ui';
import { colors, space, radius, text, alpha } from '@/constants/theme';
import {
  notificationPermission,
  prizeAlertsEnabled,
  setPrizeAlertsEnabled,
  testPrizeAlert,
} from '@/services/webNotifications';

const QUICK_REPLIES_KEY = '@operator_quick_replies';

/**
 * Ajustes.
 *
 * Antes eran 1.130 líneas con ~20 `useState` espejando el store, 23
 * `Alert.alert` y tres cosas que no hacían nada: el toggle de "Sonido" (el
 * servicio de notificaciones sólo vibra, y en web ni eso), el de "Vibración"
 * (no aplica en un browser) y los tres campos `autoPayment*`, que se mandaban
 * al backend sin tener ningún control en la pantalla.
 *
 * `update_system_settings` aplica los campos de a uno (`if (dto.x !== undefined)`),
 * así que omitir los que ya no se editan no los resetea.
 */
export default function SettingsScreen() {
  const router = useRouter();
  // Avisos de premios: preferencia del navegador, no del servidor — es de este
  // puesto de trabajo, no de la cuenta.
  const [prizeAlerts, setPrizeAlerts] = useState(prizeAlertsEnabled());
  const config = useAuthStore((s) => s.config) ?? getApiConfig();
  const storeSettings = useOperatorStore((s) => s.settings);
  const setStoreSettings = useOperatorStore((s) => s.setSettings);
  const killSwitchActive = useOperatorStore((s) => s.killSwitchActive);
  const setKillSwitch = useOperatorStore((s) => s.setKillSwitch);
  const quickReplies = useOperatorStore((s) => s.quickReplies);
  const setQuickReplies = useOperatorStore((s) => s.setQuickReplies);
  const isConnected = useAuthStore((s) => s.isConnected);
  const reset = useOperatorStore((s) => s.reset);

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    validationThreshold: '',
    validationTimeoutMs: '',
    queueCooldownMs: '',
    maxRequestsPerUserPerHour: '',
    panelBalanceThreshold: '',
    botActivityWindowStart: '',
    botActivityWindowEnd: '',
    supportPhoneNumber: '',
  });
  const [botEnabled, setBotEnabled] = useState(true);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [operatorName, setOperatorName] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('operator_name').then((n) => n && setOperatorName(n));
  }, []);

  // Un solo efecto de sincronización, en vez de veinte estados sueltos con
  // defaults duplicados como strings.
  useEffect(() => {
    if (!storeSettings) return;
    setForm({
      validationThreshold: String(storeSettings.validationThreshold ?? 0.7),
      validationTimeoutMs: String(storeSettings.validationTimeoutMs ?? 90),
      queueCooldownMs: String(storeSettings.queueCooldownMs ?? 30000),
      maxRequestsPerUserPerHour: String(storeSettings.maxRequestsPerUserPerHour ?? 10),
      panelBalanceThreshold: String(storeSettings.panelBalanceThreshold ?? 0),
      botActivityWindowStart: storeSettings.botActivityWindowStart ?? '',
      botActivityWindowEnd: storeSettings.botActivityWindowEnd ?? '',
      supportPhoneNumber: storeSettings.supportPhoneNumber ?? '',
    });
    setBotEnabled(storeSettings.botEnabled ?? true);
  }, [storeSettings]);

  useEffect(() => {
    AsyncStorage.getItem(QUICK_REPLIES_KEY).then((stored) => {
      if (!stored) return;
      try { setQuickReplies(JSON.parse(stored) as QuickReply[]); } catch { /* defaults */ }
    });
  }, [setQuickReplies]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const saveSystem = useCallback(async () => {
    const threshold = parseFloat(form.validationThreshold);
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      return toast.error('El umbral de validación va entre 0 y 1');
    }
    const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
    for (const k of ['botActivityWindowStart', 'botActivityWindowEnd'] as const) {
      if (form[k] && !timeRe.test(form[k])) return toast.error('El horario va en formato HH:MM');
    }

    setSaving(true);
    try {
      const payload: any = {
        validationThreshold: threshold,
        validationTimeoutMs: parseInt(form.validationTimeoutMs, 10) || 90,
        queueCooldownMs: parseInt(form.queueCooldownMs, 10) || 30000,
        maxRequestsPerUserPerHour: parseInt(form.maxRequestsPerUserPerHour, 10) || 10,
        panelBalanceThreshold: parseInt(form.panelBalanceThreshold, 10) || 0,
        botEnabled,
      };
      if (form.botActivityWindowStart) payload.botActivityWindowStart = form.botActivityWindowStart;
      if (form.botActivityWindowEnd) payload.botActivityWindowEnd = form.botActivityWindowEnd;
      if (form.supportPhoneNumber.trim()) payload.supportPhoneNumber = form.supportPhoneNumber.trim();

      const res: any = await emitWithTimeout('update_system_settings', payload, 15000);
      if (res?.error) throw new Error(res.error);
      if (res?.data) setStoreSettings(res.data);
      toast.success('Configuración guardada');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }, [form, botEnabled, setStoreSettings]);

  const toggleKillSwitch = useCallback(async (reason?: string) => {
    const next = !killSwitchActive;
    try {
      const payload: any = { active: next };
      if (reason) payload.reason = reason;
      const res: any = await emitWithTimeout('set_kill_switch', payload, 10000);
      if (res?.error) throw new Error(res.error);
      setKillSwitch(next);
      toast.success(next ? 'Kill switch activado — no se despacha nada' : 'Kill switch desactivado');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cambiar el kill switch');
    }
  }, [killSwitchActive, setKillSwitch]);

  const persistReplies = async (replies: QuickReply[]) => {
    setQuickReplies(replies);
    await AsyncStorage.setItem(QUICK_REPLIES_KEY, JSON.stringify(replies));
  };

  const logout = async () => {
    await AsyncStorage.removeItem('operator_name');
    reset();
    setLogoutOpen(false);
    router.replace('/wizard');
  };

  const replies = quickReplies.length > 0 ? quickReplies : DEFAULT_QUICK_REPLIES;

  return (
    <View style={s.screen}>
      <PageHeader title="Ajustes" subtitle="Lo que casi nunca se toca" />

      <ScrollView contentContainerStyle={s.content}>
        <Card>
          <Text style={s.cardTitle}>Conexión</Text>
          <Row label="Servidor" value={config?.backendUrl || '—'} />
          <Row label="Operador" value={(config as any)?.operatorName || operatorName || '—'} />
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: isConnected ? colors.onlineGreen : colors.error }]} />
            <Text style={s.statusText}>{isConnected ? 'Conectado' : 'Desconectado'}</Text>
          </View>
          <View style={s.rowButtons}>
            <Button
              label="Reconectar" tone="neutral" icon="refresh" style={{ flex: 1 }}
              onPress={() => {
                const sock = getSocket();
                sock?.disconnect();
                setTimeout(() => sock?.connect(), 500);
                toast.success('Reconectando…');
              }}
            />
            <Button label="Cerrar sesión" tone="neutral" icon="log-out-outline" style={{ flex: 1 }}
                    onPress={() => setLogoutOpen(true)} />
          </View>
        </Card>

        <Card>
          <Text style={s.cardTitle}>Kill switch</Text>
          <Text style={s.hint}>
            Con esto activo el bot no despacha ninguna carga. Las solicitudes se siguen
            acumulando en la cola y salen cuando lo desactivás.
          </Text>
          <KillSwitchButton active={killSwitchActive} onToggle={toggleKillSwitch} />
        </Card>

        <Card>
          <Text style={s.cardTitle}>Respuestas rápidas</Text>
          <Text style={s.hint}>Aparecen como atajos arriba del teclado en el chat.</Text>
          {replies.map((qr) => (
            <View key={qr.id} style={s.replyRow}>
              <Text style={s.replyIcon}>{qr.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.replyLabel}>{qr.label}</Text>
                <Text style={s.replyText} numberOfLines={2}>{qr.text}</Text>
              </View>
              <Pressable
                onPress={() => persistReplies(replies.filter((r) => r.id !== qr.id))}
                style={s.replyDelete}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <Button label="Restaurar las de fábrica" tone="neutral" icon="refresh-outline"
                  onPress={() => persistReplies([...DEFAULT_QUICK_REPLIES])} />
        </Card>

        <Card>
          <Text style={s.cardTitle}>Sistema</Text>

          <Field label="Umbral de validación (0 a 1)"
                 hint="Debajo de esto el comprobante cae a revisión manual."
                 value={form.validationThreshold} onChange={(v) => set('validationThreshold', v)} numeric />
          <Field label="Timeout del validador (segundos)"
                 value={form.validationTimeoutMs} onChange={(v) => set('validationTimeoutMs', v)} numeric />
          <Field label="Espera entre cargas (ms)"
                 hint="Cuánto descansa el bot entre un job y el siguiente."
                 value={form.queueCooldownMs} onChange={(v) => set('queueCooldownMs', v)} numeric />
          <Field label="Máximo de cargas por usuario por hora"
                 value={form.maxRequestsPerUserPerHour} onChange={(v) => set('maxRequestsPerUserPerHour', v)} numeric />
          <Field label="Avisar cuando el panel baje de"
                 hint="Fichas disponibles en el panel de juego."
                 value={form.panelBalanceThreshold} onChange={(v) => set('panelBalanceThreshold', v)} numeric />

          <View style={s.rowFields}>
            <Field label="El bot arranca a las" placeholder="09:00" style={{ flex: 1 }}
                   value={form.botActivityWindowStart} onChange={(v) => set('botActivityWindowStart', v)} />
            <Field label="y para a las" placeholder="23:00" style={{ flex: 1 }}
                   value={form.botActivityWindowEnd} onChange={(v) => set('botActivityWindowEnd', v)} />
          </View>

          <Field label="Teléfono de soporte"
                 value={form.supportPhoneNumber} onChange={(v) => set('supportPhoneNumber', v)} />

          {Platform.OS === 'web' && (
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.fieldLabel}>Avisar cuando llega un pedido de premio</Text>
                <Text style={s.hint}>
                  {notificationPermission() === 'denied'
                    ? 'El navegador tiene las notificaciones bloqueadas: sólo vas a escuchar el sonido y ver el contador en la pestaña.'
                    : 'Suena un aviso y salta una notificación aunque tengas el panel en otra pestaña.'}
                  {'  '}
                  <Text style={s.testLink} onPress={testPrizeAlert}>Probar</Text>
                </Text>
              </View>
              <Switch
                value={prizeAlerts}
                onValueChange={(v) => {
                  setPrizeAlerts(v);
                  setPrizeAlertsEnabled(v);
                }}
                trackColor={{ false: colors.border, true: alpha(colors.primary, 0.5) }}
                thumbColor={prizeAlerts ? colors.primary : colors.textMuted}
              />
            </View>
          )}

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Bot habilitado</Text>
              <Text style={s.hint}>Si lo apagás, las cargas quedan encoladas.</Text>
            </View>
            <Switch value={botEnabled} onValueChange={setBotEnabled}
                    trackColor={{ false: colors.border, true: alpha(colors.primary, 0.5) }}
                    thumbColor={botEnabled ? colors.primary : colors.textMuted} />
          </View>

          <Button label="Guardar configuración" tone="primary" icon="save-outline"
                  loading={saving} onPress={saveSystem} />
        </Card>
      </ScrollView>

      <ConfirmDialog
        visible={logoutOpen} title="Cerrar sesión"
        message="Vas a volver a la pantalla de configuración inicial."
        confirmLabel="Cerrar sesión" tone="danger"
        onConfirm={logout} onCancel={() => setLogoutOpen(false)}
      />
      {saving && <View style={s.busy}><ActivityIndicator color={colors.primary} /></View>}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} selectable numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Field({
  label, hint, value, onChange, numeric, placeholder, style,
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  numeric?: boolean; placeholder?: string; style?: any;
}) {
  return (
    <View style={[{ gap: space.xs }, style]}>
      <Text style={s.fieldLabel}>{label}</Text>
      {!!hint && <Text style={s.hint}>{hint}</Text>}
      <TextInput
        style={s.input} value={value} onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        placeholder={placeholder} placeholderTextColor={colors.placeholder}
      />
    </View>
  );
}

const s = StyleSheet.create({
  testLink: { color: colors.primary, textDecorationLine: 'underline' },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xl, paddingTop: 0, gap: space.lg, maxWidth: 720, width: '100%' },

  cardTitle: { ...text.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.sm },
  hint: { ...text.caption, color: colors.textMuted, lineHeight: 16 },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: space.xs },
  infoLabel: { ...text.body, color: colors.textSecondary },
  infoValue: { ...text.body, color: colors.textPrimary, flexShrink: 1 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  dot: { width: 7, height: 7, borderRadius: radius.full },
  statusText: { ...text.caption, color: colors.textSecondary },

  rowButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  rowFields: { flexDirection: 'row', gap: space.md },

  replyRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  replyIcon: { fontSize: 18 },
  replyLabel: { ...text.bodyStrong, color: colors.textPrimary },
  replyText: { ...text.caption, color: colors.textMuted },
  replyDelete: { padding: space.sm },

  fieldLabel: { ...text.body, color: colors.textPrimary },
  input: {
    ...text.body, color: colors.textPrimary, backgroundColor: colors.input,
    borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.md,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },

  busy: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.background, 0.5),
  },
});
