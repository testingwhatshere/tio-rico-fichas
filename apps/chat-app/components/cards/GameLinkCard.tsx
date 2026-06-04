import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { hapticMedium } from '@/utils/haptics';

const GAME_URL = 'https://tioricojuegos.co';

interface GameLinkCardProps {
  isDisabled?: boolean;
}

export default function GameLinkCard({ isDisabled = false }: GameLinkCardProps) {
  const handlePress = () => {
    hapticMedium();
    Linking.openURL(GAME_URL);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.successGlow }]}>
      <Text style={styles.emoji}>🎰</Text>
      <Text style={styles.title}>Fichas cargadas con exito!</Text>
      <Text style={styles.subtitle}>Ya podes entrar a jugar</Text>

      <TouchableOpacity
        style={[styles.buttonOuter, isDisabled && styles.buttonDisabled]}
        onPress={handlePress}
        disabled={isDisabled}
        activeOpacity={0.7}
      >
        <View style={[styles.button, { backgroundColor: colors.accent }]}>
          <Ionicons name="game-controller" size={22} color={colors.textOnPrimary} />
          <Text style={styles.buttonText}>IR A JUGAR</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.success,
    gap: 8,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 40,
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    color: colors.success,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  buttonOuter: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.goldGlowStrong,
    width: '100%',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 11,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textOnPrimary,
    letterSpacing: 1,
  },
});
