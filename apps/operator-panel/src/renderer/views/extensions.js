// renderer/views/extensions.js — Extensions Dashboard view

import { store } from '../state.js';
import { escapeHtml } from '../utils.js';
import { EXTENSION_TYPE_LABELS, EXTENSION_STATUS_CONFIG } from '../constants.js';

// ============================================
// RENDER EXTENSIONS LIST
// ============================================

export function renderExtensionsList() {
  const container = document.getElementById('extensions-list');
  if (!container) return;

  const extensions = store.extensions || [];

  if (extensions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48">
          <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
        <p>No hay extensiones conectadas</p>
        <p class="text-muted">Las extensiones apareceran cuando se conecten al servidor</p>
      </div>
    `;
    return;
  }

  // Summary bar
  const onlineCount = extensions.filter(e => e.status === 'online' || e.status === 'busy').length;
  const errorCount = extensions.filter(e => e.status === 'error' || e.status === 'degraded').length;
  const offlineCount = extensions.filter(e => e.status === 'offline').length;

  const summaryHtml = `
    <div class="extensions-summary">
      <span class="ext-summary-item ext-summary-online">${onlineCount} extensiones online</span>
      <span class="ext-summary-separator">&bull;</span>
      <span class="ext-summary-item ext-summary-error">${errorCount} con errores</span>
      <span class="ext-summary-separator">&bull;</span>
      <span class="ext-summary-item ext-summary-offline">${offlineCount} offline</span>
    </div>
  `;

  const cardsHtml = extensions.map(ext => renderExtensionCard(ext)).join('');

  container.innerHTML = summaryHtml + `<div class="extensions-grid">${cardsHtml}</div>`;
}

// ============================================
// RENDER SINGLE EXTENSION CARD
// ============================================

function renderExtensionCard(ext) {
  const statusConfig = EXTENSION_STATUS_CONFIG[ext.status] || EXTENSION_STATUS_CONFIG.offline;
  const typeLabel = EXTENSION_TYPE_LABELS[ext.type] || escapeHtml(ext.type || 'Desconocido');
  const isCircuitBroken = (ext.consecutiveErrors || 0) >= 3;

  const lastHeartbeat = ext.lastHeartbeat ? formatRelativeTime(ext.lastHeartbeat) : '--';
  const lastJob = ext.lastJobAt ? formatRelativeTime(ext.lastJobAt) : '--';
  const uptime = ext.connectedAt ? formatUptime(ext.connectedAt) : '--';
  const currentUrl = ext.currentUrl ? truncateUrl(ext.currentUrl, 40) : '--';
  const sessionValid = ext.sessionValid;
  const sessionHtml = sessionValid === true
    ? '<span class="ext-session-valid">&#10003; Valida</span>'
    : sessionValid === false
      ? '<span class="ext-session-expired">&#10007; Expirada</span>'
      : '<span class="ext-session-unknown">--</span>';

  const errorsClass = (ext.consecutiveErrors || 0) > 0 ? 'ext-errors-red' : '';

  return `
    <div class="extension-card ${isCircuitBroken ? 'ext-circuit-broken' : ''}">
      <div class="ext-card-header">
        <span class="ext-type-label">${typeLabel}</span>
        <span class="ext-status-badge ${statusConfig.class}">
          <span class="ext-status-dot">${statusConfig.dot}</span>
          ${escapeHtml(statusConfig.label)}
        </span>
      </div>

      <div class="ext-card-body">
        <div class="ext-info-row">
          <span class="ext-info-label">ID</span>
          <span class="ext-info-value">${escapeHtml(ext.extensionId || '--')}</span>
        </div>
        ${ext.panelId ? `
        <div class="ext-info-row">
          <span class="ext-info-label">Panel</span>
          <span class="ext-info-value">${escapeHtml(ext.panelId)}</span>
        </div>` : ''}
        ${ext.walletId ? `
        <div class="ext-info-row">
          <span class="ext-info-label">Wallet</span>
          <span class="ext-info-value">${escapeHtml(ext.walletId)}</span>
        </div>` : ''}
        <div class="ext-info-row">
          <span class="ext-info-label">URL</span>
          <span class="ext-info-value ext-url" title="${escapeHtml(ext.currentUrl || '')}">${escapeHtml(currentUrl)}</span>
        </div>
        <div class="ext-info-row">
          <span class="ext-info-label">Sesion</span>
          <span class="ext-info-value">${sessionHtml}</span>
        </div>
        <div class="ext-info-row">
          <span class="ext-info-label">Heartbeat</span>
          <span class="ext-info-value">${escapeHtml(lastHeartbeat)}</span>
        </div>
        <div class="ext-info-row">
          <span class="ext-info-label">Ultimo job</span>
          <span class="ext-info-value">${escapeHtml(lastJob)}</span>
        </div>
        <div class="ext-info-row">
          <span class="ext-info-label">Errores</span>
          <span class="ext-info-value ${errorsClass}">${ext.consecutiveErrors || 0}</span>
        </div>
        ${ext.version ? `
        <div class="ext-info-row">
          <span class="ext-info-label">Version</span>
          <span class="ext-info-value">${escapeHtml(ext.version)}</span>
        </div>` : ''}
        <div class="ext-info-row">
          <span class="ext-info-label">Uptime</span>
          <span class="ext-info-value">${escapeHtml(uptime)}</span>
        </div>
        ${ext.memoryMB != null ? `
        <div class="ext-info-row">
          <span class="ext-info-label">Memoria</span>
          <span class="ext-info-value">${ext.memoryMB.toFixed(1)} MB</span>
        </div>` : ''}
        ${ext.selectorHealth ? `
        <div class="ext-info-row">
          <span class="ext-info-label">Selectores</span>
          <span class="ext-info-value ${ext.selectorHealth.failed > 0 ? 'ext-errors-red' : 'ext-session-valid'}">${ext.selectorHealth.matched}/${ext.selectorHealth.total} OK${ext.selectorHealth.failed > 0 ? ` (${ext.selectorHealth.failed} fallaron!)` : ''}</span>
        </div>` : ''}
      </div>

      <div class="ext-card-footer">
        ${isCircuitBroken ? `<span class="ext-circuit-badge">PAUSADO</span>
          <button class="btn btn-sm btn-primary" onclick="window.resetCircuitBreaker('${escapeHtml(ext.extensionId)}')">Reactivar</button>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="window.showExtensionLogs('${escapeHtml(ext.extensionId)}')">Ver Logs</button>
      </div>
    </div>
  `;
}

// ============================================
// HELPERS
// ============================================

function formatRelativeTime(isoString) {
  if (!isoString) return '--';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'ahora';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours}h ${diffMin % 60}m`;
  const diffDays = Math.floor(diffHours / 24);
  return `hace ${diffDays}d`;
}

function formatUptime(connectedAtIso) {
  if (!connectedAtIso) return '--';
  const now = Date.now();
  const start = new Date(connectedAtIso).getTime();
  const diffMs = now - start;
  if (diffMs < 0) return '0m';
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function truncateUrl(url, maxLen) {
  if (!url) return '--';
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}
