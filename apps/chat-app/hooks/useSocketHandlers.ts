import { useEffect, useRef } from 'react';
import { getSocket, joinChat } from '@/services/socket';
import { requestsApi, messagesApi } from '@/services/api';
import { useAuthStore } from '@/stores/auth.store';
import { hapticSuccess } from '@/utils/haptics';
import type { InteractiveCard } from '@/components/chat/ChatBubble';
import { type FlowState, ACTIVE_STATUSES, getFlowFromStatus } from './useChatFlow';

interface SocketHandlerDeps {
  chatIdRef: React.MutableRefObject<string | null>;
  activeRequestRef: React.MutableRefObject<{
    id: string;
    targetUsername: string;
    amount: number;
    status: string;
    createdAt: string;
    proofUrl?: string;
    chatId?: string;
    chat?: { id: string };
  } | null>;

  // Callbacks for state updates
  addIncomingMessage: (message: any, currentChatId: string | null) => void;
  addBotMessage: (content: string, card?: InteractiveCard) => void;
  setFlowState: (state: FlowState) => void;
  updateActiveRequest: (req: any | null) => void;
  setIsOperatorTyping: (v: boolean) => void;
  setWaitingForBot: (v: boolean) => void;
  setConnectionError: (v: boolean) => void;
  loadMessages: (chatId: string) => Promise<void>;
  markMessagesAsRead?: () => void;

  // For reconnect flow-state guard
  flowStateRef: React.MutableRefObject<FlowState>;
}

const SOCKET_POLL_INTERVAL_MS = 200;
const SOCKET_POLL_TIMEOUT_MS = 30_000; // C3 fix: 30s timeout

