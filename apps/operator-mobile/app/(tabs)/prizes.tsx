import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useLayout } from '@/hooks/useLayout';
import { usePrizes } from '@/hooks/usePrizes';
import { usePrizeActions } from '@/hooks/usePrizeActions';
import { useFirstLoad } from '@/hooks/useFirstLoad';
import PrizeCard, { ClosedPrizeRow } from '@/components/PrizeCard';
import PrizeDetailView from '@/components/PrizeDetailView';
import PayoutProofDialog, { PayoutProof } from '@/components/PayoutProofDialog';
import { PageHeader, EmptyState, ConfirmDialog } from '@/components/ui';
import { formatMoney } from '@/utils/amount';
import {
  BOARD_STAGES,
  PRIZE_STAGES,
  PrizeAction,
  PrizeStage,
  claimAmount,
  groupByStage,
  prizeUsername,
} from '@/utils/prizes';
import { clearPrizeAlerts } from '@/services/webNotifications';
import { colors, space, radius, text, alpha } from '@/constants/theme';

type ViewMode = 'board' | 'closed';

/**
 * Premios.
 *
 * Los premios salieron de la bandeja general porque no son casos sueltos que se
 * resuelven y desaparecen: son un flujo con etapas, y el operador necesita ver
 * el flujo entero —cuánta plata está comprometida en cada tramo— y no una fila
 * más entre fallos de carga y chats.
 *
 * El tablero es el estado del dinero: cada columna es una etapa y cada tarjeta
 * trae lo que hace falta para actuar (monto, a dónde transferir, cuánto lleva
 * esperando) más su acción, sin abrir nada.
 */
