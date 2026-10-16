import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useLayout } from '@/hooks/useLayout';
import { useHistory } from '@/hooks/useHistory';
import { Badge, Card, EmptyState, FilterPills, PageHeader } from '@/components/ui';
import { CopyableText } from '@/components/Copyable';
import { formatMoney, parseAmount } from '@/utils/amount';
import { formatClock, timeAgo } from '@/utils/time';
import {
  HISTORY_CATEGORIES,
  HISTORY_RANGES,
  HistoryCategory,
  HistoryItem,
  HistoryRange,
  reasonOf,
  statusMeta,
} from '@/utils/history';
import LoadActions from '@/components/LoadActions';
import { toActionable } from '@/utils/loadActions';
import { colors, space, radius, text, alpha } from '@/constants/theme';
import ProofImage from '@/components/ProofImage';
import { proofTwinAlert } from '@/utils/proofTwins';
import { overpaidOfferTag } from '@/utils/overpaidOffer';

/**
 * Historial.
 *
 * Para ir a buscar algo que ya pasó: el comprobante de una carga de la semana
 * pasada, qué se hizo con un pedido, cuánto cargó alguien. Es consulta pura, sin
 * lo urgente vive en la Bandeja y lo que está en
 * movimiento, en Seguimiento. Consultar es lo que se viene a hacer acá, pero si
 * lo que se encuentra hay que arreglarlo —una carga vieja que quedó sin cargar,
 * una diferencia que completar— se resuelve desde el mismo comprobante que se
 * está mirando.
 *
 * Trae de a diez y suma al scrollear. Nunca pide la lista completa: la tabla de
 * solicitudes tiene años encima y un "traeme todo" la haría recorrer entera
 * para mostrar una pantalla.
 */
export default function HistorialScreen() {
  const { isDesktop } = useLayout();

  const [category, setCategory] = useState<HistoryCategory>('all');
  const [range, setRange] = useState<HistoryRange>('week');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<HistoryItem | null>(null);

  const hours = HISTORY_RANGES.find((r) => r.key === range)!.hours;
  const { items, loading, loadingMore, hasMore, error, connected, loadMore, refresh } =
    useHistory(category, hours, search);

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <PageHeader title="Historial" subtitle="Cargas pasadas y sus comprobantes" />

        <View style={s.controls}>
          <View style={s.search}>
            <Ionicons name="search" size={15} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar por usuario del panel"
              placeholderTextColor={colors.placeholder}
              style={s.searchInput}
            />
            {!!search && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          <FilterPills options={HISTORY_CATEGORIES} value={category} onChange={setCategory} />
          <FilterPills options={HISTORY_RANGES} value={range} onChange={setRange} />
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <Row item={item} onPress={() => setViewing(item)} compact={!isDesktop} />
        )}
        contentContainerStyle={[s.list, isDesktop && s.listDesktop]}
        // El scroll infinito dispara antes de tocar el fondo para que la página
        // siguiente ya esté cuando el operador llega.
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <EmptyState
            icon={error ? 'cloud-offline-outline' : 'time-outline'}
            loading={loading}
            connected={connected}
            title={error ? 'No se pudo traer el historial' : 'No hay cargas en este filtro'}
            subtitle={
              error ??
              (search.trim()
                ? `Nada que coincida con "${search.trim()}" en este período.`
                : 'Probá ampliar el período o cambiar la categoría.')
            }
          />
        }
        ListFooterComponent={
          <Footer loading={loadingMore} hasMore={hasMore} count={items.length} />
        }
      />

      <ProofViewer item={viewing} onClose={() => setViewing(null)} onDone={refresh} />
    </View>
  );
}

// ── Una fila ──────────────────────────────────────────────────────────────────

