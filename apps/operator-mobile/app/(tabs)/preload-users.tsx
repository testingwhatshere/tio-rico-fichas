import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import colors from '@/constants/colors';
import {
  bulkImportPreloaded,
  listPreloadedUsers,
  unflagPreloadedUser,
  updateUserPhone,
  PreloadedEntry,
  PreloadedUser,
  BulkImportResult,
} from '@/services/api';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { toast } from '@/components/Toast';

// ---------- CSV parsing (paridad con apps/operator-panel/src/renderer/views/preload-users.js) ----------

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function normalizeUsername(s: string): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
}

interface ParseResult {
  entries: PreloadedEntry[];
  errors: { row: number; error: string }[];
}

function parseCSV(text: string): ParseResult {
  const errors: ParseResult['errors'] = [];
  const entries: PreloadedEntry[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { entries, errors };

  const header = (lines[0] || '').toLowerCase();
  const isGoogle = header.includes('first name') && header.includes('phone');
  const isPlainHeader =
    header.includes('username') && (header.includes('phone') || header.includes('tel'));
  const startIdx = isGoogle || isPlainHeader ? 1 : 0;

  let phoneColIdx = -1;
  if (isGoogle) {
    const headerCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
    phoneColIdx = headerCells.findIndex((c) => /phone\s*1\s*-\s*value/.test(c));
    if (phoneColIdx === -1) phoneColIdx = headerCells.length - 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cells = splitCsvLine(raw);
    let username: string;
    let phone: string;
    let panelId: string | undefined;

    if (isGoogle) {
      username = (cells[0] || '').trim();
      phone = (cells[phoneColIdx] || '').trim();
      panelId = undefined;
    } else {
      const [u, p, pid] = cells.map((c) => c.trim());
      username = u;
      phone = p;
      panelId = pid;
    }

    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername || cleanUsername.length < 3) {
      errors.push({ row: i + 1, error: `Username invalido tras limpiar: "${username}"` });
      continue;
    }
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      errors.push({ row: i + 1, error: `Telefono invalido: "${phone}"` });
      continue;
    }
    entries.push({
      username: cleanUsername,
      phone: cleanPhone,
      panelId: (panelId || '').trim() || undefined,
    });
  }
  return { entries, errors };
}

// ---------- Screen ----------

/**
 * Lee el archivo elegido como texto.
 *
 * En el APK el picker devuelve una ruta del filesystem y `expo-file-system` la
 * lee. En web devuelve un blob URI que `readAsStringAsync` no sabe abrir: el
 * import de CSV directamente no funcionaba en el browser. Ahí se usa `fetch`
 * sobre el blob, que es la forma nativa de leerlo.
 */
