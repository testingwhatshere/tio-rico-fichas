import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  TextInput,
  Alert,
  Modal,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { hapticError, hapticSuccess, hapticMedium } from '@/utils/haptics';

interface KillSwitchButtonProps {
  active: boolean;
  onToggle: (reason?: string) => void;
}

export default function KillSwitchButton({ active, onToggle }: KillSwitchButtonProps) {
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reason, setReason] = useState('');

  const handlePress = () => {
    hapticMedium();

    if (active) {
      // Deactivating — simple confirmation
      Alert.alert(
        'Desactivar Kill Switch',
        'Se reanudara la automatizacion. Confirmar?',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Desactivar',
            onPress: () => {
              hapticSuccess();
              onToggle();
            },
          },
        ],
      );
    } else {
      // Activating — ask for reason via cross-platform modal
      setReason('');
      setShowReasonModal(true);
    }
  };

  const handleConfirmActivate = () => {
    setShowReasonModal(false);
    hapticError();
    onToggle(reason.trim() || 'Sin motivo especificado');
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.button, active ? styles.buttonActive : styles.buttonInactive]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <View style={styles.iconContainer}>
          <Ionicons
            name={active ? 'hand-left' : 'shield-checkmark-outline'}
            size={28}
            color={colors.white}
          />
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.label, active ? styles.labelActive : styles.labelInactive]}>
            {active ? 'KILL SWITCH ACTIVO' : 'KILL SWITCH DESACTIVADO'}
          </Text>
          <Text style={styles.sublabel}>
            {active
              ? 'Toda la automatizacion esta detenida'
              : 'El sistema esta operando normalmente'}
          </Text>
        </View>
        <View style={[styles.statusDot, active ? styles.dotActive : styles.dotInactive]} />
      </TouchableOpacity>

      {/* Reason modal (cross-platform, Alert.prompt is iOS-only) */}
      <Modal
        visible={showReasonModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowReasonModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Ionicons name="warning" size={32} color={colors.error} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>Activar Kill Switch</Text>
            <Text style={styles.modalMessage}>
              Se detendra TODA la automatizacion. Ingresa el motivo:
            </Text>
            <TextInput
              style={styles.modalInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Motivo..."
              placeholderTextColor={colors.placeholder}
              autoFocus
              multiline
              maxLength={200}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowReasonModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalActivateBtn}
                onPress={handleConfirmActivate}
                activeOpacity={0.7}
              >
                <Text style={styles.modalActivateText}>ACTIVAR</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 2,
    gap: 14,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  buttonActive: {
    backgroundColor: '#7F1D1D',
    borderColor: colors.error,
    shadowColor: colors.error,
  },
  buttonInactive: {
    backgroundColor: '#14532D',
    borderColor: colors.success,
    shadowColor: colors.success,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  labelActive: {
    color: '#FCA5A5',
  },
  labelInactive: {
    color: '#86EFAC',
  },
  sublabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotActive: {
    backgroundColor: colors.error,
    shadowColor: colors.error,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  dotInactive: {
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },

  // Reason modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: colors.error + '40',
  },
  modalIcon: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.error,
    textAlign: 'center',
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
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
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  modalActivateBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  modalActivateText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 0.5,
  },
});
