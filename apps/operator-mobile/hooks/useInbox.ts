import { useMemo } from 'react';
import { useOperatorStore } from '@/stores/operator.store';
import { buildWorkItems, WorkItem } from '@/utils/workItems';
import { TimeRangeKey, withinRange } from '@/utils/time';

/**
 * Fuente única de la bandeja.
 *
 * La usan tanto la pantalla como el badge de la navegación. Antes cada lugar
 * contaba por su cuenta y los números no coincidían: el store tenía tres
 * fórmulas distintas de "pendiente" y el badge contaba con un criterio y el
 * subtítulo de la pantalla con otro.
 *
 * Los premios no entran acá: tienen pantalla y contador propios (`usePrizes`).
 * Ver el encabezado de `utils/workItems.ts`.
 */
export function useInbox(range: TimeRangeKey = 'today'): {
  items: WorkItem[];
  total: number;
} {
  const failures = useOperatorStore((s) => s.failures);
  const outboundPayments = useOperatorStore((s) => s.outboundPayments);
  const chats = useOperatorStore((s) => s.chats);

  const items = useMemo(
    () =>
      buildWorkItems({ failures, outboundPayments, chats }).filter((i) =>
        withinRange(i.createdAt, range)
      ),
    [failures, outboundPayments, chats, range]
  );

  return { items, total: items.length };
}

/** Rango por defecto de toda la app. Lo de hoy es lo que se trabaja. */
export const DEFAULT_RANGE: TimeRangeKey = 'today';
