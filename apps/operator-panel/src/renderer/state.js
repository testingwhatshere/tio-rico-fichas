// renderer/state.js — Global mutable state with getters/setters
// O2 FIX: All intervals/timeouts tracked in cleanupTimers for proper cleanup

import {
  MAX_PENDING_CHAT_MESSAGES,
  MAX_RECENT_MESSAGE_IDS,
  RECENTLY_ACTIONED_TTL,
} from './constants.js';

// ============================================
// Tracked timers for cleanup (O2 FIX)
// ============================================
export const cleanupTimers = new Set(); // holds {type:'interval'|'timeout', id: number}

export function trackInterval(id) {
  const entry = { type: 'interval', id };
  cleanupTimers.add(entry);
  return entry;
}

export function trackTimeout(id) {
  const entry = { type: 'timeout', id };
  cleanupTimers.add(entry);
  return entry;
}

export function clearTracked(entry) {
  if (!entry) return;
  if (entry.type === 'interval') clearInterval(entry.id);
  else clearTimeout(entry.id);
  cleanupTimers.delete(entry);
}

export function clearAllTrackedTimers() {
  for (const entry of cleanupTimers) {
    if (entry.type === 'interval') clearInterval(entry.id);
    else clearTimeout(entry.id);
  }
  cleanupTimers.clear();
}

// ============================================
// View / navigation state
// ============================================
let currentView = 'dashboard';
export function getCurrentView() { return currentView; }
export function setCurrentView(v) { currentView = v; }

// ============================================
// Failure modal state
// ============================================
let selectedFailure = null;
export function getSelectedFailure() { return selectedFailure; }
export function setSelectedFailure(f) { selectedFailure = f; }

let isProcessingFailure = false;
export function getIsProcessingFailure() { return isProcessingFailure; }
export function setIsProcessingFailure(v) { isProcessingFailure = v; }

// OP11: recently-actioned failures map
export const recentlyActionedFailures = new Map(); // id -> timestamp

export function pruneRecentlyActioned() {
  const now = Date.now();
  for (const [id, ts] of recentlyActionedFailures) {
    if (now - ts > RECENTLY_ACTIONED_TTL) {
      recentlyActionedFailures.delete(id);
    }
  }
}

// ============================================
// Chat state
// ============================================
let selectedChat = null;
export function getSelectedChat() { return selectedChat; }
export function setSelectedChat(c) { selectedChat = c; }

let chatMessages = [];
export function getChatMessages() { return chatMessages; }
export function setChatMessages(msgs) { chatMessages = msgs; }
export function pushChatMessage(msg) { chatMessages.push(msg); }
export function prependChatMessages(msgs) { chatMessages = [...msgs, ...chatMessages]; }

let chatMessagesCursor = null;
export function getChatMessagesCursor() { return chatMessagesCursor; }
export function setChatMessagesCursor(c) { chatMessagesCursor = c; }

let chatMessagesHasMore = false;
export function getChatMessagesHasMore() { return chatMessagesHasMore; }
export function setChatMessagesHasMore(v) { chatMessagesHasMore = v; }

let isLoadingMoreMessages = false;
export function getIsLoadingMoreMessages() { return isLoadingMoreMessages; }
export function setIsLoadingMoreMessages(v) { isLoadingMoreMessages = v; }

let pendingChatMessages = [];
export function getPendingChatMessages() { return pendingChatMessages; }
export function setPendingChatMessages(msgs) { pendingChatMessages = msgs; }
export function pushPendingChatMessage(msg) {
  if (pendingChatMessages.length < MAX_PENDING_CHAT_MESSAGES) {
    pendingChatMessages.push(msg);
  }
}

let isLoadingMessages = false;
export function getIsLoadingMessages() { return isLoadingMessages; }
export function setIsLoadingMessages(v) { isLoadingMessages = v; }

let loadingChatId = null;
export function getLoadingChatId() { return loadingChatId; }
export function setLoadingChatId(v) { loadingChatId = v; }

let loadChatTimeout = null;
export function getLoadChatTimeout() { return loadChatTimeout; }
export function setLoadChatTimeout(v) { loadChatTimeout = v; }

let chatListDirty = false;
export function getChatListDirty() { return chatListDirty; }
export function setChatListDirty(v) { chatListDirty = v; }

