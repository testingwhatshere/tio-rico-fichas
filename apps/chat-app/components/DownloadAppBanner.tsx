import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

// La web siempre queda actualizada sola, asi que es el canal que no se corta
// nunca: desde aca el usuario de Android baja la ultima version sin depender de
// que la app instalada pueda avisarle que existe.
const APK_URL =
  'https://github.com/testingwhatshere/tio-rico-fichas/releases/download/v1.0.1/tio-rico-fichas.apk';

// Solo en la web y solo en Android: en iOS no hay APK que ofrecer, y dentro de
// la app nativa el banner no tiene sentido.
export const shouldShowDownloadBanner =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  /android/i.test(navigator.userAgent || '');

export default function DownloadAppBanner({ style }: { style?: object }) {
  if (!shouldShowDownloadBanner) return null;

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(APK_URL)}
      style={[styles.banner, style]}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Descargar la aplicacion para Android"
    >
      <Ionicons name="download-outline" size={20} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Descargar la app</Text>
        <Text style={styles.text}>Mas rapida y con avisos al instante</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.accent} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(212, 160, 32, 0.12)',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  title: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  text: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
});
