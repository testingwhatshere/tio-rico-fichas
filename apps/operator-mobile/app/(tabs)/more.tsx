import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOperatorStore } from '@/stores/operator.store';
import colors from '@/constants/colors';

interface MenuItemProps {
  icon: string;
  label: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
}

function MenuItem({ icon, label, subtitle, onPress, badge }: MenuItemProps) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.menuIconContainer}>
        <Ionicons name={icon as any} size={22} color={colors.primary} />
      </View>
      <View style={styles.menuTextContainer}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pendingPrizeClaims = useOperatorStore((s) => s.pendingPrizeClaims);
  const pendingPayments = useOperatorStore((s) =>
    s.outboundPayments.filter((p: any) => p.status === 'PENDING' || p.status === 'CONFIRMED').length
  );

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Image source={require('@/assets/icon.png')} style={styles.headerIcon} />
        <View>
          <Text style={styles.headerTitle}>Tio Rico</Text>
          <Text style={styles.headerSubtitle}>Mas opciones</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Operaciones</Text>
        <MenuItem
          icon="trophy-outline"
          label="Premios"
          subtitle="Reclamos de premios de usuarios"
          onPress={() => router.push('/(tabs)/prizes')}
          badge={pendingPrizeClaims}
        />
        <MenuItem
          icon="cash-outline"
          label="Pagos"
          subtitle="Pagos salientes de premios"
          onPress={() => router.push('/(tabs)/payments')}
          badge={pendingPayments}
        />
        <MenuItem
          icon="time-outline"
          label="Actividad"
          subtitle="Historial de acciones del sistema"
          onPress={() => router.push('/(tabs)/activity')}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Gestion</Text>
        <MenuItem
          icon="wallet-outline"
          label="Wallets"
          subtitle="Billeteras de pago configuradas"
          onPress={() => router.push('/(tabs)/wallets')}
        />
        <MenuItem
          icon="people-outline"
          label="Usuarios"
          subtitle="Clientes registrados"
          onPress={() => router.push('/(tabs)/users')}
        />
        <MenuItem
          icon="desktop-outline"
          label="Paneles"
          subtitle="Gestionar paneles del casino"
          onPress={() => router.push('/(tabs)/panels')}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sistema</Text>
        <MenuItem
          icon="extension-puzzle-outline"
          label="Extensiones"
          subtitle="Monitoreo de bots y verificadores"
          onPress={() => router.push('/(tabs)/extensions')}
        />
        <MenuItem
          icon="settings-outline"
          label="Configuracion"
          subtitle="Conexion, notificaciones y ajustes"
          onPress={() => router.push('/(tabs)/settings')}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.primary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primaryGlow,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuTextContainer: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  menuSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  badge: {
    backgroundColor: colors.unreadBadge,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 8,
  },
  badgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
});
