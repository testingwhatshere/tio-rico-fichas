import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getErrorMessage } from '@/services/api';
import colors from '@/constants/colors';
import FloatingParticles from '@/components/effects/FloatingParticles';
import { hapticMedium } from '@/utils/haptics';

export default function LoginScreen() {
  const { login, isLoading } = useAuthStore();

  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState<'username' | 'phone' | null>(null);

  const phoneInputRef = useRef<TextInput>(null);
  // Icon glow animation removed — clean design

  // Validate form — username + phone are BOTH required, every login.
  const validateForm = (): boolean => {
    if (!username.trim()) {
      setError('El nombre de usuario es requerido');
      return false;
    }

    if (username.trim().length < 3) {
      setError('El nombre de usuario debe tener al menos 3 caracteres');
      return false;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      setError('Solo letras, numeros y guiones bajos');
      return false;
    }

    if (!phone.trim()) {
      setError('El numero de telefono es requerido');
      return false;
    }

    if (!/^\d{7,15}$/.test(phone.trim())) {
      setError('Numero de telefono invalido (solo numeros, 7-15 digitos)');
      return false;
    }

    // Block Mar del Plata + zona costera area codes
    const blockedCodes = ['223'];
    const cleanPhone = phone.replace(/\s/g, '').replace(/^\+/, '');
    const isBlocked = blockedCodes.some(code =>
      cleanPhone.startsWith(code) ||
      cleanPhone.startsWith('54' + code) ||
      cleanPhone.startsWith('549' + code),
    );
    if (isBlocked) {
      setError('El sistema no está disponible en tu región');
      return false;
    }

    setError(null);
    return true;
  };

  // Handle login
  const handleLogin = async () => {
    hapticMedium();
    setError(null);

    if (!validateForm()) {
      return;
    }

    try {
      await login(username.trim(), phone.trim());
      // Navigation is handled by root _layout.tsx
    } catch (err: any) {
      const errorMessage = getErrorMessage(err);
      Alert.alert('Error', errorMessage);
    }
  };

  const isWeb = Platform.OS === 'web';

  const formContent = (
    <>
      {/* Icon + Title */}
      <View style={styles.header}>
        <Image
          source={require('@/assets/icon.png')}
          style={{ width: 100, height: 100, borderRadius: 20, marginBottom: 8 }}
          resizeMode="contain"
        />
        <Text style={styles.title}>TIO RICO</Text>
        <Text style={styles.titleSecondary}>FICHAS</Text>
        <View style={styles.titleDivider} />
        <Text style={styles.subtitle}>
          Ingresa tu usuario y telefono para continuar
        </Text>
      </View>

      {/* Form */}
      <View style={styles.form}>
        {/* Username Input */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Nombre de usuario</Text>
          <View
            style={[
              styles.inputWrapper,
              isFocused === 'username' && styles.inputWrapperFocused,
              error && isFocused !== 'phone' ? styles.inputWrapperError : null,
            ]}
          >
            <Ionicons
              name="person-outline"
              size={20}
              color={isFocused === 'username' ? colors.primary : colors.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="ej: juan_perez"
              placeholderTextColor={colors.placeholder}
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                if (error) setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              editable={!isLoading}
              returnKeyType="next"
              onSubmitEditing={() => phoneInputRef.current?.focus()}
              onFocus={() => setIsFocused('username')}
              onBlur={() => setIsFocused(null)}
            />
          </View>
        </View>

        {/* Phone Input — always required (login + register) */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Numero de telefono</Text>
          <View
            style={[
              styles.inputWrapper,
              isFocused === 'phone' && styles.inputWrapperFocused,
              error && isFocused === 'phone' ? styles.inputWrapperError : null,
            ]}
          >
            <Ionicons
              name="call-outline"
              size={20}
              color={isFocused === 'phone' ? colors.primary : colors.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              ref={phoneInputRef}
              style={styles.input}
              placeholder="ej: 1155667788"
              placeholderTextColor={colors.placeholder}
              value={phone}
              onChangeText={(text) => {
                setPhone(text.replace(/\s/g, ''));
                if (error) setError(null);
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
              editable={!isLoading}
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              onFocus={() => setIsFocused('phone')}
              onBlur={() => setIsFocused(null)}
            />
          </View>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Login Button */}
        <TouchableOpacity
          style={[styles.buttonOuter, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          <View style={styles.button}>
            {isLoading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.buttonText}>CONTINUAR</Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.infoText}>
            Tu numero verifica tu identidad. Debe coincidir con el registrado.
          </Text>
        </View>
      </View>
    </>
  );

  if (isWeb) {
    return (
      <View style={styles.container}>
        <View style={styles.scrollContent}>
          {formContent}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FloatingParticles count={20} speed="slow" area={{ width: 500, height: 800 }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {formContent}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  iconOuter: {
    marginBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primaryGlow2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 40,
    fontWeight: '900',
    color: colors.accent,
    letterSpacing: 3,
    textShadowColor: colors.goldShadow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  titleSecondary: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentLight,
    letterSpacing: 8,
    marginTop: 2,
  },
  titleDivider: {
    width: 50,
    height: 2,
    backgroundColor: colors.chipBorder,
    marginVertical: 16,
    borderRadius: 1,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 10,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    backgroundColor: colors.input,
    paddingHorizontal: 16,
  },
  inputWrapperFocused: {
    borderColor: colors.primary,
  },
  inputWrapperError: {
    borderColor: colors.inputError,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 18,
    color: colors.textPrimary,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    marginBottom: 16,
  },
  buttonOuter: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  button: {
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.buttonPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textOnPrimary,
    letterSpacing: 1.5,
  },
  infoContainer: {
    marginTop: 28,
    paddingHorizontal: 12,
  },
  infoText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
