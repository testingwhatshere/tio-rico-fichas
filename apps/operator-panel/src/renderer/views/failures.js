// renderer/views/failures.js — Failures view: list, modal, approve/reject

import { store, ollamaState,
  getSelectedFailure, setSelectedFailure,
  getIsProcessingFailure, setIsProcessingFailure,
  recentlyActionedFailures,
} from '../state.js';
import { escapeHtml, formatAmount, getTimeAgo, showToast, showTextInputModal, closeAllModals, openImageZoom, showConfirmModal } from '../utils.js';
import { triggerFailureAnalysis } from '../ai/ollama.js';
import { updateDashboard } from './dashboard.js';
import { selectChat } from './chats.js';
import { navigateTo, updateBadges } from '../entry-helpers.js';
import { DUCK_SVG } from '../constants.js';

// ============================================
// FAILURES LIST
// ============================================

export function renderFailuresList(filter = 'pending') {
  const container = document.getElementById('failures-list');
  let failures = store.failures;

  if (filter === 'pending') failures = failures.filter(f => !f.resolvedAt);
  else if (filter === 'approved') failures = failures.filter(f => f.resolution === 'APPROVED');
  else if (filter === 'rejected') failures = failures.filter(f => f.resolution === 'REJECTED');

  // Search filter
  const searchInput = document.getElementById('failures-search');
  const searchTerm = (searchInput?.value || '').trim().toLowerCase();
  if (searchTerm) {
    failures = failures.filter(f =>
      (f.targetUsername || '').toLowerCase().includes(searchTerm) ||
      (f.amount?.toString() || '').includes(searchTerm) ||
      (f.validationError || '').toLowerCase().includes(searchTerm)
    );
  }

  if (failures.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        ${DUCK_SVG}
        <p>No hay fallos en esta categor\u00eda</p>
        <span class="empty-state-hint">Todo funciona correctamente</span>
      </div>
    `;
    return;
  }

  container.innerHTML = failures.map(renderFailureItem).join('');
}

export function renderFailureItem(failure) {
  const isPending = !failure.resolvedAt;
  const type = failure.type === 'JOB_FAILURE' ? 'job' : 'validation';
  const username = failure.targetUsername || failure.request?.targetUsername || 'Usuario';
  const amount = failure.amount || failure.request?.amount || 0;
  const reason = failure.validationError || failure.error || failure.reason || 'Sin detalles';

  const score = failure.validationScore ?? failure.request?.validationScore;
  const scoreHtml = (score != null && type === 'validation')
    ? `<span class="failure-score" style="color: ${score >= 0.5 ? 'var(--amber-500)' : 'var(--red-500)'}; font-size: 11px; font-weight: 600;">${Math.round(score * 100)}%</span>`
    : '';

  return `
    <div class="failure-item ${isPending ? 'urgent' : ''}" onclick="openFailureModal('${failure.id}')">
      <div class="failure-type-icon ${type}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${type === 'job'
      ? '<path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>'
      : '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>'}
        </svg>
      </div>
      <div class="failure-content">
        <div class="failure-header">
          <span class="failure-username">${escapeHtml(username)}</span>
          ${scoreHtml}
          <span class="failure-amount">$${formatAmount(amount)}</span>
        </div>
        <div class="failure-reason">${escapeHtml(reason)}</div>
      </div>
      ${failure.resolution ? `<span class="failure-resolution ${failure.resolution.toLowerCase()}">${escapeHtml(failure.resolution)}</span>` : ''}
      <span class="failure-time">${getTimeAgo(failure.createdAt)}</span>
    </div>
  `;
}

// ============================================
// FAILURE MODAL
// ============================================

export function openFailureModal(failureId) {
  const failure = store.failures.find(f => f.id === failureId);
  if (!failure) {
    console.warn('[openFailureModal] Failure not found in store:', failureId);
    showToast('No se encontr\u00f3 el fallo', 'error');
    return;
  }
  try {

  setSelectedFailure(failure);
  const modal = document.getElementById('failure-modal');
  const body = document.getElementById('failure-modal-body');
  if (!modal || !body) return;

  const username = failure.targetUsername || failure.request?.targetUsername || 'N/A';
  const amount = failure.amount || failure.request?.amount || 0;
  const extractedAmount = failure.validationDetails?.extractedAmount;
  const hasAmountMismatch = extractedAmount !== undefined && extractedAmount !== null
    && Number(extractedAmount) !== Number(amount) && Number(extractedAmount) > 0;
  const userEmail = failure.userEmail || failure.user?.email || failure.request?.user?.email || 'N/A';
  const proofUrl = failure.proofUrl || failure.request?.proofUrl;
  const screenshot = failure.screenshot;

  const safeImageUrl = escapeHtml(proofUrl || screenshot || '');
  const errorText = escapeHtml(failure.validationError || failure.error || failure.reason || 'Sin detalles');

  body.innerHTML = `
    <div class="failure-modal-grid">
      ${proofUrl || screenshot ? `
        <div class="proof-section">
          <h4>Comprobante / Screenshot</h4>
          <div class="proof-container">
            <div class="proof-loading" id="proof-loading-spinner">
              <div class="spinner"></div>
              <span>Cargando imagen...</span>
            </div>
            <img
              src=""
              alt="Comprobante"
              class="proof-image clickable"
              data-zoom-url=""
              style="display:none"
            >
            <span class="zoom-hint" style="display:none">Click para ampliar</span>
          </div>
        </div>
      ` : ''}

      <div class="details-section">
        <h4>Detalles</h4>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Usuario Destino</span>
            <span class="detail-value">${escapeHtml(username)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">${hasAmountMismatch ? 'Monto Solicitado' : 'Monto'}</span>
            <span class="detail-value amount">$${formatAmount(amount)}</span>
          </div>
          ${hasAmountMismatch ? `
            <div class="detail-item">
              <span class="detail-label">Monto Comprobante</span>
              <span class="detail-value amount" style="color:var(--gold-400);font-weight:600">$${formatAmount(extractedAmount)}</span>
            </div>
          ` : ''}
          <div class="detail-item">
            <span class="detail-label">Email del Cliente</span>
            <span class="detail-value">${escapeHtml(userEmail)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Tipo</span>
            <span class="detail-value">${failure.type === 'JOB_FAILURE' ? 'Error de Bot' : 'Validaci\u00f3n'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Fecha</span>
            <span class="detail-value">${new Date(failure.createdAt).toLocaleString('es-AR')}</span>
          </div>
          ${failure.validationScore !== undefined ? `
            <div class="detail-item">
              <span class="detail-label">Score AI</span>
              <span class="detail-value">${Math.round(failure.validationScore * 100)}%</span>
            </div>
          ` : ''}
        </div>

        <div class="error-section">
          <h4>Motivo del Fallo</h4>
          <div class="error-box">${errorText}</div>
        </div>

        ${(() => {
          const fraudFlags = failure.validationDetails?.fraudFlags || [];
          if (fraudFlags.length === 0) return '';
          return `
            <div class="flags-section" style="margin-top:12px">
              <h4>Alertas de Validacion</h4>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                ${fraudFlags.map(flag => `
                  <span class="fraud-flag ${flag === 'RECIPIENT_MISMATCH' || flag === 'RECIPIENT_ACCOUNT_MISMATCH' ? 'fraud-flag-warning' : 'fraud-flag-danger'}">${escapeHtml(getFlagLabel(flag))}</span>
                `).join('')}
              </div>
            </div>
          `;
        })()}

        ${(ollamaState.available && ollamaState.failureAnalysisEnabled && !failure.resolution) ? `
          <div class="ai-analysis-section" id="ai-analysis-section">
            <div class="ai-analysis-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              Analisis AI
            </div>
            <div class="ai-analysis-loading" id="ai-analysis-content">
              <div class="spinner-sm"></div>
              <span>Analizando con AI...</span>
            </div>
          </div>
        ` : ''}

        ${failure.resolution ? `
          <div class="resolution-section">
            <h4>Resoluci\u00f3n</h4>
            <span class="resolution-badge ${failure.resolution.toLowerCase()}">${escapeHtml(failure.resolution)}</span>
            <span class="resolution-time">${getTimeAgo(failure.resolvedAt)}</span>
          </div>
        ` : `
          <div class="approve-note-section">
            <h4>Nota de aprobaci\u00f3n (opcional)</h4>
            <textarea id="modal-approve-note" class="approve-note-input" placeholder="Agregar nota al aprobar..." rows="2"></textarea>
          </div>
        `}
      </div>
    </div>
  `;

  // Load proof image
  const zoomImg = body.querySelector('.proof-image');
  const loadingSpinner = document.getElementById('proof-loading-spinner');
  const zoomHint = body.querySelector('.zoom-hint');
  const url = proofUrl || screenshot;
  if (zoomImg && url) {
    const showImage = (src) => {
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      zoomImg.src = src;
      zoomImg.dataset.zoomUrl = src;
      zoomImg.style.display = '';
      if (zoomHint) zoomHint.style.display = '';
      zoomImg.onclick = () => openImageZoom(src);
    };

    const showError = (detail) => {
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      const parent = zoomImg.parentElement;
      parent.innerHTML = `<div class="proof-error">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
        <span>Imagen no disponible</span>
        ${detail ? `<span class="proof-error-detail">${escapeHtml(detail)}</span>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="openFailureModal('${escapeHtml(failure.id)}')">Reintentar</button>
      </div>`;
    };

    if (url.startsWith('http')) {
      zoomImg.onload = () => {
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (zoomHint) zoomHint.style.display = '';
      };
      zoomImg.onerror = () => showError('No se pudo cargar la imagen');
      showImage(url);
    } else {
      window.api.fetchProofImage(url).then(result => {
        if (result && result.dataUrl) {
          showImage(result.dataUrl);
        } else {
          showError(result?.error || 'Respuesta vac\u00eda del servidor');
        }
      }).catch((err) => {
        showError(err?.message || 'Error de conexi\u00f3n');
      });
    }
  }

  // Show/hide action buttons
  const approveBtn = document.getElementById('modal-approve-btn');
  const rejectBtn = document.getElementById('modal-reject-btn');
  const gotoChatBtn = document.getElementById('modal-goto-chat-btn');
  const isPending = !failure.resolvedAt;

  if (approveBtn) approveBtn.style.display = isPending ? '' : 'none';
  if (rejectBtn) rejectBtn.style.display = isPending ? '' : 'none';

  if (gotoChatBtn) {
    const showChatBtn = isPending && hasAmountMismatch;
    gotoChatBtn.style.display = showChatBtn ? '' : 'none';
    gotoChatBtn.classList.toggle('hidden', !showChatBtn);
    if (showChatBtn) {
      gotoChatBtn.onclick = () => {
        const chat = store.chats.find(c => c.requestId === failure.id || c.requestId === failure.requestId)
          || store.chats.find(c => c.userId === failure.userId);
        if (chat) {
          closeAllModals();
          navigateTo('chats');
          selectChat(chat.id);
        } else {
          showToast('No se encontr\u00f3 el chat asociado', 'error');
        }
      };
    }
  }

  // Retry discovery button (for requests where user was not found on panel)
  const retryDiscoveryBtn = document.getElementById('modal-retry-discovery-btn');
  if (retryDiscoveryBtn) {
    const requestId = failure.id || failure.requestId;
    const isDiscoveryFailure = isPending && (
      (failure.error || '').includes('not found') ||
      (failure.error || '').includes('no encontrado') ||
      (failure.reason || '').includes('NOT_FOUND') ||
      failure.type === 'VALIDATION_FAILURE'
    );
    retryDiscoveryBtn.style.display = (isPending && requestId) ? '' : 'none';
    if (isPending && requestId) {
      retryDiscoveryBtn.onclick = async () => {
        retryDiscoveryBtn.disabled = true;
        retryDiscoveryBtn.textContent = 'Reintentando...';
        try {
          const result = await window.electronAPI.retryFailedRequest(requestId);
          if (result?.success) {
            showToast('Discovery reiniciado. Se buscará/creará al usuario.', 'success');
            closeAllModals();
          } else {
            showToast(result?.error || 'Error al reintentar', 'error');
          }
        } catch (err) {
          showToast(err?.message || 'Error al reintentar', 'error');
        } finally {
          retryDiscoveryBtn.disabled = false;
          retryDiscoveryBtn.textContent = 'Reintentar / Crear Usuario';
        }
      };
    }
  }

  modal.classList.remove('hidden');

  if (ollamaState.available && ollamaState.failureAnalysisEnabled && !failure.resolution) {
    triggerFailureAnalysis(failure);
  }

  } catch (err) {
    console.error('[openFailureModal] Error:', err);
    showToast('Error al abrir el detalle del fallo', 'error');
  }
}

// Import getFlagLabel for use in the modal template
import { getFlagLabel } from '../utils.js';

// ============================================
// APPROVE / REJECT
// ============================================

export async function approveSelectedFailure() {
  const selectedFailure = getSelectedFailure();
  if (!selectedFailure || selectedFailure.resolvedAt || getIsProcessingFailure()) return;

  setIsProcessingFailure(true);
  const approveBtn = document.getElementById('modal-approve-btn');
  const rejectBtn = document.getElementById('modal-reject-btn');
  const approveOriginal = approveBtn ? approveBtn.innerHTML : '';
  if (approveBtn) { approveBtn.disabled = true; approveBtn.innerHTML = '<span class="btn-spinner"></span> Aprobando...'; }
  if (rejectBtn) rejectBtn.disabled = true;

  try {
    const noteEl = document.getElementById('modal-approve-note');
    const note = noteEl ? noteEl.value.trim() : '';
    const extractedAmt = selectedFailure.validationDetails?.extractedAmount;
    const requestedAmt = selectedFailure.amount || selectedFailure.request?.amount || 0;
    const approvedAmount = (extractedAmt !== undefined && extractedAmt !== null
      && Number(extractedAmt) !== Number(requestedAmt) && Number(extractedAmt) > 0)
      ? Number(extractedAmt) : undefined;
    const result = await window.api.approveFailure(selectedFailure.id, note, approvedAmount);
    if (result.success) {
      showToast('Fallo aprobado', 'success');
      selectedFailure.resolvedAt = new Date().toISOString();
      selectedFailure.resolution = 'APPROVED';
      recentlyActionedFailures.set(selectedFailure.id, Date.now());
      closeAllModals();
      renderFailuresList();
      updateDashboard();
      updateBadges();
    } else {
      showToast('Error: ' + (result.error || 'No se pudo aprobar'), 'error');
    }
  } finally {
    setIsProcessingFailure(false);
    if (approveBtn) { approveBtn.disabled = false; approveBtn.innerHTML = approveOriginal; }
    if (rejectBtn) rejectBtn.disabled = false;
  }
}

export async function rejectSelectedFailure() {
  const selectedFailure = getSelectedFailure();
  if (!selectedFailure || selectedFailure.resolvedAt || getIsProcessingFailure()) return;

  const failureId = selectedFailure.id;

  const reason = await showTextInputModal('Motivo del rechazo', 'Describ\u00ed el motivo del rechazo...', 'Rechazar');
  if (reason === null) return;

  // Guard against selectedFailure being nulled by closeAllModals during await
  const currentFailure = getSelectedFailure();
  if (!currentFailure) {
    showToast('Error: el fallo fue deseleccionado', 'error');
    return;
  }

  setIsProcessingFailure(true);
  const approveBtn = document.getElementById('modal-approve-btn');
  const rejectBtn = document.getElementById('modal-reject-btn');
  const rejectOriginal = rejectBtn ? rejectBtn.innerHTML : '';
  if (approveBtn) approveBtn.disabled = true;
  if (rejectBtn) { rejectBtn.disabled = true; rejectBtn.innerHTML = '<span class="btn-spinner"></span> Rechazando...'; }

  try {
    const result = await window.api.rejectFailure(failureId, reason);
    if (result.success) {
      showToast('Fallo rechazado', 'success');
      currentFailure.resolvedAt = new Date().toISOString();
      currentFailure.resolution = 'REJECTED';
      recentlyActionedFailures.set(currentFailure.id, Date.now());
      closeAllModals();
      renderFailuresList();
      updateDashboard();
      updateBadges();
    } else {
      showToast('Error: ' + (result.error || 'No se pudo rechazar'), 'error');
    }
  } finally {
    setIsProcessingFailure(false);
    if (approveBtn) approveBtn.disabled = false;
    if (rejectBtn) { rejectBtn.disabled = false; rejectBtn.innerHTML = rejectOriginal; }
  }
}
