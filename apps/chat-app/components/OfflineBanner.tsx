import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import spacing from '@/constants/spacing';

export default function OfflineBanner() {
  return (
    <View style={styles.container}>
      <Ionicons name="cloud-offline" size={16} color={colors.textInverse} />
      <Text style={styles.text}>Sin conexión</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.error,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  text: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
});
