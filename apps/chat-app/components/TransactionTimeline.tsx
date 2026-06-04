import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

interface TimelineEvent {
  id: string;
  status: string;
  createdAt: string;
  changedBy?: string;
  metadata?: any;
}

interface TransactionTimelineProps {
  events: TimelineEvent[];
}

export default function TransactionTimeline({ events }: TransactionTimelineProps) {
  const getEventIcon = (status: string): keyof typeof Ionicons.glyphMap => {
    const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
      'PENDING_PROOF': 'document-outline',
      'VALIDATING': 'shield-checkmark-outline',
      'VALIDATION_FAILED': 'close-circle-outline',
      'PENDING_MP_VERIFICATION': 'cash-outline',
      'APPROVED': 'checkmark-circle-outline',
      'PROCESSING': 'sync-outline',
      'COMPLETED': 'checkmark-done-circle',
      'FAILED': 'close-circle-outline',
      'REJECTED': 'ban-outline',
      'CANCELLED': 'arrow-undo-outline',
    };
    return icons[status] || 'ellipse-outline';
  };

  const getEventLabel = (status: string): string => {
    const labels: Record<string, string> = {
      'PENDING_PROOF': 'Esperando comprobante',
      'VALIDATING': 'Validando pago',
      'VALIDATION_FAILED': 'Validación fallida',
      'PENDING_MP_VERIFICATION': 'Verificando recepción',
      'APPROVED': 'Pago aprobado',
      'PROCESSING': 'Cargando fichas',
      'COMPLETED': 'Fichas cargadas ✓',
      'FAILED': 'Error en el proceso',
      'REJECTED': 'Solicitud rechazada',
      'CANCELLED': 'Cancelada por el usuario',
    };
    return labels[status] || status;
  };

  const getEventColor = (status: string): string => {
    const colors_map: Record<string, string> = {
      'PENDING_PROOF': colors.warning,
      'VALIDATING': colors.info,
      'VALIDATION_FAILED': colors.error,
      'APPROVED': colors.success,
      'PROCESSING': colors.primary,
      'COMPLETED': colors.success,
      'FAILED': colors.error,
      'REJECTED': colors.error,
      'CANCELLED': colors.textMuted,
    };
    return colors_map[status] || colors.textSecondary;
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!events || events.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="time-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyText}>No hay historial disponible</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {events.map((event, index) => {
        const eventColor = getEventColor(event.status);
        const isLast = index === events.length - 1;

        return (
          <View key={event.id} style={styles.eventRow}>
            <View style={styles.iconColumn}>
              <View style={[styles.iconContainer, { borderColor: eventColor }]}>
                <Ionicons
                  name={getEventIcon(event.status)}
                  size={20}
                  color={eventColor}
                />
              </View>
              {!isLast && <View style={styles.connector} />}
            </View>
            <View style={[styles.contentColumn, isLast && styles.contentColumnLast]}>
              <Text style={styles.eventLabel}>{getEventLabel(event.status)}</Text>
              <Text style={styles.eventTimestamp}>{formatTimestamp(event.createdAt)}</Text>
              {event.changedBy && (
                <Text style={styles.eventMeta}>Por operador</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 12,
  },
  eventRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  iconColumn: {
    width: 40,
    alignItems: 'center',
    paddingTop: 4,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connector: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginTop: 4,
    minHeight: 24,
  },
  contentColumn: {
    flex: 1,
    marginLeft: 16,
    paddingTop: 4,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  contentColumnLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  eventLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  eventTimestamp: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  eventMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
});
