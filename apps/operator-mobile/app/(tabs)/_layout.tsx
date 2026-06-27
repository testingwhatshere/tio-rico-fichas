import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOperatorStore } from '@/stores/operator.store';
import colors from '@/constants/colors';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface BadgeIconProps {
  name: IoniconsName;
  color: string;
  size: number;
  badge?: number;
}

function BadgeIcon({ name, color, size, badge }: BadgeIconProps) {
  return (
    <View style={badgeStyles.container}>
      <Ionicons name={name} size={size} color={color} />
      {badge !== undefined && badge > 0 && (
        <View style={badgeStyles.badge}>
          <Text style={badgeStyles.badgeText}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      )}
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: colors.unreadBadge,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
});

export default function TabsLayout() {
  const pendingFailures = useOperatorStore((s) => s.pendingFailures);
  const pendingChats = useOperatorStore((s) => s.pendingChats);
  const pendingPrizeClaims = useOperatorStore((s) => s.pendingPrizeClaims);
  const pendingPayments = useOperatorStore((s) =>
    s.outboundPayments.filter((p: any) => p.status === 'PENDING' || p.status === 'CONFIRMED').length
  );

  // "Más" agrupa lo que no es accionable a diario (payments, jobs, etc.).
  // Premios subió a tab primaria, así que ya no entra en este badge.
  const moreBadge = pendingPayments || 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.backgroundSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      {/* ===== 5 VISIBLE TABS ===== */}
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="failures"
        options={{
          title: 'Fallos',
          tabBarIcon: ({ color, size }) => (
            <BadgeIcon name="alert-circle-outline" size={size} color={color} badge={pendingFailures} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => (
            <BadgeIcon name="chatbubbles-outline" size={size} color={color} badge={pendingChats} />
          ),
        }}
      />
      <Tabs.Screen
        name="prizes"
        options={{
          title: 'Premios',
          tabBarIcon: ({ color, size }) => (
            <BadgeIcon name="trophy-outline" size={size} color={color} badge={pendingPrizeClaims} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Mas',
          tabBarIcon: ({ color, size }) => (
            <BadgeIcon name="ellipsis-horizontal-circle-outline" size={size} color={color} badge={moreBadge} />
          ),
        }}
      />

      {/* ===== HIDDEN TABS (accessible from "Mas" screen) ===== */}
      <Tabs.Screen name="jobs" options={{ href: null }} />
      <Tabs.Screen name="payments" options={{ href: null }} />
      <Tabs.Screen name="extensions" options={{ href: null }} />
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="wallets" options={{ href: null }} />
      <Tabs.Screen name="users" options={{ href: null }} />
      <Tabs.Screen name="preload-users" options={{ href: null }} />
      <Tabs.Screen name="requests" options={{ href: null }} />
      <Tabs.Screen name="panels" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
