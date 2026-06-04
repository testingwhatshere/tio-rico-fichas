import { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import colors from '@/constants/colors';
import { hapticLight } from '@/utils/haptics';

interface CopyButtonProps {
  text: string;
  label: string; // "Alias", "Referencia", etc.
  compact?: boolean;
}

export default function CopyButton({ text, label, compact = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      hapticLight();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      Alert.alert('Error', 'No se pudo copiar al portapapeles');
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, compact && styles.buttonCompact, copied && styles.buttonCopied]}
      onPress={handleCopy}
      activeOpacity={0.7}
      accessibilityLabel={`Copiar ${label}`}
    >
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={compact ? 14 : 16}
        color={copied ? colors.success : colors.textOnPrimary}
        style={styles.icon}
      />
      <Text style={[styles.text, compact && styles.textCompact, copied && styles.textCopied]}>
        {copied ? 'Copiado!' : 'Copiar'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 4,
  },
  buttonCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  buttonCopied: {
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.success,
  },
  icon: {
    // Icon spacing handled by gap
  },
  text: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  textCompact: {
    fontSize: 12,
  },
  textCopied: {
    color: colors.success,
  },
});
