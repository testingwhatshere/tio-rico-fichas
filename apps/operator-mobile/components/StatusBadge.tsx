import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import colors from '@/constants/colors';

const STATUS_COLORS: Record<string, string> = {
  // Request statuses
  PENDING_PROOF: colors.textMuted,
  VALIDATING: colors.info,
  VALIDATION_FAILED: colors.warning,
  APPROVED: colors.chipCompleted,
  PROCESSING: colors.chipProcessing,
  COMPLETED: colors.chipCompleted,
  FAILED: colors.chipFailed,
  REJECTED: colors.chipFailed,

  // Job statuses
  QUEUED: colors.chipPending,

  // Failure types
  VALIDATION_FAILURE: colors.warning,
  JOB_FAILURE: colors.chipFailed,

  // Bot statuses
  connected: colors.chipCompleted,
  disconnected: colors.chipFailed,
  idle: colors.chipCompleted,
  busy: colors.chipProcessing,

  // Generic
  active: colors.chipCompleted,
  inactive: colors.textMuted,
  pending: colors.chipPending,
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_PROOF: 'Esperando prueba',
  VALIDATING: 'Validando',
  VALIDATION_FAILED: 'Validacion fallida',
  APPROVED: 'Aprobado',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelada',
  QUEUED: 'En cola',
  VALIDATION_FAILURE: 'Validacion',
  JOB_FAILURE: 'Ejecucion',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  idle: 'Disponible',
  busy: 'Ocupado',
  active: 'Activo',
  inactive: 'Inactivo',
  pending: 'Pendiente',
};

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  label?: string;
}

export default function StatusBadge({ status, size = 'md', label }: StatusBadgeProps) {
  const bgColor = STATUS_COLORS[status] || colors.textMuted;
  const displayLabel = label || STATUS_LABELS[status] || status;
  const isSm = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: bgColor + '25' }, isSm && styles.badgeSm]}>
      <View style={[styles.dot, { backgroundColor: bgColor }]} />
      <Text
        style={[styles.label, { color: bgColor }, isSm && styles.labelSm]}
        numberOfLines={1}
      >
        {displayLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  labelSm: {
    fontSize: 10,
  },
});