let pendingImageData = null;
export function getPendingImageData() { return pendingImageData; }
export function setPendingImageData(v) { pendingImageData = v; }

// ============================================
// Message dedup
// ============================================
export const recentMessageIds = new Set();

export function trackMessageId(id) {
  if (recentMessageIds.has(id)) return false; // duplicate
  recentMessageIds.add(id);
  if (recentMessageIds.size > MAX_RECENT_MESSAGE_IDS) {
    const first = recentMessageIds.values().next().value;
    recentMessageIds.delete(first);
  }
  return true; // new message
}

// ============================================
// Typing indicator state
// ============================================
let userTypingTimeout = null;
export function getUserTypingTimeout() { return userTypingTimeout; }
export function setUserTypingTimeout(v) { userTypingTimeout = v; }

let operatorTypingTimeout = null;
export function getOperatorTypingTimeout() { return operatorTypingTimeout; }
export function setOperatorTypingTimeout(v) { operatorTypingTimeout = v; }

// ============================================
// Quick replies
// ============================================
let quickReplies = null;
export function getQuickReplies() { return quickReplies; }
export function setQuickReplies(v) { quickReplies = v; }

let editingQuickReplyId = null;
export function getEditingQuickReplyId() { return editingQuickReplyId; }
export function setEditingQuickReplyId(v) { editingQuickReplyId = v; }

// ============================================
// Activity log
// ============================================
let activityLog = [];
export function getActivityLog() { return activityLog; }
export function setActivityLog(v) { activityLog = v; }
export function unshiftActivityLog(entry) { activityLog.unshift(entry); }

// ============================================
// Notification settings
// ============================================
let notificationSettings = {};
export function getNotificationSettings() { return notificationSettings; }
export function setNotificationSettings(v) { notificationSettings = v; }

// ============================================
// Store (shared data from backend)
// ============================================
export let store = {
  failures: [],
  jobs: [],
  chats: [],
  wallets: [],
  clients: [],
  prizeClaims: [],
  extensions: [],
  stats: {},
  trends: [],
  settings: undefined
};

export function updateStore(partial) {
  Object.assign(store, partial);
}

// ============================================
// App state (connection, config, etc.)
// ============================================
export let state = {
  connected: false,
  config: {},
  pendingFailures: 0,
  killSwitchActive: false,
  botStatus: 'offline',
  validatorConnected: false,
  lastUpdate: null
};

export function updateState(partial) {
  Object.assign(state, partial);
}

// ============================================
// Ollama / AI state
// ============================================
export let ollamaState = {
  available: false,
  model: null,
  botEnabled: false,
  suggestedRepliesEnabled: true,
  failureAnalysisEnabled: true
};

let isSuggestingReplies = false;
export function getIsSuggestingReplies() { return isSuggestingReplies; }
export function setIsSuggestingReplies(v) { isSuggestingReplies = v; }

// ============================================
// Wizard state
// ============================================
let wizardStep = 1;
export function getWizardStep() { return wizardStep; }
export function setWizardStep(v) { wizardStep = v; }

export let wizardConfig = {
  backendUrl: '',
  apiKey: '',
  operatorName: ''
};

// ============================================
// Modal state
// ============================================
let textInputResolve = null;
export function getTextInputResolve() { return textInputResolve; }
export function setTextInputResolve(v) { textInputResolve = v; }

let confirmModalHandler = null;
export function getConfirmModalHandler() { return confirmModalHandler; }
export function setConfirmModalHandler(v) { confirmModalHandler = v; }

// ============================================
// IPC cleanup functions
// ============================================
export let ipcCleanupFunctions = [];
export function setIpcCleanupFunctions(v) { ipcCleanupFunctions = v; }

// ============================================
// Guard flags (setup-once patterns)
// ============================================
let quickRepliesSetup = false;
export function getQuickRepliesSetup() { return quickRepliesSetup; }
export function setQuickRepliesSetup(v) { quickRepliesSetup = v; }

let walletFormSetup = false;
export function getWalletFormSetup() { return walletFormSetup; }
export function setWalletFormSetup(v) { walletFormSetup = v; }

let ollamaSettingsSetup = false;
export function getOllamaSettingsSetup() { return ollamaSettingsSetup; }
export function setOllamaSettingsSetup(v) { ollamaSettingsSetup = v; }
