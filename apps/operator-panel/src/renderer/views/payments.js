// renderer/views/payments.js — Outbound payments management view

import { store } from '../state.js';
import { escapeHtml, showToast, showConfirmModal } from '../utils.js';
import { OUTBOUND_PAYMENT_STATUS_CONFIG, WALLET_TYPE_LABELS } from '../constants.js';

// ============================================
// INIT
// ============================================

export function initPaymentsView() {
  renderPaymentsList();
}

// ============================================
// RENDER PAYMENTS LIST
// ============================================

export function renderPaymentsList() {
  const container = document.getElementById('payments-list');
  if (!container) return;

  const payments = store.outboundPayments || [];

  if (payments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No hay pagos salientes</p>
        <p class="text-muted">Los pagos se crean automaticamente cuando se retiran fichas de un premio</p>
      </div>
    `;
    return;
  }

  container.innerHTML = payments.map(payment => {
    const statusCfg = OUTBOUND_PAYMENT_STATUS_CONFIG[payment.status] || { label: payment.status, class: 'queued', icon: '?' };
    const walletLabel = WALLET_TYPE_LABELS[payment.walletType] || payment.walletType;
    const details = payment.paymentDetails || {};
    const destination = details.alias || details.cbu || '-';
    const holder = escapeHtml(details.accountHolder || '-');
    const amount = Number(payment.amount).toLocaleString('es-AR');
    const date = new Date(payment.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const typeLabel = payment.type === 'PRIZE_PAYOUT' ? 'Premio' : 'Retiro';

    const showConfirm = payment.status === 'PENDING';
    const showCancel = ['PENDING', 'CONFIRMED'].includes(payment.status);
    const showRetry = payment.status === 'FAILED';

    return `
      <div class="payment-item status-${statusCfg.class}" data-id="${payment.id}">
        <div class="payment-header">
          <span class="payment-type">${typeLabel}</span>
          <span class="status-badge ${statusCfg.class}">${statusCfg.icon} ${statusCfg.label}</span>
        </div>
        <div class="payment-body">
          <div class="payment-amount">$${amount}</div>
          <div class="payment-details">
            <span class="payment-wallet">${walletLabel}</span>
            <span class="payment-dest">${escapeHtml(payment.paymentMethod)}: ${escapeHtml(destination)}</span>
            <span class="payment-holder">${holder}</span>
          </div>
          ${payment.operationNumber ? `<div class="payment-op">Op: ${escapeHtml(payment.operationNumber)}</div>` : ''}
          ${payment.error ? `<div class="payment-error">${escapeHtml(payment.error)}</div>` : ''}
        </div>
        <div class="payment-footer">
          <span class="payment-date">${date}</span>
          <div class="payment-actions">
            ${showConfirm ? `<button class="btn btn-sm btn-success" onclick="confirmPayment('${payment.id}')">Confirmar Pago</button>` : ''}
            ${showRetry ? `<button class="btn btn-sm btn-primary" onclick="retryPayment('${payment.id}')">Reintentar</button>` : ''}
            ${showCancel ? `<button class="btn btn-sm btn-danger" onclick="cancelPayment('${payment.id}')">Cancelar</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// ACTIONS (exposed as window globals)
// ============================================

export async function confirmPayment(paymentId) {
  const confirmed = await showConfirmModal(
    'Confirmar Pago',
    'Se va a ejecutar la transferencia automaticamente. Continuar?',
  );
  if (!confirmed) return;

  try {
    const result = await window.api.confirmOutboundPayment(paymentId);
    if (result?.success) {
      showToast('Pago confirmado, procesando...', 'success');
      renderPaymentsList();
    } else {
      showToast('Error: ' + (result?.error || 'No se pudo confirmar'), 'error');
    }
  } catch (err) {
    showToast('Error al confirmar pago', 'error');
  }
}

export async function cancelPayment(paymentId) {
  const reason = await window.api.showTextInputModal('Cancelar Pago', 'Motivo de cancelacion:');
  if (!reason) return;

  try {
    const result = await window.api.cancelOutboundPayment(paymentId, reason);
    if (result?.success) {
      showToast('Pago cancelado', 'success');
      renderPaymentsList();
    } else {
      showToast('Error: ' + (result?.error || 'No se pudo cancelar'), 'error');
    }
  } catch (err) {
    showToast('Error al cancelar pago', 'error');
  }
}

export async function retryPayment(paymentId) {
  const confirmed = await showConfirmModal(
    'Reintentar Pago',
    'Se va a volver a intentar la transferencia. Continuar?',
  );
  if (!confirmed) return;

  try {
    const result = await window.api.retryOutboundPayment(paymentId);
    if (result?.success) {
      showToast('Reintentando pago...', 'success');
      renderPaymentsList();
    } else {
      showToast('Error: ' + (result?.error || 'No se pudo reintentar'), 'error');
    }
  } catch (err) {
    showToast('Error al reintentar pago', 'error');
  }
}

// Expose to window for onclick handlers
if (typeof window !== 'undefined') {
  window.confirmPayment = confirmPayment;
  window.cancelPayment = cancelPayment;
  window.retryPayment = retryPayment;
}
