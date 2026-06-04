import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import colors from '@/constants/colors';

interface QuickReplyChipProps {
  icon: string;
  label: string;
  onPress: () => void;
}

export default function QuickReplyChip({ icon, label, onPress }: QuickReplyChipProps) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 5,
  },
  icon: {
    fontSize: 14,
  },
  label: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
    maxWidth: 100,
  },
});
