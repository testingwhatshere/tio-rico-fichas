import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useLayout } from '@/hooks/useLayout';
import { useActiveLoads } from '@/hooks/useActiveLoads';
import { Card, EmptyState, FilterPills, PageHeader, StatTile } from '@/components/ui';
import { CopyableText } from '@/components/Copyable';
import { formatMoney, parseAmount } from '@/utils/amount';
import { formatClock, minutesSince, timeAgo } from '@/utils/time';
import {
  TRACKING_FILTERS,
  TRACKING_RANGES,
  TrackedLoad,
  TrackingFilter,
  TrackingRange,
  TrailStep,
  closedAt,
  matchesFilter,
} from '@/utils/tracking';
import { toActionable } from '@/utils/loadActions';
import LoadActions from '@/components/LoadActions';
import { colors, space, radius, text, alpha } from '@/constants/theme';

/**
 * Seguimiento.
 *
 * El resto del panel muestra cargas cuando ya se rompieron. Esta pantalla
 * muestra el recorrido completo mientras pasa: por qué paso va cada carga, a qué
 * hora entró en cada uno y —lo que de verdad importa— hace cuánto que no se
 * mueve. Una carga trabada no emite ningún evento; sólo se nota porque el reloj
 * corre y el paso no cambia, y eso hasta ahora no se veía en ningún lado.
 *
 * Y se opera desde acá. Antes lo único que se podía hacer era cerrar una carga
 * colgada: para cualquier otra cosa había que ir a buscarla a la Bandeja, que
 * es donde vivían todos los botones. Ahora cada carga trae las decisiones que
 * admite —aprobar con el monto que corresponda, ver el comprobante, reintentar,
 * cerrarla— porque es acá donde el operador ve que algo está trabado.
 *
 * Cerrar importa más de lo que parece: mientras la carga exista, al usuario le
 * rebota el pedido siguiente con "Ya tenés una carga en proceso".
 */
export default function TrackingScreen() {
  const { isDesktop } = useLayout();
  const [filter, setFilter] = useState<TrackingFilter>('active');
  const [range, setRange] = useState<TrackingRange>('today');
  const [query, setQuery] = useState('');

  const hours = TRACKING_RANGES.find((r) => r.key === range)!.hours;
  // Las cerradas cuestan una consulta más grande: sólo se piden si se las mira.
  const { loads, counts, loading, connected, error, refreshing, refresh } = useActiveLoads(
    hours,
    filter === 'closed',
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return loads.filter((l) => {
      if (!matchesFilter(l, filter)) return false;
      if (!q) return true;
      return (
        (l.targetUsername || '').toLowerCase().includes(q) ||
        (l.username || '').toLowerCase().includes(q) ||
        String(parseAmount(l.amount)).includes(q)
      );
    });
  }, [loads, filter, query]);

  const filters = useMemo(
    () => TRACKING_FILTERS.map((f) => ({ ...f, count: counts[f.key] })),
    [counts],
  );
  const ranges = useMemo(() => TRACKING_RANGES.map(({ key, label }) => ({ key, label })), []);

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <PageHeader
          title="Seguimiento"
          subtitle="Por dónde va cada carga en curso"
          right={
            <View style={s.tiles}>
              <StatTile label="En curso" value={counts.active} />
              <StatTile
                label="Trabadas"
                value={counts.stalled}
                tone={counts.stalled ? colors.warning : undefined}
              />
            </View>
          }
        />

        <View style={s.controls}>
          <View style={s.search}>
            <Ionicons name="search" size={15} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar por usuario o monto"
              placeholderTextColor={colors.placeholder}
              style={s.searchInput}
            />
          </View>
          <FilterPills options={filters} value={filter} onChange={setFilter} />
          <FilterPills options={ranges} value={range} onChange={setRange} />
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.list, isDesktop && s.listDesktop]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            icon={error ? 'cloud-offline-outline' : 'git-branch-outline'}
            loading={loading}
            connected={connected}
            title={
              error
                ? 'No se pudo traer el seguimiento'
                : filter === 'closed'
                  ? 'No se cerró ninguna carga en este rango'
                  : 'No hay cargas en curso'
            }
            subtitle={
              error ??
              (loads.length
                ? 'Ninguna carga entra en este filtro.'
                : 'Cuando entre un pedido vas a verlo avanzar acá, paso por paso.')
            }
          />
        ) : (
          visible.map((load) => <LoadTrail key={load.id} load={load} onDone={refresh} />)
        )}
      </ScrollView>

    </View>
  );
}

// ── Una carga ─────────────────────────────────────────────────────────────────

