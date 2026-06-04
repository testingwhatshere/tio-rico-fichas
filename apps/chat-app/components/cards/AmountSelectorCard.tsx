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
import { formatAmount, MAX_INPUT_AMOUNT } from '@/utils/amount';

interface AmountSelectorCardProps {
  onAmountSelected: (amount: number) => void | Promise<void>;
  isDisabled?: boolean;
  initialAmount?: number;
}

export default function AmountSelectorCard({
  onAmountSelected,
  isDisabled = false,
  initialAmount,
}: AmountSelectorCardProps) {
  const [amount, setAmount] = useState(initialAmount?.toString() || '');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const processingRef = useRef(false);

  const presetAmounts = [1000, 2000, 5000, 10000];

  const handleAmountChange = (text: string) => {
    // Handle pasted numbers with thousand/decimal separators
    // Last comma/period is decimal separator UNLESS followed by exactly 3 digits (thousands)
    // e.g. "5.000,50" → "5000", "10.000" → "10000", "5000.5" → "5000"
    const lastSep = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
    const afterSep = lastSep >= 0 ? text.slice(lastSep + 1) : '';
    const isThousandsSep = afterSep.replace(/[^0-9]/g, '').length === 3;
    const integerPart = lastSep >= 0 && !isThousandsSep ? text.slice(0, lastSep) : text;
    const cleaned = integerPart.replace(/[^0-9]/g, '');
    setAmount(cleaned);
    if (error) {
      setError(null);
    }
  };

  const handlePresetAmount = (preset: number) => {
    hapticLight();
    setAmount(preset.toString());
    setError(null);
  };

  const handleContinue = async () => {
    if (processingRef.current) return;

    const amountNum = Math.floor(parseFloat(amount) || 0);

    if (!amount) {
      setError('Ingresá un monto');
      return;
    }

    if (isNaN(amountNum)) {
      setError('Ingresá un número válido');
      return;
    }

    if (amountNum < 1000) {
      setError('Mínimo $1.000');
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
      await onAmountSelected(amountNum);
    } catch (e) {
      // error handled upstream
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  if (isDisabled) {
    const amountNum = parseFloat(amount) || 0;
    return (
      <View style={[styles.container, styles.containerDisabled]}>
        <Text style={styles.disabledText}>
          Monto seleccionado: ${formatAmount(amountNum)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        <Ionicons name="diamond-outline" size={16} color={colors.primary} />
        <Text style={styles.stepText}>Paso 1 de 3: Elegí cuanto cargar</Text>
      </View>

      {/* Casino Chip Buttons */}
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
                    ${formatAmount(preset)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Custom Amount Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>O ingresá otro monto</Text>
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
        <Text style={styles.helpText}>Mínimo $1.000 — Solo números enteros</Text>
      </View>

      {/* Continue Button */}
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
              <Text style={styles.buttonText}>CONTINUAR</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.textOnPrimary} />
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
    borderColor: colors.primary,
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
    color: colors.primary,
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
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    borderColor: colors.chipBorder,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 3,
  },
  chipButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.chipBackground,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  chipInnerRing: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: colors.chipBorder,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipInnerRingActive: {
    borderColor: colors.primary,
    borderStyle: 'solid',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
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
    borderColor: colors.primary,
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
    color: colors.primary,
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
