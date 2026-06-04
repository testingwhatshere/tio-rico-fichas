import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated, TouchableOpacity, Linking } from 'react-native';

import colors from '@/constants/colors';
import { useRequestStore } from '@/stores/request.store';
import { hapticSuccess, hapticError } from '@/utils/haptics';
import { playSuccess, playError } from '@/utils/sounds';
import CelebrationEffect from '@/components/effects/CelebrationEffect';

type RequestStatus =
  | 'PENDING_PROOF'
  | 'VALIDATING'
  | 'PENDING_MP_VERIFICATION'
  | 'VALIDATION_FAILED'
  | 'APPROVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';

interface StatusTrackerCardProps {
  status?: RequestStatus;
  requestId?: string;
  statusMessage?: string;
  supportPhone?: string;
}

export default function StatusTrackerCard({
  status: statusProp,
  requestId,
  statusMessage,
  supportPhone,
}: StatusTrackerCardProps) {
  const storeRequest = useRequestStore((state) =>
    requestId ? state.requests[requestId] : undefined,
  );
  const storeStatus = storeRequest?.status;
  const discoveryMessage = storeRequest?.discoveryMessage;
  const discoveryStatus = storeRequest?.discoveryStatus;
  const status = (storeStatus || statusProp || 'VALIDATING') as RequestStatus;

  // Completion/error animation + haptic
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const prevStatusRef = useRef(status);

  useEffect(() => {
    if (prevStatusRef.current !== status) {
      if (status === 'COMPLETED') {
        hapticSuccess();
        playSuccess();
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.05, duration: 200, useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
      } else if (status === 'FAILED' || status === 'REJECTED') {
        hapticError();
        playError();
      }
      prevStatusRef.current = status;
    }
  }, [status]);

  // Pulsing glow for active step dots
  useEffect(() => {
    if (status === 'VALIDATING' || status === 'PENDING_MP_VERIFICATION' || status === 'PROCESSING') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.8, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [status]);

  const getStatusConfig = () => {
    switch (status) {
      case 'PENDING_PROOF':
        return {
          color: colors.warning,
          icon: '📤',
          label: 'Esperando comprobante',
          message: statusMessage || 'Esperando comprobante de pago...',
          showSpinner: false,
        };
      case 'VALIDATING':
        return {
          color: colors.info,
          icon: '⏳',
          label: 'Verificando pago',
          message: statusMessage || 'Estamos revisando tu comprobante. Puede tardar unos segundos...',
          showSpinner: true,
        };
      case 'PENDING_MP_VERIFICATION':
        return {
          color: colors.info,
          icon: '🏦',
          label: 'Verificando pago',
          message: statusMessage || 'Comprobante validado. Verificando que el pago haya llegado...',
          showSpinner: true,
        };
      case 'APPROVED':
        return {
          color: discoveryStatus === 'SEARCHING' ? colors.info : colors.success,
          icon: discoveryStatus === 'SEARCHING' ? '🔍' : '✅',
          label: discoveryStatus === 'SEARCHING' ? 'Buscando perfil' : 'Pago verificado',
          message: statusMessage || discoveryMessage || 'Tu pago fue verificado. Preparando la carga de fichas...',
          showSpinner: discoveryStatus === 'SEARCHING',
        };
      case 'PROCESSING':
        return {
          color: colors.primary,
          icon: '🔄',
          label: 'Cargando fichas',
          message: statusMessage || 'Estamos cargando las fichas en tu cuenta. No cierres la app...',
          showSpinner: true,
        };
      case 'COMPLETED':
        return {
          color: colors.success,
          icon: '🎉',
          label: 'Listo!',
          message: statusMessage || 'Tus fichas ya estan en tu cuenta!',
          showSpinner: false,
        };
      case 'FAILED':
        return {
          color: colors.error,
          icon: discoveryStatus === 'NOT_FOUND' ? '🔍' : '❌',
          label: discoveryStatus === 'NOT_FOUND' ? 'Perfil no encontrado' : 'Hubo un problema',
          message: statusMessage || discoveryMessage || 'No pudimos cargar las fichas. Un operador va a revisar tu caso.',
          showSpinner: false,
        };
      case 'VALIDATION_FAILED':
        return {
          color: colors.warning,
          icon: '⚠️',
          label: 'Revision manual',
          message: statusMessage || 'No pudimos verificar tu comprobante automaticamente. Un operador lo va a revisar en unos minutos.',
          showSpinner: false,
        };
      case 'REJECTED':
        return {
          color: colors.error,
          icon: '🚫',
          label: 'Rechazado',
          message: statusMessage || 'Tu solicitud fue rechazada. Podes intentar de nuevo con un comprobante valido.',
          showSpinner: false,
        };
      case 'CANCELLED':
        return {
          color: colors.textMuted,
          icon: '🔙',
          label: 'Cancelada',
          message: statusMessage || 'Cancelaste esta solicitud.',
          showSpinner: false,
        };
      default:
        return {
          color: colors.textSecondary,
          icon: '📋',
          label: 'Pendiente',
          message: statusMessage || 'Esperando...',
          showSpinner: false,
        };
    }
  };

  const config = getStatusConfig();

  // Steps for progress display
  const isValidating = status === 'VALIDATING';
  const isMpVerifying = status === 'PENDING_MP_VERIFICATION';
  const isProcessing = status === 'PROCESSING';

  const steps = [
    { label: 'Comprobante recibido', done: true },
    {
      label: isValidating ? 'Validando comprobante' : 'Comprobante validado',
      done: !isValidating,
      active: isValidating,
    },
    ...(isMpVerifying || isProcessing || status === 'APPROVED'
      ? [{
          label: isMpVerifying ? 'Verificando pago' : 'Pago verificado',
          done: !isMpVerifying,
          active: isMpVerifying,
        }]
      : []),
    ...(isProcessing
      ? [{ label: 'Cargando fichas', done: false, active: true }]
      : []),
  ];

  const showSteps = isValidating || isMpVerifying || isProcessing;

  return (
    <Animated.View style={[styles.container, { borderColor: config.color, transform: [{ scale: scaleAnim }] }]}>
      {/* Status Header */}
      <View style={styles.header}>
        <View style={[styles.statusBadge, { backgroundColor: config.color }]}>
          <Text style={styles.statusIcon}>{config.icon}</Text>
          <Text style={styles.statusLabel}>{config.label}</Text>
        </View>
      </View>

      {/* Status Message */}
      <View style={styles.messageContainer}>
        {config.showSpinner && (
          <ActivityIndicator
            size="small"
            color={config.color}
            style={styles.spinner}
          />
        )}
        <Text style={styles.message}>{config.message}</Text>
      </View>

      {/* Progress Steps */}
      {showSteps && (
        <View style={styles.stepsContainer}>
          {steps.map((step, idx) => (
            <View key={idx}>
              {idx > 0 && (
                <View
                  style={[
                    styles.stepLine,
                    step.done && styles.stepLineComplete,
                    step.active && styles.stepLineActive,
                  ]}
                />
              )}
              <View style={styles.step}>
                <View style={styles.stepDotOuter}>
                  {step.active && (
                    <Animated.View style={[styles.stepDotGlow, { opacity: pulseAnim }]} />
                  )}
                  <View
                    style={[
                      styles.stepDot,
                      step.done && { backgroundColor: colors.success },
                      step.active && styles.stepDotActive,
                    ]}
                  />
                  {(step.active || step.done) && <View style={styles.stepDotInner} />}
                </View>
                <Text
                  style={[
                    styles.stepText,
                    step.active && styles.stepTextActive,
                  ]}
                >
                  {step.label}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Completion Message + Confetti */}
      {status === 'COMPLETED' && (
        <>
          <CelebrationEffect />
          <View style={styles.completionBox}>
            <Text style={styles.completionText}>
              Las fichas fueron cargadas exitosamente a tu cuenta.
            </Text>
          </View>
        </>
      )}

      {/* Error Message */}
      {(status === 'FAILED' || status === 'VALIDATION_FAILED' || status === 'REJECTED') && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {status === 'VALIDATION_FAILED'
              ? 'Un operador va a revisar tu comprobante. Te vamos a avisar cuando haya una respuesta. No hace falta que hagas nada.'
              : status === 'REJECTED'
              ? 'Podes crear una nueva solicitud desde el boton "Cargar Fichas".'
              : 'Un operador ya fue notificado y va a revisar tu caso. Te avisamos apenas se resuelva.'}
          </Text>
          {supportPhone ? (
            <TouchableOpacity
              onPress={() => {
                const tel = supportPhone.replace(/[^\d+]/g, '');
                Linking.openURL(`tel:${tel}`);
              }}
              style={styles.supportLink}
              activeOpacity={0.7}
            >
              <Text style={styles.supportLinkText}>Soporte: {supportPhone}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    gap: 16,
  },
  header: {
    alignItems: 'flex-start',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  statusIcon: {
    fontSize: 16,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
    textTransform: 'uppercase',
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  spinner: {
    // Spinner spacing handled by gap
  },
  message: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  stepsContainer: {
    gap: 0,
    paddingLeft: 8,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  stepDotOuter: {
    width: 14,
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.separator,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
  },
  stepDotGlow: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.goldGlow,
  },
  stepDotInner: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.white,
  },
  stepText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  stepTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  stepLine: {
    width: 3,
    height: 16,
    backgroundColor: colors.separator,
    marginLeft: 5.5,
    borderRadius: 1.5,
  },
  stepLineComplete: {
    backgroundColor: colors.success,
  },
  stepLineActive: {
    backgroundColor: colors.primary,
  },
  completionBox: {
    backgroundColor: colors.surfaceElevated,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  completionText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: colors.surfaceElevated,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  supportLink: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.primaryGlow,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  supportLinkText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
});
