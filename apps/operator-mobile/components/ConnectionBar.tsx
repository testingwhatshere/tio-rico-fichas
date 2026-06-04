import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import colors from '@/constants/colors';

export default function ConnectionBar() {
  const isConnected = useAuthStore((s) => s.isConnected);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const height = useRef(new Animated.Value(0)).current;
  const wasConnected = useRef(isConnected);

  useEffect(() => {
    if (!isAuthenticated) return;

    if (!isConnected) {
      // Show bar
      Animated.timing(height, { toValue: 28, duration: 300, useNativeDriver: false }).start();
    } else if (wasConnected.current === false) {
      // Was disconnected, now connected — briefly show green then hide
      Animated.sequence([
        Animated.timing(height, { toValue: 28, duration: 200, useNativeDriver: false }),
        Animated.delay(1500),
        Animated.timing(height, { toValue: 0, duration: 300, useNativeDriver: false }),
      ]).start();
    } else {
      // Already connected, hide
      Animated.timing(height, { toValue: 0, duration: 200, useNativeDriver: false }).start();
    }

    wasConnected.current = isConnected;
  }, [isConnected, isAuthenticated, height]);

  if (!isAuthenticated) return null;

  return (
    <Animated.View
      style={[
        styles.bar,
        { height, backgroundColor: isConnected ? colors.success : colors.error },
      ]}
    >
      <Text style={styles.text}>
        {isConnected ? 'Conectado' : 'Sin conexion — reconectando...'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
