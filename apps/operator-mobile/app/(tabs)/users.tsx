import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl, Alert, ActivityIndicator, Image, TouchableOpacity, Modal } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getSocket, emitWithTimeout } from '@/services/socket';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import { PageHeader } from '@/components/ui';
import { updateUserPhone } from '@/services/api';
import UserCard from '@/components/UserCard';
import { useLayout } from '@/hooks/useLayout';

export default function UsersScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useLayout();
  // ~360px por tarjeta, descontando la sidebar.
  const columns = Math.max(1, Math.min(3, Math.floor((width - 216) / 380)));
  const clients = useOperatorStore((s) => s.clients);
  const setClients = useOperatorStore((s) => s.setClients);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  // Contador de búsquedas: descarta las respuestas que llegan fuera de orden.
  const searchSeq = useRef(0);
  const [counts, setCounts] = useState({ total: 0, active: 0, blocked: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [creating, setCreating] = useState(false);
  // Edicion de telefono: el login exige que el telefono tipeado coincida con el
  // guardado, asi que un numero mal cargado deja al usuario afuera.
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  // Server-side search. We only pull the newest few clients (or the search
  // matches) instead of the whole 4000+ table.
  const fetchClients = useCallback((query = '') => {
    // Cada búsqueda invalida las anteriores.
    //
    // El operador tipea rápido y salen varias consultas en vuelo. Sin esto la
    // que contesta última gana, aunque sea de un texto viejo: la pantalla
    // terminaba mostrando resultados de "aco" mientras en el campo decía
    // "acosta23", y el operador concluía que la búsqueda anda mal.
    const seq = ++searchSeq.current;
    const isCurrent = () => seq === searchSeq.current;

    const socket = getSocket();
    if (!socket?.connected) {
      setSearchError('Sin conexión con el servidor. Reintentá en unos segundos.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setSearchError(null);
    // El ACK puede no llegar nunca (socket a medio morir, backend reiniciando).
    // Sin este timeout la pantalla se queda en "Cargando usuarios..." para
    // siempre, que es indistinguible de una busqueda sin resultados.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled || !isCurrent()) return;
      settled = true;
      setSearchError('El servidor no respondió. Probá de nuevo.');
      setLoading(false);
      setRefreshing(false);
    }, 15000);

    socket.emit('get_clients', { query, limit: query ? 50 : 10 }, (response: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Llegó tarde: ya hay una búsqueda más nueva. Se descarta.
      if (!isCurrent()) return;
      // Un `success: false` (sesion sin autenticar, error de DB) traia `data`
      // undefined y la pantalla lo mostraba como "no encontre a nadie": el
      // operador daba por hecho que el usuario no existia. Se distingue el
      // fallo del resultado vacio.
      if (response && response.success === false) {
        setSearchError(response.error || 'El servidor rechazó la búsqueda.');
        setClients([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const list = response?.data || (Array.isArray(response) ? response : []);
      if (Array.isArray(list)) setClients(list);
      if (response?.counts) setCounts(response.counts);
      setLoading(false);
      setRefreshing(false);
    });
  }, [setClients]);

  // Sólo se consulta cuando el operador busca algo.
  //
  // Antes esta pantalla pegaba a la base al montarse, con query vacía, para
  // traer 10 usuarios cualquiera que nadie mira: la lista de los últimos
  // registrados no responde ninguna pregunta. Y la query vacía además dispara
  // dos `count` sobre la tabla User entera.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      // Limpiar: si queda la lista de la busqueda anterior, el operador tipea
      // un nombre nuevo y mientras tanto sigue viendo los resultados viejos.
      setClients([]);
      setSearchError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => fetchClients(q), 300);
    return () => clearTimeout(t);
  }, [searchQuery, fetchClients, setClients]);

  const filteredClients = clients;
  const hasQuery = searchQuery.trim().length > 0;

  const onRefresh = useCallback(() => {
    const q = searchQuery.trim();
    if (!q) return;
    setRefreshing(true);
    fetchClients(q);
  }, [fetchClients, searchQuery]);

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
      // Keep the global stats header in sync without a reload.
      setCounts((prev) =>
        isActive
          ? { ...prev, active: prev.active + 1, blocked: Math.max(0, prev.blocked - 1) }
          : { ...prev, active: Math.max(0, prev.active - 1), blocked: prev.blocked + 1 },
      );
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

  const openPhoneEdit = useCallback((user: any) => {
    setEditingUser(user);
    setPhoneInput(user?.phone || '');
    setNameInput(user?.username || '');
  }, []);

  /**
   * Renombrar.
   *
   * Escribe `username` y `savedTargetUsername` juntos: si quedan distintos, la
   * extension busca en el panel de juego un nombre que no existe y la carga
   * falla. NO se relanza discovery — el panel del usuario se conserva.
   */
  const handleSaveName = useCallback(async () => {
    if (!editingUser) return;
    const nuevo = nameInput.trim().toLowerCase();
    if (nuevo === (editingUser.username || '').toLowerCase()) return;
    if (nuevo.length < 3 || nuevo.length > 30) {
      toast.error('El nombre debe tener entre 3 y 30 caracteres');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(nuevo)) {
      toast.error('Solo letras, números y guion bajo');
      return;
    }
    setSavingName(true);
    try {
      const res: any = await emitWithTimeout('operator:rename_user', {
        userId: editingUser.id,
        username: nuevo,
      }, 15000);
      if (res?.success === false) throw new Error(res.error || 'No se pudo renombrar');
      toast.success(`Ahora se llama ${nuevo}`);
      setEditingUser(null);
      // La busqueda vieja ya no matchea el nombre nuevo: reencuadrar en el.
      setSearchQuery(nuevo);
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo renombrar');
    } finally {
      setSavingName(false);
    }
  }, [editingUser, nameInput]);

  const handleSavePhone = useCallback(async () => {
    if (!editingUser) return;
    const digits = (phoneInput || '').replace(/\D/g, '');
    // Mismo rango que valida el backend, para avisar sin esperar el round-trip.
    if (digits.length < 7 || digits.length > 15) {
      toast.error('El teléfono debe tener entre 7 y 15 dígitos');
      return;
    }
    setSavingPhone(true);
    try {
      await updateUserPhone(editingUser.id, phoneInput.trim());
      hapticSuccess();
      toast.success('Teléfono actualizado');
      setEditingUser(null);
      setPhoneInput('');
      // Releer: el backend guarda canonico ("549<area><nro>"), asi que mostrar
      // lo tipeado seria mentir sobre lo que quedo en la DB.
      //
      // Si la busqueda activa era por el telefono VIEJO, el usuario ya no
      // matchea y desapareceria justo despues de editarlo, como si hubiera
      // fallado. Reencuadrar en su usuario para dejarlo a la vista.
      const q = searchQuery.trim();
      const queryWasPhone = /\d/.test(q) && !editingUser.username?.includes(q);
      if (queryWasPhone && editingUser.username) {
        setSearchQuery(editingUser.username);
      } else {
        fetchClients(q);
      }
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'No se pudo actualizar el teléfono');
    } finally {
      setSavingPhone(false);
    }
  }, [editingUser, phoneInput, fetchClients, searchQuery]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <UserCard user={item} onToggleActive={handleToggleActive} onEditPhone={openPhoneEdit} />
    ),
    [handleToggleActive, openPhoneEdit],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  const activeCount = counts.active;
  const inactiveCount = counts.blocked;

  return (
    <View style={styles.container}>
      <PageHeader
        title="Usuarios"
        subtitle={
          counts.total
            ? `${counts.total} en total · ${activeCount} activo${activeCount !== 1 ? 's' : ''}` +
              (inactiveCount > 0 ? ` · ${inactiveCount} bloqueado${inactiveCount !== 1 ? 's' : ''}` : '')
            : 'Buscá por usuario o teléfono'
        }
      />

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por usuario o teléfono..."
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
        // Grilla: una tarjeta por fila desperdiciaba todo el ancho y obligaba a
        // recorrer 1700px con la vista para llegar de los datos a las acciones.
        key={`cols-${columns}`}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.column : undefined}
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
            ) : searchError ? (
              <>
                <Ionicons
                  name="warning-outline"
                  size={40}
                  color={colors.error}
                  style={{ marginBottom: 12 }}
                />
                <Text style={styles.emptyTitle}>No se pudo buscar</Text>
                <Text style={styles.emptySubtitle}>
                  {searchError} Que no aparezca no significa que el usuario no exista.
                </Text>
                <TouchableOpacity
                  onPress={() => fetchClients(searchQuery.trim())}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryButtonText}>Reintentar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Ionicons
                  name={hasQuery ? 'person-outline' : 'search-outline'}
                  size={40}
                  color={colors.textMuted}
                  style={{ marginBottom: 12 }}
                />
                <Text style={styles.emptyTitle}>
                  {hasQuery ? 'Sin resultados' : 'Buscá un usuario'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {hasQuery
                    ? `No encontré a nadie con "${searchQuery}". La búsqueda es por nombre de usuario o teléfono, sobre los ${counts.total || '4.000+'} clientes.`
                    : 'Escribí un nombre de usuario o un teléfono. Son más de 4.000, así que la lista completa no se carga.'}
                </Text>
              </>
            )}
          </View>
        }
      />

      {/* Editar teléfono */}
      <Modal
        visible={!!editingUser}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingUser(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Editar usuario</Text>
            <Text style={styles.modalUser}>{editingUser?.username || '-'}</Text>

            <Text style={styles.fieldLabel}>Nombre</Text>
            <TextInput
              style={styles.modalInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Nombre de usuario"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalHint}>
              Tiene que ser igual al del panel de juego: es el nombre que busca el bot
              para cargar las fichas, y también con el que la persona entra a la app.
              No se pierde el panel asignado.
            </Text>
            {nameInput.trim().toLowerCase() !== (editingUser?.username || '').toLowerCase() && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary, savingName && { opacity: 0.6 }]}
                onPress={handleSaveName}
                disabled={savingName}
              >
                {savingName ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Renombrar</Text>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.fieldDivider} />

            <Text style={styles.fieldLabel}>Teléfono</Text>
            <TextInput
              style={styles.modalInput}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="Nuevo teléfono"
              placeholderTextColor={colors.placeholder}
              keyboardType="phone-pad"
            />
            <Text style={styles.modalHint}>
              Se guarda en formato canónico. Puede escribirlo con 0 o con 15.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setEditingUser(null)}
                disabled={savingPhone}
              >
                <Text style={styles.modalBtnGhostText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary, savingPhone && { opacity: 0.6 }]}
                onPress={handleSavePhone}
                disabled={savingPhone}
              >
                {savingPhone ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Guardar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 40,
    gap: 12,
  },
  column: { gap: 12 },
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
  retryButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modalUser: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 12,
    marginBottom: 6,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: 18,
  },
  modalHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  modalBtn: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalBtnGhostText: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 14,
  },
  modalBtnPrimary: {
    backgroundColor: colors.primary,
  },
  modalBtnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
