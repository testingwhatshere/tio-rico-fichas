/**
 * CopyButton - Web (navigator.clipboard)
 *
 * Uses the Web Clipboard API instead of expo-clipboard.
 * Metro resolves this file on web instead of CopyButton.tsx.
 */

import { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

interface CopyButtonProps {
  text: string;
  label: string;
  compact?: boolean;
}

export default function CopyButton({ text, label, compact = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select text in a temporary textarea
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, compact && styles.buttonCompact, copied && styles.buttonCopied]}
      onPress={handleCopy}
      activeOpacity={0.7}
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
