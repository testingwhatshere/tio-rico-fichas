import { useCallback, useEffect, useRef, useState } from 'react';
import { emitWithTimeout, getSocket } from '@/services/socket';
import { HistoryCategory, HistoryItem } from '@/utils/history';

/** Cuántas trae por vez. Diez entran en pantalla; el resto se pide al scrollear. */
const PAGE_SIZE = 10;

/** El tipeo no dispara una consulta por letra. */
const SEARCH_DEBOUNCE_MS = 400;

type Cursor = { createdAt: string; id: string } | null;

/**
 * Historial paginado.
 *
 * Nunca pide la lista entera: arranca con una página y suma de a una a medida
 * que el operador baja. Cambiar un filtro empieza de cero, porque el cursor de
 * la búsqueda anterior no significa nada en la nueva.
 *
 * A diferencia del resto del panel, esto NO se actualiza solo con los eventos
 * del socket: es una consulta a lo que ya pasó. Refrescarla sola movería las
 * filas bajo el dedo del que está leyendo.
 */
export function useHistory(
  category: HistoryCategory,
  windowHours: number,
  search: string,
) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(!!getSocket()?.connected);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * Corta las respuestas de una consulta que ya no es la vigente.
   *
   * Sin esto, cambiar de filtro mientras la anterior está en vuelo mezcla las
   * dos listas: llega tarde la vieja y pisa a la nueva.
   */
  const queryId = useRef(0);

  const fetchPage = useCallback(
    async (from: Cursor) => {
      const socket = getSocket();
      // Igual que en Seguimiento: al montar, el socket puede no estar listo
      // todavía. Eso no es un error, es esperar.
      if (!socket?.connected) {
        setConnected(false);
        return;
      }
      setConnected(true);

      const mine = ++queryId.current;
      if (from) setLoadingMore(true);
      else setLoading(true);

      try {
        const res: any = await emitWithTimeout(
          'operator:get_history',
          {
            category: category === 'all' ? undefined : category,
            windowHours,
            search: debouncedSearch.trim() || undefined,
            cursor: from ?? undefined,
            limit: PAGE_SIZE,
          },
          20000,
        );
        if (mine !== queryId.current) return;

        if (!res?.success) {
          setError(res?.error || 'No se pudo traer el historial');
          return;
        }
        setError(null);
        setItems((prev) => (from ? [...prev, ...res.data.items] : res.data.items));
        setCursor(res.data.nextCursor);
        setHasMore(!!res.data.hasMore);
      } catch (err: any) {
        if (mine === queryId.current) {
          setError(err?.message || 'No se pudo traer el historial');
        }
      } finally {
        if (mine === queryId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [category, windowHours, debouncedSearch],
  );

  // Filtro nuevo, lista nueva.
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    fetchPage(null);
  }, [fetchPage]);

  // El socket puede conectar después de que la pantalla se montó.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onConnect = () => {
      setConnected(true);
      if (items.length === 0) fetchPage(null);
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [fetchPage, items.length]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore || !cursor) return;
    fetchPage(cursor);
  }, [loading, loadingMore, hasMore, cursor, fetchPage]);

  const refresh = useCallback(() => fetchPage(null), [fetchPage]);

  return { items, loading, loadingMore, hasMore, error, connected, loadMore, refresh };
}
