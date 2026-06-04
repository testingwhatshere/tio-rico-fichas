import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useOperatorStore } from '@/stores/operator.store';
import { getApi } from '@/services/api';
import { parseAmount, formatAmount } from '@/utils/amount';
import { hapticSuccess, hapticError } from '@/utils/haptics';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pendiente', color: colors.textMuted },
  VERIFIED: { label: 'Verificado', color: colors.warning },
  PROCESSING: { label: 'Procesando', color: colors.chipProcessing },
  CHIPS_WITHDRAWN: { label: 'Fichas retiradas', color: colors.chipPending },
  COMPLETED: { label: 'Completado', color: colors.chipCompleted },
  REJECTED: { label: 'Rechazado', color: colors.chipFailed },
  FAILED: { label: 'Fallido', color: colors.chipFailed },
};

export default function PrizeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const prizeClaims = useOperatorStore((s) => s.prizeClaims);
  const updatePrizeClaim = useOperatorStore((s) => s.updatePrizeClaim);

  const claim = useMemo(() => prizeClaims.find((c) => c.id === id), [prizeClaims, id]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  if (!claim) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
        <Text style={styles.notFoundText}>Premio no encontrado</Text>
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

  const amount = parseAmount(claim.amount);
  const verifiedBalance = claim.verifiedBalance != null ? parseAmount(claim.verifiedBalance) : null;
  const targetUsername = claim.targetUsername || claim.user?.savedTargetUsername || '-';
  const userEmail = claim.user?.email || '-';
  const paymentMethod = claim.paymentMethod || '-';
  const paymentDetails = claim.paymentDetails || '-';
  const status = claim.status || 'PENDING';
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const createdAt = claim.createdAt || '';
  const updatedAt = claim.updatedAt || '';
  const isTerminal = ['COMPLETED', 'REJECTED'].includes(status);

  const handleProcessWithdrawal = () => {
    Alert.alert(
      'Procesar Retiro',
      `Vas a iniciar el retiro de $${formatAmount(amount)} para ${targetUsername}. Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Procesar',
          onPress: async () => {
            setIsProcessing(true);
            try {
              const api = getApi();
              await api.post(`/prize-claims/${claim.id}/process`);
              updatePrizeClaim(claim.id, { status: 'PROCESSING' });
              hapticSuccess();
              Alert.alert('Procesando', 'El retiro esta siendo procesado.');
            } catch (err: any) {
              hapticError();
              Alert.alert('Error', err.message || 'No se pudo procesar el retiro');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ],
    );
  };

  const handleMarkPaid = () => {
    Alert.alert(
      'Marcar como Pagado',
      `Confirmas que el pago de $${formatAmount(amount)} fue enviado a ${targetUsername}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setIsProcessing(true);
            try {
              const api = getApi();
              await api.post(`/prize-claims/${claim.id}/complete`);
              updatePrizeClaim(claim.id, { status: 'COMPLETED' });
              hapticSuccess();
              Alert.alert('Completado', 'El premio fue marcado como pagado.', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (err: any) {
              hapticError();
              Alert.alert('Error', err.message || 'No se pudo completar el premio');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ],
    );
  };

  const handleRetry = () => {
    Alert.alert(
      'Reintentar',
      `Reintentar el proceso de retiro para ${targetUsername}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reintentar',
          onPress: async () => {
            setIsProcessing(true);
            try {
              const api = getApi();
              await api.post(`/prize-claims/${claim.id}/retry`);
              updatePrizeClaim(claim.id, { status: 'PROCESSING' });
              hapticSuccess();
              Alert.alert('Reintentando', 'El retiro esta siendo procesado nuevamente.');
            } catch (err: any) {
              hapticError();
              Alert.alert('Error', err.message || 'No se pudo reintentar el retiro');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ],
    );
  };

  const handleReject = () => {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }

    if (!rejectReason.trim()) {
      Alert.alert('Requerido', 'Ingresa un motivo de rechazo');
      return;
    }

    Alert.alert(
      'Rechazar Premio',
      `Rechazar el reclamo de $${formatAmount(amount)} de ${targetUsername}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Rechazar',
          style: 'destructive',
          onPress: async () => {
            setIsProcessing(true);
            try {
              const api = getApi();
              await api.post(`/prize-claims/${claim.id}/reject`, { reason: rejectReason.trim() });
              updatePrizeClaim(claim.id, { status: 'REJECTED' });
              hapticSuccess();
              Alert.alert('Rechazado', 'El reclamo fue rechazado.', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (err: any) {
              hapticError();
              Alert.alert('Error', err.message || 'No se pudo rechazar el reclamo');
            } finally {
              setIsProcessing(false);
              setShowRejectInput(false);
              setRejectReason('');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          <Text style={styles.backText}>Premios</Text>
        </TouchableOpacity>
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '25' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
          <Text style={[styles.statusLabel, { color: statusConfig.color }]}>{statusConfig.label}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Amount highlight */}
        <View style={styles.amountCard}>
          <Text style={styles.amountCardLabel}>Monto a pagar</Text>
          <View style={styles.amountCardRow}>
            <Text style={styles.amountCardSymbol}>$</Text>
            <Text style={styles.amountCardValue}>{formatAmount(amount)}</Text>
          </View>
        </View>

        {/* User details */}
        <View style={styles.detailCard}>
          <Text style={styles.detailCardTitle}>Detalles del usuario</Text>
          <DetailRow label="Usuario destino" value={targetUsername} />
          <DetailRow label="Email" value={userEmail} />
          {verifiedBalance !== null && (
            <DetailRow label="Balance verificado" value={`$${formatAmount(verifiedBalance)}`} />
          )}
        </View>

        {/* Payment details */}
        <View style={styles.detailCard}>
          <Text style={styles.detailCardTitle}>Datos de pago</Text>
          <DetailRow label="Metodo" value={paymentMethod} />
          <DetailRow label="Detalles" value={paymentDetails} />
        </View>

        {/* Timestamps */}
        <View style={styles.detailCard}>
          <Text style={styles.detailCardTitle}>Registro</Text>
          <DetailRow
            label="Creado"
            value={
              createdAt
                ? new Date(createdAt).toLocaleString('es-AR', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : '-'
            }
          />
          <DetailRow
            label="Actualizado"
            value={
              updatedAt
                ? new Date(updatedAt).toLocaleString('es-AR', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : '-'
            }
          />
          <DetailRow label="ID" value={claim.id} mono />
        </View>

        {/* Error info */}
        {claim.error && (
          <View style={styles.detailCard}>
            <Text style={styles.detailCardTitle}>Error</Text>
            <View style={styles.errorBox}>
              <Ionicons name="close-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{claim.error}</Text>
            </View>
          </View>
        )}

        {/* Terminal status info */}
        {isTerminal && (
          <View style={[styles.terminalCard, { borderColor: statusConfig.color + '30' }]}>
            <Ionicons
              name={status === 'COMPLETED' ? 'checkmark-circle' : 'close-circle'}
              size={22}
              color={statusConfig.color}
            />
            <View style={styles.terminalTextContainer}>
              <Text style={[styles.terminalTitle, { color: statusConfig.color }]}>
                {statusConfig.label}
              </Text>
              {claim.rejectionReason && (
                <Text style={styles.terminalSubtitle}>
                  Motivo: {claim.rejectionReason}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Reject reason input */}
        {showRejectInput && !isTerminal && (
          <View style={styles.detailCard}>
            <Text style={styles.inputLabel}>Motivo de rechazo *</Text>
            <TextInput
              style={styles.rejectInput}
              placeholder="Ingresa el motivo del rechazo..."
              placeholderTextColor={colors.placeholder}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={rejectReason}
              onChangeText={setRejectReason}
            />
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Action buttons (fixed at bottom) */}
      {!isTerminal && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
          {isProcessing ? (
            <View style={[styles.actionBtn, styles.processingBtn]}>
              <ActivityIndicator size="small" color={colors.white} />
              <Text style={styles.actionBtnText}>Procesando...</Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn]}
                activeOpacity={0.7}
                onPress={handleReject}
              >
                <Ionicons name="close-circle" size={20} color={colors.white} />
                <Text style={styles.actionBtnText}>Rechazar</Text>
              </TouchableOpacity>

              {status === 'VERIFIED' && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.primaryBtn]}
                  activeOpacity={0.7}
                  onPress={handleProcessWithdrawal}
                >
                  <Ionicons name="arrow-forward-circle" size={20} color={colors.white} />
                  <Text style={styles.actionBtnText}>Procesar Retiro</Text>
                </TouchableOpacity>
              )}

              {status === 'PROCESSING' && (
                <View style={[styles.actionBtn, styles.waitingBtn]}>
                  <ActivityIndicator size="small" color={colors.chipProcessing} />
                  <Text style={[styles.actionBtnText, { color: colors.chipProcessing }]}>Retirando fichas...</Text>
                </View>
              )}

              {status === 'CHIPS_WITHDRAWN' && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.successBtn]}
                  activeOpacity={0.7}
                  onPress={handleMarkPaid}
                >
                  <Ionicons name="checkmark-circle" size={20} color={colors.white} />
                  <Text style={styles.actionBtnText}>Marcar Pagado</Text>
                </TouchableOpacity>
              )}

              {status === 'FAILED' && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.primaryBtn]}
                  activeOpacity={0.7}
                  onPress={handleRetry}
                >
                  <Ionicons name="refresh" size={20} color={colors.white} />
                  <Text style={styles.actionBtnText}>Reintentar</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ---- Sub-components ----

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={detailRowStyles.row}>
      <Text style={detailRowStyles.label}>{label}</Text>
      <Text
        style={[detailRowStyles.value, mono && detailRowStyles.mono]}
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  // Amount card
  amountCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  amountCardLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
    fontWeight: '500',
  },
  amountCardRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  amountCardSymbol: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
  },
  amountCardValue: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.textPrimary,
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
  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.error + '10',
    padding: 12,
    borderRadius: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
  // Terminal status
  terminalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  terminalTextContainer: {
    flex: 1,
  },
  terminalTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  terminalSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  // Reject input
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  rejectInput: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingTop: 12,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 80,
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
  actionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  rejectBtn: {
    backgroundColor: colors.error,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
  },
  successBtn: {
    backgroundColor: colors.success,
  },
  processingBtn: {
    backgroundColor: colors.chipProcessing,
  },
  waitingBtn: {
    backgroundColor: colors.chipProcessing + '20',
    borderWidth: 1,
    borderColor: colors.chipProcessing + '40',
  },
});
