import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { emitWithTimeout } from '@/services/socket';
import { hapticSuccess, hapticMedium, hapticError } from '@/utils/haptics';
import WalletCard from '@/components/WalletCard';

type WalletType = 'MERCADOPAGO' | 'CBU' | 'CVU' | 'RIPIO' | 'FIWIND' | 'PREX';

interface WalletFormData {
  type: WalletType;
  label: string;
  holderName: string;
  holderDni: string;
  holderLegalName: string;
  alias: string;
  cbu: string;
  cvu: string;
  bankName: string;
  amountLimit: string;
}

const EMPTY_FORM: WalletFormData = {
  type: 'MERCADOPAGO',
  label: '',
  holderName: '',
  holderDni: '',
  holderLegalName: '',
  alias: '',
  cbu: '',
  cvu: '',
  bankName: '',
  amountLimit: '',
};

const WALLET_TYPES: { key: WalletType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'MERCADOPAGO', label: 'MercadoPago', icon: 'phone-portrait-outline' },
  { key: 'CBU', label: 'CBU', icon: 'business-outline' },
  { key: 'CVU', label: 'CVU', icon: 'card-outline' },
  { key: 'RIPIO', label: 'Ripio', icon: 'logo-bitcoin' },
  { key: 'FIWIND', label: 'Fiwind', icon: 'globe-outline' },
  { key: 'PREX', label: 'Prex', icon: 'wallet-outline' },
];

