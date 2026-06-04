import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import colors from '@/constants/colors';

interface SkeletonCardProps {
  style?: any;
}

export default function SkeletonCard({ style }: SkeletonCardProps) {
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
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim]);

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={[styles.skeletonCard, style]}>
      {/* Avatar placeholder */}
      <Animated.View style={[styles.skeleton, styles.skeletonAvatar, { opacity }]} />

      {/* Text lines */}
      <View style={styles.skeletonCenter}>
        <Animated.View style={[styles.skeleton, styles.skeletonTitle, { opacity }]} />
        <Animated.View style={[styles.skeleton, styles.skeletonAmount, { opacity }]} />
        <Animated.View style={[styles.skeleton, styles.skeletonMessage, { opacity }]} />
      </View>

      {/* Right badge */}
      <View style={styles.skeletonRight}>
        <Animated.View style={[styles.skeleton, styles.skeletonTime, { opacity }]} />
        <Animated.View style={[styles.skeleton, styles.skeletonBadge, { opacity }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeleton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  skeletonCenter: {
    flex: 1,
    gap: 6,
  },
  skeletonTitle: {
    width: 100,
    height: 14,
    borderRadius: 4,
  },
  skeletonAmount: {
    width: 60,
    height: 12,
    borderRadius: 4,
  },
  skeletonMessage: {
    width: 140,
    height: 12,
    borderRadius: 4,
  },
  skeletonRight: {
    alignItems: 'flex-end',
    gap: 6,
    marginLeft: 12,
  },
  skeletonTime: {
    width: 30,
    height: 10,
    borderRadius: 4,
  },
  skeletonBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
});
