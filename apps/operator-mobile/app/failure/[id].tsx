import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore, isFailureResolved } from '@/stores/operator.store';
import { emitWithTimeout } from '@/services/socket';
import { parseAmount, formatAmount } from '@/utils/amount';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import StatusBadge from '@/components/StatusBadge';

const SCREEN_WIDTH = Dimensions.get('window').width;

type ModalType = 'approve' | 'reject' | null;

export default function FailureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const failures = useOperatorStore((s) => s.failures);
  const resolveFailure = useOperatorStore((s) => s.resolveFailure);

  const failure = useMemo(() => failures.find((f) => f.id === id), [failures, id]);

  const [modalType, setModalType] = useState<ModalType>(null);
  const [approveNote, setApproveNote] = useState('');
  const [amountOverride, setAmountOverride] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageZoomed, setImageZoomed] = useState(false);

  if (!failure) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
        <Text style={styles.notFoundText}>Fallo no encontrado</Text>
        <TouchableOpacity
          style={styles.backButtonFloating}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonFloatingText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Extract data from failure (supports nested request object)
  const amount = parseAmount(failure.amount || failure.request?.amount);
  const extractedAmount = failure.extractedAmount != null ? parseAmount(failure.extractedAmount) : null;
  const targetUsername = failure.targetUsername || failure.request?.targetUsername || '-';
  const userEmail = failure.userEmail || failure.user?.email || failure.request?.user?.email || '-';
  const proofUrl = failure.proofUrl || failure.request?.proofUrl;
  const validationScore = failure.validationScore ?? failure.request?.validationScore;
  const validationError = failure.validationError || failure.request?.validationError;
  const validationFlags = failure.validationFlags || failure.flags || [];
  const validationReasoning = failure.validationReasoning || failure.reasoning || '';
  const failureType = failure.type || (failure.jobId ? 'JOB_FAILURE' : 'VALIDATION_FAILURE');
  const createdAt = failure.createdAt || failure.request?.createdAt || '';
  const requestId = failure.requestId || failure.request?.id || failure.id;
  const isResolved = isFailureResolved(failure);

  const scorePercent = validationScore != null ? Math.round(validationScore * 100) : null;
  const scoreColor =
    validationScore == null
      ? colors.textMuted
      : validationScore >= 0.8
        ? colors.success
        : validationScore >= 0.5
          ? colors.warning
          : colors.error;

  const amountMismatch =
    extractedAmount !== null && Math.abs(extractedAmount - amount) > 0.01;

  const handleApprove = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const payload: any = {
        failureId: failure.id,
        note: approveNote.trim() || undefined,
      };

      if (amountOverride.trim()) {
        const override = parseFloat(amountOverride.trim());
        if (isNaN(override) || override <= 0) {
          Alert.alert('Error', 'Monto invalido');
          setIsSubmitting(false);
          return;
        }
        payload.approvedAmount = override;
      }

      const response: any = await emitWithTimeout('approve_failure', payload, 15000);

      if (response?.error) {
        throw new Error(response.error);
      }

      resolveFailure(failure.id, 'APPROVED');
      hapticSuccess();
      Alert.alert('Aprobado', 'El fallo fue aprobado exitosamente', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'No se pudo aprobar el fallo');
    } finally {
      setIsSubmitting(false);
      setModalType(null);
      setApproveNote('');
      setAmountOverride('');
    }
  };

  const handleReject = async () => {
    if (isSubmitting) return;

    if (!rejectReason.trim()) {
      Alert.alert('Requerido', 'Ingresa un motivo de rechazo');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        failureId: failure.id,
        requestId,
        action: 'reject',
        reason: rejectReason.trim(),
      };

      const response: any = await emitWithTimeout('reject_failure', payload, 15000);

      if (response?.error) {
        throw new Error(response.error);
      }

      resolveFailure(failure.id, 'REJECTED');
      hapticSuccess();
      Alert.alert('Rechazado', 'El fallo fue rechazado', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'No se pudo rechazar el fallo');
    } finally {
      setIsSubmitting(false);
      setModalType(null);
      setRejectReason('');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          <Text style={styles.backText}>Fallos</Text>
        </TouchableOpacity>
        <StatusBadge status={failureType} size="sm" />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Proof image */}
        {proofUrl && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setImageZoomed(true)}
            style={styles.proofContainer}
          >
            <Image
              source={{ uri: proofUrl }}
              style={styles.proofImage}
              resizeMode="contain"
            />
            <View style={styles.proofOverlay}>
              <Ionicons name="expand-outline" size={18} color={colors.white} />
            </View>
          </TouchableOpacity>
        )}

        {/* Validation score */}
        {scorePercent !== null && (
          <View style={styles.scoreSection}>
            <Text style={styles.scoreLabel}>Puntaje de validacion</Text>
            <View style={styles.scoreBarContainer}>
              <View style={styles.scoreBarTrack}>
                <View
                  style={[
                    styles.scoreBarFill,
                    {
                      width: `${scorePercent}%`,
                      backgroundColor: scoreColor,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.scoreValue, { color: scoreColor }]}>
                {scorePercent}%
              </Text>
            </View>
          </View>
        )}

        {/* Amounts */}
        <View style={styles.detailCard}>
          <Text style={styles.detailCardTitle}>Montos</Text>
          <DetailRow label="Monto solicitado" value={`$${formatAmount(amount)}`} accent />
          {extractedAmount !== null && (
            <DetailRow
              label="Monto extraido (AI)"
              value={`$${formatAmount(extractedAmount)}`}
              warning={amountMismatch}
            />
          )}
          {amountMismatch && (
            <View style={styles.mismatchBanner}>
              <Ionicons name="warning" size={14} color={colors.warning} />
              <Text style={styles.mismatchText}>
                Los montos no coinciden
              </Text>
            </View>
          )}
        </View>

        {/* User details */}
        <View style={styles.detailCard}>
          <Text style={styles.detailCardTitle}>Detalles</Text>
          <DetailRow label="Usuario destino" value={targetUsername} />
          <DetailRow label="Email" value={userEmail} />
          <DetailRow
            label="Fecha"
            value={
              createdAt
                ? new Date(createdAt).toLocaleString('es-AR', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : '-'
            }
          />
          <DetailRow label="ID" value={requestId} mono />
        </View>

        {/* Validation details */}
        {(validationError || validationReasoning || validationFlags.length > 0) && (
          <View style={styles.detailCard}>
            <Text style={styles.detailCardTitle}>Validacion AI</Text>

            {validationError && (
              <View style={styles.errorBox}>
                <Ionicons name="close-circle" size={16} color={colors.error} />
                <Text style={styles.errorText}>{validationError}</Text>
              </View>
            )}

            {validationReasoning ? (
              <Text style={styles.reasoningText}>{validationReasoning}</Text>
            ) : null}

            {validationFlags.length > 0 && (
              <View style={styles.flagsContainer}>
                {validationFlags.map((flag: string, idx: number) => (
                  <View key={idx} style={styles.flagChip}>
                    <Ionicons name="flag" size={12} color={colors.warning} />
                    <Text style={styles.flagText}>{flag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Resolved status */}
        {isResolved && (
          <View style={styles.resolvedCard}>
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            <View style={styles.resolvedTextContainer}>
              <Text style={styles.resolvedTitle}>Resuelto</Text>
              <Text style={styles.resolvedAction}>
                Accion: {failure.resolvedAction || '-'}
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Action buttons (fixed at bottom) */}
      {!isResolved && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn]}
            activeOpacity={0.7}
            onPress={() => setModalType('reject')}
          >
            <Ionicons name="close-circle" size={20} color={colors.white} />
            <Text style={styles.rejectBtnText}>Rechazar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.warning || '#f59e0b' }]}
            activeOpacity={0.7}
            onPress={async () => {
              try {
                const response: any = await emitWithTimeout('retry_failed_request', { requestId: failure.id }, 15000);
                if (response?.success) {
                  hapticSuccess();
                  Alert.alert('Listo', response.message || 'Discovery reiniciado');
                  router.back();
                } else {
                  Alert.alert('Error', response?.error || 'No se pudo reintentar');
                }
              } catch (err: any) {
                hapticError();
                Alert.alert('Error', err?.message || 'Error al reintentar');
              }
            }}
          >
            <Ionicons name="refresh-circle" size={20} color={colors.white} />
            <Text style={styles.approveBtnText}>Reintentar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            activeOpacity={0.7}
            onPress={() => setModalType('approve')}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.white} />
            <Text style={styles.approveBtnText}>Aprobar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Approve modal */}
      <Modal
        visible={modalType === 'approve'}
        transparent
        animationType="slide"
        onRequestClose={() => setModalType(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="checkmark-circle" size={28} color={colors.success} />
              <Text style={styles.modalTitle}>Aprobar fallo</Text>
            </View>

            <Text style={styles.modalLabel}>Monto original: ${formatAmount(amount)}</Text>

            <Text style={styles.inputLabel}>Monto override (opcional)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Dejar vacio para usar el original"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              value={amountOverride}
              onChangeText={setAmountOverride}
            />

            <Text style={styles.inputLabel}>Nota (opcional)</Text>
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              placeholder="Nota para el registro..."
              placeholderTextColor={colors.placeholder}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={approveNote}
              onChangeText={setApproveNote}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                activeOpacity={0.7}
                onPress={() => {
                  setModalType(null);
                  setApproveNote('');
                  setAmountOverride('');
                }}
                disabled={isSubmitting}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, styles.modalConfirmApprove]}
                activeOpacity={0.7}
                onPress={handleApprove}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirmar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject modal */}
      <Modal
        visible={modalType === 'reject'}
        transparent
        animationType="slide"
        onRequestClose={() => setModalType(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="close-circle" size={28} color={colors.error} />
              <Text style={styles.modalTitle}>Rechazar fallo</Text>
            </View>

            <Text style={styles.inputLabel}>Motivo de rechazo *</Text>
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              placeholder="Ingresa el motivo del rechazo..."
              placeholderTextColor={colors.placeholder}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={rejectReason}
              onChangeText={setRejectReason}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                activeOpacity={0.7}
                onPress={() => {
                  setModalType(null);
                  setRejectReason('');
                }}
                disabled={isSubmitting}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, styles.modalConfirmReject]}
                activeOpacity={0.7}
                onPress={handleReject}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirmar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Image zoom modal */}
      <Modal
        visible={imageZoomed}
        transparent
        animationType="fade"
        onRequestClose={() => setImageZoomed(false)}
      >
        <TouchableOpacity
          style={styles.zoomOverlay}
          activeOpacity={1}
          onPress={() => setImageZoomed(false)}
        >
          <Image
            source={{ uri: proofUrl }}
            style={styles.zoomImage}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={styles.zoomCloseBtn}
            onPress={() => setImageZoomed(false)}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={28} color={colors.white} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ---- Sub-components ----

function DetailRow({
  label,
  value,
  accent,
  warning,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warning?: boolean;
  mono?: boolean;
}) {
  return (
    <View style={detailRowStyles.row}>
      <Text style={detailRowStyles.label}>{label}</Text>
      <Text
        style={[
          detailRowStyles.value,
          accent && detailRowStyles.accent,
          warning && detailRowStyles.warning,
          mono && detailRowStyles.mono,
        ]}
        numberOfLines={1}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

const detailRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator + '40',
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  accent: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },
  warning: {
    color: colors.warning,
    fontWeight: '700',
  },
  mono: {
    fontFamily: 'monospace' as any,
    fontSize: 11,
    color: colors.textMuted,
  },
});

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  notFoundText: {
    fontSize: 16,
    color: colors.textMuted,
    marginTop: 12,
  },
  backButtonFloating: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.cardBackground,
  },
  backButtonFloatingText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingRight: 12,
  },
  backText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  // Proof image
  proofContainer: {
    width: '100%',
    height: 240,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.cardBackground,
    marginBottom: 16,
  },
  proofImage: {
    width: '100%',
    height: '100%',
  },
  proofOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: colors.overlay,
    borderRadius: 8,
    padding: 6,
  },
  // Validation score
  scoreSection: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  scoreLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 8,
    fontWeight: '500',
  },
  scoreBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scoreBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.backgroundTertiary,
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: '800',
    minWidth: 50,
    textAlign: 'right',
  },
  // Detail cards
  detailCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  detailCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  mismatchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.warning + '15',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  mismatchText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },
  // Validation details
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.error + '10',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
  reasoningText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 8,
  },
  flagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  flagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warning + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  flagText: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: '500',
  },
  // Resolved
  resolvedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.success + '12',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.success + '30',
  },
  resolvedTextContainer: {
    flex: 1,
  },
  resolvedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.success,
  },
  resolvedAction: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  // Action bar
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  approveBtn: {
    backgroundColor: colors.success,
  },
  rejectBtn: {
    backgroundColor: colors.error,
  },
  approveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  rejectBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  modalCard: {
    backgroundColor: colors.backgroundSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 14,
  },
  modalInputMultiline: {
    minHeight: 80,
    paddingTop: 12,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmApprove: {
    backgroundColor: colors.success,
  },
  modalConfirmReject: {
    backgroundColor: colors.error,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  // Image zoom
  zoomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.4,
  },
  zoomCloseBtn: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: colors.overlay,
    borderRadius: 20,
    padding: 8,
  },
});
