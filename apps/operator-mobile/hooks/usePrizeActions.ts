import { useCallback, useState } from 'react';

import { useOperatorStore } from '@/stores/operator.store';
import { emitWithTimeout } from '@/services/socket';
import { toast } from '@/components/Toast';
import type { PayoutProof } from '@/components/PayoutProofDialog';
import { formatMoney } from '@/utils/amount';
import { claimAmount, prizeUsername } from '@/utils/prizes';

/**
 * Las tres cosas que un operador le puede hacer a un premio.
 *
 * Viven acá y no en la pantalla porque ahora hay dos lugares que las disparan:
 * el detalle y las tarjetas del tablero. Duplicarlas era garantizar que una de
 * las dos copias se olvidara del `updatePrizeClaim` optimista y dejara la UI
 * mostrando un estado viejo hasta el próximo refresh.
 */
export function usePrizeActions() {
  const updatePrizeClaim = useOperatorStore((s) => s.updatePrizeClaim);
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = useCallback(
    async (claim: any, event: string, payload: any, ok: string, patch: any) => {
      if (busyId) return false;
      setBusyId(claim.id);
      try {
        const res: any = await emitWithTimeout(event, { claimId: claim.id, ...payload }, 30000);
        if (res && res.success === false) throw new Error(res.error || 'No se pudo completar');
        updatePrizeClaim(claim.id, patch);
        toast.success(ok);
        return true;
      } catch (e: any) {
        toast.error(e?.message || 'No se pudo completar la acción');
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, updatePrizeClaim],
  );

  /** Manda al bot a retirarle las fichas del panel. También sirve de reintento. */
  const process = useCallback(
    (claim: any) =>
      run(claim, 'operator:process_prize_claim', {}, 'El bot está retirando las fichas', {
        status: 'PROCESSING',
      }),
    [run],
  );

  /**
   * El operador ya miró el panel y confirma que están las fichas. No retira
   * nada: deja el premio listo para que se apruebe el retiro.
   */
  const markVerified = useCallback(
    (claim: any) =>
      run(claim, 'operator:verify_prize_claim', {}, 'Marcado como verificado', {
        status: 'VERIFIED',
        rejectionReason: null,
        verifyAttempt: null,
      }),
    [run],
  );

  /**
   * El operador retiró las fichas a mano en el panel. No dispara al bot: el
   * premio queda listo para pagar.
   */
  const markChipsWithdrawn = useCallback(
    (claim: any) =>
      run(
        claim,
        'operator:mark_chips_withdrawn',
        {},
        'Marcado como retirado — falta pagarle',
        { status: 'CHIPS_WITHDRAWN', rejectionReason: null, verifyAttempt: null },
      ),
    [run],
  );

  const reject = useCallback(
    (claim: any, reason: string) => {
      if (!reason.trim()) {
        toast.error('Escribí el motivo');
        return Promise.resolve(false);
      }
      return run(claim, 'operator:reject_prize_claim', { reason: reason.trim() }, 'Premio rechazado', {
        status: 'REJECTED',
        rejectionReason: reason.trim(),
      });
    },
    [run],
  );

  /**
   * Cierra el premio como pagado.
   *
   * Los comprobantes ya vienen subidos (los sube `PayoutProofDialog` a medida
   * que el operador los elige). Son obligatorios: el backend los exige y además
   * se le mandan al usuario por chat.
   */
  const payWithProofs = useCallback(
    async (claim: any, proofs: PayoutProof[]) => {
      if (busyId) return false;
      if (!proofs?.length) {
        toast.error('Adjuntá al menos un comprobante');
        return false;
      }
      setBusyId(claim.id);
      try {
        const res: any = await emitWithTimeout(
          'operator:complete_prize_claim',
          {
            claimId: claim.id,
            proofs,
            // Compatibilidad: si el backend todavía no tiene el deploy con
            // `proofs`, al menos guarda el primero en vez de fallar.
            proofUrl: proofs[0].url,
            proofType: proofs[0].type,
          },
          45000,
        );
        if (res && res.success === false) throw new Error(res.error || 'No se pudo completar');
        updatePrizeClaim(claim.id, {
          status: 'COMPLETED',
          payoutProofUrl: proofs[0].url,
          payoutProofType: proofs[0].type,
          payoutProofs: proofs,
        });
        toast.success(
          `Pagado ${formatMoney(claimAmount(claim))} a ${prizeUsername(claim)} — se ${
            proofs.length > 1 ? `le mandaron los ${proofs.length} comprobantes` : 'le mandó el comprobante'
          }`,
        );
        return true;
      } catch (e: any) {
        toast.error(e?.message || 'No se pudo completar el premio');
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, updatePrizeClaim],
  );

  return {
    busyId,
    isBusy: (id: string) => busyId === id,
    busy: busyId !== null,
    process,
    markVerified,
    markChipsWithdrawn,
    reject,
    payWithProofs,
  };
}
