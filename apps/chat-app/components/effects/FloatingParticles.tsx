import { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

interface Particle {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
  startX: number;
  startY: number;
  size: number;
  color: string;
  shape: 'diamond' | 'circle' | 'star';
}

interface FloatingParticlesProps {
  count?: number;
  colors?: string[];
  speed?: 'slow' | 'normal' | 'fast';
  area?: { width: number; height: number };
}

const PARTICLE_COLORS = [
  'rgba(212, 160, 32, 0.5)',   // rich gold
  'rgba(212, 160, 32, 0.35)',  // soft gold
  'rgba(240, 200, 80, 0.4)',   // light gold
  'rgba(45, 139, 78, 0.4)',    // casino green
  'rgba(184, 134, 11, 0.45)',  // dark gold
  'rgba(255, 255, 255, 0.2)',  // white sparkle
];

const SHAPES: Array<'diamond' | 'circle' | 'star'> = ['diamond', 'circle', 'star'];

export default function FloatingParticles({
  count = 12,
  colors: customColors,
  speed = 'normal',
  area = { width: 400, height: 500 },
}: FloatingParticlesProps) {
  const particleColors = customColors || PARTICLE_COLORS;
  const speedMultiplier = speed === 'slow' ? 1.5 : speed === 'fast' ? 0.6 : 1;

  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i): Particle => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0),
      startX: Math.random() * area.width,
      startY: Math.random() * area.height,
      size: 4 + Math.random() * 6,
      color: particleColors[i % particleColors.length],
      shape: SHAPES[i % SHAPES.length],
    }));
  }, []);

  useEffect(() => {
    const animations = particles.map((particle, i) => {
      const duration = (4000 + Math.random() * 6000) * speedMultiplier;
      const delay = i * (300 + Math.random() * 500);

      const driftX = -20 + Math.random() * 40;
      const driftY = -40 - Math.random() * 60; // float upward

      const animate = () => {
        particle.x.setValue(0);
        particle.y.setValue(0);
        particle.opacity.setValue(0);
        particle.scale.setValue(0.3);

        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            // Drift movement
            Animated.timing(particle.x, {
              toValue: driftX,
              duration,
              useNativeDriver: true,
            }),
            Animated.timing(particle.y, {
              toValue: driftY,
              duration,
              useNativeDriver: true,
            }),
            // Fade in then out
            Animated.sequence([
              Animated.timing(particle.opacity, {
                toValue: 1,
                duration: duration * 0.2,
                useNativeDriver: true,
              }),
              Animated.timing(particle.opacity, {
                toValue: 1,
                duration: duration * 0.5,
                useNativeDriver: true,
              }),
              Animated.timing(particle.opacity, {
                toValue: 0,
                duration: duration * 0.3,
                useNativeDriver: true,
              }),
            ]),
            // Scale up then down
            Animated.sequence([
              Animated.timing(particle.scale, {
                toValue: 1,
                duration: duration * 0.3,
                useNativeDriver: true,
              }),
              Animated.timing(particle.scale, {
                toValue: 0.5,
                duration: duration * 0.7,
                useNativeDriver: true,
              }),
            ]),
          ]),
        ]).start(() => animate()); // loop
      };

      animate();
      return () => {};
    });

    return () => {
      particles.forEach((p) => {
        p.x.stopAnimation();
        p.y.stopAnimation();
        p.opacity.stopAnimation();
        p.scale.stopAnimation();
      });
    };
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((particle, i) => (
        <Animated.View
          key={i}
          style={[
            styles.particle,
            {
              left: particle.startX,
              top: particle.startY,
              width: particle.size,
              height: particle.size,
              backgroundColor: particle.color,
              borderRadius: particle.shape === 'circle' ? particle.size / 2
                : particle.shape === 'diamond' ? 1
                : particle.size / 2,
              transform: [
                { translateX: particle.x },
                { translateY: particle.y },
                { scale: particle.scale },
                { rotate: particle.shape === 'diamond' ? '45deg' : '0deg' },
              ],
              opacity: particle.opacity,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  particle: {
    position: 'absolute',
  },
});
