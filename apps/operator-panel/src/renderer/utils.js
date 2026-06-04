// renderer/utils.js — Shared utility / helper functions
// O4 FIX: All innerHTML with user-controlled variables MUST use escapeHtml()

import { FLAG_LABELS, WALLET_TYPE_LABELS } from './constants.js';
import {
  getNotificationSettings,
  getTextInputResolve, setTextInputResolve,
  getConfirmModalHandler, setConfirmModalHandler,
  setSelectedFailure,
  trackTimeout,
} from './state.js';

// ============================================
// HTML escaping (XSS prevention)
// ============================================

const _escapeDiv = document.createElement('div');
export function escapeHtml(text) {
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

// ============================================
// Date / Time formatting
// ============================================

export function getTimeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'ahora';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatMessageTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// Amount formatting
// ============================================

export function formatAmount(value) {
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ============================================
// Toast notifications
// ============================================

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      ${type === 'success'
      ? '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>'
      : type === 'error'
        ? '<path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>'
        : '<path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'}
    </svg>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  const duration = type === 'error' ? 6000 : type === 'success' ? 3000 : 4000;
  const timerId = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
  trackTimeout(timerId);
}

// ============================================
// Sound alerts
// ============================================

export function playSound(type) {
  const settings = getNotificationSettings();
  if (!settings.soundEnabled) return;

  try {
    const audio = document.getElementById('sound-alert');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => { });
    }
  } catch (e) {
    console.log('Sound play failed:', e);
  }
}

// ============================================
// Wallet formatting helpers
// ============================================

export function getFlagLabel(flag) {
  return FLAG_LABELS[flag] || flag;
}

export function getWalletTypeLabel(type) {
  return WALLET_TYPE_LABELS[type] || type;
}

export function formatWalletDetails(wallet) {
  const details = wallet.details || {};
  if (wallet.type === 'MERCADOPAGO') {
    return details.alias ? `Alias: ${escapeHtml(details.alias)}` : '';
  } else if (wallet.type === 'CBU') {
    return [
      details.bank ? `Banco: ${escapeHtml(details.bank)}` : '',
      details.cbu ? `CBU: ${escapeHtml(details.cbu)}` : ''
    ].filter(Boolean).join(' \u2022 ');
  } else if (wallet.type === 'CVU') {
    return details.cvu ? `CVU: ${escapeHtml(details.cvu)}` : '';
  }
  // RIPIO, FIWIND, PREX — show alias or any available detail
  if (details.alias) return `Alias: ${escapeHtml(details.alias)}`;
  if (details.accountId) return `Cuenta: ${escapeHtml(details.accountId)}`;
  return '';
}

export function formatWalletDetailsLarge(wallet) {
  const details = wallet.details || {};
  if (wallet.type === 'MERCADOPAGO') {
    return details.alias ? `<div class="detail-item"><span class="label">Alias:</span> <span class="value copyable" data-copy="${escapeHtml(details.alias)}" title="Click para copiar">${escapeHtml(details.alias)}</span></div>` : '';
  } else if (wallet.type === 'CBU') {
    return [
      details.bank ? `<div class="detail-item"><span class="label">Banco:</span> <span class="value">${escapeHtml(details.bank)}</span></div>` : '',
      details.cbu ? `<div class="detail-item"><span class="label">CBU:</span> <span class="value copyable" data-copy="${escapeHtml(details.cbu)}" title="Click para copiar">${escapeHtml(details.cbu)}</span></div>` : ''
    ].filter(Boolean).join('');
  } else if (wallet.type === 'CVU') {
    return details.cvu ? `<div class="detail-item"><span class="label">CVU:</span> <span class="value copyable" data-copy="${escapeHtml(details.cvu)}" title="Click para copiar">${escapeHtml(details.cvu)}</span></div>` : '';
  }
  // RIPIO, FIWIND, PREX
  if (details.alias) return `<div class="detail-item"><span class="label">Alias:</span> <span class="value copyable" data-copy="${escapeHtml(details.alias)}" title="Click para copiar">${escapeHtml(details.alias)}</span></div>`;
  if (details.accountId) return `<div class="detail-item"><span class="label">Cuenta:</span> <span class="value copyable" data-copy="${escapeHtml(details.accountId)}" title="Click para copiar">${escapeHtml(details.accountId)}</span></div>`;
  return '';
}

// ============================================
// Modal helpers
// ============================================

