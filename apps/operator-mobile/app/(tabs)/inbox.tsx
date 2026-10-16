import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useLayout } from '@/hooks/useLayout';
import { useInbox } from '@/hooks/useInbox';
import { KIND_META, WorkItem, WorkKind } from '@/utils/workItems';
import { timeAgo, TIME_RANGES, TimeRangeKey } from '@/utils/time';
import { formatMoney } from '@/utils/amount';
import { PageHeader, FilterPills, EmptyState, Badge } from '@/components/ui';
import { CopyableText, CopyButton } from '@/components/Copyable';
import FailureDetailView from '@/components/FailureDetailView';
import { colors, space, radius, text, alpha } from '@/constants/theme';
import { getSocket } from '@/services/socket';
import { useOperatorStore } from '@/stores/operator.store';
import { useAuthStore } from '@/stores/auth.store';

const RANGE_OPTIONS = (Object.keys(TIME_RANGES) as TimeRangeKey[]).map((key) => ({
  key,
  label: TIME_RANGES[key].label,
}));

type KindFilter = 'all' | WorkKind;

/**
 * Centro de control.
 *
 * Una sola bandeja con todo lo que espera al operador —comprobantes, cargas
 * fallidas, pagos y chats— ordenado por urgencia. Reemplaza el paseo por
 * pestañas separadas.
 *
 * Los premios salieron de acá y tienen su propia pantalla: son un flujo con
 * etapas y plata comprometida en cada tramo, no un caso suelto que se resuelve
 * y desaparece.
 */
