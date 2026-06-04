import { useState, useRef, useCallback } from 'react';
import { messagesApi } from '@/services/api';
import type { Message, InteractiveCard } from '@/components/chat/ChatBubble';

export function useMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | undefined>(undefined);
  const [messageHasMore, setMessageHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastInteractiveMessageId, setLastInteractiveMessageId] = useState<string | null>(null);

  // Persist across reconnects (C4 fix)
  const seenIds = useRef(new Set<string>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastInteractiveMessageIdRef = useRef(lastInteractiveMessageId);
  lastInteractiveMessageIdRef.current = lastInteractiveMessageId;

  /**
   * Add a bot/system message to the top of the list (newest first).
   * Optionally attach an interactive card.
   * Returns the created message for external use.
   */
  const addBotMessage = useCallback(
    (content: string, interactiveCard?: InteractiveCard) => {
      const messageId = Date.now().toString() + Math.random();
      const newMessage: Message = {
        id: messageId,
        type: 'SYSTEM',
        content,
        senderId: 'bot',
        createdAt: new Date().toISOString(),
        interactiveCard,
      };

      setMessages((prev) => {
        // Dedup: skip if most recent message has same content and is a bot message
        if (prev.length > 0 && prev[0].content === content && prev[0].senderId === 'bot' && !interactiveCard) {
          return prev;
        }
        return [newMessage, ...prev];
      });

      if (interactiveCard) {
        setLastInteractiveMessageId(messageId);
        lastInteractiveMessageIdRef.current = messageId;
      }

      return newMessage;
    },
    [],
  );

  /**
   * Disable the most recent interactive card (e.g. after user takes action).
   */
  const disableLastCard = useCallback(() => {
    const currentLastId = lastInteractiveMessageIdRef.current;
    if (!currentLastId) return;

    // Clear ref BEFORE state update to prevent double-disable race
    lastInteractiveMessageIdRef.current = null;
    setLastInteractiveMessageId(null);

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === currentLastId && msg.interactiveCard
          ? { ...msg, interactiveCard: { ...msg.interactiveCard, isDisabled: true } }
          : msg,
      ),
    );
  }, []);

  /**
   * Load initial messages for a chat.
   */
  const loadMessages = useCallback(async (chatId: string) => {
    const response = await messagesApi.getByChatId(chatId, { limit: 30 });
    // Populate seenIds to prevent duplicates from real-time events arriving after load
    for (const msg of response.messages) {
      if (msg.id) seenIds.current.add(msg.id);
    }
    setMessages((prev) => {
      // Keep local-only messages (bot cards, temp user messages) that aren't on the server
      const serverIds = new Set(response.messages.map((m: any) => m.id));
      const localOnly = prev.filter(
        (m) => (m.senderId === 'bot' || m.id.startsWith('temp-') || m.id.startsWith('proof-')) && !serverIds.has(m.id),
      );
      if (localOnly.length === 0) return response.messages;
      // Merge: server messages + local-only, sorted newest first
      const merged = [...response.messages, ...localOnly];
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return merged;
    });
    setMessageCursor(response.nextCursor);
    setMessageHasMore(response.hasMore);
  }, []);

  /**
   * Load more (older) messages — pagination.
   */
  const loadMoreMessages = useCallback(
    async (chatId: string, isOffline: boolean) => {
      if (isLoadingMore || !messageHasMore || !chatId || isOffline) return;
      setIsLoadingMore(true);
      try {
        const response = await messagesApi.getByChatId(chatId, {
          cursor: messageCursor,
          limit: 30,
        });
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = response.messages.filter((m: any) => !existingIds.has(m.id));
          return [...prev, ...newMsgs];
        });
        setMessageCursor(response.nextCursor);
        setMessageHasMore(response.hasMore);
      } finally {
        setIsLoadingMore(false);
      }
    },
    [isLoadingMore, messageHasMore, messageCursor],
  );

  /**
   * Add a new incoming message (from socket) with dedup.
   * Uses the persistent seenIds Set to prevent duplicates.
   */
  const addIncomingMessage = useCallback(
    (message: any, currentChatId: string | null) => {
      if (!message?.id) return;
      if (message.chatId && message.chatId !== currentChatId) return;
      // Ref-based dedup (handles React state batching race)
      if (seenIds.current.has(message.id)) return;
      seenIds.current.add(message.id);
      // Cap seenIds to prevent unbounded memory growth in long sessions
      if (seenIds.current.size > 500) {
        const idsArray = Array.from(seenIds.current);
        seenIds.current = new Set(idsArray.slice(-300));
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        // If this is a server echo of our own optimistic message, replace the temp instead of adding
        if (message.type === 'USER' || message.senderId) {
          const tempIdx = prev.findIndex(
            (m) => m.id.startsWith('temp-') && m.content === message.content && m.type === 'USER',
          );
          if (tempIdx !== -1) {
            const updated = [...prev];
            updated[tempIdx] = message;
            return updated;
          }
        }
        return [message, ...prev]; // Newest first (inverted FlatList)
      });
    },
    [],
  );

  /**
   * Replace a temp message id with the server-assigned id after ack.
   */
  const replaceTempId = useCallback((tempId: string, realId: string) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === tempId ? { ...msg, id: realId } : msg)),
    );
  }, []);

  /**
   * Add a local user message with an image (e.g., proof upload preview).
   * Shows the uploaded image in the chat like a sent photo.
   */
  const addUserImageMessage = useCallback((imageUrl: string) => {
    const newMessage: Message = {
      id: `proof-${Date.now()}`,
      type: 'USER',
      content: '',
      senderId: 'me',
      createdAt: new Date().toISOString(),
      imageUrl,
    };
    setMessages((prev) => [newMessage, ...prev]);
  }, []);

  /**
   * Mark all USER messages as read (triggered by messages:read socket event).
   */
  const markMessagesAsRead = useCallback(() => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.type === 'USER' && !msg.isRead
          ? { ...msg, isRead: true }
          : msg,
      ),
    );
  }, []);

  return {
    messages,
    setMessages,
    messagesRef,
    messageCursor,
    messageHasMore,
    isLoadingMore,
    seenIds,
    addBotMessage,
    addUserImageMessage,
    disableLastCard,
    loadMessages,
    loadMoreMessages,
    addIncomingMessage,
    replaceTempId,
    setMessageCursor,
    setMessageHasMore,
    markMessagesAsRead,
  };
}
