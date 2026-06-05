// Operator Panel - Renderer Process (ES Module Entry Point)
// All logic has been split into modules under ./renderer/

// ============================================
// IMPORTS
// ============================================

import {
  store, state, updateStore, updateState,
  ollamaState,
  setSelectedChat, getSelectedChat,
  getChatMessages, pushChatMessage,
  getIsLoadingMessages, pushPendingChatMessage,
  trackMessageId, recentMessageIds,
  setChatListDirty, getChatListDirty,
  setNotificationSettings, getNotificationSettings,
  setQuickReplies, getQuickReplies,
  setActivityLog, getActivityLog, unshiftActivityLog,
  getCurrentView,
  recentlyActionedFailures,
  ipcCleanupFunctions, setIpcCleanupFunctions,
  clearAllTrackedTimers, trackInterval,
} from './renderer/state.js';

import { RECENTLY_ACTIONED_TTL } from './renderer/constants.js';

import {
  escapeHtml, showToast, playSound, showConfirmModal,
  closeAllModals, openImageZoom, exportData,
  confirmTextInputModal, cancelTextInputModal,
} from './renderer/utils.js';

import {
  navigateTo,
  updateConnectionStatus, updateBotStatus, updateValidatorStatus,
  updateLastUpdate, updateBadges, updateKillSwitchButton,
} from './renderer/entry-helpers.js';

import { updateDashboard } from './renderer/views/dashboard.js';
import { renderFailuresList, openFailureModal, approveSelectedFailure, rejectSelectedFailure } from './renderer/views/failures.js';
import { renderJobsList, retryJob } from './renderer/views/jobs.js';
import {
  renderChatsList, selectChat, loadChatMessages, loadMoreChatMessages, renderChatMain,
  sendChatMessage, handleImageSelected, clearPendingImage,
  closeCurrentChat, handleOperatorTyping, showUserTyping,
} from './renderer/views/chats.js';
import { renderActivityList } from './renderer/views/activity.js';
import { renderWalletsList, updateSelectedWalletDisplay, selectWallet, deleteWallet, emptyWallet, toggleWalletVerification } from './renderer/views/wallets.js';
import { renderUsersList, toggleUserActive, createPanelUser, refreshClients } from './renderer/views/users.js';
import {
  renderPrizesView, updatePrizesBadge,
  processPrizeClaim, completePrizeClaim, rejectPrizeClaim,
} from './renderer/views/prizes.js';
import { initPaymentsView, renderPaymentsList } from './renderer/views/payments.js';
import {
  loadSettings, loadNotificationSettings, setupNotificationSettingsListeners,
  setupQuickReplies, setupQuickReplySettingsListeners,
  renderQuickRepliesButtons, renderQuickRepliesSettingsList,
  editQuickReply, deleteQuickReply,
  closeQuickReplyModal, saveQuickReplyFromModal,
} from './renderer/views/settings.js';
import { setupWizard, checkShowWizard } from './renderer/views/wizard.js';
import { editPanel, deactivatePanel, activatePanel } from './renderer/views/panels.js';
import { renderExtensionsList } from './renderer/views/extensions.js';
import { checkForAppUpdate } from './renderer/views/updater.js';
import { updateOllamaStatus, requestSuggestedReplies, fillChatInputFromSuggestion } from './renderer/ai/ollama.js';

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Check for updates first — blocks everything if update available
  await checkForAppUpdate();

  setupEventListeners();
  setupIpcListeners();
  setupKeyboardShortcuts();
  setupQuickReplies();
  setupQuickReplySettingsListeners();
  setupWizard();
  await loadInitialState();

  document.getElementById('platform-info').textContent = navigator.platform || 'Unknown';
  checkShowWizard();
});

// ============================================
// LOAD INITIAL STATE
// ============================================

async function loadInitialState() {
  if (!window.api) return;
  try {
    const data = await window.api.getState();
    if (data) {
      updateState(data.state || {});
      updateStore(data.store || {});
      setNotificationSettings(data.notificationSettings || {});
      setQuickReplies(data.quickReplies || null);
      setActivityLog(data.store?.activityLog || []);
      updateUI();
      loadNotificationSettings();
      renderQuickRepliesButtons();
    }
  } catch (error) {
    console.error('Error loading initial state:', error);
    showToast('No se pudo cargar el estado inicial', 'error');
  }

  // Load Ollama AI status
  try {
    if (window.api.getOllamaStatus) {
      const ollamaData = await window.api.getOllamaStatus();
      if (ollamaData) {
        ollamaState.available = ollamaData.available || false;
        ollamaState.model = ollamaData.model || null;
        if (ollamaData.config) {
          ollamaState.botEnabled = ollamaData.config.botEnabled || false;
          ollamaState.suggestedRepliesEnabled = ollamaData.config.suggestedRepliesEnabled !== false;
          ollamaState.failureAnalysisEnabled = ollamaData.config.failureAnalysisEnabled !== false;
        }
        updateOllamaStatus();
      }
    }
  } catch (err) {
    console.log('[AI] Could not load Ollama status:', err.message);
  }
}

