import React from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLayout } from '@/hooks/useLayout';
import { useNav, type NavItem } from '@/hooks/useNav';
import GlobalSearch from '@/components/GlobalSearch';
import { colors, space, radius, text, SIDEBAR_WIDTH } from '@/constants/theme';

function Badge({ value }: { value: number }) {
  if (!value) return null;
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{value > 99 ? '99+' : value}</Text>
    </View>
  );
}

function SidebarItem({ item, active, onPress }: { item: NavItem; active: boolean; onPress: () => void }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[s.navItem, hovered && !active && s.navItemHover, active && s.navItemActive]}
    >
      <Ionicons
        name={item.icon}
        size={18}
        color={active ? colors.textOnPrimary : colors.textSecondary}
      />
      <Text style={[s.navLabel, active && s.navLabelActive]} numberOfLines={1}>
        {item.label}
      </Text>
      <Badge value={item.badge ?? 0} />
    </Pressable>
  );
}

function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { primary, secondary } = useNav();

  const go = (route: string) => router.push(`/(tabs)/${route}` as any);
  const isActive = (route: string) => pathname.includes(route);

  return (
    <View style={s.sidebar}>
      <View style={s.brand}>
        <Text style={s.brandName}>Tío Rico</Text>
        <Text style={s.brandRole}>Operadores</Text>
      </View>

      {/* Arriba de todo y en todas las pantallas: la pregunta más frecuente del
          turno es por una persona, no por una pestaña. */}
      <GlobalSearch />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.navList}>
        {primary.map((item) => (
          <SidebarItem key={item.route} item={item} active={isActive(item.route)} onPress={() => go(item.route)} />
        ))}

        <View style={s.navDivider} />

        {secondary.map((item) => (
          <SidebarItem key={item.route} item={item} active={isActive(item.route)} onPress={() => go(item.route)} />
        ))}
      </ScrollView>
    </View>
  );
}

export default function TabsLayout() {
  const { isDesktop } = useLayout();
  const { primary, secondary } = useNav();

  // Rutas que ya no están en la navegación pero siguen existiendo para no romper
  // links directos ni el historial.
  // En escritorio la sidebar lista todo y `more` no hace falta. En celular la
  // tab bar es horizontal: nueve items entraban a 43px cada uno, con la etiqueta
  // recortada a 33px de ancho y 9 de alto — ilegible. Ahí van los tres
  // principales y el resto detrás de "Más".
  const MORE: NavItem = { route: 'more', label: 'Más', icon: 'ellipsis-horizontal' };
  const visibleTabs = isDesktop ? [...primary, ...secondary] : [...primary, MORE];

  const alwaysHidden = ['dashboard', 'jobs', 'activity', 'requests', 'panels', 'preload-users', 'failures', 'chats', 'payments'];
  const hidden = isDesktop
    ? [...alwaysHidden, 'more']
    : [...alwaysHidden, ...secondary.map((i) => i.route)];

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        // En desktop navega la sidebar; la tab bar de celular se esconde.
        tabBarStyle: isDesktop
          ? { display: 'none' }
          : {
              backgroundColor: colors.backgroundSecondary,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: 64,
              paddingBottom: 8,
              paddingTop: 8,
            },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { ...text.caption },
      }}
    >
      {visibleTabs.map((item) => (
        <Tabs.Screen
          key={item.route}
          name={item.route}
          options={{
            title: item.label,
            tabBarIcon: ({ color, size }) => (
              <View>
                <Ionicons name={item.icon} size={size} color={color} />
                <Badge value={item.badge ?? 0} />
              </View>
            ),
          }}
        />
      ))}
      {hidden.map((route) => (
        <Tabs.Screen key={route} name={route} options={{ href: null }} />
      ))}
    </Tabs>
  );

  if (!isDesktop) return tabs;

  return (
    <View style={s.shell}>
      <Sidebar />
      <View style={{ flex: 1 }}>{tabs}</View>
    </View>
  );
}

const s = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },

  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.backgroundSecondary,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  brand: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.lg },
  brandName: { ...text.title, color: colors.primary },
  brandRole: { ...text.caption, color: colors.textMuted, marginTop: 1 },

  navList: { paddingHorizontal: space.sm, gap: 2, paddingBottom: space.lg },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 9,
    borderRadius: radius.md,
  },
  navItemHover: { backgroundColor: colors.surfaceElevated },
  navItemActive: { backgroundColor: colors.primary },
  navLabel: { ...text.body, color: colors.textSecondary, flex: 1 },
  navLabelActive: { color: colors.textOnPrimary, fontWeight: '700' },
  navDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: space.md,
    marginHorizontal: space.md,
  },

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
