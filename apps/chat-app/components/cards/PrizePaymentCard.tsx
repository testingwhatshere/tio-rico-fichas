import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getSocket } from '@/services/socket';
import { useAuthStore } from '@/stores/auth.store';

import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { hapticLight, hapticMedium } from '@/utils/haptics';
import { formatAmount } from '@/utils/amount';

interface PrizePaymentCardProps {
  claimId: string;
  amount?: number;
  onSubmit?: (data: { paymentMethod: string; paymentDetails: any }) => void | Promise<void>;
  isDisabled?: boolean;
}

export default function PrizePaymentCard({
  claimId,
  amount,
  onSubmit,
  isDisabled = false,
}: PrizePaymentCardProps) {
  const [method, setMethod] = useState<'CBU' | 'ALIAS'>('CBU');
  const [cbu, setCbu] = useState('');
  const [alias, setAlias] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const processingRef = useRef(false);

  const handleSubmit = async () => {
    if (processingRef.current) return;

    // Validate
    if (!accountHolder.trim()) {
      setError('Ingresa el titular de la cuenta');
      return;
    }

    if (method === 'CBU') {
      const cleanCbu = cbu.replace(/\s/g, '');
      if (!cleanCbu || cleanCbu.length !== 22) {
        setError('El CBU debe tener 22 digitos');
        return;
      }
    } else {
      if (!alias.trim() || alias.trim().length < 6) {
        setError('El alias debe tener al menos 6 caracteres');
        return;
      }
    }

    hapticMedium();
    processingRef.current = true;
    setIsProcessing(true);
    setError(null);

    try {
      const paymentDetails: any = { accountHolder: accountHolder.trim() };
      if (method === 'CBU') {
        paymentDetails.cbu = cbu.replace(/\s/g, '');
      } else {
        paymentDetails.alias = alias.trim();
      }

      if (onSubmit) {
        await onSubmit({ paymentMethod: method, paymentDetails });
        setSubmitted(true);
      } else {
        // Emit directly via socket to backend
        const socket = getSocket();
        const userId = useAuthStore.getState().user?.id;
        if (!socket) throw new Error('Sin conexion');
        if (!userId) throw new Error('No autenticado');

        socket.emit('send_message', {
          content: `Datos de pago: ${method === 'CBU' ? `CBU ${paymentDetails.cbu}` : `Alias ${paymentDetails.alias}`} - Titular: ${paymentDetails.accountHolder}`,
        });

        // The operator panel AI will pick up this message and call bot:set_prize_payment
        // But for reliability, also emit a structured event that the backend can handle directly
        socket.emit('prize_claim:set_payment', {
          claimId,
          userId,
          paymentMethod: method,
          paymentDetails,
        });

        setSubmitted(true);
      }
    } catch (e: any) {
      setError(e.message || 'Error al enviar datos de pago');
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  if (isDisabled || submitted) {
    return (
      <View style={[styles.container, styles.containerDisabled]}>
        <View style={styles.stepIndicator}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success || '#10b981'} />
          <Text style={[styles.stepText, { color: colors.success || '#10b981' }]}>Datos de pago enviados</Text>
        </View>
        <Text style={styles.disabledText}>
          {method === 'CBU' ? `CBU: ...${cbu.slice(-4)}` : `Alias: ${alias}`} - {accountHolder}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.stepIndicator}>
        <Ionicons name="wallet-outline" size={16} color={colors.accent} />
        <Text style={styles.stepText}>Paso 2 de 2: Donde te mandamos la plata?</Text>
      </View>

      {amount && (
        <View style={styles.amountBadge}>
          <Text style={styles.amountText}>Premio: ${formatAmount(amount)}</Text>
        </View>
      )}

      {/* Method toggle */}
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[styles.toggleButton, method === 'CBU' && styles.toggleActive]}
          onPress={() => { hapticLight(); setMethod('CBU'); setError(null); }}
        >
          <Text style={[styles.toggleText, method === 'CBU' && styles.toggleTextActive]}>CBU</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, method === 'ALIAS' && styles.toggleActive]}
          onPress={() => { hapticLight(); setMethod('ALIAS'); setError(null); }}
        >
          <Text style={[styles.toggleText, method === 'ALIAS' && styles.toggleTextActive]}>Alias</Text>
        </TouchableOpacity>
      </View>

      {/* Account holder */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Titular de la cuenta</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Nombre completo"
          placeholderTextColor={colors.textMuted}
          value={accountHolder}
          onChangeText={(t) => { setAccountHolder(t); setError(null); }}
          autoCapitalize="words"
        />
      </View>

      {/* CBU or Alias input */}
      {method === 'CBU' ? (
        <View style={styles.inputGroup}>
          <Text style={styles.label}>CBU (22 digitos)</Text>
          <TextInput
            style={styles.textInput}
            placeholder="0000000000000000000000"
            placeholderTextColor={colors.textMuted}
            value={cbu}
            onChangeText={(t) => { setCbu(t.replace(/[^0-9]/g, '')); setError(null); }}
            keyboardType="numeric"
            maxLength={22}
          />
        </View>
      ) : (
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Alias de MercadoPago o banco</Text>
          <TextInput
            style={styles.textInput}
            placeholder="mi.alias.mp"
            placeholderTextColor={colors.textMuted}
            value={alias}
            onChangeText={(t) => { setAlias(t); setError(null); }}
            autoCapitalize="none"
          />
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.buttonOuter, isProcessing && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={isProcessing}
        activeOpacity={0.7}
      >
        <View style={[styles.button, { backgroundColor: colors.accent }]}>
          {isProcessing ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <View style={styles.buttonContent}>
              <Ionicons name="send" size={16} color={colors.textOnPrimary} />
              <Text style={styles.buttonText}>CONFIRMAR</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  containerDisabled: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.separator,
    opacity: 0.7,
  },
  disabledText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  stepText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  amountBadge: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  amountText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  toggleContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: colors.background,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleActive: {
    backgroundColor: colors.accent,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.textOnPrimary,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.separator,
    height: 44,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    marginBottom: 8,
  },
  buttonOuter: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.goldGlowStrong,
    marginTop: 4,
  },
  button: {
    height: 48,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
});
