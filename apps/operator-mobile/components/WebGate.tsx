import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, space, radius, text, shadow } from '@/constants/theme';
import {
  primeAudio,
  prizeAlertsEnabled,
  requestNotificationPermission,
} from '@/services/webNotifications';

/**
 * Puerta de entrada del panel web.
 *
 * El panel vive en una URL pública: cualquiera que la tenga ve premios, chats y
 * datos de clientes. Esto pide usuario y contraseña antes de mostrar nada.
 *
 * Es una barrera, no seguridad: la clave viaja en el bundle, así que quien
 * sepa mirar el JavaScript la encuentra. Sirve contra el que llega al link por
 * casualidad —que es el caso real— y no contra alguien que quiera entrar de
 * verdad. Para eso haría falta autenticación contra el backend.
 *
 * Sólo aplica a web: el APK del operador se instala a mano y ya pasa por el
 * wizard.
 */
const USER = 'admin';
const PASS = 'leon123';

/** Por pestaña: recargar no vuelve a pedirla, abrir el link de nuevo sí. */
const SESSION_KEY = 'operator_web_gate';

function unlockedInSession(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    // Modo incógnito con storage bloqueado: mejor pedir la clave que romper.
    return false;
  }
}

export default function WebGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => Platform.OS !== 'web');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS === 'web' && unlockedInSession()) setUnlocked(true);
  }, []);

  if (unlocked) return <>{children}</>;

  const submit = () => {
    if (user.trim().toLowerCase() !== USER || pass !== PASS) {
      setError('Usuario o contraseña incorrectos');
      setPass('');
      return;
    }
    try {
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // Sin storage se entra igual; la próxima vez vuelve a pedirla.
    }
    // Este click es el único gesto garantizado de la sesión: el navegador exige
    // uno para habilitar el audio, así que es acá o los avisos salen mudos.
    primeAudio();
    if (prizeAlertsEnabled()) void requestNotificationPermission();
    setUnlocked(true);
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.card}>
        <View style={s.brand}>
          <Ionicons name="lock-closed-outline" size={22} color={colors.primary} />
          <View>
            <Text style={s.title}>Tío Rico · Operadores</Text>
            <Text style={s.subtitle}>Ingresá para entrar al panel</Text>
          </View>
        </View>

        <TextInput
          value={user}
          onChangeText={(v) => {
            setUser(v);
            setError('');
          }}
          placeholder="Usuario"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
          onSubmitEditing={submit}
        />
        <TextInput
          value={pass}
          onChangeText={(v) => {
            setPass(v);
            setError('');
          }}
          placeholder="Contraseña"
          placeholderTextColor={colors.placeholder}
          secureTextEntry
          autoCapitalize="none"
          style={s.input}
          onSubmitEditing={submit}
        />

        {!!error && <Text style={s.error}>{error}</Text>}

        <Pressable onPress={submit} style={s.button}>
          <Text style={s.buttonText}>Entrar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.md,
    ...shadow.md,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  title: { ...text.title, color: colors.textPrimary },
  subtitle: { ...text.caption, color: colors.textMuted, marginTop: 2 },
  input: {
    ...text.body,
    color: colors.textPrimary,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    outlineStyle: 'none',
  } as any,
  error: { ...text.caption, color: colors.error },
  button: {
    backgroundColor: colors.primaryDark,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  buttonText: { ...text.bodyStrong, color: colors.textOnPrimary },
});