export default function InboxScreen() {
  const router = useRouter();
  const { isDesktop } = useLayout();
  // Por defecto, lo de hoy: un fallo de hace tres meses no se resuelve, se archiva.
  const [range, setRange] = useState<TimeRangeKey>('today');
  const [kind, setKind] = useState<KindFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  // En desktop el caso se abre al lado de la lista en vez de reemplazarla: el
  // operador resuelve uno y el siguiente ya está ahí, sin ir y volver.
  const [selected, setSelected] = useState<WorkItem | null>(null);

  // "Todo al día" y "todavía no llegaron los datos" se ven igual: la bandeja
  // sale del store, que arranca vacío. El operador entraba, leía "Nada
  // pendiente" y se iba, con casos esperando. `lastUpdate` sólo tiene valor
  // cuando el servidor ya contestó al menos una vez.
  const lastUpdate = useOperatorStore((s) => s.lastUpdate);
  const isConnected = useAuthStore((s) => s.isConnected);
  const isLoadingFirst = !lastUpdate;

  const { items: inRange } = useInbox(range);
  const items = useMemo(
    () => (kind === 'all' ? inRange : inRange.filter((i) => i.kind === kind)),
    [inRange, kind]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: inRange.length };
    for (const i of inRange) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [inRange]);

  // Sólo se ofrecen los tipos que existen ahora: filtros que siempre dan cero
  // son ruido.
  const kindOptions = useMemo(() => {
    const present = (Object.keys(KIND_META) as WorkKind[]).filter((k) => counts[k]);
    return [
      { key: 'all' as KindFilter, label: 'Todo', count: counts.all },
      ...present.map((k) => ({ key: k as KindFilter, label: KIND_META[k].label, count: counts[k] })),
    ];
  }, [counts]);

  // Si el caso abierto se resolvió y salió de la bandeja, se cierra solo.
  React.useEffect(() => {
    if (selected && !inRange.some((i) => i.id === selected.id)) setSelected(null);
  }, [inRange, selected]);

  const openItem = (item: WorkItem) => {
    // Chats y pagos necesitan la pantalla entera; los fallos se embeben.
    const embeddable = item.kind !== 'chat' && item.kind !== 'payment';
    if (isDesktop && embeddable) setSelected(item);
    else router.push(item.href as any);
  };

  const refresh = () => {
    setRefreshing(true);
    getSocket()?.emit('get_initial_data', {}, () => setRefreshing(false));
    setTimeout(() => setRefreshing(false), 4000);
  };

  const detailId = selected ? selected.id.split(':')[1] : null;

  return (
    <View style={s.split}>
      <View style={selected ? s.listPane : s.screen}>
      <PageHeader
        title="Centro de control"
        subtitle={
          isLoadingFirst
            ? isConnected
              ? 'Buscando lo que hay pendiente…'
              : 'Conectando con el servidor…'
            : items.length
              ? `${items.length} ${items.length === 1 ? 'cosa espera' : 'cosas esperan'} tu atención`
              : 'Nada pendiente'
        }
        right={
          <Pressable onPress={refresh} style={s.refresh}>
            <Ionicons name="refresh" size={18} color={colors.textSecondary} />
          </Pressable>
        }
      />

      <View style={s.filters}>
        <FilterPills options={RANGE_OPTIONS} value={range} onChange={setRange} />
        {kindOptions.length > 2 && (
          <FilterPills options={kindOptions} value={kind} onChange={setKind} />
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={items.length ? s.list : { flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <Row
            item={item}
            wide={isDesktop && !selected}
            selected={selected?.id === item.id}
            onPress={() => openItem(item)}
          />
        )}
        ListEmptyComponent={
          isLoadingFirst ? (
            <View style={s.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={s.loadingTitle}>
                {isConnected ? 'Cargando tu bandeja…' : 'Conectando con el servidor…'}
              </Text>
              <Text style={s.loadingHint}>
                {isConnected
                  ? 'Un segundo, estoy trayendo todo lo pendiente.'
                  : 'La primera conexión del día puede tardar unos segundos.'}
              </Text>
            </View>
          ) : (
            <EmptyState
              title="Todo al día"
              subtitle={
                range === 'all'
                  ? 'No hay nada pendiente.'
                  : `Nada pendiente en este rango. Probá con un período más amplio.`
              }
            />
          )
        }
      />
      </View>

      {selected && detailId && (
        <View style={s.detailPane}>
          <FailureDetailView id={detailId} onClose={() => setSelected(null)} embedded />
        </View>
      )}
    </View>
  );
}

function Row({
  item, wide, onPress, selected,
}: { item: WorkItem; wide: boolean; onPress: () => void; selected?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const meta = KIND_META[item.kind];

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[s.row, hovered && s.rowHover, selected && s.rowSelected]}
    >
      <View style={[s.kindDot, { backgroundColor: alpha(meta.color, 0.16) }]}>
        <Ionicons name={meta.icon as any} size={15} color={meta.color} />
      </View>

      <View style={s.identity}>
        <CopyableText value={item.username} label="Usuario" style={s.username} iconSize={11} />
        {!wide && <Text style={s.reasonNarrow} numberOfLines={1}>{item.reason}</Text>}
      </View>

      {wide && (
        <View style={s.reasonCol}>
          <Badge label={meta.label} color={meta.color} />
          <Text style={s.reason} numberOfLines={1}>{item.reason}</Text>
        </View>
      )}

      <View style={s.amountCell}>
        <Text style={s.amount}>{item.amount ? formatMoney(item.amount) : ''}</Text>
        {!!item.amount && <CopyButton value={item.amount} label="Monto" size={11} />}
      </View>
      <Text style={s.age}>{timeAgo(item.createdAt)}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  loadingTitle: { ...text.title, color: colors.textPrimary, textAlign: 'center' },
  loadingHint: { ...text.body, color: colors.textMuted, textAlign: 'center' },
  split: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  /** Con un caso abierto la lista se angosta y muestra sólo lo esencial. */
  listPane: {
    width: 380,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  detailPane: { flex: 1 },
  refresh: { padding: space.sm, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
  filters: { gap: space.sm, paddingBottom: space.lg },
  list: { paddingHorizontal: space.md, paddingBottom: space.xl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  rowHover: { backgroundColor: colors.cardBackground },
  rowSelected: { backgroundColor: colors.surfaceElevated },

  kindDot: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: { flex: 1, minWidth: 0, gap: 1 },
  username: { ...text.bodyStrong, color: colors.textPrimary },
  reasonNarrow: { ...text.caption, color: colors.textSecondary },

  reasonCol: { flex: 2, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reason: { ...text.body, color: colors.textSecondary, flex: 1 },

  amount: { ...text.bodyStrong, color: colors.textPrimary, textAlign: 'right' },
  amountCell: {
    width: 106,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.xs,
  },
  age: { ...text.caption, color: colors.textMuted, width: 48, textAlign: 'right' },
});
