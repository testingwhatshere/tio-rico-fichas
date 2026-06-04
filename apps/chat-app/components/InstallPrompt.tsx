import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform, Modal } from 'react-native';
import { colors } from '@/constants/colors';

const DISMISS_KEY = 'pwa_install_dismissed_at';
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return true;
  return (
    (window as any).navigator?.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function wasDismissedRecently(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) return false;
  const daysAgo = (Date.now() - parseInt(dismissed, 10)) / (1000 * 60 * 60 * 24);
  return daysAgo < DISMISS_DAYS;
}

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (isStandalone()) return;
    if (wasDismissedRecently()) return;

    // Show prompt
    setVisible(true);

    // Capture Android/Chrome install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        setVisible(false);
      }
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    }
  }, []);

  if (!visible) return null;

  const showIOSInstructions = isIOS();

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={handleDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Image
            source={require('@/assets/icon.png')}
            style={styles.icon}
          />
          <Text style={styles.title}>Instala Tio Rico</Text>
          <Text style={styles.subtitle}>
            Accede rapido desde tu pantalla de inicio
          </Text>

          {showIOSInstructions ? (
            <View style={styles.steps}>
              <Text style={styles.step}>
                1. Toca el icono de <Text style={styles.bold}>Compartir</Text> {'\u2B06\uFE0F'}
              </Text>
              <Text style={styles.step}>
                2. Selecciona <Text style={styles.bold}>Agregar a Inicio</Text>
              </Text>
            </View>
          ) : deferredPrompt ? (
            <TouchableOpacity style={styles.installBtn} onPress={handleInstall}>
              <Text style={styles.installBtnText}>Instalar</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.steps}>
              <Text style={styles.step}>
                Abre el menu del navegador y selecciona{' '}
                <Text style={styles.bold}>Instalar app</Text>
              </Text>
            </View>
          )}

          <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss}>
            <Text style={styles.dismissText}>Ahora no</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 80,
    height: 80,
    borderRadius: 18,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  steps: {
    width: '100%',
    marginBottom: 16,
    gap: 10,
  },
  step: {
    fontSize: 15,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
  },
  bold: {
    fontWeight: '700',
    color: colors.accent,
  },
  installBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  installBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  dismissBtn: {
    paddingVertical: 10,
  },
  dismissText: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
