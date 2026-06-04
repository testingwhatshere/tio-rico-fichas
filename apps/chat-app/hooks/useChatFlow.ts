import { useState, useRef, useCallback } from 'react';
import { paymentApi } from '@/services/api';
import type { Message, InteractiveCard } from '@/components/chat/ChatBubble';

export type FlowState =
  | 'IDLE'
  | 'INITIAL'
  | 'AMOUNT_SELECTED'
  | 'PAYMENT_PENDING'
  | 'PROOF_PENDING'
  | 'VALIDATING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export const ACTIVE_STATUSES = ['PENDING_PROOF', 'VALIDATING', 'APPROVED', 'PROCESSING'];

interface Request {
  id: string;
  targetUsername: string;
  amount: number;
  status: string;
  createdAt: string;
  proofUrl?: string;
  chatId?: string;
  chat?: { id: string };
}

interface Wallet {
  id: string;
  type: 'MERCADOPAGO' | 'CBU' | 'CVU';
  label: string;
  holderName: string;
  details: {
    alias?: string;
    cbu?: string;
    cvu?: string;
    bank?: string;
  };
}

const STATUS_TO_FLOW: Record<string, FlowState> = {
  PENDING_PROOF: 'PAYMENT_PENDING',
  VALIDATING: 'VALIDATING',
  VALIDATION_FAILED: 'FAILED',
  PENDING_MP_VERIFICATION: 'VALIDATING',
  APPROVED: 'PROCESSING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REJECTED: 'FAILED',
  CANCELLED: 'IDLE',
};

export function getFlowFromStatus(status: string): FlowState | undefined {
  return STATUS_TO_FLOW[status];
}

export function useChatFlow() {
  const [flowState, setFlowState] = useState<FlowState>('IDLE');
  const [activeRequest, setActiveRequest] = useState<Request | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const activeRequestRef = useRef(activeRequest);
  activeRequestRef.current = activeRequest;

  const resetFlow = useCallback(() => {
    setFlowState('IDLE');
    setActiveRequest(null);
    activeRequestRef.current = null;
  }, []);

  const updateActiveRequest = useCallback((req: Request | null) => {
    setActiveRequest(req);
    activeRequestRef.current = req;
  }, []);

  /**
   * Initialize FlowState from an existing active request.
   * Calls addBotMessage to render appropriate cards/messages.
   */
  const initFlowStateFromRequest = useCallback(
    async (
      req: Request,
      _currentChatId: string,
      addBotMessage: (content: string, card?: InteractiveCard) => void,
      handlePaymentConfirmed: () => void,
      supportPhoneRef: React.MutableRefObject<string>,
    ) => {
      if (!req.proofUrl && req.status === 'PENDING_PROOF') {
        // On resume/reconnect, skip straight to proof upload.
        // The user already saw payment details in the original session.
        // Showing them again would be confusing — they need to upload the proof now.
        setFlowState('PROOF_PENDING');
        addBotMessage('Tenes una carga pendiente. Subi el comprobante de pago para continuar:', {
          type: 'PROOF_UPLOAD',
          props: {
            requestId: req.id,
          },
        });
      } else if (req.status === 'VALIDATING') {
        setFlowState('VALIDATING');
        addBotMessage('Validando comprobante...', {
          type: 'STATUS_TRACKER',
          props: { requestId: req.id },
        });
      } else if (req.status === 'APPROVED') {
        setFlowState('PROCESSING');
        addBotMessage('Comprobante aprobado! Preparando carga...', {
          type: 'STATUS_TRACKER',
          props: { requestId: req.id },
        });
      } else if (req.status === 'PROCESSING') {
        setFlowState('PROCESSING');
        addBotMessage('Cargando fichas...', {
          type: 'STATUS_TRACKER',
          props: { requestId: req.id },
        });
      } else if (req.status === 'VALIDATION_FAILED') {
        setFlowState('FAILED');
        addBotMessage('No pudimos validar tu comprobante. Un operador lo va a revisar.', {
          type: 'STATUS_TRACKER',
          props: { requestId: req.id, supportPhone: supportPhoneRef.current },
        });
      } else if (req.status === 'REJECTED') {
        setFlowState('FAILED');
        addBotMessage('Tu solicitud fue rechazada.', {
          type: 'STATUS_TRACKER',
          props: { requestId: req.id, supportPhone: supportPhoneRef.current },
        });
      } else if (req.status === 'COMPLETED') {
        setFlowState('COMPLETED');
        addBotMessage('Fichas cargadas con exito!', {
          type: 'STATUS_TRACKER',
          props: { requestId: req.id },
        });
      } else if (req.status === 'FAILED') {
        setFlowState('FAILED');
        addBotMessage('Hubo un error al cargar las fichas. Un operador va a revisar.', {
          type: 'STATUS_TRACKER',
          props: { requestId: req.id, supportPhone: supportPhoneRef.current },
        });
      }
    },
    [],
  );

  return {
    flowState,
    setFlowState,
    activeRequest,
    activeRequestRef,
    updateActiveRequest,
    wallet,
    setWallet,
    resetFlow,
    initFlowStateFromRequest,
  };
}
