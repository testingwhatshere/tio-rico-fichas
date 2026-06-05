// renderer/entry-helpers.js — Functions that multiple view modules need
// These break circular deps between views and the main entry point.

import { store, state, getCurrentView, setCurrentView, setChatListDirty } from './state.js';
import { VIEW_TITLES } from './constants.js';
import { updateDashboard } from './views/dashboard.js';
import { renderFailuresList } from './views/failures.js';
import { renderJobsList } from './views/jobs.js';
import { renderChatsList } from './views/chats.js';
import { renderActivityList } from './views/activity.js';
import { initWalletsView } from './views/wallets.js';
import { initPrizesView } from './views/prizes.js';
import { initPaymentsView } from './views/payments.js';
import { initUsersView } from './views/users.js';
import { initPreloadUsersView } from './views/preload-users.js';
import { initRequestsView } from './views/requests.js';
import { loadSettings } from './views/settings.js';
import { loadPanels, setupPanelsView, editPanel, deactivatePanel, activatePanel } from './views/panels.js';
import { renderExtensionsList } from './views/extensions.js';

// ============================================
// NAVIGATION
// ============================================

export function navigateTo(view) {
  setCurrentView(view);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });

  document.getElementById('view-title').textContent = VIEW_TITLES[view] || 'Dashboard';

  switch (view) {
    case 'dashboard': updateDashboard(); break;
    case 'failures': renderFailuresList(); break;
    case 'jobs': renderJobsList(); break;
    case 'chats': setChatListDirty(false); renderChatsList(); break;
    case 'activity': renderActivityList(); break;
    case 'wallets': initWalletsView(); break;
    case 'prizes': initPrizesView(); break;
    case 'payments': initPaymentsView(); break;
    case 'users': initUsersView(); break;
    case 'preload-users': initPreloadUsersView(); break;
    case 'requests': initRequestsView(); break;
    case 'panels': setupPanelsView(); loadPanels(); break;
    case 'extensions': renderExtensionsList(); break;
    case 'settings': loadSettings(); break;
  }
}

// ============================================
// UI STATUS UPDATES
// ============================================

export function updateConnectionStatus() {
  const statusEl = document.getElementById('connection-status');
  if (!statusEl) return;

  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('span:last-child');

  if (dot) dot.className = `status-dot ${state.connected ? 'connected' : 'disconnected'}`;
  if (text) text.textContent = state.connected ? 'Conectado' : 'Desconectado';
}

export function updateBotStatus() {
  const botStatusEl = document.getElementById('bot-status');
  if (!botStatusEl) return;

  const dot = botStatusEl.querySelector('.bot-status-dot');
  const text = botStatusEl.querySelector('.bot-status-text');

  const statusMap = {
    online: { class: 'online', text: 'Bot Online' },
    offline: { class: 'offline', text: 'Bot Offline' },
    busy: { class: 'busy', text: 'Bot Procesando' },
    error: { class: 'error', text: 'Bot Error' }
  };

  // Show per-panel status if available
  const perPanel = state.botStatusPerPanel;
  if (perPanel && Object.keys(perPanel).length > 0) {
    const onlineCount = Object.values(perPanel).filter(s => s === 'online' || s === 'busy').length;
    const totalCount = Object.keys(perPanel).length;
    const worstStatus = Object.values(perPanel).includes('offline') ? 'offline' :
      Object.values(perPanel).includes('busy') ? 'busy' : 'online';

    const status = statusMap[worstStatus] || statusMap.offline;
    if (dot) dot.className = `bot-status-dot ${onlineCount > 0 ? 'online' : 'offline'}`;
    if (text) text.textContent = `Bots: ${onlineCount}/${totalCount} online`;
  } else {
    const status = statusMap[state.botStatus] || statusMap.offline;
    if (dot) dot.className = `bot-status-dot ${status.class}`;
    if (text) text.textContent = status.text;
  }
}

export function updateValidatorStatus() {
  const validatorStatusEl = document.getElementById('validator-status');
  if (!validatorStatusEl) return;

  const dot = validatorStatusEl.querySelector('.bot-status-dot');
  const text = validatorStatusEl.querySelector('.bot-status-text');

  if (dot) dot.className = `bot-status-dot ${state.validatorConnected ? 'online' : 'offline'}`;
  if (text) text.textContent = state.validatorConnected ? 'Validador Online' : 'Validador Offline';
}

export function updateLastUpdate() {
  const el = document.getElementById('last-update');
  if (!el) return;

  const span = el.querySelector('span');
  if (!span) return;

  if (state.lastUpdate) {
    const date = new Date(state.lastUpdate);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    let text;
    if (diff < 5) text = 'Ahora';
    else if (diff < 60) text = `${diff}s`;
    else if (diff < 3600) text = `${Math.floor(diff / 60)}m`;
    else text = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    span.textContent = text;

    el.classList.toggle('stale-warning', diff >= 300 && diff < 900);
    el.classList.toggle('stale-danger', diff >= 900);
  }
}

export function updateBadges() {
  const failuresBadge = document.getElementById('failures-badge');
  const pendingFailures = store.failures.filter(f => !f.resolvedAt).length;
  if (failuresBadge) {
    failuresBadge.textContent = pendingFailures;
    failuresBadge.classList.toggle('hidden', pendingFailures === 0);
  }

  const chatsBadge = document.getElementById('chats-badge');
  const unreadChats = store.chats.filter(c => (c.unread || c.unreadCount) > 0).length;
  if (chatsBadge) {
    chatsBadge.textContent = unreadChats;
    chatsBadge.classList.toggle('hidden', unreadChats === 0);
  }
}

export function updateKillSwitchButton() {
  const btn = document.getElementById('kill-switch-btn');
  if (!btn) return;

  btn.classList.toggle('active', state.killSwitchActive);
  const span = btn.querySelector('span');
  if (span) {
    span.textContent = state.killSwitchActive ? 'KILL SWITCH ACTIVO' : 'Kill Switch';
  }
}
