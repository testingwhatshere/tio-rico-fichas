/**
 * Diálogo para decidir cuánto cargar.
 *
 * El monto es del operador: escribe el número que corresponde y se carga. Lo
 * que dice el comprobante y lo que el usuario pidió se ofrecen como atajos y,
 * si el monto elegido supera a los dos, se avisa en el momento — pero no se
 * bloquea. Antes sí se bloqueaba, y como el monto leído del comprobante nunca
 * llegaba a esta pantalla, el tope terminaba siendo el monto pedido: un usuario
 * que pedía $3.000 y transfería $3.300 no tenía forma de recibir sus $3.300.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ConfirmDialog } from '@/components/ui';
import { formatMoney } from '@/utils/amount';
import { colors, space, radius, text, alpha } from '@/constants/theme';

export type AmountChoice = {
  amount: number;
  /** El monto no está respaldado por el comprobante y el operador lo decidió igual. */
  override: boolean;
  note?: string;
};

export default function AmountDialog({
  visible,
  title,
  username,
  requested,
  extracted,
  confirmLabel = 'Cargar',
  loading,
  onConfirm,
  onCancel,
  noteLabel = 'Nota interna (opcional)',
}: {
  visible: boolean;
  title: string;
  username?: string;
  /** Lo que el usuario pidió. */
  requested?: number | null;
  /** Lo que el OCR leyó del comprobante. `null` = no se pudo leer. */
  extracted?: number | null;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: (choice: AmountChoice) => void;
  onCancel: () => void;
  noteLabel?: string;
}) {
  // El comprobante manda sobre lo pedido: es la plata que entró de verdad.
  const sugerido = extracted ?? requested ?? 0;
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Cada vez que se abre vuelve al sugerido: un monto tipeado para otra carga
  // no puede quedar colgado en la siguiente.
  useEffect(() => {
    if (visible) {
      setRaw(sugerido > 0 ? String(Math.round(sugerido)) : '');
      setNote('');
      setError(null);
    }
  }, [visible, sugerido]);

  const value = useMemo(() => {
    const n = parseFloat(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }, [raw]);

  const respaldado = Math.max(requested ?? 0, extracted ?? 0);
  const excede = Number.isFinite(value) && respaldado > 0 && value > respaldado + 1;

  const confirm = () => {
    if (!Number.isFinite(value) || value <= 0) {
      setError('Escribí un monto mayor a 0');
      return;
    }
    onConfirm({ amount: value, override: excede, note: note.trim() || undefined });
  };

  const chips = [
    requested ? { label: `Pidió ${formatMoney(requested)}`, value: requested } : null,
    extracted ? { label: `Comprobante ${formatMoney(extracted)}`, value: extracted } : null,
  ].filter(Boolean) as { label: string; value: number }[];

  return (
    <ConfirmDialog
      visible={visible}
      title={title}
      message={username ? `Se le cargan las fichas a ${username}. El bot lo hace solo.` : undefined}
      confirmLabel={
        Number.isFinite(value) && value > 0 ? `${confirmLabel} ${formatMoney(value)}` : confirmLabel
      }
      tone="success"
      loading={loading}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <TextInput
        style={[s.input, s.amountInput]}
        placeholder="Monto a cargar"
        placeholderTextColor={colors.placeholder}
        keyboardType="numeric"
        value={raw}
        onChangeText={(t) => {
          setRaw(t);
          setError(null);
        }}
        autoFocus
      />

      {chips.length > 0 && (
        <View style={s.chips}>
          {chips.map((c) => (
            <Pressable key={c.label} style={s.chip} onPress={() => setRaw(String(Math.round(c.value)))}>
              <Text style={s.chipText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!!error && <Text style={s.error}>{error}</Text>}

      {excede && (
        <View style={s.warn}>
          <Ionicons name="alert-circle" size={15} color={colors.warning} />
          <Text style={s.warnText}>
            Es más de lo que respalda el comprobante ({formatMoney(respaldado)}). Se carga igual y
            queda registrado a tu nombre.
          </Text>
        </View>
      )}

      <TextInput
        style={s.input}
        placeholder={noteLabel}
        placeholderTextColor={colors.placeholder}
        value={note}
        onChangeText={setNote}
      />
    </ConfirmDialog>
  );
}

const s = StyleSheet.create({
  input: {
    ...text.body,
    color: colors.textPrimary,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  amountInput: { ...text.title, color: colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { ...text.caption, color: colors.textSecondary },
  error: { ...text.caption, color: colors.error },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: alpha(colors.warning, 0.12),
  },
  warnText: { ...text.caption, color: colors.warning, flex: 1, lineHeight: 17 },
});