export default function PrizesScreen() {
  const { isDesktop } = useLayout();
  const { isLoadingFirst, isConnected } = useFirstLoad();
  const { claims, byStage, totals, paidToday, loadedHistory, refreshing, refresh } = usePrizes();
  const actions = usePrizeActions();

  const [mode, setMode] = useState<ViewMode>('board');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ claim: any; action: PrizeAction } | null>(null);
  // Pagar tiene su propio diálogo: hay que adjuntar uno o varios comprobantes,
  // no alcanza con confirmar.
  const [payFor, setPayFor] = useState<any | null>(null);
  const [rejectFor, setRejectFor] = useState<any | null>(null);
  const [reason, setReason] = useState('');

  // Con el detalle abierto la lista se angosta: el tablero de columnas no entra
  // y pasa a la misma vista apilada que en celular.
  const wide = isDesktop && !selectedId;

  // Entrar acá es haber visto los premios nuevos: se apaga el contador del
  // título de la pestaña.
  React.useEffect(() => {
    clearPrizeAlerts();
  }, [totals.pay.count, totals.withdraw.count, totals.stuck.count]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return byStage;
    const match = (c: any) =>
      prizeUsername(c).toLowerCase().includes(q) ||
      String(claimAmount(c)).includes(q) ||
      JSON.stringify(c.paymentDetails ?? '').toLowerCase().includes(q);
    return groupByStage(claims.filter(match));
  }, [byStage, claims, query]);

  // Columnas siempre presentes: pagar y retirar son el trabajo. Trabados y en
  // curso sólo aparecen si tienen algo — una columna vacía permanente enseña al
  // ojo a ignorar ese pedazo de pantalla.
  const stages = useMemo(
    () => BOARD_STAGES.filter((st) => st === 'pay' || st === 'withdraw' || groups[st].length > 0),
    [groups],
  );

  const pending = totals.pay.count + totals.withdraw.count + totals.stuck.count;
  // Sólo es "cargando" mientras no llegó nada por ninguna de las dos vías. Con
  // premios en pantalla el subtítulo decía "buscando…" encima de la lista que
  // el operador ya estaba leyendo.
  const stillLoading = claims.length === 0 && !loadedHistory && isLoadingFirst;
  const selected = selectedId ? claims.find((c) => c.id === selectedId) : null;

  const openAction = (claim: any, action: PrizeAction) => {
    // Pagar necesita comprobantes, no una confirmación: va a su propio diálogo.
    if (action.kind === 'pay') setPayFor(claim);
    else setDialog({ claim, action });
  };

  const runAction = async () => {
    if (!dialog) return;
    await actions.process(dialog.claim);
    setDialog(null);
  };

  const pay = async (proofs: PayoutProof[]) => {
    if (!payFor) return;
    const ok = await actions.payWithProofs(payFor, proofs);
    if (ok) {
      if (selectedId === payFor.id) setSelectedId(null);
      setPayFor(null);
    }
  };

  const doReject = async () => {
    if (!rejectFor) return;
    const ok = await actions.reject(rejectFor, reason);
    if (ok) {
      if (selectedId === rejectFor.id) setSelectedId(null);
      setRejectFor(null);
      setReason('');
    }
  };

  const board = (
    <>
      <View style={[s.tiles, !wide && s.tilesWrap]}>
        <MoneyTile
          label="Falta pagarles"
          amount={totals.pay.amount}
          count={totals.pay.count}
          color={colors.primary}
          icon="cash-outline"
          note="fichas ya retiradas"
          wide={wide}
        />
        <MoneyTile
          label="Para retirar"
          amount={totals.withdraw.amount}
          count={totals.withdraw.count}
          color={colors.warning}
          icon="download-outline"
          note="esperan al bot"
          wide={wide}
        />
        {totals.stuck.count > 0 && (
          <MoneyTile
            label="Trabados"
            amount={totals.stuck.amount}
            count={totals.stuck.count}
            color={colors.error}
            icon="alert-circle-outline"
            note="falló el retiro"
            wide={wide}
          />
        )}
        <MoneyTile
          label="Pagado (24 h)"
          amount={paidToday.amount}
          count={paidToday.count}
          color={colors.success}
          icon="checkmark-done-outline"
          note="ya transferido"
          wide={wide}
        />
      </View>

      {wide ? (
        <View style={s.board}>
          {stages.map((stage) => (
            <View key={stage} style={s.column}>
              <ColumnHeader stage={stage} count={groups[stage].length} amount={sum(groups[stage])} />
              <ScrollView contentContainerStyle={s.columnList} showsVerticalScrollIndicator={false}>
                {groups[stage].map((claim) => (
                  <PrizeCard
                    key={claim.id}
                    claim={claim}
                    busy={actions.isBusy(claim.id)}
                    selected={selectedId === claim.id}
                    onPress={() => setSelectedId(claim.id)}
                    onAction={openAction}
                  />
                ))}
                {groups[stage].length === 0 && (
                  <Text style={s.columnEmpty}>Nada acá.</Text>
                )}
              </ScrollView>
            </View>
          ))}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.stackList}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
          }
        >
          {stages.map((stage) =>
            groups[stage].length === 0 && stage !== 'pay' ? null : (
              <View key={stage} style={s.section}>
                <ColumnHeader stage={stage} count={groups[stage].length} amount={sum(groups[stage])} />
                {groups[stage].map((claim) => (
                  <PrizeCard
                    key={claim.id}
                    claim={claim}
                    busy={actions.isBusy(claim.id)}
                    selected={selectedId === claim.id}
                    compact={Boolean(selectedId)}
                    onPress={() => setSelectedId(claim.id)}
                    onAction={openAction}
                  />
                ))}
                {groups[stage].length === 0 && <Text style={s.columnEmpty}>Nada acá.</Text>}
              </View>
            ),
          )}
        </ScrollView>
      )}
    </>
  );

  const closed = (
    <ScrollView
      contentContainerStyle={s.closedList}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      {!loadedHistory && groups.closed.length === 0 ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.loadingText}>Trayendo el historial…</Text>
        </View>
      ) : groups.closed.length === 0 ? (
        <EmptyState
          icon="file-tray-outline"
          title={query ? 'Ningún premio cerrado coincide' : 'Todavía no hay premios cerrados'}
          subtitle={query ? 'Probá con otro nombre o monto.' : undefined}
        />
      ) : (
        groups.closed.map((claim) => (
          <ClosedPrizeRow key={claim.id} claim={claim} onPress={() => setSelectedId(claim.id)} />
        ))
      )}
    </ScrollView>
  );

  return (
    <View style={s.split}>
      <View style={selectedId ? s.listPane : s.screen}>
        <PageHeader
          title="Premios"
          subtitle={
            stillLoading
              ? isConnected
                ? 'Buscando premios pendientes…'
                : 'Conectando con el servidor…'
              : pending
                ? `${pending} ${pending === 1 ? 'premio espera' : 'premios esperan'} — ${formatMoney(
                    totals.pay.amount + totals.withdraw.amount + totals.stuck.amount,
                  )} comprometidos`
                : 'Ningún premio pendiente'
          }
          right={
            <Pressable onPress={refresh} style={s.refresh}>
              <Ionicons name="refresh" size={18} color={colors.textSecondary} />
            </Pressable>
          }
        />

        <View style={s.toolbar}>
          <View style={s.modes}>
            <ModeTab label="Tablero" active={mode === 'board'} onPress={() => setMode('board')} count={pending} />
            <ModeTab
              label="Cerrados"
              active={mode === 'closed'}
              onPress={() => setMode('closed')}
              count={totals.closed.count}
            />
          </View>
          <View style={s.search}>
            <Ionicons name="search" size={14} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar usuario, monto o CBU"
              placeholderTextColor={colors.placeholder}
              style={s.searchInput}
            />
            {!!query && (
              <Pressable onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={14} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
        </View>

        {mode === 'board' ? board : closed}
      </View>

      {selectedId && (
        <View style={s.detailPane}>
          <PrizeDetailView
            id={selectedId}
            fallbackClaim={selected}
            onClose={() => setSelectedId(null)}
            embedded
          />
        </View>
      )}

      <ConfirmDialog
        visible={Boolean(dialog)}
        title={dialog?.action.kind === 'retry' ? 'Reintentar retiro' : 'Retirar fichas'}
        message={
          dialog
            ? [
                `El bot le retira las fichas a ${prizeUsername(dialog.claim)} del panel. Después vas a tener que transferirle ${formatMoney(claimAmount(dialog.claim))}.`,
                // Sin verificación automática confirmada, el saldo lo garantiza
                // el operador: que quede dicho antes de apretar.
                ['PENDING_VERIFICATION', 'VERIFYING_CHIPS', 'VERIFICATION_FAILED'].includes(
                  dialog.claim.status,
                )
                  ? 'Todavía no se pudo confirmar el saldo en el panel: asegurate de que tenga las fichas antes de seguir.'
                  : null,
              ]
                .filter(Boolean)
                .join('\n\n')
            : undefined
        }
        confirmLabel={dialog?.action.kind === 'retry' ? 'Reintentar' : 'Retirar'}
        tone="primary"
        loading={actions.busy}
        onConfirm={runAction}
        onCancel={() => setDialog(null)}
      >
        {!!dialog && (
          <Pressable
            onPress={() => {
              setRejectFor(dialog.claim);
              setDialog(null);
            }}
            style={s.linkRow}
          >
            <Ionicons name="close-circle-outline" size={15} color={colors.textSecondary} />
            <Text style={s.linkText}>Rechazar este premio en vez de retirarlo</Text>
          </Pressable>
        )}
      </ConfirmDialog>

      <PayoutProofDialog
        visible={Boolean(payFor)}
        claim={payFor}
        busy={payFor ? actions.isBusy(payFor.id) : false}
        onCancel={() => setPayFor(null)}
        onConfirm={pay}
      />

      <ConfirmDialog
        visible={Boolean(rejectFor)}
        title="Rechazar premio"
        message={
          rejectFor
            ? `Se rechaza el pedido de ${formatMoney(claimAmount(rejectFor))} de ${prizeUsername(rejectFor)}.`
            : undefined
        }
        confirmLabel="Rechazar"
        tone="danger"
        loading={actions.busy}
        onConfirm={doReject}
        onCancel={() => {
          setRejectFor(null);
          setReason('');
        }}
      >
        <TextInput
          style={s.input}
          placeholder="Motivo (se lo ve el usuario)"
          placeholderTextColor={colors.placeholder}
          value={reason}
          onChangeText={setReason}
        />
      </ConfirmDialog>
    </View>
  );
}

function sum(claims: any[]): number {
  return claims.reduce((acc, c) => acc + claimAmount(c), 0);
}

/**
 * El número que importa es la plata, no la cantidad.
 *
 * "3 premios pendientes" no dice nada; "$180.000 sin transferir" decide si el
 * operador atiende esto ahora o después del almuerzo.
 */
function MoneyTile({
  label, amount, count, color, icon, note, wide,
}: {
  label: string;
  amount: number;
  count: number;
  color: string;
  icon: string;
  note: string;
  wide: boolean;
}) {
  return (
    <View style={[s.tile, { borderTopColor: color }, !wide && s.tileNarrow]}>
      <View style={s.tileHead}>
        <Ionicons name={icon as any} size={14} color={color} />
        <Text style={s.tileLabel}>{label}</Text>
      </View>
      <Text style={[s.tileAmount, count === 0 && { color: colors.textMuted }]}>
        {formatMoney(amount)}
      </Text>
      <Text style={s.tileNote}>
        {count} {count === 1 ? 'premio' : 'premios'} · {note}
      </Text>
    </View>
  );
}

function ColumnHeader({ stage, count, amount }: { stage: PrizeStage; count: number; amount: number }) {
  const meta = PRIZE_STAGES[stage];
  return (
    <View style={s.columnHead}>
      <View style={s.columnTitleRow}>
        <View style={[s.columnDot, { backgroundColor: meta.color }]} />
        <Text style={s.columnTitle}>{meta.label}</Text>
        <View style={[s.columnCount, { backgroundColor: alpha(meta.color, 0.16) }]}>
          <Text style={[s.columnCountText, { color: meta.color }]}>{count}</Text>
        </View>
        <Text style={s.columnAmount}>{count ? formatMoney(amount) : ''}</Text>
      </View>
      <Text style={s.columnHint}>{meta.hint}</Text>
    </View>
  );
}

function ModeTab({
  label, active, onPress, count,
}: { label: string; active: boolean; onPress: () => void; count: number }) {
  return (
    <Pressable onPress={onPress} style={[s.modeTab, active && s.modeTabActive]}>
      <Text style={[s.modeText, active && s.modeTextActive]}>{label}</Text>
      {count > 0 && (
        <Text style={[s.modeCount, active && s.modeCountActive]}>{count}</Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  split: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  listPane: {
    width: 400,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  detailPane: { flex: 1 },
  refresh: { padding: space.sm, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    flexWrap: 'wrap',
  },
  modes: { flexDirection: 'row', gap: space.xs, backgroundColor: colors.cardBackground, borderRadius: radius.md, padding: 3 },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  modeTabActive: { backgroundColor: colors.surfaceElevated },
  modeText: { ...text.label, color: colors.textSecondary },
  modeTextActive: { color: colors.textPrimary },
  modeCount: { ...text.caption, color: colors.textMuted },
  modeCountActive: { color: colors.primary },

  search: {
    flex: 1,
    minWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  searchInput: { ...text.body, color: colors.textPrimary, flex: 1, outlineStyle: 'none' } as any,

  tiles: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg },
  tilesWrap: { flexWrap: 'wrap' },
  tile: {
    flex: 1,
    minWidth: 150,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderTopWidth: 2,
    padding: space.md,
    gap: 2,
  },
  tileNarrow: { flexBasis: '46%' },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tileLabel: { ...text.caption, color: colors.textSecondary },
  tileAmount: { ...text.display, color: colors.textPrimary },
  tileNote: { ...text.caption, color: colors.textMuted },

  board: { flex: 1, flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg },
  column: {
    flex: 1,
    minWidth: 0,
    backgroundColor: alpha(colors.backgroundSecondary, 0.6),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  columnList: { padding: space.sm, gap: space.sm },
  columnHead: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm, gap: 3 },
  columnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  columnDot: { width: 7, height: 7, borderRadius: radius.full },
  columnTitle: { ...text.bodyStrong, color: colors.textPrimary },
  columnCount: { paddingHorizontal: 6, borderRadius: radius.full },
  columnCountText: { ...text.caption, fontWeight: '700' },
  columnAmount: { ...text.caption, color: colors.textSecondary, flex: 1, textAlign: 'right' },
  columnHint: { ...text.caption, color: colors.textMuted, lineHeight: 15 },
  columnEmpty: { ...text.caption, color: colors.textMuted, padding: space.md, textAlign: 'center' },

  stackList: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.lg },
  section: { gap: space.sm },

  closedList: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  loading: { padding: space.xl, alignItems: 'center', gap: space.sm },
  loadingText: { ...text.body, color: colors.textMuted },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'center' },
  linkText: { ...text.caption, color: colors.textSecondary, textDecorationLine: 'underline' },
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
});
