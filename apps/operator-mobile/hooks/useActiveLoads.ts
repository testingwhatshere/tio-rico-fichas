import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emitWithTimeout, getSocket } from '@/services/socket';
import { ActiveLoad, TrackedLoad, sortForOperator, track } from '@/utils/tracking';

/** Cada cuánto se recalculan los tiempos relativos y el "está trabada". */
const TICK_MS = 20_000;
/** Cada cuántos ticks se vuelve a pedir la lista al servidor. */
// Cada 3 min (9 × 20 s). Antes era cada minuto, por cada operador con la
// pestaña abierta, y cada consulta viaja desde Supabase (egress cobrado). Lo
// inmediato ya llega por los eventos de socket; esto sólo atrapa las
// transiciones que no emiten nada.
const REFETCH_EVERY_TICKS = 9;

/**
 * Eventos que ya emite el backend a los operadores y que cambian el recorrido
 * de alguna carga.
 *
 * Traen sólo el caso que cambió, pero acá se vuelve a pedir la lista entera: el
 * evento no dice en qué paso quedó ni actualiza el historial, y sin el historial
 * no hay recorrido que dibujar. Son ≤60 filas con índice, no vale la pena
 * inventar un merge incremental que se desincronice.
 */
const CHANGE_EVENTS = [
  'job_status',
  'job_failed',
  'validation_failed',
  'validation_completed',
  'request:rejected',
  // Otro operador cerró una carga colgada: tiene que desaparecer de mi tablero
  // también, o dos personas terminan mirando la misma carga muerta.
  'load_cancelled',
];

/** Ráfaga de eventos = una sola consulta. */
const DEBOUNCE_MS = 800;

export function useActiveLoads(windowHours: number, includeClosed: boolean) {
  const [loads, setLoads] = useState<ActiveLoad[]>([]);
  /** Todavía no llegó ninguna respuesta del servidor. */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(!!getSocket()?.connected);
  // Fuerza el recálculo de "hace 3 min" y de las trabadas sin pedir nada.
  const [tick, setTick] = useState(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLoads = useCallback(async () => {
    const socket = getSocket();
    // Trampa conocida: la pantalla se monta antes de que el socket conecte y
    // `emitWithTimeout` rechaza con "Socket not connected". Eso no es un error
    // que mostrarle al operador — es que todavía no arrancó. Se queda cargando
    // y el listener de `connect` vuelve a pedirlo.
    if (!socket?.connected) {
      setConnected(false);
      return;
    }
    setConnected(true);
    try {
      const res: any = await emitWithTimeout(
        'operator:get_active_loads',
        { windowHours, includeClosed },
        20000,
      );
      if (res?.success && Array.isArray(res.data)) {
        setLoads(res.data);
        setError(null);
      } else {
        setError(res?.error || 'No se pudo traer el seguimiento');
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo traer el seguimiento');
    } finally {
      setLoading(false);
    }
  }, [windowHours, includeClosed]);

  const scheduleFetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fetchLoads, DEBOUNCE_MS);
  }, [fetchLoads]);

  // Cambiar de rango o pedir las cerradas es otra consulta: se vacía lo que hay
  // para no mostrar por un segundo la lista anterior como si fuera la nueva.
  useEffect(() => {
    setLoads([]);
    setLoading(true);
  }, [windowHours, includeClosed]);

  useEffect(() => {
    fetchLoads();

    const socket = getSocket();
    if (!socket) return;

    const onConnect = () => {
      setConnected(true);
      fetchLoads();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    CHANGE_EVENTS.forEach((ev) => socket.on(ev, scheduleFetch));

    let ticks = 0;
    let missed = false;
    // Un solo intervalo para las dos cosas: los tiempos se recalculan siempre,
    // y cada REFETCH_EVERY_TICKS vueltas además se vuelve a consultar. El repaso periódico hace
    // falta porque hay transiciones que no emiten nada a los operadores
    // (PENDING_PROOF → VALIDATING, por ejemplo): sin esto una carga se quedaría
    // dibujada en un paso que ya pasó.
    const interval = setInterval(() => {
      ticks += 1;
      setTick((t) => t + 1);
      // Con la pestaña oculta no se consulta: nadie la está mirando, y al
      // volver se repasa enseguida (ver `onVisibility`).
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (ticks % REFETCH_EVERY_TICKS === 0) {
        if (hidden) missed = true;
        else fetchLoads();
      }
    }, TICK_MS);

    // Al volver a la pestaña, si se salteó algún repaso mientras estaba oculta.
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (!document.hidden && missed) {
        missed = false;
        fetchLoads();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      CHANGE_EVENTS.forEach((ev) => socket.off(ev, scheduleFetch));
      clearInterval(interval);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchLoads, scheduleFetch]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLoads();
    setRefreshing(false);
  }, [fetchLoads]);

  /**
   * Cierra una carga colgada.
   *
   * Devuelve el error en texto en vez de tirar, porque el que llama es un
   * diálogo de confirmación: lo que necesita es qué decirle al operador, no una
   * excepción. El backend rechaza lo que no se puede cerrar (una carga que el
   * bot ya tomó, por ejemplo) y ese mensaje es el que se muestra tal cual.
   */
  const cancelLoad = useCallback(
    async (requestId: string, reason?: string): Promise<string | null> => {
      if (!getSocket()?.connected) return 'Sin conexión con el servidor.';
      try {
        const res: any = await emitWithTimeout(
          'operator:cancel_load',
          { requestId, reason },
          20000,
        );
        if (!res?.success) return res?.error || 'No se pudo cerrar la carga';
        await fetchLoads();
        return null;
      } catch (err: any) {
        return err?.message || 'No se pudo cerrar la carga';
      }
    },
    [fetchLoads],
  );

  // Depende del tick a propósito: "trabada" es una función del reloj, así que
  // se recalcula sola aunque no llegue ningún dato nuevo.
  const tracked: TrackedLoad[] = useMemo(
    () => sortForOperator(track(loads)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loads, tick],
  );

  const counts = useMemo(
    () => ({
      active: tracked.filter((l) => !l.trail.settled).length,
      stalled: tracked.filter((l) => l.trail.stalled).length,
      // Sin número: las cerradas sólo se traen cuando se pide ese filtro, así
      // que un contador acá diría 0 mientras se miran las que están en curso.
      closed: undefined as number | undefined,
    }),
    [tracked],
  );

  return {
    loads: tracked,
    counts,
    /** Sólo mientras no llegó nada: con datos en pantalla no se dice "cargando". */
    loading: loading && loads.length === 0,
    connected,
    /** Sólo se muestra si además no hay nada que mirar. */
    error: loads.length === 0 ? error : null,
    refreshing,
    refresh,
    cancelLoad,
  };
}