export function showTextInputModal(title, placeholder, confirmLabel) {
  return new Promise((resolve) => {
    setTextInputResolve(resolve);
    const modal = document.getElementById('text-input-modal');
    const titleEl = document.getElementById('text-input-modal-title');
    const textarea = document.getElementById('text-input-modal-textarea');
    const messageEl = document.getElementById('text-input-modal-message');
    const confirmBtn = document.getElementById('text-input-modal-confirm');

    textarea.classList.remove('hidden');
    messageEl.classList.add('hidden');

    titleEl.textContent = title || 'Ingres\u00e1 un motivo';
    textarea.placeholder = placeholder || 'Escrib\u00ed el motivo...';
    textarea.value = '';
    if (confirmLabel) confirmBtn.textContent = confirmLabel;
    else confirmBtn.textContent = 'Confirmar';

    modal.classList.remove('hidden');
    setTimeout(() => textarea.focus(), 100);

    textarea.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        confirmTextInputModal();
      } else if (e.key === 'Escape') {
        cancelTextInputModal();
      }
    };
  });
}

export function confirmTextInputModal() {
  const modal = document.getElementById('text-input-modal');
  const textarea = document.getElementById('text-input-modal-textarea');
  const value = textarea.value.trim();
  const handler = getConfirmModalHandler();
  if (handler) {
    modal.removeEventListener('keydown', handler);
    setConfirmModalHandler(null);
  }
  modal.classList.add('hidden');
  const resolve = getTextInputResolve();
  if (resolve) {
    resolve(value);
    setTextInputResolve(null);
  }
}

export function cancelTextInputModal() {
  const modal = document.getElementById('text-input-modal');
  const handler = getConfirmModalHandler();
  if (handler) {
    modal.removeEventListener('keydown', handler);
    setConfirmModalHandler(null);
  }
  modal.classList.add('hidden');
  document.getElementById('text-input-modal-textarea').classList.remove('hidden');
  document.getElementById('text-input-modal-message').classList.add('hidden');
  const resolve = getTextInputResolve();
  if (resolve) {
    resolve(null);
    setTextInputResolve(null);
  }
}

export function showConfirmModal(title, message, confirmLabel) {
  return new Promise((resolve) => {
    setTextInputResolve((val) => resolve(val !== null));
    const modal = document.getElementById('text-input-modal');
    const titleEl = document.getElementById('text-input-modal-title');
    const textarea = document.getElementById('text-input-modal-textarea');
    const messageEl = document.getElementById('text-input-modal-message');
    const confirmBtn = document.getElementById('text-input-modal-confirm');

    titleEl.textContent = title || 'Confirmaci\u00f3n';
    messageEl.textContent = message || '';
    messageEl.classList.remove('hidden');
    textarea.classList.add('hidden');
    textarea.value = '';
    confirmBtn.textContent = confirmLabel || 'Confirmar';

    modal.classList.remove('hidden');
    confirmBtn.focus();

    // O3 FIX: Remove previous handler to prevent accumulation
    const prevHandler = getConfirmModalHandler();
    if (prevHandler) {
      modal.removeEventListener('keydown', prevHandler);
    }
    const handler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmTextInputModal();
      } else if (e.key === 'Escape') {
        cancelTextInputModal();
      }
    };
    setConfirmModalHandler(handler);
    modal.addEventListener('keydown', handler);
  });
}

export function closeAllModals() {
  if (getTextInputResolve()) {
    cancelTextInputModal();
  }
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  setSelectedFailure(null);
}

// ============================================
// Image zoom
// ============================================

export function openImageZoom(src) {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('zoomed-image');
  img.onerror = () => {
    img.style.display = 'none';
    showToast('No se pudo cargar la imagen', 'error');
  };
  img.onload = () => {
    img.style.display = '';
  };
  img.src = src;
  modal.classList.remove('hidden');
}

// ============================================
// Export data
// ============================================

export async function exportData(type) {
  const btn = document.getElementById(`export-${type}-btn`);
  const savedHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Exportando...';
  }
  try {
    const result = await window.api.exportData(type);
    if (result.success) {
      if (!result.data || (Array.isArray(result.data) && result.data.length === 0)) {
        showToast('No hay datos para exportar', 'warning');
        return;
      }
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Exportaci\u00f3n completada', 'success');
    } else {
      showToast('Error al exportar', 'error');
    }
  } catch (error) {
    showToast('Error al exportar', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = savedHtml;
    }
  }
}
