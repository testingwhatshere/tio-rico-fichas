import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import colors from '@/constants/colors';

const PARTICLE_COUNT = 18;
const DURATION = 1500;

const GOLD_COLORS = [
  colors.accent,
  colors.accentLight,
  colors.accentDark,
  '#FFD700',
  '#FFC107',
  colors.success,
];

interface Particle {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
  color: string;
  size: number;
}

export default function CelebrationEffect() {
  const particles = useRef<Particle[]>(
    Array.from({ length: PARTICLE_COUNT }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(0),
      color: GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)],
      size: 4 + Math.random() * 6,
    })),
  ).current;

  useEffect(() => {
    const animations = particles.map((p) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 40 + Math.random() * 80;
      const targetX = Math.cos(angle) * distance;
      const targetY = Math.sin(angle) * distance - 20; // bias upward

      return Animated.parallel([
        Animated.timing(p.x, {
          toValue: targetX,
          duration: DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(p.y, {
          toValue: targetY,
          duration: DURATION,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(p.scale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(p.scale, {
            toValue: 0,
            duration: DURATION - 200,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(p.opacity, {
          toValue: 0,
          duration: DURATION,
          useNativeDriver: true,
        }),
      ]);
    });

    Animated.stagger(30, animations).start();
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.particle,
            {
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: p.color,
              transform: [
                { translateX: p.x },
                { translateY: p.y },
                { scale: p.scale },
              ],
              opacity: p.opacity,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  particle: {
    position: 'absolute',
  },
});
