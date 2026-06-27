// renderer/views/prizes.js — Prize claims management view

import { store } from '../state.js';
import { escapeHtml, showToast, showTextInputModal } from '../utils.js';
import { DUCK_SVG } from '../constants.js';

let prizesFilter = 'pending';

export function initPrizesView() {
  renderPrizesView();
}

export function renderPrizesView() {
  const container = document.getElementById('prizes-container');
  if (!container) return;

  const claims = store.prizeClaims || [];
  let filteredClaims;
  if (prizesFilter === 'pending') {
    filteredClaims = claims.filter(isPendingClaim);
  } else if (prizesFilter === 'completed') {
    filteredClaims = claims.filter(c => c.status === 'COMPLETED');
  } else {
    filteredClaims = claims;
  }

  container.innerHTML = `
    <div class="view-header">
      <h2>Premios</h2>
      <select id="prizes-history-filter" class="filter-select">
        <option value="pending" ${prizesFilter === 'pending' ? 'selected' : ''}>Pendientes</option>
        <option value="completed" ${prizesFilter === 'completed' ? 'selected' : ''}>Completados</option>
        <option value="all" ${prizesFilter === 'all' ? 'selected' : ''}>Todos</option>
      </select>
    </div>
    <div class="prizes-list">
      ${filteredClaims.length === 0
        ? `<div class="empty-state">${DUCK_SVG}<p>No hay premios</p></div>`
        : filteredClaims.map(c => renderPrizeClaimCard(c)).join('')}
    </div>
  `;

  // Attach filter listener
  const filterEl = document.getElementById('prizes-history-filter');
  if (filterEl) {
    filterEl.addEventListener('change', (e) => {
      prizesFilter = e.target.value;
      renderPrizesView();
    });
  }
}

function renderPrizeClaimCard(claim) {
  const amount = Number(claim.amount).toLocaleString('es-AR');
  const balance = claim.verifiedBalance ? Number(claim.verifiedBalance).toLocaleString('es-AR') : '?';
  const statusBadge = getPrizeStatusBadge(claim.status);
  const paymentInfo = claim.paymentDetails
    ? formatPaymentDetails(claim.paymentDetails, claim.paymentMethod)
    : 'Sin datos de pago';
  const createdAt = new Date(claim.createdAt).toLocaleString('es-AR');

  let actions = '';
  if (claim.status === 'VERIFIED') {
    actions = `
      <button class="btn btn-primary btn-sm" onclick="window.processPrizeClaim('${claim.id}')">
        Procesar Retiro
      </button>
      <button class="btn btn-danger btn-sm" onclick="window.rejectPrizeClaim('${claim.id}')">
        Rechazar
      </button>
    `;
  } else if (claim.status === 'PROCESSING') {
    actions = '<span class="processing-indicator">Retirando fichas...</span>';
  } else if (claim.status === 'CHIPS_WITHDRAWN') {
    actions = `
      <button class="btn btn-success btn-sm" onclick="window.completePrizeClaim('${claim.id}')">
        Marcar Pagado
      </button>
      <button class="btn btn-danger btn-sm" onclick="window.rejectPrizeClaim('${claim.id}')">
        Rechazar
      </button>
    `;
  } else if (claim.status === 'FAILED') {
    actions = `
      <button class="btn btn-primary btn-sm" onclick="window.processPrizeClaim('${claim.id}')">
        Reintentar
      </button>
      <button class="btn btn-danger btn-sm" onclick="window.rejectPrizeClaim('${claim.id}')">
        Rechazar
      </button>
    `;
  } else if (claim.status === 'VERIFICATION_FAILED') {
    actions = `
      <span class="prize-hint">Verificá las fichas a mano en el panel antes de procesar.</span>
      <button class="btn btn-primary btn-sm" onclick="window.processPrizeClaim('${claim.id}')">
        Procesar igual
      </button>
      <button class="btn btn-danger btn-sm" onclick="window.rejectPrizeClaim('${claim.id}')">
        Rechazar
      </button>
    `;
  }

  return `
    <div class="prize-card card" data-claim-id="${claim.id}">
      <div class="prize-header">
        <span class="prize-user">${escapeHtml(claim.targetUsername || '?')}</span>
        ${statusBadge}
      </div>
      <div class="prize-body">
        <div class="prize-detail"><strong>Monto:</strong> $${amount}</div>
        <div class="prize-detail"><strong>Fichas verificadas:</strong> $${balance}</div>
        <div class="prize-detail"><strong>Pago:</strong> ${escapeHtml(paymentInfo)}</div>
        <div class="prize-detail"><strong>Creado:</strong> ${createdAt}</div>
      </div>
      <div class="prize-actions">${actions}</div>
    </div>
  `;
}