// ============================================
// UI UPDATE (master)
// ============================================

function updateUI() {
  updateConnectionStatus();
  updateBadges();
  updateKillSwitchButton();
  updateBotStatus();
  updateValidatorStatus();
  updateOllamaStatus();
  updateLastUpdate();
  updateDashboard();

  updatePrizesBadge();
  if (getCurrentView() === 'chats') renderChatsList();
  if (getCurrentView() === 'failures') renderFailuresList();
  if (getCurrentView() === 'prizes') renderPrizesView();

  const backendUrlField = document.getElementById('backend-url');
  const apiKeyField = document.getElementById('api-key');
  const operatorNameField = document.getElementById('operator-name');

  if (backendUrlField && state.config?.backendUrl) backendUrlField.value = state.config.backendUrl;
  if (apiKeyField && state.config?.apiKey) apiKeyField.value = state.config.apiKey;
  if (operatorNameField && state.config?.operatorName) operatorNameField.value = state.config.operatorName;
}

// ============================================
// EVENT LISTENERS (DOM)
// ============================================

function setupEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  document.querySelectorAll('[data-navigate]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.navigate));
  });

  // Kill switch
  document.getElementById('kill-switch-btn').addEventListener('click', async () => {
    const willActivate = !state.killSwitchActive;
    const confirmed = await showConfirmModal(
      willActivate ? 'Activar Kill Switch' : 'Desactivar Kill Switch',
      willActivate
        ? 'Esto detendr\u00e1 TODA la automatizaci\u00f3n. \u00bfContinuar?'
        : 'Esto reanudar\u00e1 la automatizaci\u00f3n. \u00bfContinuar?',
      willActivate ? 'Activar' : 'Desactivar'
    );
    if (!confirmed) return;
    const result = await window.api.toggleKillSwitch();
    if (result.success) {
      showToast(willActivate ? 'Kill Switch activado' : 'Kill Switch desactivado', 'success');
    } else {
      showToast('Error: ' + (result.error || 'No se pudo cambiar el estado'), 'error');
    }
  });

  // Reconnect
  document.getElementById('reconnect-btn').addEventListener('click', async () => {
    showToast('Reconectando...', 'info');
    await window.api.reconnect();
  });

  // AI Status Indicator click
  const ollamaStatusEl = document.getElementById('ollama-status');
  if (ollamaStatusEl) {
    ollamaStatusEl.addEventListener('click', async () => {
      if (!ollamaState.available) {
        showToast('Ollama no disponible', 'warning');
        return;
      }
      try {
        const newState = !ollamaState.botEnabled;
        const result = await window.api.toggleBot(newState);
        if (result && result.success !== false) {
          ollamaState.botEnabled = newState;
          updateOllamaStatus();
          showToast(newState ? 'Bot AI activado' : 'Bot AI desactivado', 'success');
        } else {
          showToast('Error al cambiar estado de AI', 'error');
        }
      } catch (err) {
        showToast('Error: ' + (err.message || 'No se pudo cambiar el estado'), 'error');
      }
    });
  }

  // Settings form
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const backendUrl = document.getElementById('backend-url')?.value?.trim();
    const apiKey = document.getElementById('api-key')?.value?.trim();
    const operatorName = document.getElementById('operator-name')?.value?.trim() || '';

    if (!backendUrl || !apiKey) {
      showToast('Completa todos los campos requeridos', 'error');
      return;
    }

    try {
      new URL(backendUrl);
    } catch {
      showToast('La URL del backend no es v\u00e1lida', 'error');
      return;
    }

    const config = { backendUrl, apiKey, operatorName };
    const result = await window.api.saveConfig(config);

    if (result.success) {
      state.config = config;
      showToast('Configuraci\u00f3n guardada. Conectando...', 'success');
    } else {
      showToast('Error al guardar: ' + (result.error || 'Desconocido'), 'error');
    }
  });

  // Test connection (in settings)
  document.getElementById('test-connection-btn').addEventListener('click', async () => {
    const backendUrl = document.getElementById('backend-url')?.value?.trim();
    const apiKey = document.getElementById('api-key')?.value?.trim();

    if (!backendUrl || !apiKey) {
      showToast('Completa la URL y API Key primero', 'error');
      return;
    }

    showToast('Probando conexi\u00f3n...', 'info');

    try {
      const result = await window.api.testConnection({ backendUrl, apiKey });
      if (result.success) {
        showToast('\u00a1Conexi\u00f3n exitosa!', 'success');
      } else {
        showToast('Error: ' + (result.error || 'No se pudo conectar'), 'error');
      }
    } catch (error) {
      showToast('Error: ' + error.message, 'error');
    }
  });

  // Save support phone
  document.getElementById('save-support-phone-btn')?.addEventListener('click', async () => {
    const phone = document.getElementById('support-phone')?.value?.trim() || '';
    const btn = document.getElementById('save-support-phone-btn');
    if (btn) btn.disabled = true;
    try {
      const result = await window.api.updateSystemSettings({ supportPhoneNumber: phone });
      if (result?.success !== false) {
        showToast('Numero de soporte guardado', 'success');
      } else {
        showToast('Error al guardar: ' + (result?.error || 'Desconocido'), 'error');
      }
    } catch (error) {
      showToast('Error: ' + error.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Save system settings
  document.getElementById('save-system-settings-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-system-settings-btn');
    if (btn) btn.disabled = true;
    try {
      const settings = {};
      const threshold = document.getElementById('sys-validation-threshold')?.value;
      if (threshold) settings.validationThreshold = parseFloat(threshold);
      const timeout = document.getElementById('sys-validation-timeout')?.value;
      if (timeout) settings.validationTimeoutMs = parseInt(timeout) * 1000;
      const cooldown = document.getElementById('sys-queue-cooldown')?.value;
      if (cooldown) settings.queueCooldownMs = parseInt(cooldown) * 1000;
      // maxRequestAmount removed — no amount limits
      const maxReqs = document.getElementById('sys-max-requests-hour')?.value;
      if (maxReqs) settings.maxRequestsPerUserPerHour = parseInt(maxReqs);
      const actStart = document.getElementById('sys-activity-start')?.value;
      if (actStart) settings.botActivityWindowStart = actStart;
      const actEnd = document.getElementById('sys-activity-end')?.value;
      if (actEnd) settings.botActivityWindowEnd = actEnd;
      const botEnabled = document.getElementById('sys-bot-enabled')?.checked;
      settings.botEnabled = !!botEnabled;
      const panelBalanceThreshold = document.getElementById('sys-panel-balance-threshold')?.value;
      if (panelBalanceThreshold !== undefined && panelBalanceThreshold !== '') settings.panelBalanceThreshold = parseInt(panelBalanceThreshold);
      const defaultNewUserPanelId = document.getElementById('sys-default-new-user-panel')?.value;
      if (defaultNewUserPanelId !== undefined) settings.defaultNewUserPanelId = defaultNewUserPanelId;
      // Auto-payment settings
      settings.autoPaymentEnabled = !!document.getElementById('sys-auto-payment-enabled')?.checked;
      settings.autoPaymentRequiresConfirm = !!document.getElementById('sys-auto-payment-requires-confirm')?.checked;
      const autoPaymentMax = document.getElementById('sys-auto-payment-max-amount')?.value;
      if (autoPaymentMax) settings.autoPaymentMaxAmount = parseInt(autoPaymentMax);

      const result = await window.api.updateSystemSettings(settings);
      if (result?.success !== false) {
        // Update local store with the response data
        if (result?.data) {
          store.settings = result.data;
        }
        showToast('Configuracion del sistema guardada', 'success');
        // Reload settings UI to reflect saved values
        loadSettings();
      } else {
        showToast('Error: ' + (result?.error || 'Desconocido'), 'error');
      }
    } catch (error) {
      showToast('Error: ' + error.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Filter tabs
  document.querySelectorAll('.filter-tabs').forEach(tabs => {
    tabs.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.dataset.filter;
        const cv = getCurrentView();

        if (cv === 'failures') renderFailuresList(filter);
        else if (cv === 'jobs') renderJobsList(filter);
        else if (cv === 'activity') renderActivityList(filter);
      });
    });
  });

  // Search inputs — re-render on typing
  document.getElementById('failures-search')?.addEventListener('input', () => {
    const activeFilter = document.querySelector('#view-failures .filter-tab.active')?.dataset.filter || 'pending';
    renderFailuresList(activeFilter);
  });
  document.getElementById('jobs-search')?.addEventListener('input', () => {
    const activeFilter = document.querySelector('#view-jobs .filter-tab.active')?.dataset.filter || 'all';
    renderJobsList(activeFilter);
  });
  document.getElementById('chats-search')?.addEventListener('input', () => {
    renderChatsList();
  });

  // Modal close
  document.querySelectorAll('.modal-backdrop, .modal-close').forEach(el => {
    el.addEventListener('click', closeAllModals);
  });

  // Modal actions (onclick assignment to prevent duplicate listeners - O3 FIX).
  // Null-checked: if either element isn't in the DOM yet, the missing assignment
  // would throw and skip the rest of setupEventListeners, leaving handlers detached.
  const approveBtn = document.getElementById('modal-approve-btn');
  if (approveBtn) approveBtn.onclick = approveSelectedFailure;
  const rejectBtn = document.getElementById('modal-reject-btn');
  if (rejectBtn) rejectBtn.onclick = rejectSelectedFailure;

  // Export buttons
  document.getElementById('export-failures-btn')?.addEventListener('click', () => exportData('failures'));
  document.getElementById('export-jobs-btn')?.addEventListener('click', () => exportData('jobs'));
  document.getElementById('export-activity-btn')?.addEventListener('click', () => exportData('activity'));

  // Notification settings
  setupNotificationSettingsListeners();

  // Delegated click handler for copyable wallet values (event delegation - O3 FIX)
  document.addEventListener('click', (e) => {
    const copyable = e.target.closest('[data-copy]');
    if (copyable) {
      const text = copyable.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        const original = copyable.textContent;
        copyable.textContent = '\u00a1Copiado!';
        copyable.classList.add('copied');
        setTimeout(() => {
          copyable.textContent = original;
          copyable.classList.remove('copied');
        }, 1200);
      }).catch(() => showToast('No se pudo copiar', 'error'));
    }
  });

  // Image modal
  document.getElementById('image-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'image-modal' || e.target.classList.contains('modal-backdrop')) {
      document.getElementById('image-modal').classList.add('hidden');
    }
  });
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const modal = document.getElementById('failure-modal');
    const isModalOpen = !modal.classList.contains('hidden');

    if (isModalOpen) {
      if (e.key === 'Enter') {
        e.preventDefault();
        approveSelectedFailure();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rejectSelectedFailure();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAllModals();
      }
      return;
    }

    if (e.key === 'Escape') {
      closeAllModals();
    } else if (e.key === '1') {
      navigateTo('dashboard');
    } else if (e.key === '2') {
      navigateTo('failures');
    } else if (e.key === '3') {
      navigateTo('jobs');
    } else if (e.key === '4') {
      navigateTo('chats');
    } else if (e.key === '5') {
      navigateTo('activity');
    } else if (e.key === '6') {
      navigateTo('wallets');
    } else if (e.key === '7') {
      navigateTo('users');
    } else if (e.key === '8') {
      navigateTo('settings');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('kill-switch-btn').click();
    }
  });
}

