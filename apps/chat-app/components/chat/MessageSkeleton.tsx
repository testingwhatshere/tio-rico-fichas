import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import colors from '@/constants/colors';

export default function MessageSkeleton() {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.6],
  });

  return (
    <View style={styles.container}>
      {/* System message skeleton (left-aligned) */}
      <View style={styles.leftGroup}>
        <Animated.View style={[styles.bar, styles.barShort, { opacity }]} />
        <Animated.View style={[styles.bar, styles.barLong, { opacity }]} />
      </View>

      {/* User message skeleton (right-aligned) */}
      <View style={styles.rightGroup}>
        <Animated.View style={[styles.bar, styles.barMedium, { opacity }]} />
      </View>

      {/* System message skeleton */}
      <View style={styles.leftGroup}>
        <Animated.View style={[styles.bar, styles.barLong, { opacity }]} />
        <Animated.View style={[styles.bar, styles.barShort, { opacity }]} />
      </View>

      {/* User message skeleton */}
      <View style={styles.rightGroup}>
        <Animated.View style={[styles.bar, styles.barShort, { opacity }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
  },
  leftGroup: {
    alignItems: 'flex-start',
    gap: 6,
  },
  rightGroup: {
    alignItems: 'flex-end',
    gap: 6,
  },
  bar: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    height: 36,
  },
  barShort: {
    width: '40%',
  },
  barMedium: {
    width: '55%',
  },
  barLong: {
    width: '70%',
  },
});