function Row({
  item,
  onPress,
  compact,
}: {
  item: HistoryItem;
  onPress: () => void;
  compact: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = statusMeta(item.status);
  const amount = parseAmount(item.amount);
  const reason = reasonOf(item);
  const twin = proofTwinAlert(item.proofTwins);
  const overpaid = overpaidOfferTag(item.overpaidOffer);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <Card accent={meta.color} style={[s.row, hovered && s.rowHover] as any}>
        {/* La miniatura es el ancla: el operador viene buscando un comprobante,
            y reconocerlo de un vistazo evita abrir de a uno. */}
        <View style={s.thumbBox}>
          {item.proofUrl ? (
            <ProofImage uri={item.proofUrl} style={s.thumb} resizeMode="cover" compact />
          ) : (
            <View style={[s.thumb, s.thumbEmpty]}>
              <Ionicons name="document-outline" size={16} color={colors.textMuted} />
            </View>
          )}
        </View>

        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <CopyableText
              value={item.targetUsername}
              label="Usuario"
              style={s.username}
              iconSize={12}
            />
            <CopyableText
              value={amount}
              display={formatMoney(amount)}
              label="Monto"
              style={s.amount}
              iconSize={12}
            />
            {!compact && <Badge label={meta.label} color={meta.color} />}
          </View>

          <View style={s.rowBottom}>
            {compact && <Badge label={meta.label} color={meta.color} />}
            <Text style={s.when}>
              {formatClock(item.createdAt)} · hace {timeAgo(item.createdAt)}
            </Text>
            {!!item.panel?.name && <Text style={s.panel}>{item.panel.name}</Text>}
            {item.manuallyApproved && <Text style={s.manual}>aprobada a mano</Text>}
            {!!overpaid && (
              <Text style={[s.twinTag, { color: overpaid.color }]}>{overpaid.label}</Text>
            )}
            {!!twin && (
              <Text style={[s.twinTag, twin.severe && { color: colors.error }]}>
                {twin.label.toLowerCase()}
              </Text>
            )}
          </View>

          {!!reason && (
            <Text style={s.reason} numberOfLines={1}>
              {reason}
            </Text>
          )}
        </View>

        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Card>
    </Pressable>
  );
}

/** Pie de la lista: dice si falta más, si está trayendo, o que ya no hay nada. */
function Footer({
  loading,
  hasMore,
  count,
}: {
  loading: boolean;
  hasMore: boolean;
  count: number;
}) {
  if (loading) {
    return (
      <View style={s.footer}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={s.footerText}>Trayendo más…</Text>
      </View>
    );
  }
  if (hasMore || count === 0) return <View style={{ height: space.xl }} />;
  return (
    <View style={s.footer}>
      <Text style={s.footerText}>
        {count === 1 ? 'Una sola carga en este filtro' : `${count} cargas — no hay más`}
      </Text>
    </View>
  );
}

// ── El comprobante ────────────────────────────────────────────────────────────

/** Fila etiqueta/valor del detalle. El valor se copia si sirve pegarlo. */
function Field({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string | number | null;
  copyLabel?: string;
}) {
  if (value === null || value === '') return null;
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {copyLabel ? (
        <CopyableText value={value} label={copyLabel} style={s.fieldValue} iconSize={12} />
      ) : (
        <Text style={s.fieldValue}>{value}</Text>
      )}
    </View>
  );
}

