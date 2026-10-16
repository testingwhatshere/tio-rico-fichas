import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { getSocket, emitWithTimeout } from '@/services/socket';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ui';
import { colors as themeColors, space, radius, text as themeText } from '@/constants/theme';
import StatusBadge from '@/components/StatusBadge';

interface Panel {
  id: string;
  name: string;
  isActive: boolean;
  /** Si entra en la busqueda automatica de usuarios sin panel asignado. */
  discoverable?: boolean;
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

  // `Alert.prompt` solo existe en iOS: en web y Android no se podia crear un
  // panel porque el diálogo nunca aparecía.
  const [newPanelName, setNewPanelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const handleAddPanel = () => {
    setNewPanelName('');
    setShowCreate(true);
  };

  const confirmCreatePanel = async () => {
    const name = newPanelName.trim();
    if (!name) {
      toast.error('Poné un nombre');
      return;
    }
    setCreating(true);
    try {
      const result: any = await emitWithTimeout('create_panel', { name });
      if (result?.success) {
        toast.success('Panel creado');
        setShowCreate(false);
        fetchPanels();
      } else {
        toast.error(result?.error || 'Error');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const [renaming, setRenaming] = useState<Panel | null>(null);
  const [newName, setNewName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const patchPanel = async (panel: Panel, data: any, okMsg: string) => {
    try {
      const result: any = await emitWithTimeout('update_panel', { id: panel.id, ...data });
      if (result?.success) {
        hapticSuccess();
        toast.success(okMsg);
        fetchPanels();
        return true;
      }
      hapticError();
      toast.error(result?.error || 'Error');
    } catch (e: any) {
      toast.error(e.message);
    }
    return false;
  };

  const confirmRename = async () => {
    if (!renaming) return;
    const name = newName.trim();
    if (!name) {
      toast.error('Poné un nombre');
      return;
    }
    setSavingName(true);
    const ok = await patchPanel(renaming, { name }, `Ahora se llama "${name}"`);
    setSavingName(false);
    if (ok) setRenaming(null);
  };

  /**
   * Un panel fuera de la busqueda solo atiende a los usuarios que ya tiene
   * asignados. Es lo que hay que hacer cuando tiene billetera propia: si la
   * busqueda pudiera mandarle un usuario sin panel, ese usuario ya pago a la
   * billetera compartida y las fichas se cargarian en la caja equivocada.
   */
  const handleToggleDiscoverable = (panel: Panel) => {
    const next = !(panel.discoverable ?? true);
    patchPanel(
      panel,
      { discoverable: next },
      next ? 'Entra en la búsqueda' : 'Solo atiende a sus usuarios',
    );
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
                toast.success(`Panel ${newActive ? 'activado' : 'desactivado'}`);
                fetchPanels();
              } else {
                hapticError();
                toast.error(result?.error || 'Error');
              }
            } catch (e: any) {
              toast.error(e.message);
            }
          },
        },
      ],
    );
  };

  const renderPanel = ({ item }: { item: Panel }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <TouchableOpacity
          onPress={() => {
            setNewName(item.name);
            setRenaming(item);
          }}
          style={styles.nameBtn}
        >
          <Text style={styles.panelName}>{item.name}</Text>
          <Ionicons name="pencil-outline" size={13} color={colors.textMuted} />
        </TouchableOpacity>
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
      <TouchableOpacity style={styles.discoverRow} onPress={() => handleToggleDiscoverable(item)}>
        <Ionicons
          name={(item.discoverable ?? true) ? 'search-outline' : 'lock-closed-outline'}
          size={14}
          color={(item.discoverable ?? true) ? colors.textMuted : colors.primary}
        />
        <Text style={styles.discoverText}>
          {(item.discoverable ?? true)
            ? 'Entra en la búsqueda de usuarios sin panel'
            : 'Solo atiende a sus usuarios asignados'}
        </Text>
      </TouchableOpacity>

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

      <ConfirmDialog
        visible={!!renaming}
        title="Renombrar panel"
        message="El nombre es solo para identificarlo acá. No cambia nada de lo que ya está cargado."
        confirmLabel="Guardar"
        tone="primary"
        loading={savingName}
        onConfirm={confirmRename}
        onCancel={() => setRenaming(null)}
      >
        <TextInput
          style={panelInputStyle}
          placeholder="Nuevo nombre"
          placeholderTextColor={themeColors.placeholder}
          value={newName}
          onChangeText={setNewName}
          autoFocus
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={showCreate}
        title="Nuevo panel"
        message="El nombre es como lo vas a identificar en el panel de operadores."
        confirmLabel="Crear"
        tone="primary"
        loading={creating}
        onConfirm={confirmCreatePanel}
        onCancel={() => setShowCreate(false)}
      >
        <TextInput
          style={panelInputStyle}
          placeholder="Nombre del panel"
          placeholderTextColor={themeColors.placeholder}
          value={newPanelName}
          onChangeText={setNewPanelName}
          autoFocus
        />
      </ConfirmDialog>

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
  nameBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 4,
  },
  discoverText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
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

const panelInputStyle = {
  ...themeText.body,
  color: themeColors.textPrimary,
  backgroundColor: themeColors.input,
  borderWidth: 1,
  borderColor: themeColors.inputBorder,
  borderRadius: radius.md,
  paddingHorizontal: space.md,
  paddingVertical: space.md,
} as const;
