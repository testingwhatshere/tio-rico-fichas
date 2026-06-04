import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { hapticLight, hapticMedium } from '@/utils/haptics';
import { getSocket } from '@/services/socket';
import { formatAmount, MAX_INPUT_AMOUNT } from '@/utils/amount';

interface PrizeAmountCardProps {
  onAmountSelected?: (amount: number) => void | Promise<void>;
  isDisabled?: boolean;
  initialAmount?: number;
}

export default function PrizeAmountCard({
  onAmountSelected,
  isDisabled = false,
  initialAmount,
}: PrizeAmountCardProps) {
  const [amount, setAmount] = useState(initialAmount?.toString() || '');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
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
    setError(null);
  };

  const handleContinue = async () => {
    if (processingRef.current) return;

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

    hapticMedium();
    processingRef.current = true;
    setIsProcessing(true);
    try {
      if (onAmountSelected) {
        await onAmountSelected(amountNum);
      } else {
        // Send as user message so the AI bot picks it up as claim_prize intent
        const socket = getSocket();
        if (socket) {
          socket.emit('send_message', {
            content: `Quiero cobrar ${amountNum}`,
          });
        }
      }
    } catch (e) {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  if (isDisabled) {
    const amountNum = parseInt(amount) || 0;
    return (
      <View style={[styles.container, styles.containerDisabled]}>
        <Text style={styles.disabledText}>
          Monto a cobrar: ${formatAmount(amountNum)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.stepIndicator}>
        <Ionicons name="trophy-outline" size={16} color={colors.accent} />
        <Text style={styles.stepText}>Paso 1 de 2: Cuanto queres cobrar?</Text>
      </View>

      <View style={styles.presetsContainer}>
        <Text style={styles.presetsLabel}>Montos rapidos</Text>
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
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>O ingresa otro monto</Text>
        <View style={[styles.amountInputWrapper, isFocused && styles.inputFocused, error ? styles.inputError : null]}>
          <Text style={[styles.currencySymbol, isFocused && styles.currencyFocused]}>$</Text>
          <TextInput
            style={styles.input}
            placeholder="1000"
            placeholderTextColor={colors.textMuted}
            value={amount}
            onChangeText={handleAmountChange}
            keyboardType="numeric"
            maxLength={9}
            returnKeyType="done"
            onSubmitEditing={handleContinue}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Text style={styles.helpText}>Mínimo $3.000 — Solo números enteros</Text>
      </View>

      <TouchableOpacity
        style={[styles.buttonOuter, isProcessing && styles.buttonDisabled]}
        onPress={handleContinue}
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
  presetsContainer: {
    marginBottom: 16,
  },
  presetsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 10,
  },
  presetsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  chipButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
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
    borderRadius: 30,
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
    fontSize: 13,
    fontWeight: '800',
    color: colors.accent,
  },
  chipTextActive: {
    color: colors.primaryLight,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  amountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.separator,
    borderRadius: 12,
    backgroundColor: colors.background,
    height: 48,
  },
  inputFocused: {
    borderColor: colors.accent,
  },
  inputError: {
    borderColor: colors.error,
  },
  currencySymbol: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textMuted,
    paddingLeft: 14,
    marginRight: 4,
  },
  currencyFocused: {
    color: colors.accent,
  },
  input: {
    flex: 1,
    height: 48,
    paddingRight: 16,
    fontSize: 20,
    color: colors.textPrimary,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },
  helpText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  buttonOuter: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.goldGlowStrong,
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