function getPrizeStatusBadge(status) {
  const map = {
    PENDING_PAYMENT_DETAILS: { label: 'Esperando datos', cls: 'badge-warning' },
    PENDING_VERIFICATION: { label: 'Pendiente verificacion', cls: 'badge-warning' },
    VERIFYING_CHIPS: { label: 'Verificando fichas', cls: 'badge-info' },
    VERIFIED: { label: 'Verificado', cls: 'badge-success' },
    VERIFICATION_FAILED: { label: 'Verificacion fallida', cls: 'badge-danger' },
    PROCESSING: { label: 'Retirando fichas', cls: 'badge-info' },
    CHIPS_WITHDRAWN: { label: 'Fichas retiradas', cls: 'badge-warning' },
    COMPLETED: { label: 'Pagado', cls: 'badge-success' },
    REJECTED: { label: 'Rechazado', cls: 'badge-danger' },
    FAILED: { label: 'Error', cls: 'badge-danger' },
  };
  const info = map[status] || { label: status, cls: 'badge-secondary' };
  return `<span class="badge ${info.cls}">${escapeHtml(info.label)}</span>`;
}

function formatPaymentDetails(details, method) {
  if (!details) return 'Sin datos';
  if (method === 'CBU' && details.cbu) return `CBU: ${details.cbu} (${details.accountHolder || '?'})`;
  if (method === 'ALIAS' && details.alias) return `Alias: ${details.alias} (${details.accountHolder || '?'})`;
  return JSON.stringify(details);
}

// Pendiente = requiere acción/atención del operador. VERIFICATION_FAILED solo
// cuenta cuando fue un error de verificación (sin verifiedBalance); si el
// usuario simplemente no tenía fichas suficientes, ya se le indicó qué hacer.
function isPendingClaim(c) {
  if (['VERIFIED', 'CHIPS_WITHDRAWN', 'PROCESSING', 'FAILED'].includes(c.status)) return true;
  return c.status === 'VERIFICATION_FAILED' && c.verifiedBalance == null;
}

export function updatePrizesBadge() {
  const pending = (store.prizeClaims || []).filter(isPendingClaim);
  const badge = document.getElementById('prizes-badge');
  if (badge) {
    badge.textContent = pending.length.toString();
    badge.style.display = pending.length > 0 ? '' : 'none';
  }
}

export async function processPrizeClaim(claimId) {
  if (!confirm('Procesar retiro de fichas? Esto va a retirar las fichas del panel.')) return;
  try {
    const result = await window.api.processPrizeClaim(claimId);
    if (result?.success) {
      showToast('Retiro de fichas iniciado', 'success');
    } else {
      showToast(result?.error || 'Error al procesar', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

export async function completePrizeClaim(claimId) {
  if (!confirm('Confirmar que ya pagaste el premio al usuario?\n\nA continuación vas a tener que adjuntar el comprobante (imagen o PDF) de la transferencia.')) return;

  showToast('Elegí el comprobante de la transferencia...', 'info');
  let upload;
  try {
    upload = await window.api.pickAndUploadPayoutProof();
  } catch (e) {
    showToast('Error abriendo el diálogo: ' + e.message, 'error');
    return;
  }

  if (!upload || upload.cancelled) {
    showToast('Marcado como pagado cancelado — no adjuntaste comprobante.', 'warning');
    return;
  }
  if (upload.error || !upload.url) {
    showToast('No se pudo subir el comprobante: ' + (upload.error || 'sin URL devuelta'), 'error');
    return;
  }

  try {
    const result = await window.api.completePrizeClaim(claimId, upload.url, upload.type || 'image');
    if (result?.success) {
      showToast('Premio marcado como pagado. Comprobante enviado al usuario.', 'success');
    } else {
      showToast(result?.error || 'Error al completar', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

export async function rejectPrizeClaim(claimId) {
  // window.prompt() is disabled in Electron renderer — use the in-app modal instead.
  // Backend requires reason >= 5 chars (prize-claims.service.ts), validate before sending.
  const reason = await showTextInputModal(
    'Motivo del rechazo',
    'Describí por qué se rechaza este premio (mínimo 5 caracteres)...',
    'Rechazar',
  );
  if (!reason) return;
  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    showToast('El motivo debe tener al menos 5 caracteres', 'error');
    return;
  }
  try {
    const result = await window.api.rejectPrizeClaim(claimId, trimmed);
    if (result?.success) {
      showToast('Premio rechazado', 'success');
    } else {
      showToast(result?.error || 'Error al rechazar', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}
