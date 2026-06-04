import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOperatorStore, DEFAULT_QUICK_REPLIES, type QuickReply } from '@/stores/operator.store';
import { useAuthStore } from '@/stores/auth.store';
import { connectSocket, disconnectSocket, emitWithTimeout } from '@/services/socket';
import { hapticSuccess, hapticMedium, hapticError } from '@/utils/haptics';
import { getSoundEnabled, setSoundEnabled, getVibrationEnabled, setVibrationEnabled } from '@/services/notifications';
import KillSwitchButton from '@/components/KillSwitchButton';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const config = useAuthStore((s) => s.config);
  const isConnected = useAuthStore((s) => s.isConnected);
  const logout = useAuthStore((s) => s.logout);

  const killSwitchActive = useOperatorStore((s) => s.killSwitchActive);
  const setKillSwitch = useOperatorStore((s) => s.setKillSwitch);
  const quickReplies = useOperatorStore((s) => s.quickReplies);
  const setQuickReplies = useOperatorStore((s) => s.setQuickReplies);
  const storeSettings = useOperatorStore((s) => s.settings);
  const setStoreSettings = useOperatorStore((s) => s.setSettings);
  const lastUpdate = useOperatorStore((s) => s.lastUpdate);

  // ---- Local form state ----
  const [supportPhone, setSupportPhone] = useState('');
  const [savingSupport, setSavingSupport] = useState(false);

  const [validationThreshold, setValidationThreshold] = useState('');
  const [validationTimeout, setValidationTimeout] = useState('');
  const [queueCooldown, setQueueCooldown] = useState('');
  // maxRequestAmount removed — no amount limits
  const [maxRequestsPerHour, setMaxRequestsPerHour] = useState('');
  const [activityWindowStart, setActivityWindowStart] = useState('');
  const [activityWindowEnd, setActivityWindowEnd] = useState('');
  const [botEnabled, setBotEnabled] = useState(true);
  const [panelBalanceThreshold, setPanelBalanceThreshold] = useState('');
  const [defaultNewUserPanelId, setDefaultNewUserPanelId] = useState('');
  const [autoPaymentEnabled, setAutoPaymentEnabled] = useState(false);
  const [autoPaymentRequiresConfirm, setAutoPaymentRequiresConfirm] = useState(true);
  const [autoPaymentMaxAmount, setAutoPaymentMaxAmount] = useState('50000');
  const [panels, setPanels] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  const [reconnecting, setReconnecting] = useState(false);

  // Notification settings
  const [soundOn, setSoundOn] = useState(getSoundEnabled());
  const [vibrationOn, setVibrationOn] = useState(getVibrationEnabled());

  // Quick reply editing
  const [editingQR, setEditingQR] = useState<QuickReply | null>(null);
  const [qrIcon, setQrIcon] = useState('');
  const [qrLabel, setQrLabel] = useState('');
  const [qrText, setQrText] = useState('');

  const QUICK_REPLIES_STORAGE_KEY = '@operator_quick_replies';

  // Load notification preferences on mount
  useEffect(() => {
    AsyncStorage.getItem('@notif_sound').then((v) => {
      if (v !== null) { const on = v !== 'false'; setSoundOn(on); setSoundEnabled(on); }
    });
    AsyncStorage.getItem('@notif_vibration').then((v) => {
      if (v !== null) { const on = v !== 'false'; setVibrationOn(on); setVibrationEnabled(on); }
    });
  }, []);

  const handleToggleSound = (val: boolean) => {
    setSoundOn(val);
    setSoundEnabled(val);
    AsyncStorage.setItem('@notif_sound', String(val));
  };

  const handleToggleVibration = (val: boolean) => {
    setVibrationOn(val);
    setVibrationEnabled(val);
    AsyncStorage.setItem('@notif_vibration', String(val));
  };

  // Load quick replies from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(QUICK_REPLIES_STORAGE_KEY).then((stored) => {
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as QuickReply[];
          setQuickReplies(parsed);
        } catch { /* use defaults */ }
      }
    });
  }, [setQuickReplies]);

  const effectiveQuickReplies = quickReplies.length > 0 ? quickReplies : DEFAULT_QUICK_REPLIES;

  const persistQuickReplies = useCallback(
    async (replies: QuickReply[]) => {
      setQuickReplies(replies);
      await AsyncStorage.setItem(QUICK_REPLIES_STORAGE_KEY, JSON.stringify(replies));
    },
    [setQuickReplies],
  );

  const handleAddQuickReply = useCallback(() => {
    setEditingQR({ id: '', icon: '💬', label: '', text: '', order: effectiveQuickReplies.length });
    setQrIcon('💬');
    setQrLabel('');
    setQrText('');
  }, [effectiveQuickReplies.length]);

  const handleEditQuickReply = useCallback((qr: QuickReply) => {
    setEditingQR(qr);
    setQrIcon(qr.icon);
    setQrLabel(qr.label);
    setQrText(qr.text);
  }, []);

  const handleSaveQuickReply = useCallback(async () => {
    if (!qrIcon.trim() || !qrLabel.trim() || !qrText.trim()) {
      Alert.alert('Error', 'Todos los campos son obligatorios');
      return;
    }
    if (qrLabel.length > 30) {
      Alert.alert('Error', 'La etiqueta no puede tener mas de 30 caracteres');
      return;
    }
    if (qrText.length > 500) {
      Alert.alert('Error', 'El texto no puede tener mas de 500 caracteres');
      return;
    }

    const isNew = !editingQR?.id;
    const current = quickReplies.length > 0 ? [...quickReplies] : [...DEFAULT_QUICK_REPLIES];

    if (isNew) {
      if (current.length >= 20) {
        Alert.alert('Error', 'Maximo 20 respuestas rapidas');
        return;
      }
      const newQR: QuickReply = {
        id: `qr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        icon: qrIcon.trim(),
        label: qrLabel.trim(),
        text: qrText.trim(),
        order: current.length,
      };
      await persistQuickReplies([...current, newQR]);
    } else {
      const updated = current.map((qr) =>
        qr.id === editingQR!.id
          ? { ...qr, icon: qrIcon.trim(), label: qrLabel.trim(), text: qrText.trim() }
          : qr,
      );
      await persistQuickReplies(updated);
    }

    setEditingQR(null);
    hapticSuccess();
  }, [editingQR, qrIcon, qrLabel, qrText, quickReplies, persistQuickReplies]);

  const handleDeleteQuickReply = useCallback(
    (id: string) => {
      Alert.alert('Eliminar', 'Seguro que queres eliminar esta respuesta rapida?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const current = quickReplies.length > 0 ? quickReplies : DEFAULT_QUICK_REPLIES;
            const filtered = current.filter((qr) => qr.id !== id).map((qr, i) => ({ ...qr, order: i }));
            await persistQuickReplies(filtered);
            hapticMedium();
          },
        },
      ]);
    },
    [quickReplies, persistQuickReplies],
  );

  const handleResetQuickReplies = useCallback(() => {
    Alert.alert('Restaurar', 'Restaurar las respuestas rapidas por defecto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Restaurar',
        onPress: async () => {
          await persistQuickReplies([]);
          hapticSuccess();
        },
      },
    ]);
  }, [persistQuickReplies]);

  // Populate form from store settings
  useEffect(() => {
    if (!storeSettings) return;

    setSupportPhone(storeSettings.supportPhoneNumber || '');
    setValidationThreshold(
      storeSettings.validationThreshold != null ? String(storeSettings.validationThreshold) : '0.8',
    );
    setValidationTimeout(
      storeSettings.validationTimeout != null ? String(storeSettings.validationTimeout) : '30',
    );
    setQueueCooldown(
      storeSettings.queueCooldown != null ? String(storeSettings.queueCooldown) : '30',
    );
    setMaxRequestsPerHour(
      storeSettings.maxRequestsPerHour != null ? String(storeSettings.maxRequestsPerHour) : '10',
    );
    setActivityWindowStart(storeSettings.activityWindowStart || '08:00');
    setActivityWindowEnd(storeSettings.activityWindowEnd || '23:00');
    setBotEnabled(storeSettings.botEnabled !== false);
    setPanelBalanceThreshold(
      storeSettings.panelBalanceThreshold != null ? String(storeSettings.panelBalanceThreshold) : '1000',
    );
    setDefaultNewUserPanelId(storeSettings.defaultNewUserPanelId || '');
    setAutoPaymentEnabled(storeSettings.autoPaymentEnabled === true);
    setAutoPaymentRequiresConfirm(storeSettings.autoPaymentRequiresConfirm !== false);
    setAutoPaymentMaxAmount(
      storeSettings.autoPaymentMaxAmount != null ? String(storeSettings.autoPaymentMaxAmount) : '50000',
    );
    if (storeSettings.panels) {
      setPanels(storeSettings.panels);
    }
  }, [storeSettings]);

  // ---- Handlers ----

  const handleReconnect = useCallback(async () => {
    if (!config) return;
    setReconnecting(true);
    hapticMedium();

    try {
      disconnectSocket();
      // Small delay to ensure clean disconnect
      await new Promise((r) => setTimeout(r, 500));
      connectSocket({
        backendUrl: config.backendUrl,
        apiKey: config.apiKey,
        operatorName: config.operatorName,
      });
      hapticSuccess();
    } catch {
      hapticError();
      Alert.alert('Error', 'No se pudo reconectar');
    } finally {
      setTimeout(() => setReconnecting(false), 2000);
    }
  }, [config]);

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Cerrar Sesion',
      'Se desconectara del backend y se eliminaran las credenciales guardadas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar Sesion',
          style: 'destructive',
          onPress: () => {
            hapticMedium();
            disconnectSocket();
            useOperatorStore.getState().reset();
            logout();
          },
        },
      ],
    );
  }, [logout]);

  const handleToggleKillSwitch = useCallback(async (reason?: string) => {
    try {
      const newState = !killSwitchActive;
      const payload: any = { active: newState };
      if (reason) payload.reason = reason;

      const result = await emitWithTimeout<any>(
        'set_kill_switch',
        payload,
        10000,
      );
      if (result?.error) {
        Alert.alert('Error', result.error);
        return;
      }
      setKillSwitch(newState);
      hapticSuccess();
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'No se pudo cambiar el kill switch');
    }
  }, [killSwitchActive, setKillSwitch]);

  const handleSaveSupport = useCallback(async () => {
    if (!supportPhone.trim()) {
      Alert.alert('Error', 'Ingresa un numero de telefono');
      return;
    }

    setSavingSupport(true);
    try {
      const result = await emitWithTimeout<any>(
        'update_system_settings',
        { supportPhoneNumber: supportPhone.trim() },
        15000,
      );
      if (result?.error) {
        Alert.alert('Error', result.error);
        return;
      }
      if (result?.data) {
        setStoreSettings(result.data);
      }
      hapticSuccess();
      Alert.alert('Guardado', 'Telefono de soporte actualizado');
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'No se pudo guardar');
    } finally {
      setSavingSupport(false);
    }
  }, [supportPhone, setStoreSettings]);

  const handleSaveSystemSettings = useCallback(async () => {
    // Validate
    const threshold = parseFloat(validationThreshold);
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      Alert.alert('Error', 'El umbral de validacion debe estar entre 0 y 1');
      return;
    }

    const timeout = parseInt(validationTimeout, 10);
    if (isNaN(timeout) || timeout < 5) {
      Alert.alert('Error', 'El timeout de validacion debe ser al menos 5 segundos');
      return;
    }

    const cooldown = parseInt(queueCooldown, 10);
    if (isNaN(cooldown) || cooldown < 0) {
      Alert.alert('Error', 'El cooldown debe ser >= 0');
      return;
    }

    // Validate time format HH:MM
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (activityWindowStart && !timeRegex.test(activityWindowStart)) {
      Alert.alert('Error', 'El horario de inicio debe tener formato HH:MM (24hs)');
      return;
    }
    if (activityWindowEnd && !timeRegex.test(activityWindowEnd)) {
      Alert.alert('Error', 'El horario de fin debe tener formato HH:MM (24hs)');
      return;
    }

    setSavingSettings(true);
    try {
      const payload: any = {
        validationThreshold: threshold,
        validationTimeoutMs: timeout,
        queueCooldownMs: cooldown,
        maxRequestsPerUserPerHour: parseInt(maxRequestsPerHour, 10) || 10,
        botEnabled,
        panelBalanceThreshold: parseInt(panelBalanceThreshold, 10) || 0,
        defaultNewUserPanelId,
        autoPaymentEnabled,
        autoPaymentRequiresConfirm,
        autoPaymentMaxAmount: parseInt(autoPaymentMaxAmount, 10) || 50000,
      };

      if (activityWindowStart) payload.botActivityWindowStart = activityWindowStart;
      if (activityWindowEnd) payload.botActivityWindowEnd = activityWindowEnd;

      const result = await emitWithTimeout<any>('update_system_settings', payload, 15000);
      if (result?.error) {
        Alert.alert('Error', result.error);
        return;
      }
      if (result?.data) {
        setStoreSettings(result.data);
      }
      hapticSuccess();
      Alert.alert('Guardado', 'Configuracion del sistema actualizada');
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'No se pudo guardar la configuracion');
    } finally {
      setSavingSettings(false);
    }
  }, [
    validationThreshold,
    validationTimeout,
    queueCooldown,
    maxRequestsPerHour,
    activityWindowStart,
    activityWindowEnd,
    botEnabled,
    defaultNewUserPanelId,
    autoPaymentEnabled,
    autoPaymentRequiresConfirm,
    autoPaymentMaxAmount,
    setStoreSettings,
  ]);

  // ---- Render helpers ----

  const renderSectionHeader = (title: string, icon: React.ComponentProps<typeof Ionicons>['name']) => (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );

  const renderSettingRow = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options?: {
      placeholder?: string;
      keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
      maxLength?: number;
      hint?: string;
    },
  ) => (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelRow}>
        <Text style={styles.settingLabel}>{label}</Text>
        {options?.hint && <Text style={styles.settingHint}>{options.hint}</Text>}
      </View>
      <TextInput
        style={styles.settingInput}
        value={value}
        onChangeText={onChange}
        placeholder={options?.placeholder || ''}
        placeholderTextColor={colors.placeholder}
        keyboardType={options?.keyboardType || 'default'}
        maxLength={options?.maxLength}
      />
    </View>
  );

  const renderReadOnlyRow = (label: string, value: string) => (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.readOnlyField}>
        <Text style={styles.readOnlyText} numberOfLines={1}>{value || '-'}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
          <Text style={styles.headerTitle}>Configuracion</Text>
        </View>
        <Text style={styles.headerSubtitle}>Ajustes del sistema y la conexion</Text>
      </View>

      {/* ==================== CONNECTION ==================== */}
      <View style={styles.section}>
        {renderSectionHeader('Conexion', 'globe-outline')}

        {renderReadOnlyRow('Backend URL', config?.backendUrl || '')}
        {renderReadOnlyRow('Operador', config?.operatorName || '')}

        {/* Connection status */}
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Estado</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? colors.onlineGreen : colors.error },
              ]}
            />
            <Text style={[styles.statusText, { color: isConnected ? colors.onlineGreen : colors.error }]}>
              {isConnected ? 'Conectado' : 'Desconectado'}
            </Text>
          </View>
        </View>

        {/* Reconnect button */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleReconnect}
          disabled={reconnecting}
          activeOpacity={0.7}
        >
          {reconnecting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="refresh-outline" size={18} color={colors.primary} />
          )}
          <Text style={styles.actionButtonText}>
            {reconnecting ? 'Reconectando...' : 'Reconectar'}
          </Text>
        </TouchableOpacity>

        {/* Logout button */}
        <TouchableOpacity
          style={[styles.actionButton, styles.logoutButton]}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={[styles.actionButtonText, { color: colors.error }]}>Cerrar Sesion</Text>
        </TouchableOpacity>
      </View>

      {/* ==================== NOTIFICATIONS ==================== */}
      <View style={styles.section}>
        {renderSectionHeader('Notificaciones', 'notifications-outline')}
        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Sonido</Text>
            <Text style={styles.settingHint}>Alertas sonoras para fallos, mensajes y billeteras</Text>
          </View>
          <Switch
            value={soundOn}
            onValueChange={handleToggleSound}
            trackColor={{ false: colors.border, true: colors.primary + '80' }}
            thumbColor={soundOn ? colors.primary : '#666'}
          />
        </View>
        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Vibracion</Text>
            <Text style={styles.settingHint}>Vibracion al recibir notificaciones</Text>
          </View>
          <Switch
            value={vibrationOn}
            onValueChange={handleToggleVibration}
            trackColor={{ false: colors.border, true: colors.primary + '80' }}
            thumbColor={vibrationOn ? colors.primary : '#666'}
          />
        </View>
      </View>

      {/* ==================== KILL SWITCH ==================== */}
      <View style={styles.section}>
        {renderSectionHeader('Kill Switch', 'hand-left-outline')}
        <KillSwitchButton active={killSwitchActive} onToggle={handleToggleKillSwitch} />
      </View>

      {/* ==================== QUICK REPLIES ==================== */}
      <View style={styles.section}>
        {renderSectionHeader('Respuestas Rapidas', 'chatbubbles-outline')}

        {editingQR ? (
          <View style={styles.qrEditForm}>
            <View style={styles.qrEditRow}>
              <View style={styles.qrIconField}>
                <Text style={styles.settingLabel}>Icono</Text>
                <TextInput
                  style={[styles.settingInput, styles.qrIconInput]}
                  value={qrIcon}
                  onChangeText={(v) => setQrIcon(v.slice(0, 2))}
                  placeholder="💬"
                  placeholderTextColor={colors.placeholder}
                  maxLength={2}
                />
              </View>
              <View style={styles.qrLabelField}>
                <Text style={styles.settingLabel}>Etiqueta</Text>
                <TextInput
                  style={styles.settingInput}
                  value={qrLabel}
                  onChangeText={setQrLabel}
                  placeholder="Nombre corto"
                  placeholderTextColor={colors.placeholder}
                  maxLength={30}
                />
              </View>
            </View>
            <Text style={styles.settingLabel}>Texto del mensaje</Text>
            <TextInput
              style={[styles.settingInput, styles.qrTextInput]}
              value={qrText}
              onChangeText={setQrText}
              placeholder="Mensaje que se enviara..."
              placeholderTextColor={colors.placeholder}
              multiline
              maxLength={500}
            />
            <View style={styles.qrEditActions}>
              <TouchableOpacity
                style={styles.qrCancelBtn}
                onPress={() => setEditingQR(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.qrCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.qrSaveBtn}
                onPress={handleSaveQuickReply}
                activeOpacity={0.7}
              >
                <Ionicons name="checkmark" size={18} color={colors.textOnPrimary} />
                <Text style={styles.qrSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {effectiveQuickReplies.map((qr) => (
              <View key={qr.id} style={styles.qrItem}>
                <Text style={styles.qrItemIcon}>{qr.icon}</Text>
                <View style={styles.qrItemContent}>
                  <Text style={styles.qrItemLabel}>{qr.label}</Text>
                  <Text style={styles.qrItemText} numberOfLines={2}>{qr.text}</Text>
                </View>
                <View style={styles.qrItemActions}>
                  <TouchableOpacity onPress={() => handleEditQuickReply(qr)} activeOpacity={0.6}>
                    <Ionicons name="pencil-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeleteQuickReply(qr.id)} activeOpacity={0.6}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={styles.qrBottomActions}>
              <TouchableOpacity style={styles.qrAddBtn} onPress={handleAddQuickReply} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.qrAddText}>Agregar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.qrResetBtn} onPress={handleResetQuickReplies} activeOpacity={0.7}>
                <Ionicons name="refresh-outline" size={16} color={colors.textMuted} />
                <Text style={styles.qrResetText}>Restaurar</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* ==================== SUPPORT CONTACT ==================== */}
      <View style={styles.section}>
        {renderSectionHeader('Contacto de Soporte', 'call-outline')}

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Telefono</Text>
          <TextInput
            style={styles.settingInput}
            value={supportPhone}
            onChangeText={setSupportPhone}
            placeholder="+54 11 1234-5678"
            placeholderTextColor={colors.placeholder}
            keyboardType="phone-pad"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, savingSupport && styles.saveButtonDisabled]}
          onPress={handleSaveSupport}
          disabled={savingSupport}
          activeOpacity={0.8}
        >
          {savingSupport ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="checkmark-outline" size={18} color={colors.textOnPrimary} />
              <Text style={styles.saveButtonText}>Guardar Telefono</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ==================== SYSTEM SETTINGS ==================== */}
      <View style={styles.section}>
        {renderSectionHeader('Configuracion del Sistema', 'construct-outline')}

        {renderSettingRow(
          'Umbral de validacion',
          validationThreshold,
          setValidationThreshold,
          { placeholder: '0.8', keyboardType: 'decimal-pad', hint: '0 a 1' },
        )}

        {renderSettingRow(
          'Timeout validacion (seg)',
          validationTimeout,
          setValidationTimeout,
          { placeholder: '30', keyboardType: 'number-pad', hint: 'segundos' },
        )}

        {renderSettingRow(
          'Cooldown de cola (seg)',
          queueCooldown,
          setQueueCooldown,
          { placeholder: '30', keyboardType: 'number-pad', hint: 'entre jobs' },
        )}

        {renderSettingRow(
          'Max requests/hora/usuario',
          maxRequestsPerHour,
          setMaxRequestsPerHour,
          { placeholder: '10', keyboardType: 'number-pad' },
        )}

        {renderSettingRow(
          'Alerta fichas bajas (umbral)',
          panelBalanceThreshold,
          setPanelBalanceThreshold,
          { placeholder: '1000', keyboardType: 'number-pad', hint: '0 = desactivado' },
        )}

        {/* Panel for new user creation */}
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Panel para nuevos usuarios</Text>
          <View style={[styles.settingInput, { paddingVertical: 0, justifyContent: 'center' }]}>
            {panels.length > 0 ? (
              <View>
                <TouchableOpacity
                  style={{ paddingVertical: 12 }}
                  onPress={() => {
                    const options = [
                      { label: 'No crear automaticamente', value: '' },
                      ...panels.filter(p => p.isActive).map(p => ({ label: p.name, value: p.id })),
                    ];
                    const currentIndex = options.findIndex(o => o.value === defaultNewUserPanelId);
                    Alert.alert(
                      'Panel para nuevos usuarios',
                      'Cuando un usuario no existe en ningun panel, se crea automaticamente en el panel seleccionado.',
                      options.map(o => ({
                        text: (o.value === defaultNewUserPanelId ? '✓ ' : '') + o.label,
                        onPress: () => setDefaultNewUserPanelId(o.value),
                      })),
                    );
                  }}
                >
                  <Text style={{ color: colors.textPrimary, fontSize: 14 }}>
                    {defaultNewUserPanelId
                      ? panels.find(p => p.id === defaultNewUserPanelId)?.name || defaultNewUserPanelId
                      : 'No crear automaticamente'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={{ color: colors.textMuted, fontSize: 14, paddingVertical: 12 }}>Sin paneles disponibles</Text>
            )}
          </View>
          <Text style={styles.settingHint}>Selecciona donde se crean las cuentas nuevas</Text>
        </View>

        {/* Activity window */}
        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.settingLabel}>Horario inicio</Text>
            <TextInput
              style={styles.settingInput}
              value={activityWindowStart}
              onChangeText={setActivityWindowStart}
              placeholder="08:00"
              placeholderTextColor={colors.placeholder}
              maxLength={5}
            />
          </View>
          <View style={styles.timeSeparator}>
            <Text style={styles.timeSeparatorText}>a</Text>
          </View>
          <View style={styles.timeField}>
            <Text style={styles.settingLabel}>Horario fin</Text>
            <TextInput
              style={styles.settingInput}
              value={activityWindowEnd}
              onChangeText={setActivityWindowEnd}
              placeholder="23:00"
              placeholderTextColor={colors.placeholder}
              maxLength={5}
            />
          </View>
        </View>

        {/* Bot enabled toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleLabelContainer}>
            <Text style={styles.settingLabel}>Bot habilitado</Text>
            <Text style={styles.settingHint}>
              {botEnabled ? 'El bot esta procesando jobs' : 'El bot esta pausado'}
            </Text>
          </View>
          <Switch
            value={botEnabled}
            onValueChange={setBotEnabled}
            trackColor={{ false: colors.backgroundTertiary, true: colors.primaryDark }}
            thumbColor={botEnabled ? colors.primary : colors.textMuted}
          />
        </View>

        {/* Save all button */}
        <TouchableOpacity
          style={[styles.saveButton, savingSettings && styles.saveButtonDisabled]}
          onPress={handleSaveSystemSettings}
          disabled={savingSettings}
          activeOpacity={0.8}
        >
          {savingSettings ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color={colors.textOnPrimary} />
              <Text style={styles.saveButtonText}>Guardar Configuracion</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ==================== INFO ==================== */}
      <View style={styles.section}>
        {renderSectionHeader('Informacion', 'information-circle-outline')}

        {renderReadOnlyRow('Version de la app', '1.0.0')}
        {renderReadOnlyRow(
          'Ultima actualizacion',
          lastUpdate
            ? new Date(lastUpdate).toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '-',
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
  },
  header: {
    paddingHorizontal: 4,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  section: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  settingRow: {
    marginBottom: 14,
  },
  settingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  settingHint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  settingInput: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.textPrimary,
  },
  readOnlyField: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readOnlyText: {
    fontSize: 14,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  logoutButton: {
    borderColor: colors.error + '40',
    backgroundColor: colors.error + '10',
    marginBottom: 0,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 0,
    marginBottom: 14,
  },
  timeField: {
    flex: 1,
  },
  timeSeparator: {
    paddingHorizontal: 10,
    paddingBottom: 14,
  },
  timeSeparatorText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingVertical: 4,
  },
  toggleLabelContainer: {
    flex: 1,
    marginRight: 12,
  },

  // Quick replies
  qrItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  qrItemIcon: {
    fontSize: 20,
    width: 30,
    textAlign: 'center',
  },
  qrItemContent: {
    flex: 1,
  },
  qrItemLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  qrItemText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  qrItemActions: {
    flexDirection: 'row',
    gap: 14,
  },
  qrBottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  qrAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qrAddText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  qrResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  qrResetText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  qrEditForm: {
    gap: 8,
  },
  qrEditRow: {
    flexDirection: 'row',
    gap: 10,
  },
  qrIconField: {
    width: 70,
  },
  qrIconInput: {
    textAlign: 'center',
    fontSize: 20,
  },
  qrLabelField: {
    flex: 1,
  },
  qrTextInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  qrEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  qrCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrCancelText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '600',
  },
  qrSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  qrSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
});
