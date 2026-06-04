import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatAmount, MAX_INPUT_AMOUNT } from '@/utils/amount';
import { api, getErrorMessage } from '@/services/api';
// useAuthStore import removed — balance is never read or shown.
import colors from '@/constants/colors';

export default function WithdrawScreen() {
  const router = useRouter();
  // Balance is intentionally not pulled from the store: we never show it to the user.

  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CBU' | 'ALIAS'>('ALIAS');
  const [cbu, setCbu] = useState('');
  const [alias, setAlias] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [bank, setBank] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateForm = (): boolean => {
    const amountNum = parseInt(amount, 10);

    if (!amount || isNaN(amountNum)) {
      setError('Ingresá un monto válido');
      return false;
    }

    if (amountNum < 3000) {
      setError('Mínimo $3.000');
      return false;
    }

    if (amountNum > MAX_INPUT_AMOUNT) {
      setError(`Máximo $${formatAmount(MAX_INPUT_AMOUNT)}`);
      return false;
    }

    // Balance-based validation removed: never reveal balance to the user.
    // Backend will reject withdrawals exceeding the real balance.

    if (paymentMethod === 'CBU' && (!cbu || cbu.length !== 22)) {
      setError('El CBU debe tener 22 dígitos');
      return false;
    }

    if (paymentMethod === 'ALIAS' && !alias) {
      setError('Ingresá tu alias de MercadoPago o CVU');
      return false;
    }

    if (!accountHolder) {
      setError('Ingresá el titular de la cuenta');
      return false;
    }

    setError(null);
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    Alert.alert(
      'Confirmar Retiro',
      `¿Estás seguro que querés retirar $${formatAmount(parseInt(amount, 10))}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setIsLoading(true);
            try {
              const paymentDetails: any = {
                accountHolder,
              };

              if (paymentMethod === 'CBU') {
                paymentDetails.cbu = cbu;
                paymentDetails.bank = bank;
              } else {
                paymentDetails.alias = alias;
              }

              await api.post('/withdrawals', {
                amount: parseInt(amount, 10),
                paymentMethod,
                paymentDetails,
              });

              Alert.alert(
                '¡Solicitud Enviada!',
                'Tu solicitud de retiro está siendo revisada. Te notificaremos cuando sea aprobada.',
                [{ text: 'OK', onPress: () => { router.back(); } }]
              );
            } catch (err) {
              const errorMessage = getErrorMessage(err);
              Alert.alert('Error', errorMessage);
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleAmountChange = (text: string) => {
    // Handle pasted numbers with thousand/decimal separators — no cents
    const lastSep = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
    const afterSep = lastSep >= 0 ? text.slice(lastSep + 1) : '';
    const isThousandsSep = afterSep.replace(/[^0-9]/g, '').length === 3;
    const integerPart = lastSep >= 0 && !isThousandsSep ? text.slice(0, lastSep) : text;
    const cleaned = integerPart.replace(/[^0-9]/g, '');
    setAmount(cleaned);
    if (error) setError(null);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7} accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Retirar Fichas</Text>
        </View>

        {/* Balance NEVER shown to the user — the operator verifies the real balance
            on Tio Rico when reviewing the withdrawal request. */}

        {/* Amount Input */}
        <View style={styles.section}>
          <Text style={styles.label}>Monto a Retirar</Text>
          <View style={styles.amountInputWrapper}>
            <Text style={styles.currencySymbol}>$</Text>
            <TextInput
              style={[styles.input, styles.amountInput, error && styles.inputError]}
              placeholder="3000"
              value={amount}
              onChangeText={handleAmountChange}
              keyboardType="numeric"
              editable={!isLoading}
            />
          </View>
          <Text style={styles.helpText}>Mínimo: $3000</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        {/* Payment Method Selection */}
        <View style={styles.section}>
          <Text style={styles.label}>Método de Pago</Text>
          <View style={styles.methodSelector}>
            <TouchableOpacity
              style={[
                styles.methodButton,
                paymentMethod === 'ALIAS' && styles.methodButtonActive,
              ]}
              onPress={() => setPaymentMethod('ALIAS')}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Ionicons
                name="wallet-outline"
                size={24}
                color={paymentMethod === 'ALIAS' ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.methodText,
                  paymentMethod === 'ALIAS' && styles.methodTextActive,
                ]}
              >
                Alias / CVU
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.methodButton,
                paymentMethod === 'CBU' && styles.methodButtonActive,
              ]}
              onPress={() => setPaymentMethod('CBU')}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Ionicons
                name="card-outline"
                size={24}
                color={paymentMethod === 'CBU' ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.methodText,
                  paymentMethod === 'CBU' && styles.methodTextActive,
                ]}
              >
                CBU
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Payment Details */}
        <View style={styles.section}>
          <Text style={styles.label}>Datos de Pago</Text>

          {paymentMethod === 'ALIAS' ? (
            <TextInput
              style={styles.input}
              placeholder="tu.alias.mp o CVU"
              value={alias}
              onChangeText={setAlias}
              autoCapitalize="none"
              editable={!isLoading}
            />
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="CBU (22 dígitos)"
                value={cbu}
                onChangeText={(text) => setCbu(text.replace(/\s/g, ''))}
                keyboardType="numeric"
                maxLength={22}
                editable={!isLoading}
              />
              <TextInput
                style={[styles.input, { marginTop: 12 }]}
                placeholder="Banco (opcional)"
                value={bank}
                onChangeText={setBank}
                editable={!isLoading}
              />
            </>
          )}

          <TextInput
            style={[styles.input, { marginTop: 12 }]}
            placeholder="Titular de la cuenta"
            value={accountHolder}
            onChangeText={setAccountHolder}
            editable={!isLoading}
          />
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={20} color={colors.info} />
          <Text style={styles.infoText}>
            Tu solicitud será revisada por un operador, quien verificará tu saldo real en Tio Rico
            (incluyendo ganancias/pérdidas) antes de aprobar. Una vez aprobada, el dinero será
            transferido en 24-48 horas hábiles.
          </Text>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Solicitar Retiro</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  balanceCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 40,
    fontWeight: 'bold',
    color: colors.primary,
  },
  balanceHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  input: {
    height: 56,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: colors.input,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.inputError,
  },
  amountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    position: 'absolute',
    left: 16,
    fontSize: 20,
    fontWeight: '600',
    color: colors.textSecondary,
    zIndex: 1,
  },
  amountInput: {
    paddingLeft: 40,
    flex: 1,
    fontSize: 24,
  },
  helpText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },
  methodSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  methodButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
  },
  methodButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  methodText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  methodTextActive: {
    color: colors.primary,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.primaryGlow,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.info,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.info,
    lineHeight: 20,
  },
  button: {
    height: 56,
    backgroundColor: colors.buttonPrimary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.buttonDisabled,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
});
