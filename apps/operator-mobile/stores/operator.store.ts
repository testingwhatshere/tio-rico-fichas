import { create } from 'zustand';

const MAX_RECENT_MESSAGE_IDS = 200;
const MAX_PROCESSED_FAILURE_IDS = 500;
const MAX_QUICK_REPLIES = 20;
const PENDING_PRIZE_STATUSES = ['VERIFIED', 'CHIPS_WITHDRAWN', 'PROCESSING', 'FAILED'];

// Unified resolved-failure check. Backend emits `resolvedAt` (ISO string);
// older code paths and the desktop panel set `resolved` (boolean). Treat either as resolved.
export const isFailureResolved = (f: any): boolean =>
  Boolean(f && (f.resolvedAt || f.resolved === true));

export interface QuickReply {
  id: string;
  icon: string;
  label: string;
  text: string;
  order: number;
}

export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'default_1', icon: '👋', label: 'Saludo', text: 'Hola! En que te puedo ayudar?', order: 0 },
  { id: 'default_2', icon: '⏳', label: 'Procesando', text: 'Tu solicitud esta siendo procesada. Te aviso cuando este lista!', order: 1 },
  { id: 'default_3', icon: '✅', label: 'Completado', text: 'Listo! Las fichas ya fueron cargadas. Verifica en tu cuenta.', order: 2 },
  { id: 'default_4', icon: '📎', label: 'Reenviar', text: 'Necesito que reenvies el comprobante de pago, no se pudo validar.', order: 3 },
  { id: 'default_5', icon: '💰', label: 'Monto', text: 'El monto del comprobante no coincide con el solicitado. Podes verificar?', order: 4 },
  { id: 'default_6', icon: '👋', label: 'Despedida', text: 'Cualquier cosa que necesites, estoy aca. Saludos!', order: 5 },
];

interface OperatorState {
  // Data collections
  failures: any[];
  jobs: any[];
  chats: any[];
  wallets: any[];
  clients: any[];
  prizeClaims: any[];
  stats: any;
  settings: any;
  trends: any[];

  pendingPrizeClaims: number;

  // System state
  killSwitchActive: boolean;
  botStatus: string;
  botStatusPerPanel: Record<string, string>;
  connectedPanels: string[];
  validatorConnected: boolean;
  pendingFailures: number;
  pendingChats: number;
  lastUpdate: string;

  // Dedup
  processedFailureIds: Set<string>;
  recentMessageIds: Set<string>;

  // Chat state
  selectedChatId: string | null;
  chatMessages: Record<string, any[]>;
  chatMessageCursors: Record<string, string | undefined>;
  chatMessageHasMore: Record<string, boolean>;

  // Quick replies
  quickReplies: QuickReply[];

  // Actions
  setInitialData: (data: any) => void;
  addFailure: (failure: any) => void;
  resolveFailure: (failureId: string, action: string) => void;
  updateJob: (job: any) => void;
  addChat: (chat: any) => void;
  updateChat: (chatId: string, updates: any) => void;
  setSelectedChat: (chatId: string | null) => void;
  addMessage: (chatId: string, message: any) => void;
  setChatMessages: (chatId: string, messages: any[], cursor?: string, hasMore?: boolean) => void;
  appendOlderMessages: (chatId: string, messages: any[], cursor?: string, hasMore?: boolean) => void;
  updateWallet: (wallet: any) => void;
  addWallet: (wallet: any) => void;
  removeWallet: (walletId: string) => void;
  updateStats: (stats: any) => void;
  setKillSwitch: (active: boolean) => void;
  setBotStatus: (status: string) => void;
  setBotStatusForPanel: (panelId: string, status: string) => void;
  setConnectedPerPanel: (perPanel: Record<string, number>) => void;
  setValidatorConnected: (connected: boolean) => void;
  setSettings: (settings: any) => void;
  setChats: (chats: any[]) => void;
  markChatRead: (chatId: string) => void;
  setQuickReplies: (replies: QuickReply[]) => void;
  addQuickReply: (reply: QuickReply) => void;
  updateQuickReply: (id: string, updates: Partial<QuickReply>) => void;
  deleteQuickReply: (id: string) => void;
  setClients: (clients: any[]) => void;
  setPrizeClaims: (claims: any[]) => void;
  addPrizeClaim: (claim: any) => void;
  updatePrizeClaim: (claimId: string, updates: any) => void;
  // Outbound payments
  outboundPayments: any[];
  setOutboundPayments: (payments: any[]) => void;
  addOutboundPayment: (payment: any) => void;
  updateOutboundPayment: (paymentId: string, updates: any) => void;
  // Extension monitoring
  extensions: any[];
  upsertExtension: (data: any) => void;
  trackMessageId: (id: string) => boolean;
  reset: () => void;
}