export function useSocketHandlers(deps: SocketHandlerDeps) {
  const {
    chatIdRef,
    activeRequestRef,
    addIncomingMessage,
    addBotMessage,
    setFlowState,
    updateActiveRequest,
    setIsOperatorTyping,
    setWaitingForBot,
    setConnectionError,
    loadMessages,
    flowStateRef,
  } = deps;

  const typingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ==========================================
  // MAIN SOCKET EVENT REGISTRATION
  // ==========================================
  useEffect(() => {
    let cleanupFn: (() => void) | undefined;
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let pollStartTime: number | undefined;

    // Track processed status events to prevent duplicate bot messages on reconnect
    const processedStatusEvents = new Set<string>();
    const trackStatusEvent = (eventName: string, requestId: string): boolean => {
      const key = `${eventName}:${requestId}`;
      if (processedStatusEvents.has(key)) return false;
      processedStatusEvents.add(key);
      // Cap size
      if (processedStatusEvents.size > 50) {
        const arr = Array.from(processedStatusEvents);
        processedStatusEvents.clear();
        arr.slice(-25).forEach((k) => processedStatusEvents.add(k));
      }
      return true;
    };

    const registerHandlers = (socket: ReturnType<typeof getSocket>) => {
      if (!socket) return;

      // ---- handlers ----

      const handleNewMessage = (message: any) => {
        addIncomingMessage(message, chatIdRef.current);
        // Any incoming message (bot/system/operator) means bot finished processing
        if (message.type !== 'USER') {
          setWaitingForBot(false);
        }
      };

      const handleValidationStarted = (data: any) => {
        if (data.requestId === activeRequestRef.current?.id && trackStatusEvent('validation_started', data.requestId)) {
          addBotMessage('Validando comprobante...');
          setFlowState('VALIDATING');
        }
      };

      const handleValidationCompleted = (data: any) => {
        if (data.requestId === activeRequestRef.current?.id && trackStatusEvent('validation_completed', data.requestId)) {
          addBotMessage('Tu pago fue verificado! Ahora vamos a cargar las fichas...');
        }
      };

      const handleJobStarted = (data: any) => {
        if (data.requestId === activeRequestRef.current?.id && trackStatusEvent('job_started', data.requestId)) {
          addBotMessage('Estamos cargando las fichas en tu cuenta. Esto puede tardar unos segundos...');
          setFlowState('PROCESSING');
        }
      };

      const handleJobCompleted = (data: any) => {
        if (data.requestId === activeRequestRef.current?.id && trackStatusEvent('job_completed', data.requestId)) {
          hapticSuccess();
          addBotMessage('Listo! Tus fichas ya estan en tu cuenta. Entra a jugar!');
          addBotMessage('', { type: 'GAME_LINK', props: {} });
          setFlowState('COMPLETED');
          updateActiveRequest(null);
          useAuthStore.getState().refreshBalance();
          setTimeout(() => {
            addBotMessage('Queres cargar mas fichas? Toca el boton de abajo.');
            setFlowState('IDLE');
          }, 5000);
        }
      };

      const handleJobFailed = (data: any) => {
        if (data.requestId === activeRequestRef.current?.id && trackStatusEvent('job_failed', data.requestId)) {
          addBotMessage('Hubo un problema al cargar las fichas. Un operador ya fue notificado y va a revisar tu caso. Te avisamos apenas se resuelva.');
          setFlowState('FAILED');
          updateActiveRequest(null);
          setTimeout(() => setFlowState('IDLE'), 5000);
        }
      };

      const handleValidationFailed = (data: any) => {
        if (data.requestId === activeRequestRef.current?.id && trackStatusEvent('validation_failed', data.requestId)) {
          addBotMessage('No pudimos verificar tu comprobante automaticamente. Un operador lo va a revisar en unos minutos. No hace falta que hagas nada, te avisamos.');
          setFlowState('FAILED');
        }
      };

      const handleRequestRejected = (data: any) => {
        if (data.requestId === activeRequestRef.current?.id) {
          addBotMessage('Tu solicitud fue rechazada. Podes intentar de nuevo con el boton "Cargar Fichas".');
          setFlowState('FAILED');
          updateActiveRequest(null);
          setTimeout(() => setFlowState('IDLE'), 5000);
        }
      };

      const handleOperatorTyping = (data: { chatId: string }) => {
        if (data.chatId !== chatIdRef.current) return;
        setIsOperatorTyping(true);
        if (typingIndicatorTimerRef.current) clearTimeout(typingIndicatorTimerRef.current);
        typingIndicatorTimerRef.current = setTimeout(() => {
          setIsOperatorTyping(false);
        }, 3000);
      };

      const handleOperatorAssigned = (data: { chatId: string; operatorName?: string }) => {
        if (data.chatId !== chatIdRef.current) return;
        const name = data.operatorName || 'Un operador';
        addBotMessage(`${name} se unio al chat`);
      };

      const handleBotShowCard = (data: any) => {
        if (data.chatId && data.chatId !== chatIdRef.current) return;
        setWaitingForBot(false);
        addBotMessage(data.message || '', {
          type: data.cardType as InteractiveCard['type'],
          props: data.props || {},
        });
        if (flowStateRef.current === 'IDLE') {
          setFlowState('INITIAL');
        }
      };

      // ---- subscribe ----
      socket.on('message:new', handleNewMessage);
      socket.on('validation:started', handleValidationStarted);
      socket.on('validation:completed', handleValidationCompleted);
      socket.on('job:started', handleJobStarted);
      socket.on('job:completed', handleJobCompleted);
      socket.on('job:failed', handleJobFailed);
      socket.on('validation:failed', handleValidationFailed);
      socket.on('request:rejected', handleRequestRejected);
      socket.on('operator_typing', handleOperatorTyping);
      socket.on('chat:operator_assigned', handleOperatorAssigned);
      socket.on('bot:show_card', handleBotShowCard);

      const handlePrizeClaimStatus = (data: any) => {
        if (data.message) {
          addBotMessage(data.message);
        }
      };
      socket.on('prize_claim:status_update', handlePrizeClaimStatus);

      // Read receipts: mark messages as read when operator/bot reads them
      const handleMessagesRead = () => {
        deps.markMessagesAsRead?.();
      };
      socket.on('messages:read', handleMessagesRead);

      cleanupFn = () => {
        socket.off('message:new', handleNewMessage);
        socket.off('validation:started', handleValidationStarted);
        socket.off('validation:completed', handleValidationCompleted);
        socket.off('job:started', handleJobStarted);
        socket.off('job:completed', handleJobCompleted);
        socket.off('job:failed', handleJobFailed);
        socket.off('validation:failed', handleValidationFailed);
        socket.off('request:rejected', handleRequestRejected);
        socket.off('operator_typing', handleOperatorTyping);
        socket.off('chat:operator_assigned', handleOperatorAssigned);
        socket.off('bot:show_card', handleBotShowCard);
        socket.off('prize_claim:status_update', handlePrizeClaimStatus);
        socket.off('messages:read', handleMessagesRead);
      };
    };

    // Try to register immediately, otherwise poll with 30s timeout (C3 fix)
    const socket = getSocket();
    if (socket) {
      registerHandlers(socket);
    } else {
      pollStartTime = Date.now();
      let slowedDown = false;
      pollInterval = setInterval(() => {
        const s = getSocket();
        if (s) {
          clearInterval(pollInterval!);
          pollInterval = undefined;
          registerHandlers(s);
          return;
        }
        // After 30s, slow down polling to save battery (2s instead of 200ms) but never give up
        if (!slowedDown && Date.now() - pollStartTime! > SOCKET_POLL_TIMEOUT_MS) {
          slowedDown = true;
          clearInterval(pollInterval!);
          pollInterval = setInterval(() => {
            const socket = getSocket();
            if (socket) {
              clearInterval(pollInterval!);
              pollInterval = undefined;
              registerHandlers(socket);
            }
          }, 2000);
          console.warn('[useSocketHandlers] Socket not ready after 30s, slowing poll to 2s (will keep trying)');
        }
      }, SOCKET_POLL_INTERVAL_MS);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (cleanupFn) cleanupFn();
      if (typingIndicatorTimerRef.current) clearTimeout(typingIndicatorTimerRef.current);
      setIsOperatorTyping(false);
    };
  }, []);

  // ==========================================
  // RECONNECT HANDLER
  // ==========================================
  useEffect(() => {
    const socket = getSocket();
    if (!socket?.io) return;

    const handleReconnect = async () => {
      setConnectionError(false);
      try {
        if (chatIdRef.current) joinChat(chatIdRef.current);

        if (chatIdRef.current) {
          await loadMessages(chatIdRef.current);
        }

        const allRequests = await requestsApi.getMy();
        const active = allRequests.find((r: any) => ACTIVE_STATUSES.includes(r.status));
        if (active) {
          updateActiveRequest(active);
          const newFlowState = getFlowFromStatus(active.status);
          if (newFlowState) setFlowState(newFlowState);
        } else {
          const fs = flowStateRef.current;
          if (fs !== 'INITIAL' && fs !== 'PAYMENT_PENDING' && fs !== 'PROOF_PENDING') {
            setFlowState('IDLE');
            updateActiveRequest(null);
          }
        }

        useAuthStore.getState().refreshBalance();
      } catch (e) {
        console.warn('[Chat] Failed to refresh on reconnect:', e);
      }
    };

    const handleReconnectFailed = () => setConnectionError(true);

    socket.io.on('reconnect', handleReconnect);
    socket.io.on('reconnect_failed', handleReconnectFailed);

    return () => {
      socket.io.off('reconnect', handleReconnect);
      socket.io.off('reconnect_failed', handleReconnectFailed);
    };
  }, []);
}