export default function WalletsScreen() {
  const insets = useSafeAreaInsets();
  const wallets = useOperatorStore((s) => s.wallets);
  const addWalletToStore = useOperatorStore((s) => s.addWallet);
  const updateWalletInStore = useOperatorStore((s) => s.updateWallet);
  const removeWalletFromStore = useOperatorStore((s) => s.removeWallet);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingWallet, setEditingWallet] = useState<any>(null);
  const [form, setForm] = useState<WalletFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // ---- Helpers ----

  const updateField = useCallback((field: keyof WalletFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const openCreateModal = useCallback(() => {
    setEditingWallet(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
  }, []);

  const openEditModal = useCallback((wallet: any) => {
    setEditingWallet(wallet);
    const details = wallet.details || {};
    setForm({
      type: wallet.type || 'MERCADOPAGO',
      label: wallet.label || '',
      holderName: wallet.holderName || '',
      holderDni: wallet.holderDni || '',
      holderLegalName: wallet.holderLegalName || '',
      alias: details.alias || '',
      cbu: details.cbu || '',
      cvu: details.cvu || '',
      bankName: details.bankName || details.bank || '',
      amountLimit: wallet.amountLimit ? String(wallet.amountLimit) : '',
    });
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingWallet(null);
    setForm(EMPTY_FORM);
  }, []);

  // ---- Actions ----

  const handleSubmit = useCallback(async () => {
    if (!form.holderName.trim()) {
      Alert.alert('Error', 'El nombre del titular es obligatorio');
      return;
    }

    if (form.type === 'CBU' && form.cbu.replace(/\s/g, '').length !== 22) {
      Alert.alert('Error', 'El CBU debe tener 22 digitos');
      return;
    }

    if (form.type === 'CVU' && form.cvu.replace(/\s/g, '').length !== 22) {
      Alert.alert('Error', 'El CVU debe tener 22 digitos');
      return;
    }

    if (form.holderDni && (form.holderDni.length < 7 || form.holderDni.length > 11)) {
      Alert.alert('Error', 'El DNI debe tener entre 7 y 11 digitos');
      return;
    }

    setSubmitting(true);

    try {
      const details: Record<string, string> = {};
      if (form.type === 'MERCADOPAGO') {
        if (form.alias.trim()) details.alias = form.alias.trim();
      } else if (form.type === 'CBU') {
        details.cbu = form.cbu.replace(/\s/g, '');
        if (form.bankName.trim()) details.bankName = form.bankName.trim();
      } else if (form.type === 'CVU') {
        details.cvu = form.cvu.replace(/\s/g, '');
        if (form.bankName.trim()) details.bankName = form.bankName.trim();
      } else {
        // RIPIO, FIWIND, PREX — store alias or account id in details
        if (form.alias.trim()) details.alias = form.alias.trim();
        if (form.bankName.trim()) details.bankName = form.bankName.trim();
      }

      const payload: any = {
        type: form.type,
        label: form.label.trim() || undefined,
        holderName: form.holderName.trim(),
        holderDni: form.holderDni.trim() || undefined,
        holderLegalName: form.holderLegalName.trim() || undefined,
        details,
        amountLimit: form.amountLimit && !isNaN(parseFloat(form.amountLimit)) ? parseFloat(form.amountLimit) : undefined,
      };

      if (editingWallet) {
        payload.id = editingWallet.id;
        const result = await emitWithTimeout<any>('update_wallet', payload, 15000);
        if (result?.error) {
          Alert.alert('Error', result.error);
          return;
        }
        updateWalletInStore(result?.data || result?.wallet || { ...editingWallet, ...payload });
        hapticSuccess();
      } else {
        const result = await emitWithTimeout<any>('create_wallet', payload, 15000);
        if (result?.error) {
          Alert.alert('Error', result.error);
          return;
        }
        addWalletToStore(result?.data || result?.wallet || payload);
        hapticSuccess();
      }

      closeModal();
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'No se pudo guardar la wallet');
    } finally {
      setSubmitting(false);
    }
  }, [form, editingWallet, closeModal, addWalletToStore, updateWalletInStore]);

  const handleSelect = useCallback(async (wallet: any) => {
    try {
      hapticMedium();
      const result = await emitWithTimeout<any>('select_wallet', { id: wallet.id });
      if (result?.error) {
        Alert.alert('Error', result.error);
        return;
      }
      // Mark this wallet as selected, unmark others
      const store = useOperatorStore.getState();
      for (const w of store.wallets) {
        if (w.id === wallet.id) {
          store.updateWallet({ ...w, isSelected: true });
        } else if (w.isSelected) {
          store.updateWallet({ ...w, isSelected: false });
        }
      }
      hapticSuccess();
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'No se pudo seleccionar la wallet');
    }
  }, []);

  const handleEmpty = useCallback((wallet: any) => {
    Alert.alert(
      'Vaciar Wallet',
      `Se reiniciara el acumulado de "${wallet.label || wallet.holderName}" a $0. Confirmar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Vaciar',
          style: 'destructive',
          onPress: async () => {
            try {
              hapticMedium();
              const result = await emitWithTimeout<any>('empty_wallet', { id: wallet.id });
              if (result?.error) {
                Alert.alert('Error', result.error);
                return;
              }
              useOperatorStore.getState().updateWallet({
                ...wallet,
                accumulatedAmount: '0',
              });
              hapticSuccess();
            } catch (err: any) {
              hapticError();
              Alert.alert('Error', err.message || 'No se pudo vaciar la wallet');
            }
          },
        },
      ],
    );
  }, []);

  const handleDelete = useCallback((wallet: any) => {
    Alert.alert(
      'Eliminar Wallet',
      `Se eliminara permanentemente "${wallet.label || wallet.holderName}". Esta accion no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              hapticMedium();
              const result = await emitWithTimeout<any>('delete_wallet', { id: wallet.id });
              if (result?.error) {
                Alert.alert('Error', result.error);
                return;
              }
              removeWalletFromStore(wallet.id);
              hapticSuccess();
            } catch (err: any) {
              hapticError();
              Alert.alert('Error', err.message || 'No se pudo eliminar la wallet');
            }
          },
        },
      ],
    );
  }, [removeWalletFromStore]);

  // ---- Render ----

  const renderWallet = useCallback(
    ({ item }: { item: any }) => (
      <WalletCard
        wallet={item}
        onSelect={() => handleSelect(item)}
        onEdit={() => openEditModal(item)}
        onEmpty={() => handleEmpty(item)}
        onDelete={() => handleDelete(item)}
      />
    ),
    [handleSelect, openEditModal, handleEmpty, handleDelete],
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="wallet-outline" size={48} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>Sin wallets</Text>
      <Text style={styles.emptySubtitle}>
        Agrega una wallet para recibir pagos de los usuarios
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('@/assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8 }} />
            <Text style={styles.headerTitle}>Wallets</Text>
          </View>
          <Text style={styles.headerSubtitle}>{wallets.length} configurada{wallets.length !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={wallets}
        keyExtractor={(item) => item.id}
        renderItem={renderWallet}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        onPress={openCreateModal}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color={colors.textOnPrimary} />
      </TouchableOpacity>

      {/* Create/Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Modal header */}
          <View style={[styles.modalHeader, { paddingTop: 16 }]}>
            <TouchableOpacity onPress={closeModal} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingWallet ? 'Editar Wallet' : 'Nueva Wallet'}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Type selector */}
            <Text style={styles.fieldLabel}>Tipo</Text>
            <View style={styles.typeSelector}>
              {WALLET_TYPES.map((wt) => {
                const selected = form.type === wt.key;
                return (
                  <TouchableOpacity
                    key={wt.key}
                    style={[styles.typeOption, selected && styles.typeOptionSelected]}
                    onPress={() => updateField('type', wt.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={wt.icon}
                      size={18}
                      color={selected ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.typeOptionText, selected && styles.typeOptionTextSelected]}>
                      {wt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Label */}
            <Text style={styles.fieldLabel}>Etiqueta (opcional)</Text>
            <TextInput
              style={styles.input}
              value={form.label}
              onChangeText={(v) => updateField('label', v)}
              placeholder="Ej: Wallet principal"
              placeholderTextColor={colors.placeholder}
            />

            {/* Holder name */}
            <Text style={styles.fieldLabel}>Nombre del titular *</Text>
            <TextInput
              style={styles.input}
              value={form.holderName}
              onChangeText={(v) => updateField('holderName', v)}
              placeholder="Nombre completo"
              placeholderTextColor={colors.placeholder}
            />

            {/* Holder DNI */}
            <Text style={styles.fieldLabel}>DNI del titular (opcional)</Text>
            <TextInput
              style={styles.input}
              value={form.holderDni}
              onChangeText={(v) => updateField('holderDni', v.replace(/\D/g, ''))}
              placeholder="12345678"
              placeholderTextColor={colors.placeholder}
              keyboardType="number-pad"
              maxLength={11}
            />

            {/* Holder legal name */}
            <Text style={styles.fieldLabel}>Razon social (opcional)</Text>
            <TextInput
              style={styles.input}
              value={form.holderLegalName}
              onChangeText={(v) => updateField('holderLegalName', v)}
              placeholder="Razon social o nombre legal"
              placeholderTextColor={colors.placeholder}
            />

            {/* Type-specific fields */}
            {form.type === 'MERCADOPAGO' && (
              <>
                <Text style={styles.fieldLabel}>Alias</Text>
                <TextInput
                  style={styles.input}
                  value={form.alias}
                  onChangeText={(v) => updateField('alias', v)}
                  placeholder="alias.mercadopago"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                />
              </>
            )}

            {form.type === 'CBU' && (
              <>
                <Text style={styles.fieldLabel}>Numero de CBU *</Text>
                <TextInput
                  style={styles.input}
                  value={form.cbu}
                  onChangeText={(v) => updateField('cbu', v.replace(/\D/g, ''))}
                  placeholder="22 digitos"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="number-pad"
                  maxLength={22}
                />
              </>
            )}

            {form.type === 'CVU' && (
              <>
                <Text style={styles.fieldLabel}>Numero de CVU *</Text>
                <TextInput
                  style={styles.input}
                  value={form.cvu}
                  onChangeText={(v) => updateField('cvu', v.replace(/\D/g, ''))}
                  placeholder="22 digitos"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="number-pad"
                  maxLength={22}
                />
              </>
            )}

            {/* Bank name */}
            <Text style={styles.fieldLabel}>Nombre del banco (opcional)</Text>
            <TextInput
              style={styles.input}
              value={form.bankName}
              onChangeText={(v) => updateField('bankName', v)}
              placeholder="Ej: Banco Nacion"
              placeholderTextColor={colors.placeholder}
            />

            {/* Amount limit */}
            <Text style={styles.fieldLabel}>Limite de monto (opcional)</Text>
            <TextInput
              style={styles.input}
              value={form.amountLimit}
              onChangeText={(v) => updateField('amountLimit', v.replace(/[^0-9.]/g, ''))}
              placeholder="0 = sin limite"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
            />

            {/* Submit button */}
            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons
                    name={editingWallet ? 'checkmark-circle-outline' : 'add-circle-outline'}
                    size={20}
                    color={colors.textOnPrimary}
                  />
                  <Text style={styles.submitButtonText}>
                    {editingWallet ? 'Guardar Cambios' : 'Crear Wallet'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* Bottom spacing */}
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  listContent: {
    paddingBottom: 100,
    paddingTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  // ---- Modal ----
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  typeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  typeOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryGlow,
  },
  typeOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  typeOptionTextSelected: {
    color: colors.primary,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
});
