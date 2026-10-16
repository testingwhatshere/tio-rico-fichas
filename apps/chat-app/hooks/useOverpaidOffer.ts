import { useCallback, useRef } from 'react';
import { requestsApi } from '@/services/api';
import type { InteractiveCard } from '@/components/chat/ChatBubble';
import type { FlowState } from './useChatFlow';

export type OverpaidOffer = {
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  requestedAmount: number;
  offeredAmount: number;
};

interface UseOverpaidOfferOptions {
  addBotMessage: (content: string, card?: InteractiveCard) => void;
  setFlowState: (state: FlowState) => void;
  updateActiveRequest: (req: any | null) => void;
  handleAmountSelected?: (amount: number) => Promise<void> | void;
}

/**
 * Transferiste de mas: el backend deja la carga esperando y le pregunta al
 * jugador si carga el monto del comprobante. Aceptar sigue el camino normal
 * (aprobada → bot). Rechazar la manda a un operador y libera al jugador para
 * empezar otra carga con un comprobante distinto.
 */
export function useOverpaidOffer({
  addBotMessage,
  setFlowState,
  updateActiveRequest,
  handleAmountSelected,
}: UseOverpaidOfferOptions) {
  // Una sola tarjeta por carga, aunque el evento llegue dos veces (reconexion).
  const shownRef = useRef(new Set<string>());

  const showOverpaidOffer = useCallback(
    (requestId: string, offer: OverpaidOffer) => {
      if (offer?.status !== 'PENDING' || shownRef.current.has(requestId)) return;
      shownRef.current.add(requestId);

      const onRespond = async (accept: boolean) => {
        await requestsApi.respondOverpaidOffer(requestId, accept);
        if (accept) {
          setFlowState('PROCESSING');
          return;
        }
        // La carga queda con un operador; el jugador puede seguir cargando.
        updateActiveRequest(null);
        setFlowState('IDLE');
        if (handleAmountSelected) {
          addBotMessage(
            'Un operador va a revisar esa transferencia. Si hiciste otra transferencia, podes empezar una carga nueva:',
            { type: 'AMOUNT_SELECTOR', props: { onAmountSelected: handleAmountSelected } },
          );
        } else {
          addBotMessage('Un operador va a revisar esa transferencia. Te avisamos cuando este resuelto.');
        }
      };

      setFlowState('VALIDATING');
      addBotMessage('', {
        type: 'OVERPAID_OFFER',
        props: {
          requestedAmount: Number(offer.requestedAmount),
          offeredAmount: Number(offer.offeredAmount),
          onRespond,
        },
      });
    },
    [addBotMessage, setFlowState, updateActiveRequest, handleAmountSelected],
  );

  return { showOverpaidOffer };
}