function ProofViewer({
  item,
  onClose,
  onDone,
}: {
  item: HistoryItem | null;
  onClose: () => void;
  /** Refrescar la lista después de operar sobre la carga. */
  onDone: () => void;
}) {
  const { isDesktop } = useLayout();
  if (!item) return null;

  const meta = statusMeta(item.status);
  const amount = parseAmount(item.amount);
  const sheetTwin = proofTwinAlert(item.proofTwins);
  const reason = reasonOf(item);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable
          style={[s.sheet, !isDesktop && s.sheetNarrow]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={s.sheetHead}>
            <View style={{ flex: 1 }}>
              <CopyableText
                value={item.targetUsername}
                label="Usuario"
                style={s.sheetTitle}
              />
              <Text style={s.sheetSub}>
                {formatClock(item.createdAt)} · hace {timeAgo(item.createdAt)}
              </Text>
            </View>
            <Badge label={meta.label} color={meta.color} />
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={[s.sheetBody, !isDesktop && { flexDirection: 'column' }]}>
            <View style={s.proofPane}>
              {item.proofUrl ? (
                <ProofImage uri={item.proofUrl} style={s.proof} resizeMode="contain" />
              ) : (
                <View style={s.noProof}>
                  <Ionicons
                    name={item.proofPurged ? 'time-outline' : 'document-outline'}
                    size={28}
                    color={colors.textMuted}
                  />
                  {/* "No hay comprobante" y "lo hubo y venció" llevan a hacer
                      cosas distintas: una se resuelve pidiéndoselo al cliente. */}
                  <Text style={s.noProofText}>
                    {item.proofPurged
                      ? 'El comprobante se borró por antigüedad (se guardan 6 meses)'
                      : 'Esta carga no tiene comprobante'}
                  </Text>
                </View>
              )}
              {!!sheetTwin && (
                <View
                  style={[
                    s.twinBox,
                    sheetTwin.severe && { borderColor: alpha(colors.error, 0.5) },
                  ]}
                >
                  <Ionicons
                    name="copy-outline"
                    size={16}
                    color={sheetTwin.severe ? colors.error : colors.warning}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        s.twinLabel,
                        { color: sheetTwin.severe ? colors.error : colors.warning },
                      ]}
                    >
                      {sheetTwin.label}
                    </Text>
                    <Text style={s.twinDetail}>{sheetTwin.detail}</Text>
                  </View>
                </View>
              )}
            </View>

            <View style={s.detail}>
              <Field label="Monto" value={formatMoney(amount)} copyLabel="Monto" />
              <Field label="Estado" value={meta.label} />
              {item.validationScore !== null && (
                <Field label="Score de la IA" value={item.validationScore.toFixed(2)} />
              )}
              <Field label="Panel" value={item.panel?.name ?? null} />
              <Field
                label="Aprobación"
                value={item.manuallyApproved ? 'Manual, por un operador' : null}
              />
              <Field label="Motivo" value={reason} />
              <Field label="ID de la carga" value={item.id} copyLabel="ID" />

              {/* El historial dejó de ser sólo para mirar: si alguien pregunta
                  por una carga vieja que quedó mal, se resuelve acá mismo en vez
                  de tener que ir a buscar por dónde entrarle. */}
              <LoadActions
                load={{
                  ...toActionable({ ...item, userId: item.user?.id ?? null }),
                  // El listado no trae el Json de la validación (pesa más que
                  // toda la fila): el monto lo decide el operador mirando el
                  // comprobante que tiene al lado.
                  extractedAmount: null,
                }}
                onDone={() => {
                  onDone();
                  onClose();
                }}
                compact
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  twinTag: { ...text.caption, color: colors.warning, fontWeight: '700' },
  twinBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: alpha(colors.warning, 0.5),
    backgroundColor: colors.backgroundSecondary,
  },
  twinLabel: { ...text.label },
  twinDetail: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  screen: { flex: 1, backgroundColor: colors.background },

  head: { paddingHorizontal: space.lg, paddingTop: space.lg },
  controls: { gap: space.sm, marginBottom: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: 36,
  },
  searchInput: { flex: 1, ...text.body, color: colors.textPrimary, outlineStyle: 'none' } as any,

  list: { paddingHorizontal: space.lg, paddingBottom: space.xl, flexGrow: 1 },
  listDesktop: { maxWidth: 880, width: '100%', alignSelf: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  rowHover: { borderColor: colors.borderStrong },
  thumbBox: { width: 44, height: 44 },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },

  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  username: { ...text.bodyStrong, color: colors.textPrimary },
  amount: { ...text.bodyStrong, color: colors.primary },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  when: { ...text.caption, color: colors.textMuted },
  panel: { ...text.caption, color: colors.textMuted },
  manual: { ...text.caption, color: colors.textSecondary },
  reason: { ...text.caption, color: colors.textSecondary },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  footerText: { ...text.caption, color: colors.textMuted },

  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 900,
    maxHeight: '90%',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sheetNarrow: { maxWidth: '100%' },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  sheetTitle: { ...text.title, color: colors.textPrimary },
  sheetSub: { ...text.caption, color: colors.textMuted, marginTop: 1 },

  sheetBody: { flexDirection: 'row', padding: space.lg, gap: space.xl },
  proofPane: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  proof: { width: '100%', height: 380, borderRadius: radius.md },
  noProof: { alignItems: 'center', gap: space.sm, paddingVertical: space['2xl'] },
  noProofText: { ...text.caption, color: colors.textMuted },

  detail: { width: 260, gap: space.md },
  field: { gap: 1 },
  fieldLabel: { ...text.caption, color: colors.textMuted },
  fieldValue: { ...text.body, color: colors.textPrimary },
});
