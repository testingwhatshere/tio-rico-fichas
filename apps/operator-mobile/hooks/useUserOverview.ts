/**
 * Todo lo de un cliente, en una consulta.
 *
 * El operador pregunta por una persona, no por una tabla: qué le pasó con su
 * última carga, si tiene un premio esperando, cómo se llama en el panel. Eso
 * vivía repartido en cuatro pantallas.
 */
import { useCallback, useEffect, useState } from 'react';
import { emitWithTimeout, getSocket } from '@/services/socket';
import { ActiveLoad, buildTrail, TrackedLoad } from '@/utils/tracking';

export type UserOverview = {
  user: {
    id: string;
    username: string | null;
    savedTargetUsername: string | null;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    createdAt: string;
    panelId: string | null;
    panel: { id: string; name: string } | null;
  };
  loads: TrackedLoad[];
  prizeClaims: {
    id: string;
    amount: string | number;
    status: string;
    createdAt: string;
    targetUsername: string;
  }[];
  chatId: string | null;
};

export function useUserOverview(userId?: string) {
  const [data, setData] = useState<UserOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!userId) return;
    const socket = getSocket();
    // Igual que en el seguimiento: recién montado el socket puede no estar
    // listo, y eso no es un error que mostrarle a nadie.
    if (!socket?.connected) return;
    try {
      const res: any = await emitWithTimeout('operator:get_user_overview', { userId }, 20000);
      if (res?.success && res.data) {
        const loads: TrackedLoad[] = (res.data.loads as ActiveLoad[]).map((l) => ({
          ...l,
          trail: buildTrail(l),
        }));
        setData({ ...res.data, loads });
        setError(null);
      } else {
        setError(res?.error || 'No se pudo traer la ficha');
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo traer la ficha');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    fetch();
    const socket = getSocket();
    if (!socket) return;
    socket.on('connect', fetch);
    return () => {
      socket.off('connect', fetch);
    };
  }, [fetch]);

  return { data, loading, error, refresh: fetch };
}
