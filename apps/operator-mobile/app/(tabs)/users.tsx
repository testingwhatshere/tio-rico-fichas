import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl, Alert, ActivityIndicator, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getSocket, emitWithTimeout } from '@/services/socket';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import UserCard from '@/components/UserCard';

export default function UsersScreen() {
  const insets = useSafeAreaInsets();
  const clients = useOperatorStore((s) => s.clients);
  const setClients = useOperatorStore((s) => s.setClients);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchClients = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) {
      setLoading(false);
      return;
    }

    socket.emit('get_clients', {}, (response: any) => {
      // Backend returns { success, data: [...] }
      const clients = response?.data || response?.clients || (Array.isArray(response) ? response : []);
      if (Array.isArray(clients)) {
        setClients(clients);
      }
      setLoading(false);
    });
  }, [setClients]);

  useEffect(() => {
    // Only fetch if store is empty (avoid re-fetching on tab switch)
    if (clients.length === 0) {
      fetchClients();
    } else {
      setLoading(false);
    }
  }, [clients.length, fetchClients]);

  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return clients;
    const q = searchQuery.toLowerCase().trim();
    return clients.filter((c) => {
      const username = (c.username || c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const savedTarget = (c.savedTargetUsername || '').toLowerCase();
      return username.includes(q) || email.includes(q) || savedTarget.includes(q);
    });
  }, [clients, searchQuery]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchClients();
    setTimeout(() => setRefreshing(false), 1000);
  }, [fetchClients]);

  const handleToggleActive = useCallback(async (userId: string, isActive: boolean) => {
    try {
      const result = await emitWithTimeout<any>('toggle_user_active', { userId, isActive });
      if (result?.error) {
        hapticError();
        toast.error(result.error);
        return;
      }
      hapticSuccess();
      toast.success(isActive ? 'Usuario activado' : 'Usuario desactivado');
      // Optimistic update
      const store = useOperatorStore.getState();
      const updatedClients = store.clients.map((c) =>
        c.id === userId ? { ...c, isActive } : c,
      );
      store.setClients(updatedClients);
    } catch (err: any) {
      hapticError();
      toast.error(err.message || 'No se pudo actualizar el usuario');
    }
  }, []);

  const handleCreatePanelUser = useCallback(async () => {
    const username = newUsername.trim();
    if (!username || username.length < 3) {
      toast.error('El nombre debe tener al menos 3 caracteres');
      return;
    }
    setCreating(true);
    try {
      const result = await emitWithTimeout<any>('create_panel_user', { targetUsername: username });
      if (result?.success) {
        hapticSuccess();
        toast.success(`Creación de "${username}" en proceso`);
        setNewUsername('');
      } else {
        hapticError();
        toast.error(result?.error || 'No se pudo crear usuario');
      }
    } catch (err: any) {
      hapticError();
      toast.error(err.message || 'Error al crear usuario');
    } finally {
      setCreating(false);
    }
  }, [newUsername]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <UserCard user={item} onToggleActive={handleToggleActive} />
    ),
    [handleToggleActive],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const activeCount = clients.filter((c) => c.isActive !== false).length;
  const inactiveCount = clients.length - activeCount;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
          <Text style={styles.headerTitle}>Usuarios</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {clients.length} total &middot; {activeCount} activo{activeCount !== 1 ? 's' : ''}
          {inactiveCount > 0 ? ` &middot; ${inactiveCount} inactivo${inactiveCount !== 1 ? 's' : ''}` : ''}
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre o email..."
            placeholderTextColor={colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.textMuted}
              onPress={() => setSearchQuery('')}
            />
          )}
        </View>
      </View>

      {/* Create panel user */}
      <View style={styles.createUserBar}>
        <TextInput
          style={styles.createUserInput}
          placeholder="Nickname para el panel"
          placeholderTextColor={colors.placeholder}
          value={newUsername}
          onChangeText={setNewUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.createUserBtn, creating && { opacity: 0.6 }]}
          onPress={handleCreatePanelUser}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.createUserBtnText}>Crear</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* List */}
      <FlatList
        data={filteredClients}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredClients.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 16 }} />
                <Text style={styles.emptyTitle}>Cargando usuarios...</Text>
              </>
            ) : (
              <>
                <Image source={require('@/assets/icon.png')} style={{ width: 64, height: 64, borderRadius: 16, opacity: 0.5, marginBottom: 16 }} />
                <Text style={styles.emptyTitle}>
                  {searchQuery ? 'Sin resultados' : 'Sin usuarios registrados'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {searchQuery
                    ? `No se encontraron usuarios para "${searchQuery}"`
                    : 'Los usuarios apareceran aqui cuando se registren'}
                </Text>
              </>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  createUserBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  createUserInput: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  createUserBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  createUserBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 100,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.cardBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
