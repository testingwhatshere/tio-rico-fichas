/**
 * Componentes base del panel.
 *
 * Reemplazan cuatro patrones que estaban copiados a mano en ~24 archivos:
 * la "card" (con radios 10/12/14/16 según quién la escribió), las pills de
 * filtro (el mismo bloque de ~65 líneas en 5 pantallas), el empty state
 * (reescrito 9 veces) y el header de página (12 veces, 4 tamaños distintos).
 */
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, space, radius, text, shadow, alpha } from '@/constants/theme';

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({
  children,
  accent,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  /** Barra de color a la izquierda. Sin esto la card es neutra. */
  accent?: string;
  style?: ViewStyle;
  padded?: boolean;
}) {
  return (
    <View
      style={[
        s.card,
        padded && { padding: space.lg },
        accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ── PageHeader ────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={s.header}>
      {/* `minWidth` es lo que hace que el bloque de la derecha baje de línea en
          un celular en vez de aplastarse contra el título: sin un ancho mínimo,
          `flex: 1` se achica hasta donde haga falta y nunca se dispara el wrap. */}
      <View style={s.headerTitleBlock}>
        <Text style={s.headerTitle}>{title}</Text>
        {!!subtitle && <Text style={s.headerSubtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

// ── FilterPills ───────────────────────────────────────────────────────────────

export type FilterOption<T extends string> = {
  key: T;
  label: string;
  count?: number;
};

export function FilterPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    // Scroll horizontal: con la bandeja partida el panel de lista mide 380px y
    // los filtros se cortaban, dejando categorías enteras invisibles.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.pillsScroll}
      contentContainerStyle={s.pills}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[s.pill, active && s.pillActive]}
          >
            <Text style={[s.pillText, active && s.pillTextActive]}>{opt.label}</Text>
            {opt.count !== undefined && (
              <View style={[s.pillBadge, active && s.pillBadgeActive]}>
                <Text style={[s.pillBadgeText, active && s.pillBadgeTextActive]}>
                  {opt.count}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

export function EmptyState({
  icon = 'checkmark-circle-outline',
  title,
  subtitle,
  loading,
  connected = true,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /**
   * Todavía no llegaron los datos. Con esto en true la pantalla dice que está
   * cargando en vez de afirmar que no hay nada: son estados distintos y hasta
   * ahora se veían iguales, así que el operador daba por vacía una lista que ni
   * siquiera había cargado. Ver `useFirstLoad`.
   */
  loading?: boolean;
  /** Si no hay socket, el mensaje apunta a la conexión y no al contenido. */
  connected?: boolean;
}) {
  if (loading) {
    return (
      <View style={s.empty}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={s.emptyTitle}>
          {connected ? 'Cargando…' : 'Conectando con el servidor…'}
        </Text>
        <Text style={s.emptySubtitle}>
          {connected
            ? 'Un segundo, estoy trayendo los datos.'
            : 'La primera conexión del día puede tardar unos segundos.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={40} color={colors.textMuted} />
      <Text style={s.emptyTitle}>{title}</Text>
      {!!subtitle && <Text style={s.emptySubtitle}>{subtitle}</Text>}
    </View>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

type ButtonTone = 'primary' | 'neutral' | 'danger' | 'success';

export function Button({
  label,
  onPress,
  tone = 'neutral',
  icon,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const bg = {
    primary: colors.primaryDark,
    neutral: colors.surfaceElevated,
    danger: colors.error,
    success: colors.success,
  }[tone];
  const fg = tone === 'neutral' ? colors.textPrimary : colors.textOnPrimary;
  const off = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={[s.button, { backgroundColor: bg }, off && { opacity: 0.45 }, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={16} color={fg} />}
          <Text style={[s.buttonText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

/**
 * Reemplaza los ~90 `Alert.alert` y los `Alert.prompt`.
 *
 * `Alert.prompt` sólo existe en iOS, así que en web y Android dejaba funciones
 * enteras muertas: crear un panel y cancelar un pago no se podían hacer.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirmar',
  tone = 'primary',
  loading,
  onConfirm,
  onCancel,
  children,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  tone?: ButtonTone;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Campos extra (ej. un input de motivo). */
  children?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.overlay} onPress={onCancel}>
        <Pressable style={s.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={s.dialogTitle}>{title}</Text>
          {!!message && <Text style={s.dialogMessage}>{message}</Text>}
          {children}
          <View style={s.dialogActions}>
            <Button label="Cancelar" tone="neutral" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              label={confirmLabel}
              tone={tone}
              onPress={onConfirm}
              loading={loading}
              style={{ flex: 1 }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

/** Contenedor de pantalla: fondo, padding y ancho máximo de lectura. */
export function Screen({
  children,
  scroll,
  maxWidth,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  maxWidth?: number;
}) {
  const inner = (
    <View style={[s.screenInner, maxWidth ? { maxWidth, alignSelf: 'center', width: '100%' } : null]}>
      {children}
    </View>
  );
  if (scroll) {
    return <ScrollView style={s.screen} contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView>;
  }
  return <View style={s.screen}>{inner}</View>;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.lg,
  },
  headerTitleBlock: { flex: 1, minWidth: 200 },
  headerTitle: { ...text.display, color: colors.textPrimary },
  headerSubtitle: { ...text.body, color: colors.textSecondary, marginTop: 2 },

  pillsScroll: { flexGrow: 0, flexShrink: 0 },
  pills: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xl, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
  },
  pillActive: { backgroundColor: colors.primary },
  pillText: { ...text.label, color: colors.textSecondary },
  pillTextActive: { color: colors.textOnPrimary },
  pillBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    backgroundColor: alpha(colors.textPrimary, 0.12),
    alignItems: 'center',
  },
  pillBadgeActive: { backgroundColor: alpha(colors.black, 0.2) },
  pillBadgeText: { ...text.caption, color: colors.textSecondary },
  pillBadgeTextActive: { color: colors.textOnPrimary },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyTitle: { ...text.title, color: colors.textSecondary },
  emptySubtitle: { ...text.body, color: colors.textMuted, textAlign: 'center' },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  buttonText: { ...text.bodyStrong },

  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.md,
    ...shadow.md,
  },
  dialogTitle: { ...text.title, color: colors.textPrimary },
  dialogMessage: { ...text.body, color: colors.textSecondary, lineHeight: 20 },
  dialogActions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderText: {
    ...text.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  tableRowHover: { backgroundColor: colors.surfaceElevated },
  rowAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2 },

  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeText: { ...text.caption, fontWeight: '700' },

  stat: {
    flex: 1,
    minWidth: 140,
    gap: space.xs,
    padding: space.lg,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  statLabel: { ...text.label, color: colors.textSecondary },
  statValue: { ...text.display, color: colors.textPrimary },

  screen: { flex: 1, backgroundColor: colors.background },
  screenInner: { flex: 1 },
});

// ── Tabla ─────────────────────────────────────────────────────────────────────
//
// El panel viejo mostraba cada fallo como una tarjeta de 80px con el contenido
// apiñado a la izquierda: en 1440px entraban 9 filas y ninguna decía por qué
// había fallado. Una tabla con columnas alineadas entra al triple de densidad
// y deja comparar de un vistazo.

export type Column<T> = {
  key: string;
  header: string;
  /** Ancho fijo en px. Sin esto la columna reparte el espacio sobrante. */
  width?: number;
  flex?: number;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
};

export function TableHeader<T>({ columns }: { columns: Column<T>[] }) {
  return (
    <View style={s.tableHeader}>
      {columns.map((c) => (
        <View
          key={c.key}
          style={[
            c.width ? { width: c.width } : { flex: c.flex ?? 1 },
            c.align === 'right' && { alignItems: 'flex-end' },
          ]}
        >
          <Text style={s.tableHeaderText}>{c.header}</Text>
        </View>
      ))}
    </View>
  );
}

export function TableRow<T>({
  row,
  columns,
  onPress,
  accent,
}: {
  row: T;
  columns: Column<T>[];
  onPress?: () => void;
  accent?: string;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[s.tableRow, hovered && s.tableRowHover]}
    >
      {accent && <View style={[s.rowAccent, { backgroundColor: accent }]} />}
      {columns.map((c) => (
        <View
          key={c.key}
          style={[
            c.width ? { width: c.width } : { flex: c.flex ?? 1 },
            c.align === 'right' && { alignItems: 'flex-end' },
          ]}
        >
          {c.render(row)}
        </View>
      ))}
    </Pressable>
  );
}

/** Celda de texto estándar. `muted` para lo secundario, `strong` para la identidad. */
export function Cell({
  children,
  muted,
  strong,
  mono,
}: {
  children: React.ReactNode;
  muted?: boolean;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <Text
      numberOfLines={1}
      style={[
        mono ? text.mono : strong ? text.bodyStrong : text.body,
        { color: muted ? colors.textSecondary : colors.textPrimary },
      ]}
    >
      {children}
    </Text>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

/** Fondo tenue del propio color + texto saturado. Nunca color sólido: en una
 *  lista larga los badges sólidos gritan más que los datos. */
export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[s.badge, { backgroundColor: alpha(color, 0.14) }]}>
      <Text style={[s.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ── StatTile ──────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: number | string;
  tone?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, tone ? { color: tone } : null]}>{value}</Text>
    </Pressable>
  );
}
