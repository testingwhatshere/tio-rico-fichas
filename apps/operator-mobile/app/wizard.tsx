import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import colors from '@/constants/colors';
import { useAuthStore } from '@/stores/auth.store';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';

const DEFAULT_BACKEND =
  process.env.EXPO_PUBLIC_DEFAULT_API_URL || 'https://tiorico-api.onrender.com';
const DEFAULT_API_KEY = process.env.EXPO_PUBLIC_OPERATOR_API_KEY || 'Narciso';

type Status = 'idle' | 'testing' | 'success' | 'error';

export default function WizardScreen() {
  const router = useRouter();
  const [operatorName, setOperatorName] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Probamos la conexión apenas se monta — el operador no debería tener que dar click
  // para algo que en el 99% de los casos funciona sin tocar nada.
  const runTest = useCallback(async () => {
    setStatus('testing');
    setErrorMsg(null);
    try {
      const res = await axios.get(`${DEFAULT_BACKEND}/api/health`, {
        headers: { 'X-Operator-API-Key': DEFAULT_API_KEY },
        timeout: 10000,
      });
      if (res.status === 200) {
        setStatus('success');
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      setStatus('error');
      const msg =
        err.response?.status === 401 || err.response?.status === 403
          ? 'API key invalida'
          : err.code === 'ECONNABORTED'
            ? 'Timeout al conectar (servidor frio?)'
            : err.message || 'No se pudo conectar';
      setErrorMsg(msg);
    }
  }, []);

  useEffect(() => {
    runTest();
  }, [runTest]);

  const handleSubmit = useCallback(async () => {
    const name = operatorName.trim();
    if (!name) {
      toast.error('Ingresa tu nombre de operador');
      return;
    }
    if (status !== 'success') {
      toast.error('Esperá a que la conexión sea OK');
      return;
    }
    setSaving(true);
    try {
      await useAuthStore.getState().login(name);
      hapticSuccess();
      toast.success(`Bienvenido, ${name}`);
      router.replace('/(tabs)/dashboard');
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'No se pudo guardar');
      setSaving(false);
    }
  }, [operatorName, status, router]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Image source={require('@/assets/icon.png')} style={styles.logo} />
            <Text style={styles.brandTitle}>Tio Rico Operador</Text>
            <Text style={styles.brandSubtitle}>Configuración inicial</Text>
          </View>

          {/* Status de conexión */}
          <View
            style={[
              styles.connBox,
              status === 'success' && styles.connBoxSuccess,
              status === 'error' && styles.connBoxError,
            ]}
          >
            {status === 'testing' && <ActivityIndicator color={colors.primary} />}
            {status === 'success' && (
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            )}
            {status === 'error' && (
              <Ionicons name="close-circle" size={22} color={colors.error} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.connTitle}>
                {status === 'testing' && 'Probando conexión...'}
                {status === 'success' && 'Conectado al servidor'}
                {status === 'error' && 'Sin conexión'}
                {status === 'idle' && 'Esperando...'}
              </Text>
              <Text style={styles.connSubtitle} numberOfLines={2}>
                {status === 'success'
                  ? DEFAULT_BACKEND.replace(/^https?:\/\//, '')
                  : status === 'error'
                    ? errorMsg || 'Error desconocido'
                    : DEFAULT_BACKEND.replace(/^https?:\/\//, '')}
              </Text>
            </View>
            {status === 'error' && (
              <TouchableOpacity onPress={runTest} style={styles.retryBtn}>
                <Ionicons name="refresh" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Nombre */}
          <View style={styles.step}>
            <Text style={styles.stepTitle}>Tu nombre</Text>
            <Text style={styles.stepHint}>
              Se va a usar para identificarte en el chat y en el log de actividad.
            </Text>
            <TextInput
              style={styles.input}
              value={operatorName}
              onChangeText={setOperatorName}
              placeholder="Ej: Juan"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.submitButton,
              (status !== 'success' || !operatorName.trim() || saving) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={status !== 'success' || !operatorName.trim() || saving}
            activeOpacity={0.7}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Text style={styles.submitButtonText}>Continuar</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.white} />
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.footer}>
            Para configurar otro servidor o API key, ingresá luego desde Configuración.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 60,
    flexGrow: 1,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 16,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    marginBottom: 14,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.primary,
  },
  brandSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  connBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  connBoxSuccess: {
    borderColor: colors.success,
    backgroundColor: 'rgba(72, 187, 120, 0.08)',
  },
  connBoxError: {
    borderColor: colors.error,
    backgroundColor: 'rgba(245, 101, 101, 0.08)',
  },
  connTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  connSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  retryBtn: {
    padding: 6,
  },
  step: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stepHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 17,
  },
  input: {
    backgroundColor: colors.input,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 20,
  },
});
