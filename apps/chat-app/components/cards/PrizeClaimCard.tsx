import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getSocket } from '@/services/socket';
import { useAuthStore } from '@/stores/auth.store';

import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { hapticLight, hapticMedium, hapticSuccess } from '@/utils/haptics';
import { formatAmount, MAX_INPUT_AMOUNT } from '@/utils/amount';

interface PrizeClaimCardProps {
  isDisabled?: boolean;
  initialAmount?: number;
  onCancel?: () => void;
  onSubmit?: (data: {
    amount: number;
    paymentMethod: 'CBU' | 'ALIAS';
    paymentDetails: { cbu?: string; alias?: string; accountHolder: string };
  }) => void | Promise<void>;
}

export default function PrizeClaimCard({
  isDisabled = false,
  initialAmount,
  onCancel,
  onSubmit,
}: PrizeClaimCardProps) {
  // Amount state
  const [amount, setAmount] = useState(initialAmount?.toString() || '');
  const [amountFocused, setAmountFocused] = useState(false);

  // Payment state
  const [method, setMethod] = useState<'CBU' | 'ALIAS'>('CBU');
  const [cbu, setCbu] = useState('');
  const [alias, setAlias] = useState('');
  const [accountHolder, setAccountHolder] = useState('');

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const processingRef = useRef(false);

  const presetAmounts = [3000, 5000, 10000, 25000];

  const handleAmountChange = (text: string) => {
    const lastSep = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
    const afterSep = lastSep >= 0 ? text.slice(lastSep + 1) : '';
    const isThousandsSep = afterSep.replace(/[^0-9]/g, '').length === 3;
    const integerPart = lastSep >= 0 && !isThousandsSep ? text.slice(0, lastSep) : text;
    const cleaned = integerPart.replace(/[^0-9]/g, '');
    setAmount(cleaned);
    if (error) setError(null);
  };

  const handlePresetAmount = (preset: number) => {
    hapticLight();
    setAmount(preset.toString());
    if (error) setError(null);
  };

  const handleSubmit = async () => {
    if (processingRef.current) return;

    // Validate amount
    const amountNum = parseInt(amount, 10);
    if (!amount) {
      setError('Ingresá un monto');
      return;
    }
    if (isNaN(amountNum)) {
      setError('Ingresá un número válido');
      return;
    }
    if (amountNum < 3000) {
      setError('Mínimo $3.000');
      return;
    }
    if (amountNum > MAX_INPUT_AMOUNT) {
      setError(`Máximo $${formatAmount(MAX_INPUT_AMOUNT)}`);
      return;
    }

    // Validate account holder
    if (!accountHolder.trim()) {
      setError('Ingresá el titular de la cuenta');
      return;
    }

    // Validate CBU/Alias
    if (method === 'CBU') {
      const cleanCbu = cbu.replace(/\s/g, '');
      if (!cleanCbu || cleanCbu.length !== 22) {
        setError('El CBU debe tener 22 dígitos');
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
        await onSubmit({ amount: amountNum, paymentMethod: method, paymentDetails });
        hapticSuccess();
        setSubmitted(true);
      } else {
        const socket = getSocket();
        const claimData = { amount: amountNum, paymentMethod: method, paymentDetails };

        if (socket?.connected) {
          // Primary: socket-based creation
          const timeout = setTimeout(() => {
            if (processingRef.current) {
              setError('No se recibio respuesta del servidor. Reintenta.');
              processingRef.current = false;
              setIsProcessing(false);
            }
          }, 10000);

          socket.emit(
            'prize_claim:create_unified',
            claimData,
            (response: any) => {
              clearTimeout(timeout);
              if (response?.success) {
                hapticSuccess();
                setSubmitted(true);
                if (onCancel) setTimeout(() => onCancel(), 1500);
              } else {
                setError(response?.error || 'No se pudo crear la solicitud');
                processingRef.current = false;
                setIsProcessing(false);
              }
            },
          );
        } else {
          // Fallback: HTTP when socket is disconnected
          const { prizeClaimsApi } = require('../../services/api');
          const result = await prizeClaimsApi.create(claimData);
          if (result?.id) {
            hapticSuccess();
            setSubmitted(true);
            if (onCancel) setTimeout(() => onCancel(), 1500);
          } else {
            throw new Error('No se pudo crear la solicitud');
          }
        }
      }
    } catch (e: any) {
      setError(e.message || 'Error al enviar solicitud');
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Disabled/submitted state
  if (isDisabled || submitted) {
    const amountNum = parseInt(amount) || 0;
    return (
      <View style={[styles.container, styles.containerDisabled]}>
        <View style={styles.stepIndicator}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success || '#10b981'} />
          <Text style={[styles.stepText, { color: colors.success || '#10b981' }]}>
            Solicitud de cobro enviada
          </Text>
        </View>
        <Text style={styles.disabledText}>
          Premio: ${formatAmount(amountNum)} — {method === 'CBU' ? `CBU: ...${cbu.slice(-4)}` : `Alias: ${alias}`} — {accountHolder}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.stepIndicator}>
        <Ionicons name="trophy-outline" size={16} color={colors.accent} />
        <Text style={styles.stepText}>Cobrar Premio</Text>
      </View>

      {/* Requirements notice */}
      <View style={styles.requirementsBox}>
        <Ionicons name="information-circle-outline" size={16} color={colors.warning || '#f59e0b'} />
        <Text style={styles.requirementsText}>
          Para cobrar, necesitas tener fichas en tu cuenta del casino. Minimo $3.000.
        </Text>
      </View>

      {/* Amount section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Cuanto queres cobrar?</Text>
        <View style={styles.presetsGrid}>
          {presetAmounts.map((preset) => {
            const isActive = amount === preset.toString();
            return (
              <TouchableOpacity
                key={preset}
                style={[styles.chipButton, isActive && styles.chipButtonActive]}
                onPress={() => handlePresetAmount(preset)}
                activeOpacity={0.7}
              >
                <View style={[styles.chipInnerRing, isActive && styles.chipInnerRingActive]}>
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    ${preset >= 1000 ? `${Math.floor(preset / 1000)}k` : preset}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.inputLabel}>O ingresá otro monto</Text>
        <View style={[styles.amountInputWrapper, amountFocused && styles.inputFocused]}>
          <Text style={[styles.currencySymbol, amountFocused && styles.currencyFocused]}>$</Text>
          <TextInput
            style={styles.amountInput}
            placeholder="3000"
            placeholderTextColor={colors.textMuted}
            value={amount}
            onChangeText={handleAmountChange}
            keyboardType="numeric"
            maxLength={9}
            returnKeyType="next"
            onFocus={() => setAmountFocused(true)}
            onBlur={() => setAmountFocused(false)}
          />
        </View>
        <Text style={styles.helpText}>Mínimo $3.000 — Solo números enteros</Text>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Payment section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Dónde te mandamos la plata?</Text>

        {/* Account holder */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Nombre completo del titular</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Nombre y Apellido"
            placeholderTextColor={colors.textMuted}
            value={accountHolder}
            onChangeText={(t) => { setAccountHolder(t); if (error) setError(null); }}
            autoCapitalize="words"
          />
        </View>

        {/* Method toggle */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, method === 'CBU' && styles.toggleActive]}
            onPress={() => { hapticLight(); setMethod('CBU'); if (error) setError(null); }}
          >
            <Text style={[styles.toggleText, method === 'CBU' && styles.toggleTextActive]}>CBU</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, method === 'ALIAS' && styles.toggleActive]}
            onPress={() => { hapticLight(); setMethod('ALIAS'); if (error) setError(null); }}
          >
            <Text style={[styles.toggleText, method === 'ALIAS' && styles.toggleTextActive]}>Alias</Text>
          </TouchableOpacity>
        </View>

        {/* CBU or Alias input */}
        {method === 'CBU' ? (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>CBU (22 dígitos)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0000000000000000000000"
              placeholderTextColor={colors.textMuted}
              value={cbu}
              onChangeText={(t) => { setCbu(t.replace(/[^0-9]/g, '')); if (error) setError(null); }}
              keyboardType="numeric"
              maxLength={22}
            />
          </View>
        ) : (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Alias de MercadoPago o banco</Text>
            <TextInput
              style={styles.textInput}
              placeholder="mi.alias.mp"
              placeholderTextColor={colors.textMuted}
              value={alias}
              onChangeText={(t) => { setAlias(t); if (error) setError(null); }}
              autoCapitalize="none"
            />
          </View>
        )}
      </View>

      {/* Error */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Submit button */}
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
              <Ionicons name="trophy" size={18} color={colors.textOnPrimary} />
              <Text style={styles.buttonText}>COBRAR PREMIO</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Cancel button */}
      {onCancel && !isProcessing && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onCancel}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelText}>Cancelar</Text>
        </TouchableOpacity>
      )}
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
    fontSize: 13,
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
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  section: {
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 10,
  },
  presetsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 12,
  },
  chipButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2.5,
    borderColor: colors.chipBorder,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 3,
  },
  chipButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.chipBackground,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  chipInnerRing: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: colors.chipBorder,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipInnerRingActive: {
    borderColor: colors.accent,
    borderStyle: 'solid',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.accent,
  },
  chipTextActive: {
    color: colors.primaryLight,
  },
  amountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.separator,
    borderRadius: 12,
    backgroundColor: colors.background,
    height: 44,
  },
  inputFocused: {
    borderColor: colors.accent,
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textMuted,
    paddingLeft: 14,
    marginRight: 4,
  },
  currencyFocused: {
    color: colors.accent,
  },
  amountInput: {
    flex: 1,
    height: 44,
    paddingRight: 16,
    fontSize: 18,
    color: colors.textPrimary,
  },
  helpText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.separator,
    marginVertical: 14,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
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
  toggleContainer: {
    flexDirection: 'row',
    marginBottom: 12,
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
  requirementsBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  requirementsText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
