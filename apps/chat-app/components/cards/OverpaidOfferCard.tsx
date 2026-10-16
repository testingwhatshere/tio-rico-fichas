/**
 * OverpaidOfferCard
 *
 * El comprobante dice otro monto que el que el jugador eligió cargar (de más o
 * de menos). Le preguntamos si quiere cargar el monto transferido. Aceptar carga
 * ese monto; rechazar manda la carga a un operador.
 */

import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { formatAmount } from '@/utils/amount';
import { hapticLight } from '@/utils/haptics';

interface OverpaidOfferCardProps {
  isDisabled?: boolean;
  requestedAmount: number;
  offeredAmount: number;
  onRespond?: (accept: boolean) => Promise<void>;
}

export default function OverpaidOfferCard({
  isDisabled = false,
  requestedAmount,
  offeredAmount,
  onRespond,
}: OverpaidOfferCardProps) {
  const [answered, setAnswered] = useState<null | 'accept' | 'reject'>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const respond = async (accept: boolean) => {
    if (sendingRef.current || answered || !onRespond) return;
    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    hapticLight();
    try {
      await onRespond(accept);
      setAnswered(accept ? 'accept' : 'reject');
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          'No pudimos enviar tu respuesta. Revisa tu conexion e intenta de nuevo.',
      );
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const locked = isDisabled || !!answered;
  const deMenos = offeredAmount < requestedAmount;

  return (
    <View style={[styles.container, locked && styles.containerDisabled]}>
      <View style={styles.header}>
        <Ionicons name="cash-outline" size={22} color={colors.primary} />
        <Text style={styles.title}>
          {deMenos ? 'Transferiste menos de lo que elegiste' : 'Transferiste mas de lo que elegiste'}
        </Text>
      </View>

      <View style={styles.amounts}>
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Elegiste</Text>
          <Text style={styles.amountValue}>${formatAmount(requestedAmount)}</Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color={colors.textSecondary} />
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Transferiste</Text>
          <Text style={[styles.amountValue, styles.amountOffered]}>
            ${formatAmount(offeredAmount)}
          </Text>
        </View>
      </View>

      <Text style={styles.question}>
        Queres que te carguemos ${formatAmount(offeredAmount)} en fichas?
      </Text>

      {answered === 'accept' && (
        <Text style={styles.answer}>Aceptaste cargar ${formatAmount(offeredAmount)}.</Text>
      )}
      {answered === 'reject' && (
        <Text style={styles.answer}>Listo, un operador va a revisar tu carga.</Text>
      )}

      {!answered && (
        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.button, styles.rejectButton, locked && styles.buttonDisabled]}
            onPress={() => respond(false)}
            disabled={locked || isSending}
            activeOpacity={0.7}
          >
            <Text style={styles.rejectText}>No, que lo vea un operador</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.acceptButton, locked && styles.buttonDisabled]}
            onPress={() => respond(true)}
            disabled={locked || isSending}
            activeOpacity={0.7}
          >
            {isSending ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.acceptText}>Si, cargar ${formatAmount(offeredAmount)}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: 12,
  },
  containerDisabled: {
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  amounts: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingVertical: 12,
  },
  amountBox: {
    alignItems: 'center',
    gap: 2,
  },
  amountLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  amountOffered: {
    color: colors.success,
  },
  question: {
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  answer: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: colors.success,
  },
  rejectButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  acceptText: {
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  rejectText: {
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '600',
    color: colors.textSecondary,
  },
  error: {
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
  },
});
