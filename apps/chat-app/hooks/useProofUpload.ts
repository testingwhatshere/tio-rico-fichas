import { useState, useCallback } from 'react';
import { requestsApi } from '@/services/api';
import type { FlowState } from './useChatFlow';
import type { InteractiveCard } from '@/components/chat/ChatBubble';

interface ImageFile {
  uri: string;
  type: string;
  name: string;
  file?: File;
}

interface UseProofUploadOptions {
  activeRequestRef: React.MutableRefObject<{ id: string } | null>;
  disableLastCard: () => void;
  addBotMessage: (content: string, card?: InteractiveCard) => void;
  addUserImageMessage: (imageUrl: string) => void;
  setFlowState: (state: FlowState) => void;
}

// Matches the backend's duplicate-proof error in any phrasing currently in use.
const DUPLICATE_PROOF_HINTS = [
  'comprobante ya fue utilizado',
  'usaste este comprobante',
  'ya usaste este comprobante',
  'usado en otra solicitud',
  'en otra solicitud',
];

export function useProofUpload({
  activeRequestRef,
  disableLastCard,
  addBotMessage,
  addUserImageMessage,
  setFlowState,
}: UseProofUploadOptions) {
  const [isUploading, setIsUploading] = useState(false);

  const handleProofUpload = useCallback(
    async (file: ImageFile, onProgress?: (progress: number) => void) => {
      const currentRequest = activeRequestRef.current;
      if (!currentRequest) return;

      setIsUploading(true);
      try {
        // Direct-to-Cloudinary upload (3-step: sign → upload → confirm)
        // Progress is tracked on the Cloudinary upload step
        await requestsApi.uploadProof(currentRequest.id, file, onProgress);

        // Show the uploaded image in the chat so the user sees what they sent
        addUserImageMessage(file.uri);
        disableLastCard();
        addBotMessage('Comprobante recibido! Estamos verificando tu pago...', {
          type: 'STATUS_TRACKER',
          props: { requestId: currentRequest.id },
        });
        setFlowState('VALIDATING');
      } catch (error: any) {
        console.error('Upload error:', error?.response?.status, error?.response?.data, error?.message);

        try {
          const rawMessage =
            error?.response?.data?.message ||
            error?.response?.data?.error?.message ||
            error?.message ||
            'Error desconocido';
          const message = String(rawMessage).toLowerCase();

          const isDuplicate = DUPLICATE_PROOF_HINTS.some((hint) => message.includes(hint));
          if (isDuplicate) {
            addBotMessage('Este comprobante ya fue usado en otra solicitud. Toca "Cambiar archivo" y subi uno diferente.');
          } else if (message.includes('10mb') || message.includes('excede')) {
            addBotMessage('El archivo es demasiado grande (max 10MB). Intenta con una imagen mas chica.');
          } else if (message.includes('not configured') || message.includes('cloudinary')) {
            addBotMessage('El servicio de subida de archivos no esta disponible. Contacta soporte.');
          } else {
            addBotMessage(`No pudimos subir el comprobante. ${rawMessage.length < 100 ? rawMessage : 'Verifica tu conexion e intenta de nuevo.'}`);
          }
        } catch (botMsgError) {
          console.error('Failed to show upload error in chat:', botMsgError);
        }
      } finally {
        setIsUploading(false);
      }
    },
    [activeRequestRef, disableLastCard, addBotMessage, addUserImageMessage, setFlowState],
  );

  return {
    handleProofUpload,
    isUploading,
  };
}
