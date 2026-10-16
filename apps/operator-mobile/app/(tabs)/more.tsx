import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNav, type NavItem } from '@/hooks/useNav';
import { colors, space, radius, text } from '@/constants/theme';

/**
 * "Más" — sólo existe en celular.
 *
 * La tab bar horizontal no entra más de cuatro items legibles: con las nueve
 * pantallas quedaban a 43px cada una y la etiqueta recortada a 33px de ancho.
 * Acá van las secundarias.
 *
 * La lista sale de `useNav()`, la misma que arma la sidebar de escritorio. No
 * se escribe a mano: la versión anterior de este archivo ofrecía Pagos, Jobs,
 * Solicitudes y Paneles —rutas que ya no están en la navegación— y no ofrecía
 * ninguna de las actuales.
 */
function Item({ item, onPress }: { item: NavItem; onPress: () => void }) {
  return (
    <Pressable style={s.item} onPress={onPress}>
      <View style={s.icon}>
        <Ionicons name={item.icon} size={20} color={colors.primary} />
      </View>
      <Text style={s.label}>{item.label}</Text>
      {!!item.badge && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { secondary } = useNav();

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.content, { paddingTop: insets.top + space.lg }]}
    >
      <Text style={s.title}>Más</Text>
      <View style={s.list}>
        {secondary.map((item) => (
          <Item
            key={item.route}
            item={item}
            onPress={() => router.push(`/(tabs)/${item.route}` as any)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  title: { ...text.display, color: colors.textPrimary, marginBottom: space.lg },
  list: { gap: space.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  icon: { width: 28, alignItems: 'center' },
  label: { ...text.body, color: colors.textPrimary, flex: 1 },
  badge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.unreadBadge,
    alignItems: 'center',
  },
  badgeText: { ...text.caption, color: colors.white, fontWeight: '700' },
});
