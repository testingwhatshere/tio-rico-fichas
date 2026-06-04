import React, { useRef } from 'react';
import { Animated, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

let Swipeable: any = null;
let RectButton: any = TouchableOpacity;
try {
  const gh = require('react-native-gesture-handler');
  Swipeable = gh.Swipeable;
  RectButton = gh.RectButton;
} catch {}

interface SwipeAction {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
}

export default function SwipeableRow({ children, leftAction, rightAction }: SwipeableRowProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const close = () => swipeableRef.current?.close();

  const renderLeftActions = (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    if (!leftAction) return null;
    const scale = dragX.interpolate({ inputRange: [0, 80], outputRange: [0, 1], extrapolate: 'clamp' });
    return (
      <RectButton
        style={[styles.actionContainer, { backgroundColor: leftAction.color }]}
        onPress={() => { close(); leftAction.onPress(); }}
      >
        <Animated.View style={[styles.actionContent, { transform: [{ scale }] }]}>
          <Ionicons name={leftAction.icon as any} size={22} color="#fff" />
          <Text style={styles.actionLabel}>{leftAction.label}</Text>
        </Animated.View>
      </RectButton>
    );
  };

  const renderRightActions = (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    if (!rightAction) return null;
    const scale = dragX.interpolate({ inputRange: [-80, 0], outputRange: [1, 0], extrapolate: 'clamp' });
    return (
      <RectButton
        style={[styles.actionContainer, { backgroundColor: rightAction.color }]}
        onPress={() => { close(); rightAction.onPress(); }}
      >
        <Animated.View style={[styles.actionContent, { transform: [{ scale }] }]}>
          <Ionicons name={rightAction.icon as any} size={22} color="#fff" />
          <Text style={styles.actionLabel}>{rightAction.label}</Text>
        </Animated.View>
      </RectButton>
    );
  };

  // Fallback: if gesture handler not available, just render children
  if (!Swipeable) return <>{children}</>;

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={leftAction ? renderLeftActions : undefined}
      renderRightActions={rightAction ? renderRightActions : undefined}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  actionContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
  },
  actionContent: {
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