async function readAssetText(asset: any): Promise<string> {
  if (Platform.OS === 'web') {
    // `asset.file` es el File del input cuando el picker lo expone.
    if (asset.file instanceof Blob) return await asset.file.text();
    const res = await fetch(asset.uri);
    return await res.text();
  }
  return await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export default function PreloadUsersScreen() {
  const insets = useSafeAreaInsets();

  const [parsedEntries, setParsedEntries] = useState<PreloadedEntry[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseResult['errors']>([]);
  const [pickedFilename, setPickedFilename] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  const [list, setList] = useState<PreloadedUser[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Phone edit modal
  const [editingUser, setEditingUser] = useState<PreloadedUser | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const users = await listPreloadedUsers();
      setList(users);
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo cargar la lista');
    } finally {
      setLoadingList(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handlePickCsv = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setPickedFilename(asset.name);
      const text = await readAssetText(asset);
      const { entries, errors } = parseCSV(text);
      setParsedEntries(entries);
      setParseErrors(errors);
      setImportResult(null);
      if (entries.length === 0) {
        toast.error('No se encontraron filas validas');
      } else {
        toast.success(`${entries.length} filas listas para importar`);
      }
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'Error al leer el archivo');
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (parsedEntries.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await bulkImportPreloaded(parsedEntries);
      setImportResult(result);
      hapticSuccess();
      toast.success(`Importados ${(result.created || 0) + (result.updated || 0)} usuarios`);
      setParsedEntries([]);
      setParseErrors([]);
      setPickedFilename(null);
      await loadList();
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'Error en la importacion');
    } finally {
      setImporting(false);
    }
  }, [parsedEntries, loadList]);

  const handleUnflag = useCallback(
    (user: PreloadedUser) => {
      Alert.alert(
        'Quitar pre-cargado',
        `Quitar a ${user.username} de la lista de pre-cargados?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Quitar',
            style: 'destructive',
            onPress: async () => {
              try {
                await unflagPreloadedUser(user.id);
                hapticSuccess();
                toast.success('Quitado');
                await loadList();
              } catch (err: any) {
                hapticError();
                toast.error(err?.message || 'No se pudo quitar');
              }
            },
          },
        ],
      );
    },
    [loadList],
  );

  const openPhoneEdit = useCallback((user: PreloadedUser) => {
    setEditingUser(user);
    setPhoneInput(user.phone || '');
  }, []);

  const handleSavePhone = useCallback(async () => {
    if (!editingUser) return;
    const digits = (phoneInput || '').replace(/\D/g, '');
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
      await loadList();
    } catch (err: any) {
      hapticError();
      toast.error(err?.message || 'No se pudo actualizar el teléfono');
    } finally {
      setSavingPhone(false);
    }
  }, [editingUser, phoneInput, loadList]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadList();
  }, [loadList]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 8 }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Pre-cargar usuarios</Text>
        <Text style={styles.subtitle}>
          Subi un CSV con columnas: username, phone, panelId. Tambien acepta export de Google
          Contacts (First Name + Phone 1 - Value).
        </Text>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.pickButton} onPress={handlePickCsv} activeOpacity={0.7}>
          <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
          <Text style={styles.pickButtonText}>Elegir archivo CSV</Text>
        </TouchableOpacity>
        {pickedFilename && (
          <Text style={styles.filename} numberOfLines={1}>
            {pickedFilename}
          </Text>
        )}

        {parsedEntries.length > 0 && (
          <View style={styles.previewBox}>
            <Text style={styles.previewTitle}>
              {parsedEntries.length} filas validas
              {parseErrors.length > 0 ? ` · ${parseErrors.length} con errores` : ''}
            </Text>
            <View style={styles.previewList}>
              {parsedEntries.slice(0, 20).map((e, i) => (
                <Text key={i} style={styles.previewItem}>
                  {e.username} · {e.phone}
                  {e.panelId ? ` · panel=${e.panelId}` : ''}
                </Text>
              ))}
              {parsedEntries.length > 20 && (
                <Text style={styles.previewMore}>+{parsedEntries.length - 20} mas...</Text>
              )}
              {parseErrors.slice(0, 5).map((e, i) => (
                <Text key={`err-${i}`} style={styles.previewError}>
                  fila {e.row}: {e.error}
                </Text>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.importButton, importing && styles.importButtonDisabled]}
              onPress={handleImport}
              disabled={importing}
              activeOpacity={0.7}
            >
              {importing ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={colors.white} />
                  <Text style={styles.importButtonText}>Importar al sistema</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {importResult && (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>Importacion completada</Text>
            <Text style={styles.resultLine}>
              Nuevos: {importResult.created} · Actualizados: {importResult.updated} · Errores:{' '}
              {importResult.errors?.length || 0}
            </Text>
            {(importResult.errors || []).slice(0, 5).map((e, i) => (
              <Text key={i} style={styles.resultError}>
                fila {e.row} ({e.username || '?'}): {e.error}
              </Text>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>
            Pre-cargados <Text style={styles.count}>({list.length})</Text>
          </Text>
        </View>

        {loadingList ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : list.length === 0 ? (
          <Text style={styles.empty}>No hay usuarios pre-cargados todavia.</Text>
        ) : (
          list.map((u) => (
            <View key={u.id} style={styles.listItem}>
              <View style={styles.listItemContent}>
                <Text style={styles.listItemUsername}>{u.username}</Text>
                <Text style={styles.listItemMeta}>
                  {u.phone}
                  {u.panelId ? ` · panel ${u.panelId}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => openPhoneEdit(u)} style={styles.unflagBtn}>
                <Ionicons name="create-outline" size={21} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleUnflag(u)} style={styles.unflagBtn}>
                <Ionicons name="close-circle-outline" size={22} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* Edit phone modal */}
      <Modal
        visible={!!editingUser}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingUser(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cambiar teléfono</Text>
            <Text style={styles.modalUser}>{editingUser?.username}</Text>
            <TextInput
              style={styles.modalInput}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="Ej: 11 3456 7890"
              placeholderTextColor={colors.placeholder}
              keyboardType="phone-pad"
              autoFocus
            />
            <Text style={styles.modalHint}>
              Se guarda en formato canónico (549…) para que el login coincida.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditingUser(null)}
                disabled={savingPhone}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSavePhone}
                disabled={savingPhone}
              >
                {savingPhone ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.modalSaveText}>Guardar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  section: {
    marginTop: 8,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  count: {
    color: colors.primary,
  },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: colors.primaryGlow,
  },
  pickButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  filename: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
  previewBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  previewList: {
    maxHeight: 220,
  },
  previewItem: {
    fontSize: 12,
    color: colors.textSecondary,
    paddingVertical: 2,
    fontFamily: 'monospace',
  },
  previewMore: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    paddingTop: 4,
  },
  previewError: {
    fontSize: 11,
    color: colors.error,
    paddingVertical: 2,
  },
  importButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  importButtonDisabled: {
    opacity: 0.5,
  },
  importButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  resultBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(72, 187, 120, 0.1)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  resultTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
    marginBottom: 4,
  },
  resultLine: {
    fontSize: 12,
    color: colors.textPrimary,
  },
  resultError: {
    fontSize: 11,
    color: colors.error,
    paddingTop: 4,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 24,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  listItemContent: {
    flex: 1,
  },
  listItemUsername: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  listItemMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  unflagBtn: {
    padding: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: 20,
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
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  modalHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 8,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.backgroundTertiary,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
});