const initialState = {
  failures: [],
  jobs: [],
  chats: [],
  wallets: [],
  clients: [],
  prizeClaims: [],
  outboundPayments: [],
  extensions: [],
  stats: null,
  settings: null,
  trends: [],

  pendingPrizeClaims: 0,

  killSwitchActive: false,
  botStatus: 'disconnected',
  botStatusPerPanel: {},
  connectedPanels: [],
  validatorConnected: false,
  pendingFailures: 0,
  pendingChats: 0,
  lastUpdate: '',

  processedFailureIds: new Set<string>(),
  recentMessageIds: new Set<string>(),

  selectedChatId: null,
  chatMessages: {},
  chatMessageCursors: {},
  chatMessageHasMore: {},

  quickReplies: [],
};

export const useOperatorStore = create<OperatorState>((set, get) => ({
  ...initialState,

  setInitialData: (data: any) => {
    const failures = data.failures || [];
    const processedIds = new Set<string>(failures.map((f: any) => f.id));

    const chats = data.chats || [];
    const pendingChats = chats.filter(
      (c: any) => c.unreadCount > 0 || c._count?.messages > 0,
    ).length;

    set({
      failures,
      jobs: data.jobs || [],
      chats: sortChatsByRecency(chats),
      wallets: data.wallets || [],
      stats: data.stats || null,
      settings: data.settings ? { ...data.settings, panels: data.panels || [] } : null,
      trends: data.trends || [],
      killSwitchActive: data.killSwitch === true,
      botStatus: typeof data.botStatus === 'string'
        ? data.botStatus
        : data.botStatus?.status || 'disconnected',
      botStatusPerPanel: data.botStatus?.connectedPerPanel
        ? Object.fromEntries(
            Object.entries(data.botStatus.connectedPerPanel).map(
              ([panelId, count]) => [panelId, (count as number) > 0 ? 'online' : 'offline'],
            ),
          )
        : {},
      connectedPanels: data.botStatus?.connectedPanels || [],
      validatorConnected: data.validatorStatus === true || data.validatorStatus === 'connected',
      pendingFailures: failures.length,
      pendingChats,
      processedFailureIds: processedIds,
      outboundPayments: data.outboundPayments || [],
      lastUpdate: new Date().toISOString(),
    });
  },

  addFailure: (failure: any) => {
    const { processedFailureIds } = get();

    if (processedFailureIds.has(failure.id)) {
      return;
    }

    // Cap the processedFailureIds set
    const newIds = new Set(processedFailureIds);
    if (newIds.size >= MAX_PROCESSED_FAILURE_IDS) {
      const firstId = newIds.values().next().value;
      if (firstId !== undefined) {
        newIds.delete(firstId);
      }
    }
    newIds.add(failure.id);

    set((state) => ({
      failures: [failure, ...state.failures],
      pendingFailures: state.pendingFailures + 1,
      processedFailureIds: newIds,
      lastUpdate: new Date().toISOString(),
    }));
  },

  resolveFailure: (failureId: string, action: string) => {
    set((state) => {
      const nowIso = new Date().toISOString();
      const updatedFailures = state.failures.map((f) =>
        f.id === failureId
          ? { ...f, resolved: true, resolvedAt: nowIso, resolvedAction: action }
          : f,
      );
      const remaining = updatedFailures.filter((f) => !isFailureResolved(f)).length;

      return {
        failures: updatedFailures,
        pendingFailures: remaining,
        lastUpdate: nowIso,
      };
    });
  },

  updateJob: (job: any) => {
    set((state) => {
      const existingIndex = state.jobs.findIndex((j) => j.id === job.id);
      let updatedJobs: any[];

      if (existingIndex >= 0) {
        updatedJobs = [...state.jobs];
        updatedJobs[existingIndex] = { ...updatedJobs[existingIndex], ...job };
      } else {
        updatedJobs = [job, ...state.jobs];
      }

      return {
        jobs: updatedJobs,
        lastUpdate: new Date().toISOString(),
      };
    });
  },

  addChat: (chat: any) => {
    set((state) => {
      const existingIndex = state.chats.findIndex((c) => c.id === chat.id);
      let updatedChats: any[];

      if (existingIndex >= 0) {
        updatedChats = [...state.chats];
        updatedChats[existingIndex] = { ...updatedChats[existingIndex], ...chat };
      } else {
        updatedChats = [chat, ...state.chats];
      }

      return {
        chats: sortChatsByRecency(updatedChats),
        pendingChats: updatedChats.filter((c) => c.unreadCount > 0).length,
        lastUpdate: new Date().toISOString(),
      };
    });
  },

  updateChat: (chatId: string, updates: any) => {
    set((state) => {
      const updatedChats = state.chats.map((c) =>
        c.id === chatId ? { ...c, ...updates } : c,
      );

      return {
        chats: sortChatsByRecency(updatedChats),
        pendingChats: updatedChats.filter((c) => c.unreadCount > 0).length,
        lastUpdate: new Date().toISOString(),
      };
    });
  },

  setSelectedChat: (chatId: string | null) => {
    set({ selectedChatId: chatId });

    // Clear unread count when selecting a chat
    if (chatId) {
      const { chats } = get();
      const chat = chats.find((c) => c.id === chatId);
      if (chat && chat.unreadCount > 0) {
        get().updateChat(chatId, { unreadCount: 0 });
      }
    }
  },

  addMessage: (chatId: string, message: any) => {
    const isDuplicate = !get().trackMessageId(message.id);
    if (isDuplicate) {
      return;
    }

    set((state) => {
      const existing = state.chatMessages[chatId] || [];
      const updatedMessages = {
        ...state.chatMessages,
        [chatId]: [...existing, message],
      };

      // Update chat's last message and bump to top
      const updatedChats = state.chats.map((c) => {
        if (c.id === chatId) {
          const isSelected = state.selectedChatId === chatId;
          return {
            ...c,
            lastMessage: message,
            updatedAt: message.createdAt || new Date().toISOString(),
            unreadCount: isSelected ? 0 : (c.unreadCount || 0) + 1,
          };
        }
        return c;
      });

      return {
        chatMessages: updatedMessages,
        chats: sortChatsByRecency(updatedChats),
        pendingChats: updatedChats.filter((c) => c.unreadCount > 0).length,
        lastUpdate: new Date().toISOString(),
      };
    });
  },

  setChatMessages: (chatId: string, messages: any[], cursor?: string, hasMore?: boolean) => {
    // Track all message IDs for dedup
    const { recentMessageIds } = get();
    const newIds = new Set(recentMessageIds);
    for (const msg of messages) {
      if (msg.id) {
        newIds.add(msg.id);
      }
    }
    // Trim if over limit
    if (newIds.size > MAX_RECENT_MESSAGE_IDS) {
      const idsArray = Array.from(newIds);
      const trimmed = idsArray.slice(idsArray.length - MAX_RECENT_MESSAGE_IDS);
      newIds.clear();
      for (const id of trimmed) {
        newIds.add(id);
      }
    }

    set((state) => ({
      chatMessages: {
        ...state.chatMessages,
        [chatId]: messages,
      },
      chatMessageCursors: {
        ...state.chatMessageCursors,
        [chatId]: cursor,
      },
      chatMessageHasMore: {
        ...state.chatMessageHasMore,
        [chatId]: hasMore ?? true,
      },
      recentMessageIds: newIds,
    }));
  },

  appendOlderMessages: (chatId: string, messages: any[], cursor?: string, hasMore?: boolean) => {
    if (messages.length === 0) {
      set((state) => ({
        chatMessageHasMore: {
          ...state.chatMessageHasMore,
          [chatId]: false,
        },
      }));
      return;
    }

    // Track IDs
    const { recentMessageIds } = get();
    const newIds = new Set(recentMessageIds);
    for (const msg of messages) {
      if (msg.id) {
        newIds.add(msg.id);
      }
    }

    set((state) => {
      const existing = state.chatMessages[chatId] || [];

      // Dedup: filter out messages that already exist
      const existingIds = new Set(existing.map((m) => m.id));
      const uniqueOlder = messages.filter((m) => !existingIds.has(m.id));

      return {
        chatMessages: {
          ...state.chatMessages,
          [chatId]: [...uniqueOlder, ...existing],
        },
        chatMessageCursors: {
          ...state.chatMessageCursors,
          [chatId]: cursor,
        },
        chatMessageHasMore: {
          ...state.chatMessageHasMore,
          [chatId]: hasMore ?? false,
        },
        recentMessageIds: newIds,
      };
    });
  },

  updateWallet: (wallet: any) => {
    set((state) => {
      const existingIndex = state.wallets.findIndex((w) => w.id === wallet.id);

      if (existingIndex < 0) {
        // Unknown wallet - add it
        return {
          wallets: [...state.wallets, wallet],
          lastUpdate: new Date().toISOString(),
        };
      }

      const updatedWallets = [...state.wallets];
      updatedWallets[existingIndex] = { ...updatedWallets[existingIndex], ...wallet };

      return {
        wallets: updatedWallets,
        lastUpdate: new Date().toISOString(),
      };
    });
  },

  addWallet: (wallet: any) => {
    set((state) => {
      const exists = state.wallets.some((w) => w.id === wallet.id);
      if (exists) {
        return state;
      }

      return {
        wallets: [...state.wallets, wallet],
        lastUpdate: new Date().toISOString(),
      };
    });
  },

  removeWallet: (walletId: string) => {
    set((state) => ({
      wallets: state.wallets.filter((w) => w.id !== walletId),
      lastUpdate: new Date().toISOString(),
    }));
  },

  updateStats: (stats: any) => {
    set({
      stats,
      lastUpdate: new Date().toISOString(),
    });
  },

  setKillSwitch: (active: boolean) => {
    set({
      killSwitchActive: active,
      lastUpdate: new Date().toISOString(),
    });
  },

  setBotStatus: (status: string) => {
    set({
      botStatus: status,
      lastUpdate: new Date().toISOString(),
    });
  },

  setBotStatusForPanel: (panelId: string, status: string) => {
    const current = get().botStatusPerPanel;
    set({
      botStatusPerPanel: { ...current, [panelId]: status },
    });
  },

  setConnectedPerPanel: (perPanel: Record<string, number>) => {
    const panelStatuses: Record<string, string> = {};
    const panels: string[] = [];
    for (const [panelId, count] of Object.entries(perPanel)) {
      panelStatuses[panelId] = count > 0 ? 'online' : 'offline';
      if (count > 0) panels.push(panelId);
    }
    set({
      botStatusPerPanel: panelStatuses,
      connectedPanels: panels,
    });
  },

  setValidatorConnected: (connected: boolean) => {
    set({
      validatorConnected: connected,
      lastUpdate: new Date().toISOString(),
    });
  },

  setSettings: (settings: any) => {
    set({ settings });
  },

  setChats: (chats: any[]) => {
    const sorted = sortChatsByRecency(chats);
    set({
      chats: sorted,
      pendingChats: sorted.filter((c: any) => c.unreadCount > 0).length,
      lastUpdate: new Date().toISOString(),
    });
  },

  markChatRead: (chatId: string) => {
    set((state) => {
      const updatedChats = state.chats.map((c) =>
        c.id === chatId ? { ...c, unreadCount: 0 } : c,
      );

      return {
        chats: updatedChats,
        pendingChats: updatedChats.filter((c) => c.unreadCount > 0).length,
        lastUpdate: new Date().toISOString(),
      };
    });
  },

  setQuickReplies: (replies: QuickReply[]) => {
    set({ quickReplies: replies.sort((a, b) => a.order - b.order) });
  },

  addQuickReply: (reply: QuickReply) => {
    set((state) => {
      if (state.quickReplies.length >= MAX_QUICK_REPLIES) return state;
      return {
        quickReplies: [...state.quickReplies, reply].sort((a, b) => a.order - b.order),
      };
    });
  },

  updateQuickReply: (id: string, updates: Partial<QuickReply>) => {
    set((state) => ({
      quickReplies: state.quickReplies
        .map((qr) => (qr.id === id ? { ...qr, ...updates } : qr))
        .sort((a, b) => a.order - b.order),
    }));
  },

  deleteQuickReply: (id: string) => {
    set((state) => ({
      quickReplies: state.quickReplies.filter((qr) => qr.id !== id),
    }));
  },

  setClients: (clients: any[]) => {
    set({ clients });
  },

  setPrizeClaims: (claims) => set({
    prizeClaims: claims,
    pendingPrizeClaims: claims.filter((c: any) => PENDING_PRIZE_STATUSES.includes(c.status)).length,
  }),

  addPrizeClaim: (claim) => set((state) => {
    const existing = state.prizeClaims.find((c: any) => c.id === claim.id);
    if (existing) return state;
    const updated = [claim, ...state.prizeClaims];
    return {
      prizeClaims: updated,
      pendingPrizeClaims: updated.filter((c: any) => PENDING_PRIZE_STATUSES.includes(c.status)).length,
    };
  }),

  updatePrizeClaim: (claimId, updates) => set((state) => {
    const updated = state.prizeClaims.map((c: any) => c.id === claimId ? { ...c, ...updates } : c);
    return {
      prizeClaims: updated,
      pendingPrizeClaims: updated.filter((c: any) => PENDING_PRIZE_STATUSES.includes(c.status)).length,
    };
  }),

  // Outbound payments
  setOutboundPayments: (payments) => set({ outboundPayments: payments }),

  addOutboundPayment: (payment) => set((state) => {
    if (state.outboundPayments.some((p: any) => p.id === payment.id)) return state;
    return { outboundPayments: [payment, ...state.outboundPayments] };
  }),

  updateOutboundPayment: (paymentId, updates) => set((state) => ({
    outboundPayments: state.outboundPayments.map((p: any) =>
      p.id === paymentId ? { ...p, ...updates } : p
    ),
  })),

  // Extension monitoring
  upsertExtension: (data) => set((state) => {
    const idx = state.extensions.findIndex((e: any) => e.extensionId === data.extensionId);
    if (idx >= 0) {
      const updated = [...state.extensions];
      updated[idx] = { ...updated[idx], ...data };
      return { extensions: updated };
    }
    return { extensions: [data, ...state.extensions] };
  }),

  trackMessageId: (id: string): boolean => {
    const { recentMessageIds } = get();

    if (recentMessageIds.has(id)) {
      return false;
    }

    const newIds = new Set(recentMessageIds);
    newIds.add(id);

    // Trim oldest entries if over limit
    if (newIds.size > MAX_RECENT_MESSAGE_IDS) {
      const idsArray = Array.from(newIds);
      const trimmed = idsArray.slice(idsArray.length - MAX_RECENT_MESSAGE_IDS);
      newIds.clear();
      for (const trimmedId of trimmed) {
        newIds.add(trimmedId);
      }
    }

    set({ recentMessageIds: newIds });
    return true;
  },

  reset: () => {
    set({
      ...initialState,
      // Create fresh Set instances to avoid shared references
      processedFailureIds: new Set<string>(),
      recentMessageIds: new Set<string>(),
    });
  },
}));

// Helper: sort chats by most recent activity
function sortChatsByRecency(chats: any[]): any[] {
  return [...chats].sort((a, b) => {
    const dateA = a.updatedAt || a.createdAt || '';
    const dateB = b.updatedAt || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });
}
