/**
 * Las acciones que un operador puede tomar sobre una carga, en un solo lugar.
 *
 * Antes vivían adentro de `FailureDetailView`, que es la pantalla de la
 * Bandeja: para operar sobre una carga había que encontrarla ahí. Seguimiento
 * sólo podía cerrarla, el Historial no podía hacer nada, y desde la ficha de un
 * cliente no se podía cargar nada. Sacarlas del componente es lo que permite
 * ofrecer las mismas decisiones en todas las pantallas.
 *
 * Cada acción devuelve `null` si salió bien o el mensaje de error si no —
 * misma convención que `useActiveLoads.cancelLoad`, porque quien las llama es
 * un diálogo y necesita decidir si se cierra.
 */
import { useCallback, useState } from 'react';
import { emitWithTimeout } from '@/services/socket';

/** Aprobar hace una transacción Serializable + acumulación + despacho: 15s es
 *  poco cuando el backend viene de dormir en Render. */
const TIMEOUT_MS = 60000;

export type LoadActionResult = string | null;

async function call(event: string, payload: any): Promise<LoadActionResult> {
  try {
    const res: any = await emitWithTimeout(event, payload, TIMEOUT_MS);
    // El gateway responde `{success:false, error}`; algunos handlers viejos
    // devuelven sólo `{error}`.
    if (res?.error) return String(res.error);
    if (res && res.success === false) return 'No se pudo completar la acción';
    return null;
  } catch (e: any) {
    return e?.message || 'No se pudo completar la acción';
  }
}

export function useLoadActions() {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (event: string, payload: any): Promise<LoadActionResult> => {
      setBusy(true);
      try {
        return await call(event, payload);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    busy,

    /**
     * Aprobar la carga y mandar el bot.
     *
     * `override` es el operador diciendo "ya sé que no coincide con el
     * comprobante, cargá esto igual". Sin esa bandera el backend topea el monto
     * en lo que dice el comprobante, que es lo que dejaba casos sin salida
     * cuando el OCR no leía nada.
     */
    approve: (
      requestId: string,
      opts?: { amount?: number; note?: string; override?: boolean; overrideReason?: string },
    ) =>
      run('approve_failure', {
        failureId: requestId,
        note: opts?.note,
        approvedAmount: opts?.amount,
        amountOverride: opts?.override,
        overrideReason: opts?.overrideReason,
      }),

    /** Cargar fichas sin que haya un pedido esperando (ficha del cliente,
     *  carga ya cerrada, compensación). Crea la carga y encola el bot. */
    loadCredits: (userId: string, amount: number, note?: string) =>
      run('operator:load_credits', { userId, amount, note }),

    /** Pedirle al usuario un comprobante nuevo. No cancela: el pago sigue vigente. */
    reject: (requestId: string, reason: string) =>
      run('reject_failure', { failureId: requestId, requestId, action: 'reject', reason }),

    /** Ya se cargaron las fichas a mano: cierra sin mandar el bot. */
    markLoaded: (requestId: string, note?: string) =>
      run('mark_failure_loaded', { failureId: requestId, note }),

    /** Reintentar. Con job = mandar el bot de nuevo; sin job = volver a buscar
     *  al usuario en los paneles. */
    retry: (target: { requestId: string; jobId?: string | null }) =>
      target.jobId
        ? run('retry_job', { jobId: target.jobId })
        : run('retry_failed_request', { requestId: target.requestId }),

    /** Cerrar una carga colgada. Libera al usuario, que si no queda trabado con
     *  "Ya tenés una carga en proceso". */
    cancel: (requestId: string, reason?: string) =>
      run('operator:cancel_load', { requestId, reason }),
  };
}