function LoadTrail({ load, onDone }: { load: TrackedLoad; onDone: () => void }) {
  const { trail } = load;
  const amount = parseAmount(load.amount);

  // El acento resume el estado en un color antes de que el ojo lea nada:
  // trabada o rota piden atención, lo que terminó bien no pide nada.
  const accent = trail.stalled
    ? colors.warning
    : load.status === 'COMPLETED'
      ? colors.success
      : load.status === 'FAILED'
        ? colors.error
        : trail.settled
          ? colors.textMuted
          : colors.info;

  return (
    <Card accent={accent} style={trail.stalled ? s.cardStalled : s.card}>
      <View style={s.cardHead}>
        <View style={s.identity}>
          <CopyableText
            value={load.targetUsername}
            label="Usuario"
            style={s.username}
            iconSize={12}
          />
          <Text style={s.dot}>·</Text>
          <CopyableText
            value={amount}
            display={formatMoney(amount)}
            label="Monto"
            style={s.amount}
            iconSize={12}
          />
          {!!load.panelName && <Text style={s.panel}>{load.panelName}</Text>}
        </View>
        <View style={s.headRight}>
          <Text style={s.started}>
            {trail.settled
              ? `cerrada ${formatClock(closedAt(load))} · hace ${timeAgo(closedAt(load))}`
              : `hace ${timeAgo(load.createdAt)}`}
          </Text>
        </View>
      </View>

      {trail.stalled && <StalledNotice trail={trail} />}

      <View style={s.trail}>
        {trail.steps.map((step, i) => (
          <Step key={`${step.status}-${i}`} step={step} last={i === trail.steps.length - 1} />
        ))}
      </View>

      {/* Las decisiones, al pie de la carga que las pide. */}
      <LoadActions load={toActionable(load)} onDone={onDone} />
    </Card>
  );
}

/** El único cartel de la pantalla: lleva más tiempo del esperable sin moverse. */
function StalledNotice({ trail }: { trail: TrackedLoad['trail'] }) {
  const mins = minutesSince(trail.currentSince);
  return (
    <View style={s.stalled}>
      <Ionicons name="alert-circle" size={14} color={colors.warning} />
      <Text style={s.stalledText}>
        Sin moverse hace {mins} min — {(trail.current?.label ?? '').toLowerCase()}
      </Text>
    </View>
  );
}

// ── Un paso ───────────────────────────────────────────────────────────────────

const MARKER: Record<TrailStep['state'], { icon: any; color: string }> = {
  done: { icon: 'checkmark', color: colors.success },
  current: { icon: 'ellipse', color: colors.primary },
  pending: { icon: 'ellipse-outline', color: colors.textMuted },
};

function Step({ step, last }: { step: TrailStep; last: boolean }) {
  const marker = step.broken
    ? { icon: 'close' as const, color: colors.error }
    : MARKER[step.state];

  const tone =
    step.state === 'pending'
      ? colors.textMuted
      : step.broken
        ? colors.error
        : step.state === 'current'
          ? colors.textPrimary
          : colors.textSecondary;

  return (
    <View style={s.step}>
      <View style={s.rail}>
        <View style={[s.marker, { borderColor: marker.color }]}>
          <Ionicons name={marker.icon} size={9} color={marker.color} />
        </View>
        {/* La línea baja hasta el paso siguiente: es lo que convierte una lista
            de estados en un recorrido. El último paso no la lleva. */}
        {!last && (
          <View
            style={[
              s.connector,
              { backgroundColor: step.state === 'done' ? alpha(colors.success, 0.35) : colors.border },
            ]}
          />
        )}
      </View>

      <View style={s.stepBody}>
        <View style={s.stepLine}>
          <Text
            style={[
              s.stepLabel,
              { color: tone },
              step.state === 'current' && s.stepLabelCurrent,
            ]}
          >
            {step.label}
          </Text>
          {!!step.at && <Text style={s.stepTime}>{formatClock(step.at)}</Text>}
          {step.score !== null && (
            <Text style={s.stepScore}>score {step.score.toFixed(2)}</Text>
          )}
          {step.state === 'current' && <Text style={s.here}>acá está ahora</Text>}
        </View>
        {!!step.note && (
          <Text style={s.stepNote} numberOfLines={2}>
            {step.note}
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  card: { marginBottom: space.md },
  // Borde de atención sólo en las trabadas: si todas las cards brillan, ninguna.
  cardStalled: { marginBottom: space.md, borderColor: alpha(colors.warning, 0.45) },

  head: { paddingHorizontal: space.lg, paddingTop: space.lg },
  // Sin wrap, cuatro tiles en 360px quedan ilegibles.
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

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

  // `flexWrap` en vez de un breakpoint: en un celular angosto el bloque de la
  // derecha ("cerrada 14:32 · hace 2 h") baja solo a la línea siguiente en lugar
  // de aplastar el usuario y el monto. Se acomoda a cualquier ancho, no sólo al
  // que uno eligió como umbral.
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    flexShrink: 1,
  },
  username: { ...text.bodyStrong, color: colors.textPrimary },
  dot: { ...text.body, color: colors.textMuted },
  amount: { ...text.bodyStrong, color: colors.primary },
  panel: {
    ...text.caption,
    color: colors.textMuted,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  started: { ...text.caption, color: colors.textMuted },

  stalled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: alpha(colors.warning, 0.12),
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  headRight: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md },
  stalledText: { ...text.label, color: colors.warning, flexShrink: 1 },

  trail: { gap: 0 },
  step: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: 18 },
  marker: {
    width: 16,
    height: 16,
    borderRadius: radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: { width: 2, flex: 1, minHeight: 12, marginVertical: 2 },

  stepBody: { flex: 1, paddingBottom: space.md },
  stepLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  stepLabel: { ...text.body },
  stepLabelCurrent: { ...text.bodyStrong },
  stepTime: { ...text.caption, color: colors.textMuted },
  stepScore: { ...text.caption, color: colors.textSecondary },
  here: {
    ...text.caption,
    color: colors.primary,
    backgroundColor: alpha(colors.primary, 0.14),
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  stepNote: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
});
