import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { colors } from '@/constants/colors';
import { type UpdateInfo, downloadApk, installApk } from '@/services/appUpdate';

interface Props {
  updateInfo: UpdateInfo;
}

type UpdateState = 'idle' | 'downloading' | 'installing' | 'error';

export default function UpdateBlocker({ updateInfo }: Props) {
  const [state, setState] = useState<UpdateState>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const handleUpdate = useCallback(async () => {
    setState('downloading');
    setProgress(0);
    setErrorMsg('');

    try {
      const fileUri = await downloadApk(updateInfo.apkUrl, (percent) => {
        setProgress(percent);
      });

      setState('installing');
      await installApk(fileUri);

      // If user cancels the installer, go back to idle
      setState('idle');
    } catch (e: any) {
      setState('error');
      setErrorMsg(e?.message || 'No se pudo descargar la actualización');
    }
  }, [updateInfo.apkUrl]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Tio Rico Icon */}
        <Image
          source={require('@/assets/icon.png')}
          style={styles.icon}
          resizeMode="contain"
        />

        <Text style={styles.title}>Actualización necesaria</Text>

        <Text style={styles.subtitle}>
          Para mejorar tu experiencia, necesitás actualizar la app a la versión{' '}
          <Text style={styles.versionText}>{updateInfo.latestVersion}</Text>
        </Text>

        {updateInfo.changelog ? (
          <View style={styles.changelogBox}>
            <Text style={styles.changelogLabel}>Novedades:</Text>
            <Text style={styles.changelogText}>{updateInfo.changelog}</Text>
          </View>
        ) : null}

        {/* Progress bar */}
        {state === 'downloading' && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>Descargando... {progress}%</Text>
          </View>
        )}

        {/* Installing state */}
        {state === 'installing' && (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.progressText}>Instalando...</Text>
          </View>
        )}

        {/* Error state */}
        {state === 'error' && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* Action button */}
        {(state === 'idle' || state === 'error') && (
          <TouchableOpacity
            style={styles.button}
            onPress={handleUpdate}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {state === 'error' ? 'Reintentar' : 'Actualizar ahora'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  content: {
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
  },
  icon: {
    width: 140,
    height: 140,
    borderRadius: 28,
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  versionText: {
    color: colors.accent,
    fontWeight: '600',
  },
  changelogBox: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 32,
  },
  changelogLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  changelogText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 24,
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
