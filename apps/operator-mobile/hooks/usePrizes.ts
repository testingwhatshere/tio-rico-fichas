import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOperatorStore } from '@/stores/operator.store';
import { useAuthStore } from '@/stores/auth.store';
import { emitWithTimeout, getSocket } from '@/services/socket';
import {
  BOARD_STAGES,
  PrizeStage,
  actionablePrizes,
  claimAmount,
  groupByStage,
  prizeStage,
  sumAmounts,
} from '@/utils/prizes';

/**
 * Todos los premios, no sólo los pendientes.
 *
 * El store trae lo que el backend considera accionable (`findPending`), que es
 * lo que necesita la alerta en vivo pero no alcanza para una pantalla de
 * control: el operador también pregunta "¿a este ya le pagué?" y "¿cuánto
 * pagamos hoy?". El histórico se pide una vez con `get_prize_claims` en scope
 * 'all' y se mezcla con el store, que gana siempre porque es el que recibe los
 * updates por websocket.
 *
 * El histórico se guarda acá y no en el store a propósito: `prizeClaims` del
 * store alimenta contadores de pendientes en otras pantallas, y meterle
 * COMPLETED/REJECTED los inflaría.
 */
export function usePrizes() {
  const live = useOperatorStore((s) => s.prizeClaims);
  const isConnected = useAuthStore((s) => s.isConnected);

  const [history, setHistory] = useState<any[]>([]);
  const [loadedHistory, setLoadedHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!getSocket()?.connected) return;
    try {
      const res: any = await emitWithTimeout('get_prize_claims', { scope: 'all' }, 20000);
      if (Array.isArray(res?.data)) setHistory(res.data);
    } catch {
      // Sin histórico la pantalla sigue sirviendo: las etapas con acción salen
      // del store. No vale la pena un cartel de error por esto.
    } finally {
      setLoadedHistory(true);
    }
  }, []);

  useEffect(() => {
    if (isConnected) loadHistory();
  }, [isConnected, loadHistory]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    getSocket()?.emit('get_initial_data', {});
    await loadHistory();
    setRefreshing(false);
  }, [loadHistory]);

  // El backend decide qué está pendiente (`findPending`, que archiva lo viejo).
  // Los que sólo aparecen en el historial se marcan como no-pendientes para que
  // no vuelvan al tablero por la puerta de atrás: si no, un premio trabado hace
  // dos meses seguía apareciendo como "para retirar" aunque el servidor ya lo
  // hubiera archivado.
  const claims = useMemo(() => {
    const byId = new Map<string, any>();
    for (const c of history) byId.set(c.id, { ...c, __pending: false });
    for (const c of live) byId.set(c.id, { ...byId.get(c.id), ...c, __pending: true });
    return [...byId.values()];
  }, [history, live]);

  const byStage = useMemo(() => groupByStage(claims), [claims]);

  const totals = useMemo(() => {
    const t = {} as Record<PrizeStage, { count: number; amount: number }>;
    for (const stage of [...BOARD_STAGES, 'closed' as PrizeStage]) {
      t[stage] = { count: byStage[stage].length, amount: sumAmounts(byStage[stage]) };
    }
    return t;
  }, [byStage]);

  // Cerrado hoy: el único número del histórico que cambia una decisión del día.
  const paidToday = useMemo(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const paid = claims.filter(
      (c) =>
        c.status === 'COMPLETED' &&
        new Date(c.updatedAt || c.createdAt).getTime() >= since,
    );
    return { count: paid.length, amount: sumAmounts(paid) };
  }, [claims]);

  return {
    claims,
    byStage,
    totals,
    paidToday,
    /** Premios esperando una decisión. Mismo criterio que el badge. */
    actionable: useMemo(() => actionablePrizes(claims), [claims]),
    loadedHistory,
    refreshing,
    refresh,
  };
}

/** Sólo el número, para el badge de la navegación. Sin traer el histórico. */
export function usePendingPrizeCount(): number {
  const live = useOperatorStore((s) => s.prizeClaims);
  return useMemo(() => actionablePrizes(live).length, [live]);
}

export { prizeStage, claimAmount };
