import React, { useCallback, useRef, useState } from 'react';
import { Text, Pressable, StyleSheet, View, ViewStyle, TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';

import { toast } from '@/components/Toast';
import { colors, space, radius, text } from '@/constants/theme';

/**
 * Copiar al portapapeles, en todas partes.
 *
 * El operador pasa el día llevando datos del panel a la app del banco y del
 * chat al panel: CBU, alias, usuario, teléfono, número de operación. Antes eso
 * era seleccionar con el mouse y Ctrl+C —o peor, tipearlo a mano y equivocarse
 * en un dígito del CBU—. Cualquier dato que se pegue en otro lado va envuelto
 * en uno de estos.
 */
export function useCopy() {
  // Confirmación en el propio botón: el toast puede pasar desapercibido cuando
  // se copian tres datos seguidos.
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (value?: string | number | null, label = 'Dato') => {
    const str = value === null || value === undefined ? '' : String(value).trim();
    if (!str || str === '—') return;
    try {
      await Clipboard.setStringAsync(str);
      setCopied(str);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1400);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('No se pudo copiar');
    }
  }, []);

  return { copy, copied };
}

/** ¿Vale la pena ofrecer copiar esto? Los vacíos y los guiones, no. */
export function isCopyable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  return str.length > 0 && str !== '—' && str !== '-';
}

/**
 * Texto que se copia al tocarlo, con el ícono al lado.
 * Es el caso más común: un CBU, un usuario, un teléfono.
 */
export function CopyableText({
  value,
  label,
  display,
  mono,
  style,
  numberOfLines = 1,
  iconSize = 13,
}: {
  value?: string | number | null;
  /** Nombre del dato, para el aviso: "CBU copiado". */
  label: string;
  /** Qué mostrar, si difiere de lo que se copia (ej. monto formateado). */
  display?: string;
  mono?: boolean;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
  iconSize?: number;
}) {
  const { copy, copied } = useCopy();
  const shown = display ?? (value === null || value === undefined ? '—' : String(value));

  if (!isCopyable(value)) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {shown}
      </Text>
    );
  }

  const isCopied = copied === String(value).trim();

  return (
    <Pressable
      onPress={() => copy(value, label)}
      style={s.row}
      // El título nativo del browser: el operador nuevo descubre que se puede.
      {...({ title: `Copiar ${label.toLowerCase()}` } as any)}
    >
      <Text style={[style, mono ? text.mono : null]} numberOfLines={numberOfLines}>
        {shown}
      </Text>
      <Ionicons
        name={isCopied ? 'checkmark' : 'copy-outline'}
        size={iconSize}
        color={isCopied ? colors.success : colors.textMuted}
      />
    </Pressable>
  );
}

/** Sólo el ícono, para cuando el texto ya está renderizado por otro componente. */
export function CopyButton({
  value,
  label,
  size = 14,
  style,
}: {
  value?: string | number | null;
  label: string;
  size?: number;
  style?: ViewStyle;
}) {
  const { copy, copied } = useCopy();
  if (!isCopyable(value)) return null;
  const isCopied = copied === String(value).trim();

  return (
    <Pressable
      onPress={() => copy(value, label)}
      hitSlop={8}
      style={[s.iconBtn, style]}
      {...({ title: `Copiar ${label.toLowerCase()}` } as any)}
    >
      <Ionicons
        name={isCopied ? 'checkmark' : 'copy-outline'}
        size={size}
        color={isCopied ? colors.success : colors.textMuted}
      />
    </Pressable>
  );
}

/**
 * Fila etiqueta + valor copiable. La usan las fichas de detalle, donde los
 * datos vienen en lista.
 */
export function CopyableRow({
  label,
  value,
  display,
  mono,
}: {
  label: string;
  value?: string | number | null;
  display?: string;
  mono?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <CopyableText
        value={value}
        label={label}
        display={display}
        mono={mono}
        style={s.fieldValue}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 0 },
  iconBtn: { padding: 2, borderRadius: radius.sm },
  field: { gap: 2 },
  fieldLabel: { ...text.caption, color: colors.textMuted },
  fieldValue: { ...text.body, color: colors.textPrimary },
});

export default CopyableText;
