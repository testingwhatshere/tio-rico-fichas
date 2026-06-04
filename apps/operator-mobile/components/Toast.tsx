import React, { useEffect, useRef, useCallback } from 'react';
import { Animated, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { create } from 'zustand';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
  show: (message: string, type?: ToastType) => void;
  hide: () => void;
}

export const useToast = create<ToastState>((set) => ({
  visible: false,
  message: '',
  type: 'info',
  show: (message, type = 'info') => set({ visible: true, message, type }),
  hide: () => set({ visible: false }),
}));

// Convenience functions
export const toast = {
  success: (msg: string) => useToast.getState().show(msg, 'success'),
  error: (msg: string) => useToast.getState().show(msg, 'error'),
  warning: (msg: string) => useToast.getState().show(msg, 'warning'),
  info: (msg: string) => useToast.getState().show(msg, 'info'),
};

const ICON_MAP: Record<ToastType, string> = {
  success: 'checkmark-circle',
  error: 'close-circle',
  warning: 'warning',
  info: 'information-circle',
};

const COLOR_MAP: Record<ToastType, string> = {
  success: colors.success,
  error: colors.error,
  warning: colors.warning,
  info: colors.info,
};

const BG_MAP: Record<ToastType, string> = {
  success: 'rgba(72, 187, 120, 0.15)',
  error: 'rgba(245, 101, 101, 0.15)',
  warning: 'rgba(237, 137, 54, 0.15)',
  info: 'rgba(66, 153, 225, 0.15)',
};

export default function ToastContainer() {
  const insets = useSafeAreaInsets();
  const { visible, message, type, hide } = useToast();
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -100, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => hide());
  }, [hide, translateY, opacity]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(dismiss, 3000);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, dismiss, translateY, opacity]);

  if (!visible) return null;

  const color = COLOR_MAP[type];
  const bg = BG_MAP[type];
  const icon = ICON_MAP[type];

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + 8, backgroundColor: bg, borderColor: color, transform: [{ translateY }], opacity },
      ]}
    >
      <TouchableOpacity style={styles.content} onPress={dismiss} activeOpacity={0.8}>
        <Ionicons name={icon as any} size={20} color={color} />
        <Text style={[styles.text, { color }]} numberOfLines={2}>{message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 9999,
    elevation: 10,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
});
