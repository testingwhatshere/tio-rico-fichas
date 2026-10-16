import { useOperatorStore } from '@/stores/operator.store';
import { useAuthStore } from '@/stores/auth.store';

/**
 * ¿Todavía no llegaron los datos del servidor?
 *
 * Todas las pantallas leen del store, que arranca vacío. Mientras el
 * `initial_data` no vuelve, "no hay nada pendiente" y "no cargó todavía" se ven
 * exactamente igual, y el operador se va tranquilo con casos esperando. Peor en
 * el arranque en frío de Render, que puede tardar bastante.
 *
 * `lastUpdate` sólo tiene valor cuando el servidor ya contestó al menos una vez.
 */
export function useFirstLoad(): { isLoadingFirst: boolean; isConnected: boolean } {
  const lastUpdate = useOperatorStore((s) => s.lastUpdate);
  const isConnected = useAuthStore((s) => s.isConnected);
  return { isLoadingFirst: !lastUpdate, isConnected };
}
