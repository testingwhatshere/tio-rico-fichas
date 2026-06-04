import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { getSocket, emitWithTimeout } from '@/services/socket';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import StatusBadge from '@/components/StatusBadge';

interface Panel {
  id: string;
  name: string;
  isActive: boolean;
  botConnected?: boolean;
  _count?: { users: number; jobs: number };
}

export default function PanelsScreen() {
  const insets = useSafeAreaInsets();
  const [panels, setPanels] = useState<Panel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchPanels = useCallback(async () => {
    try {
      const result = await emitWithTimeout('get_panels', {});
      if (result?.success && result.panels) {
        setPanels(result.panels);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPanels();
  }, [fetchPanels]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPanels();
    setRefreshing(false);
  }, [fetchPanels]);

  const handleAddPanel = () => {
    Alert.prompt('Nuevo Panel', 'Nombre del panel:', async (name) => {
      if (!name?.trim()) return;
      try {
        const result = await emitWithTimeout('create_panel', { name: name.trim() });
        if (result?.success) {
          hapticSuccess();
          toast('Panel creado', 'success');
          fetchPanels();
        } else {
          hapticError();
          toast(result?.error || 'Error', 'error');
        }
      } catch (e: any) {
        toast(e.message, 'error');
      }
    });
  };

  const handleToggleActive = async (panel: Panel) => {
    const newActive = !panel.isActive;
    const action = newActive ? 'activar' : 'desactivar';

    Alert.alert(
      `${newActive ? 'Activar' : 'Desactivar'} Panel`,
      `${action.charAt(0).toUpperCase() + action.slice(1)} "${panel.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          style: newActive ? 'default' : 'destructive',
          onPress: async () => {
            try {
              const result = await emitWithTimeout('update_panel', { id: panel.id, isActive: newActive });
              if (result?.success) {
                hapticSuccess();
                toast(`Panel ${newActive ? 'activado' : 'desactivado'}`, 'success');
                fetchPanels();
              } else {
                hapticError();
                toast(result?.error || 'Error', 'error');
              }
            } catch (e: any) {
              toast(e.message, 'error');
            }
          },
        },
      ],
    );
  };

  const renderPanel = ({ item }: { item: Panel }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.panelName}>{item.name}</Text>
        <View style={styles.badges}>
          <StatusBadge status={item.isActive ? 'active' : 'inactive'} size="sm" />
          <StatusBadge status={item.botConnected ? 'connected' : 'disconnected'} size="sm" />
        </View>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Ionicons name="people-outline" size={14} color={colors.textMuted} />
          <Text style={styles.statText}>{item._count?.users ?? 0} usuarios</Text>
        </View>
        <View style={styles.stat}>
          <Ionicons name="briefcase-outline" size={14} color={colors.textMuted} />
          <Text style={styles.statText}>{item._count?.jobs ?? 0} jobs</Text>
        </View>
      </View>
      <TouchableOpacity
        style={[styles.toggleBtn, item.isActive ? styles.toggleBtnDanger : styles.toggleBtnSuccess]}
        onPress={() => handleToggleActive(item)}
      >
        <Text style={styles.toggleBtnText}>{item.isActive ? 'Desactivar' : 'Activar'}</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Paneles</Text>
        <TouchableOpacity style={styles.addBtn} onPress={handleAddPanel}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={panels}
        renderItem={renderPanel}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="desktop-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No hay paneles configurados</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  panelName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  badges: { flexDirection: 'row', gap: 6 },
  statsRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 13, color: colors.textSecondary },
  toggleBtn: { paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  toggleBtnDanger: { backgroundColor: 'rgba(239,68,68,0.15)' },
  toggleBtnSuccess: { backgroundColor: 'rgba(34,197,94,0.15)' },
  toggleBtnText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: colors.textMuted },
});
