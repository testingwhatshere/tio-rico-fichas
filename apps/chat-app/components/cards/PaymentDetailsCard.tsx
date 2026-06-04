import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import CopyButton from '@/components/CopyButton';
import colors from '@/constants/colors';
import { hapticLight } from '@/utils/haptics';
import { formatAmount } from '@/utils/amount';

interface Wallet {
  id: string;
  type: 'MERCADOPAGO' | 'CBU' | 'CVU';
  label: string;
  holderName: string;
  details: {
    alias?: string;
    cbu?: string;
    cvu?: string;
    bank?: string;
  };
}

interface PaymentDetailsCardProps {
  wallet: Wallet;
  amount: number;
  referenceId?: string;
  onPaymentConfirmed: () => void;
  isDisabled?: boolean;
}

export default function PaymentDetailsCard({
  wallet,
  amount,
  referenceId,
  onPaymentConfirmed,
  isDisabled = false,
}: PaymentDetailsCardProps) {
  // paymentConfirmed checkbox removed — the proof upload itself is the confirmation.

  const getWalletTypeLabel = (type: string) => {
    switch (type) {
      case 'MERCADOPAGO':
        return 'MercadoPago';
      case 'CBU':
        return 'Transferencia Bancaria';
      case 'CVU':
        return 'Transferencia CVU';
      default:
        return type;
    }
  };

  const getWalletEmoji = (type: string) => {
    switch (type) {
      case 'MERCADOPAGO': return '💙';
      case 'CBU': return '🏦';
      case 'CVU': return '💳';
      default: return '💳';
    }
  };

  const getCopyableValue = () => {
    switch (wallet.type) {
      case 'MERCADOPAGO':
        return wallet.details.alias || '';
      case 'CBU':
        return wallet.details.cbu || '';
      case 'CVU':
        return wallet.details.cvu || '';
      default:
        return '';
    }
  };

  const getCopyableLabel = () => {
    switch (wallet.type) {
      case 'MERCADOPAGO':
        return 'Alias';
      case 'CBU':
        return 'CBU';
      case 'CVU':
        return 'CVU';
      default:
        return 'Dato';
    }
  };

  const handleContinue = () => {
    onPaymentConfirmed();
  };

  const [allCopied, setAllCopied] = useState(false);

  const handleCopyAll = async () => {
    const lines = [
      `${getCopyableLabel()}: ${getCopyableValue()}`,
      `Titular: ${wallet.holderName}`,
    ];
    if (wallet.type === 'CBU' && wallet.details.bank) {
      lines.push(`Banco: ${wallet.details.bank}`);
    }
    lines.push(`Monto: $${formatAmount(amount)}`);
    await Clipboard.setStringAsync(lines.join('\n'));
    hapticLight();
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 1500);
  };

  if (isDisabled) {
    return (
      <View style={[styles.container, styles.containerDisabled]}>
        <Text style={styles.disabledText}>
          Pago confirmado - Esperando comprobante
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        <Ionicons name="card-outline" size={16} color={colors.primary} />
        <Text style={styles.stepText}>Paso 2 de 3: Realiza el pago</Text>
      </View>

      {/* Header Stripe */}
      <View style={[styles.cardHeaderStripe, { backgroundColor: colors.primaryGlow }]}>
        <Text style={styles.walletTypeText}>
          {getWalletEmoji(wallet.type)} Pagar con {getWalletTypeLabel(wallet.type)}
        </Text>
        <Text style={styles.walletHelpText}>
          {wallet.type === 'MERCADOPAGO'
            ? 'Abri la app de MercadoPago y transferi al alias de abajo'
            : wallet.type === 'CBU'
            ? 'Desde tu banco, hace una transferencia al CBU de abajo'
            : 'Desde tu banco o billetera virtual, transferi al CVU de abajo'}
        </Text>
      </View>

      {/* Holder Name */}
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Titular</Text>
        <Text style={styles.infoValue}>{wallet.holderName}</Text>
      </View>

      {/* Bank (only for CBU) */}
      {wallet.type === 'CBU' && wallet.details.bank && (
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Banco</Text>
          <Text style={styles.infoValue}>{wallet.details.bank}</Text>
        </View>
      )}

      {/* Main Copyable Field (Alias/CBU/CVU) */}
      <View style={styles.copyRow}>
        <View style={styles.copyContent}>
          <Text style={styles.copyLabel}>{getCopyableLabel()}</Text>
          <Text style={styles.copyValue} numberOfLines={1} ellipsizeMode="middle">{getCopyableValue()}</Text>
        </View>
        <CopyButton text={getCopyableValue()} label={getCopyableLabel()} />
      </View>

      {/* Amount — Jackpot Display */}
      <View style={styles.amountDisplay}>
        <Text style={styles.infoLabel}>Monto a transferir</Text>
        <Text style={styles.amountValue}>${formatAmount(amount)}</Text>
      </View>

      {/* Reference ID */}
      {referenceId && (
        <View style={styles.copyRow}>
          <View style={styles.copyContent}>
            <Text style={styles.copyLabel}>Referencia</Text>
            <Text style={styles.copyValue}>#{referenceId.slice(0, 8).toUpperCase()}</Text>
          </View>
          <CopyButton text={referenceId.slice(0, 8).toUpperCase()} label="Referencia" />
        </View>
      )}

      {/* Copy All Button */}
      <TouchableOpacity
        style={styles.copyAllButton}
        onPress={handleCopyAll}
        activeOpacity={0.7}
      >
        <Ionicons
          name={allCopied ? 'checkmark-circle' : 'copy-outline'}
          size={16}
          color={allCopied ? colors.success : colors.primary}
        />
        <Text style={[styles.copyAllText, allCopied && styles.copyAllTextCopied]}>
          {allCopied ? 'Datos copiados' : 'Copiar todos los datos'}
        </Text>
      </TouchableOpacity>

      {/* Important note */}
      <View style={styles.helpBox}>
        <Text style={styles.helpText}>
          Transferi el monto EXACTO de arriba. Despues subi una captura del comprobante.
        </Text>
      </View>

      {/* Continue Button — no intermediate checkbox; the act of uploading a proof IS
          the user confirming they paid. One less click, less friction. */}
      <TouchableOpacity
        style={styles.buttonOuter}
        onPress={handleContinue}
        activeOpacity={0.7}
      >
        <View style={[styles.button, { backgroundColor: colors.accent }]}>
          <Text style={styles.buttonText}>YA TRANSFERÍ, SUBIR COMPROBANTE</Text>
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
    gap: 12,
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
  cardHeaderStripe: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginHorizontal: -4,
    marginTop: -4,
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: -4,
  },
  stepText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  walletTypeText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  walletHelpText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  infoRow: {
    gap: 4,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(26, 32, 44, 0.6)',
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    gap: 12,
  },
  copyContent: {
    flex: 1,
    gap: 4,
    overflow: 'hidden',
  },
  copyLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  copyValue: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primary,
  },
  copyAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  copyAllText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
  },
  copyAllTextCopied: {
    color: colors.success,
  },
  amountDisplay: {
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.chipBorder,
    borderBottomWidth: 1,
    borderBottomColor: colors.chipBorder,
    gap: 4,
  },
  amountValue: {
    fontSize: 36,
    fontWeight: '900',
    color: colors.success,
    textShadowColor: colors.successGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
    letterSpacing: 1,
  },
  helpBox: {
    backgroundColor: colors.surfaceElevated,
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  helpText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  checkboxText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  checkboxTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
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
    borderColor: colors.separator,
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textOnPrimary,
    letterSpacing: 1,
  },
});