// ============================================
// IPC LISTENERS
// ============================================

function setupIpcListeners() {
  // Guard: window.api is only available inside Electron (injected by preload.js)
  if (!window.api) {
    console.warn('[Renderer] window.api not available — running outside Electron, skipping IPC listeners');
    return;
  }

  // Clean up any previous listeners
  ipcCleanupFunctions.forEach(cleanup => {
    if (typeof cleanup === 'function') cleanup();
  });
  setIpcCleanupFunctions([]);

  const fns = [];

  fns.push(window.api.onConnectionStatus((data) => {
    const wasDisconnected = !state.connected;
    state.connected = data.connected;
    state.lastUpdate = data.lastUpdate || state.lastUpdate;
    updateConnectionStatus();
    updateLastUpdate();

    const reconnectBtn = document.getElementById('reconnect-btn');
    if (reconnectBtn) reconnectBtn.classList.toggle('hidden', data.connected);

    if (data.connected) {
      showToast('Conectado al servidor', 'success');
      if (wasDisconnected && getSelectedChat()?.id) {
        loadChatMessages(getSelectedChat().id);
      }
    }
    else if (data.error) showToast('Error: ' + data.error, 'error');
  }));

  fns.push(window.api.onDataUpdate((data) => {
    updateStore(data.store || {});
    updateState(data.state || {});
    setNotificationSettings(data.notificationSettings || getNotificationSettings());
    if (data.quickReplies !== undefined) {
      setQuickReplies(data.quickReplies);
      renderQuickRepliesButtons();
    }
    setActivityLog(data.store?.activityLog || []);

    // OP2: Re-resolve selectedChat
    const sc = getSelectedChat();
    if (sc) {
      const resolved = store.chats.find(c => c.id === sc.id) || null;
      if (resolved) {
        // Preserve local read state — operator is viewing this chat
        resolved.unread = 0;
        resolved.unreadCount = 0;
      }
      setSelectedChat(resolved);
    }

    // OP11: Preserve local resolution for recently-actioned failures
    const now = Date.now();
    for (const [id, ts] of recentlyActionedFailures) {
      if (now - ts > RECENTLY_ACTIONED_TTL) {
        recentlyActionedFailures.delete(id);
        continue;
      }
      const f = store.failures.find(fail => fail.id === id);
      if (f && !f.resolvedAt) {
        f.resolvedAt = new Date(ts).toISOString();
      }
    }

    updateUI();
    loadNotificationSettings();
  }));

  fns.push(window.api.onNewFailure((failure) => {
    if (store.failures.some(f => f.id === failure.id)) return;
    store.failures.unshift(failure);
    state.pendingFailures++;
    updateBadges();
    if (getCurrentView() === 'failures') renderFailuresList();
    if (getCurrentView() === 'dashboard') updateDashboard();
    playSound('alert');
  }));

  fns.push(window.api.onJobFailed((job) => {
    if (store.failures.some(f => f.id === job.id)) return;
    store.failures.unshift({ ...job, type: 'JOB_FAILURE' });
    state.pendingFailures++;
    updateBadges();
    if (getCurrentView() === 'failures') renderFailuresList();
    playSound('alert');
  }));

  fns.push(window.api.onJobUpdate((job) => {
    const index = store.jobs.findIndex(j => j.id === job.id);
    if (index >= 0) store.jobs[index] = job;
    else store.jobs.unshift(job);
    if (getCurrentView() === 'jobs') renderJobsList();
    if (getCurrentView() === 'dashboard') updateDashboard();
  }));

  fns.push(window.api.onStatsUpdate((data) => {
    store.stats = { ...store.stats, ...data.stats };
    state.lastUpdate = data.lastUpdate;
    updateDashboard();
    updateLastUpdate();
  }));

  fns.push(window.api.onKillSwitch((data) => {
    state.killSwitchActive = data.active;
    updateKillSwitchButton();
  }));

  fns.push(window.api.onNavigate((view) => navigateTo(view)));

  fns.push(window.api.onDispatchBlocked((data) => {
    showToast(`Despacho bloqueado: ${data.reason}`, 'warning');
  }));

  fns.push(window.api.onChatHelpRequested((data) => {
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.needsHelp = true;
      chat.helpContext = data.context;
      chat.helpRequestedAt = data.requestedAt;
    }
    const contextLabel = data.context === 'prize' ? 'cobro de premio' : 'soporte';
    showToast(`🙋 AYUDA: ${data.username} pidió ayuda con ${contextLabel}`, 'warning');
    if (getCurrentView() === 'chats') renderChatsList();
    else setChatListDirty(true);
  }));

  fns.push(window.api.onChatHelpCleared((data) => {
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.needsHelp = false;
      chat.helpContext = null;
      chat.helpRequestedAt = null;
    }
    if (getCurrentView() === 'chats') renderChatsList();
    else setChatListDirty(true);
  }));

  fns.push(window.api.onNewMessage((message) => {
    const chat = store.chats.find(c => c.id === message.chatId);
    if (chat) {
      chat.lastMessage = message;
      const sc = getSelectedChat();
      if (sc?.id !== message.chatId && message.type === 'USER') {
        chat.unread = (chat.unread || 0) + 1;
      }
      if (getCurrentView() === 'chats') renderChatsList();
      else setChatListDirty(true);
    } else {
      window.api.getState().then(data => {
        if (data?.store?.chats) {
          const existingIds = new Set(store.chats.map(c => c.id));
          for (const c of data.store.chats) {
            if (!existingIds.has(c.id)) {
              store.chats.unshift(c);
            }
          }
          if (getCurrentView() === 'chats') renderChatsList();
          else setChatListDirty(true);
        }
      }).catch(() => {});
    }
    const sc = getSelectedChat();
    if (sc?.id === message.chatId) {
      if (getIsLoadingMessages()) {
        pushPendingChatMessage(message);
      } else {
        if (trackMessageId(message.id)) {
          pushChatMessage(message);
          renderChatMain();
        }
      }
    }
    updateBadges();
    if (message.type !== 'OPERATOR') {
      playSound('message');
    }
  }));

  fns.push(window.api.onBotStatus((data) => {
    state.botStatus = data.status;
    // Store per-panel status
    if (!state.botStatusPerPanel) state.botStatusPerPanel = {};
    if (data.panelId) {
      state.botStatusPerPanel[data.panelId] = data.status;
    }
    if (data.connectedPerPanel) {
      state.connectedPerPanel = data.connectedPerPanel;
    }
    updateBotStatus();
  }));

  fns.push(window.api.onActivityLog((entry) => {
    unshiftActivityLog(entry);
    if (getCurrentView() === 'activity') renderActivityList();
  }));

  fns.push(window.api.onFailureResolved((data) => {
    const failure = store.failures.find(f => f.id === data.failureId);
    if (failure) {
      failure.resolvedAt = data.timestamp;
      failure.resolution = data.action;
    }
    state.pendingFailures = store.failures.filter(f => !f.resolvedAt).length;
    updateBadges();
    if (getCurrentView() === 'failures') renderFailuresList();
  }));

  fns.push(window.api.onPlaySound((data) => playSound(data.type)));

  // Chat closed
  fns.push(window.api.onChatClosed((data) => {
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.status = 'CLOSED';
      chat.closedAt = data.timestamp;
    }
    if (getCurrentView() === 'chats') renderChatsList();
  }));

  // Job retried
  fns.push(window.api.onJobRetried((data) => {
    showToast(`Trabajo ${(data.jobId || '').slice(0, 8)} reintentado`, 'info');
    if (getCurrentView() === 'jobs') renderJobsList();
  }));

  // Wallet events
  fns.push(window.api.onWalletCreated((wallet) => {
    store.wallets.unshift(wallet);
    if (getCurrentView() === 'wallets') {
      renderWalletsList();
      updateSelectedWalletDisplay();
    }
    showToast('Billetera creada: ' + wallet.label, 'success');
  }));

  fns.push(window.api.onWalletUpdated((wallet) => {
    const index = store.wallets.findIndex(w => w.id === wallet.id);
    if (index >= 0) store.wallets[index] = wallet;
    if (getCurrentView() === 'wallets') {
      renderWalletsList();
      updateSelectedWalletDisplay();
    }
  }));

  fns.push(window.api.onWalletSelected((data) => {
    store.wallets.forEach(w => {
      w.isSelected = w.id === data.wallet?.id;
    });
    if (getCurrentView() === 'wallets') {
      renderWalletsList();
      updateSelectedWalletDisplay();
    }
    if (data.reason === 'auto_rotation') {
      showToast('Rotacion automatica: billetera cambiada a "' + escapeHtml(data.wallet?.label || '') + '"', 'info');
    } else {
      showToast('Billetera activada: ' + escapeHtml(data.wallet?.label || 'Unknown'), 'success');
    }
  }));

  fns.push(window.api.onWalletDeleted((data) => {
    store.wallets = store.wallets.filter(w => w.id !== data.id);
    if (getCurrentView() === 'wallets') {
      renderWalletsList();
      updateSelectedWalletDisplay();
    }
    showToast('Billetera eliminada', 'info');
  }));

  fns.push(window.api.onWalletEmptied((data) => {
    const idx = store.wallets.findIndex(w => w.id === data.wallet?.id);
    if (idx >= 0) store.wallets[idx] = data.wallet;
    if (getCurrentView() === 'wallets') {
      renderWalletsList();
      updateSelectedWalletDisplay();
    }
    showToast('Billetera vaciada: ' + escapeHtml(data.wallet?.label || ''), 'success');
  }));

  fns.push(window.api.onWalletsAllFull((data) => {
    showToast('TODAS LAS BILLETERAS SUPERARON SU LIMITE', 'error');
  }));

  fns.push(window.api.onUserUpdated((user) => {
    const idx = store.clients.findIndex(c => c.id === user.id);
    if (idx >= 0) {
      store.clients[idx] = user;
    } else {
      store.clients.unshift(user);
    }
    if (getCurrentView() === 'users') {
      renderUsersList();
    }
  }));

  // Typing indicator from users
  fns.push(window.api.onUserTyping((data) => {
    if (getSelectedChat()?.id === data.chatId) {
      showUserTyping();
    }
  }));

  // Auth warning
  fns.push(window.api.onAuthWarning((data) => {
    showToast(data.message, 'error');
  }));

  // Validator status
  fns.push(window.api.onValidatorStatus((data) => {
    state.validatorConnected = data.connected;
    updateValidatorStatus();
  }));

  fns.push(window.api.onMessagesRead((data) => {
    const chat = store.chats.find(c => c.id === data.chatId);
    if (chat) {
      chat.unread = 0;
      chat.unreadCount = 0;
      if (getCurrentView() === 'chats') renderChatsList();
      updateBadges();
    }
  }));

  fns.push(window.api.onQuickRepliesUpdated((data) => {
    setQuickReplies(data);
    renderQuickRepliesButtons();
    if (getCurrentView() === 'settings') {
      renderQuickRepliesSettingsList();
    }
  }));

  // Ollama AI status
  if (window.api.onOllamaStatus) {
    fns.push(window.api.onOllamaStatus((data) => {
      ollamaState.available = data.available;
      ollamaState.model = data.model || null;
      updateOllamaStatus();
    }));
  }

  // Sound alerts from main process
  if (window.api.onPlaySound) {
    fns.push(window.api.onPlaySound((data) => {
      playSound(data.sound);
    }));
  }

  // Prize claims
  if (window.api.onNewPrizeClaim) {
    fns.push(window.api.onNewPrizeClaim((data) => {
      store.prizeClaims = store.prizeClaims || [];
      if (!store.prizeClaims.find(c => c.id === data.id)) {
        store.prizeClaims.unshift(data);
      }
      updatePrizesBadge();
      if (getCurrentView() === 'prizes') renderPrizesView();
    }));
  }

  if (window.api.onPrizeClaimUpdated) {
    fns.push(window.api.onPrizeClaimUpdated((data) => {
      if (store.prizeClaims) {
        const idx = store.prizeClaims.findIndex(c => c.id === data.id);
        if (idx >= 0) {
          store.prizeClaims[idx] = { ...store.prizeClaims[idx], ...data };
        }
      }
      updatePrizesBadge();
      if (getCurrentView() === 'prizes') renderPrizesView();
    }));
  }

  if (window.api.onPrizeClaimsLoaded) {
    fns.push(window.api.onPrizeClaimsLoaded((data) => {
      store.prizeClaims = data || [];
      updatePrizesBadge();
      if (getCurrentView() === 'prizes') renderPrizesView();
    }));
  }

  // Outbound payments
  if (window.api.onOutboundPaymentCreated) {
    fns.push(window.api.onOutboundPaymentCreated((payment) => {
      store.outboundPayments = store.outboundPayments || [];
      store.outboundPayments.unshift(payment);
      if (getCurrentView() === 'payments') renderPaymentsList();
    }));
  }

  if (window.api.onOutboundPaymentUpdated) {
    fns.push(window.api.onOutboundPaymentUpdated((payment) => {
      store.outboundPayments = store.outboundPayments || [];
      const idx = store.outboundPayments.findIndex(p => p.id === payment.id);
      if (idx >= 0) store.outboundPayments[idx] = { ...store.outboundPayments[idx], ...payment };
      else store.outboundPayments.unshift(payment);
      if (getCurrentView() === 'payments') renderPaymentsList();
    }));
  }

  // Settings synced from another operator
  if (window.api.onSettingsUpdated) {
    fns.push(window.api.onSettingsUpdated((data) => {
      if (data.settings) store.settings = data.settings;
      if (getCurrentView() === 'settings') loadSettings();
      showToast('Configuracion actualizada por otro operador', 'info');
    }));
  }

  // Proof uploaded — refresh failures view if visible
  if (window.api.onProofUploaded) {
    fns.push(window.api.onProofUploaded((data) => {
      if (getCurrentView() === 'failures') renderFailuresList();
    }));
  }

  // Panel balance alert muted
  if (window.api.onPanelBalanceAlertMuted) {
    fns.push(window.api.onPanelBalanceAlertMuted((data) => {
      showToast(`Alerta de balance silenciada (panel ${escapeHtml(data.panelId || 'default')})`, 'info');
    }));
  }

  // Extension heartbeat
  if (window.api.onExtensionHeartbeat) {
    fns.push(window.api.onExtensionHeartbeat((data) => {
      if (!store.extensions) store.extensions = [];
      const idx = store.extensions.findIndex(e => e.extensionId === data.extensionId);
      if (idx >= 0) {
        store.extensions[idx] = { ...store.extensions[idx], ...data };
      } else {
        store.extensions.push(data);
      }
      if (getCurrentView() === 'extensions') renderExtensionsList();
    }));
  }

  // Extension log
  if (window.api.onExtensionLog) {
    fns.push(window.api.onExtensionLog((data) => {
      const content = document.getElementById('extension-logs-content');
      if (content && content.dataset.extensionId === data.extensionId) {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${escapeHtml(data.level || 'info')}`;
        entry.textContent = `[${(data.timestamp || '').substring(11, 19) || ''}] [${data.level || 'info'}] ${data.message || ''}`;
        content.appendChild(entry);
        if (content.children.length > 200) content.removeChild(content.firstChild);
        content.scrollTop = content.scrollHeight;
      }
    }));
  }

  // Extension circuit breaker
  if (window.api.onExtensionCircuitBreaker) {
    fns.push(window.api.onExtensionCircuitBreaker((data) => {
      if (!store.extensions) store.extensions = [];
      const idx = store.extensions.findIndex(e => e.extensionId === data.extensionId);
      if (idx >= 0) {
        store.extensions[idx].consecutiveErrors = data.errors || store.extensions[idx].consecutiveErrors;
        store.extensions[idx].status = 'error';
      }
      if (getCurrentView() === 'extensions') renderExtensionsList();
      showToast(`Extension ${escapeHtml(data.extensionId || '')} pausada por ${data.errors || 0} errores`, 'error');
    }));
  }

  if (window.api.onExtensionSelectorHealth) {
    fns.push(window.api.onExtensionSelectorHealth((data) => {
      if (!store.extensions) store.extensions = [];
      const idx = store.extensions.findIndex(e => e.extensionId === data.extensionId);
      if (idx >= 0) {
        store.extensions[idx].selectorHealth = {
          matched: data.matched || 0,
          failed: data.failed || 0,
          total: data.total || 0,
          failedSelectors: data.failedSelectors || [],
          checkedAt: data.timestamp,
        };
      }
      if (getCurrentView() === 'extensions') renderExtensionsList();
      if (data.failed > 0) {
        showToast(`${data.failed} selectores rotos en ${escapeHtml(data.extensionId || 'extension')}`, 'warning');
      }
    }));
  }

  setIpcCleanupFunctions(fns);
}

// ============================================
// WINDOW GLOBALS (for HTML onclick handlers)
// ============================================

window.openFailureModal = openFailureModal;
window.selectChat = selectChat;
window.sendChatMessage = sendChatMessage;
window.handleImageSelected = handleImageSelected;
window.clearPendingImage = clearPendingImage;
window.closeCurrentChat = closeCurrentChat;
window.retryJob = retryJob;
window.openImageZoom = openImageZoom;
window.selectWallet = selectWallet;
window.deleteWallet = deleteWallet;
window.emptyWallet = emptyWallet;
window.toggleWalletVerification = toggleWalletVerification;
window.loadChatMessages = loadChatMessages;
window.loadMoreChatMessages = loadMoreChatMessages;
window.handleOperatorTyping = handleOperatorTyping;
window.editQuickReply = editQuickReply;
window.deleteQuickReply = deleteQuickReply;
window.closeQuickReplyModal = closeQuickReplyModal;
window.saveQuickReplyFromModal = saveQuickReplyFromModal;
window.toggleUserActive = toggleUserActive;
window.createPanelUser = createPanelUser;
window.refreshClients = refreshClients;
window.processPrizeClaim = processPrizeClaim;
window.completePrizeClaim = completePrizeClaim;
window.rejectPrizeClaim = rejectPrizeClaim;
window.requestSuggestedReplies = requestSuggestedReplies;
window.fillChatInputFromSuggestion = fillChatInputFromSuggestion;
window.confirmTextInputModal = confirmTextInputModal;
window.editPanel = editPanel;
window.deactivatePanel = deactivatePanel;
window.activatePanel = activatePanel;
window.cancelTextInputModal = cancelTextInputModal;

// Extension log panel globals
window.showExtensionLogs = (extensionId) => {
  const panel = document.getElementById('extension-logs-panel');
  const content = document.getElementById('extension-logs-content');
  const title = document.getElementById('extension-logs-title');
  if (panel && content) {
    panel.style.display = 'flex';
    content.innerHTML = '';
    content.dataset.extensionId = extensionId;
    if (title) title.textContent = `Logs: ${extensionId}`;
  }
};
window.closeExtensionLogs = () => {
  const panel = document.getElementById('extension-logs-panel');
  if (panel) panel.style.display = 'none';
};
window.resetCircuitBreaker = (extensionId) => {
  if (window.api && window.api.resetCircuitBreaker) {
    window.api.resetCircuitBreaker(extensionId);
  }
};

// ============================================
// PERIODIC UPDATES & CLEANUP (O2 FIX)
// ============================================

const lastUpdateEntry = trackInterval(setInterval(updateLastUpdate, 5000));

window.addEventListener('beforeunload', () => {
  clearAllTrackedTimers();
});
