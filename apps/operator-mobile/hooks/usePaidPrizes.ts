import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { emitWithTimeout, getSocket } from '@/services/socket';
import { claimAmount } from '@/utils/prizes';

/** Un premio pagado sin nada que identifique a quién se le pagó. */
export type PaidPrize = { id: string; amount: number; paidAt: string };

/**
 * Premios pagados, para los estados de WhatsApp.
 *
 * El backend manda el claim entero (usuario, teléfono, datos de cobro). Acá se
 * recorta a monto y fecha apenas llega: lo que no entra al estado de React no
 * puede terminar en una imagen pública por error.
 *
 * `findAll` corta en 100. Alcanza para hoy y casi siempre para la semana;
 * `capped` avisa cuando no, para no publicar un total más bajo que el real.
 */
export function usePaidPrizes() {
  const isConnected = useAuthStore((s) => s.isConnected);
  const [prizes, setPrizes] = useState<PaidPrize[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!getSocket()?.connected) return;
    try {
      const res: any = await emitWithTimeout('get_prize_claims', { scope: 'completed' }, 20000);
      if (Array.isArray(res?.data)) {
        const clean = res.data
          .filter((c: any) => c.status === 'COMPLETED')
          .map((c: any) => ({
            id: String(c.id),
            amount: claimAmount(c),
            paidAt: c.updatedAt || c.createdAt,
          }))
          .filter((p: PaidPrize) => p.amount > 0)
          .sort((a: PaidPrize, b: PaidPrize) => +new Date(b.paidAt) - +new Date(a.paidAt));
        setPrizes(clean);
      }
    } catch {
      // Sin datos la pantalla muestra el vacío; reintenta con "Actualizar".
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (isConnected) load();
  }, [isConnected, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { prizes, loaded, refreshing, refresh, connected: isConnected, capped: prizes.length >= 100 };
}
