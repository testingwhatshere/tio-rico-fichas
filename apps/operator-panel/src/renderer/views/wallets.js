// renderer/views/wallets.js — Wallet management view

import { store, getWalletFormSetup, setWalletFormSetup } from '../state.js';
import { escapeHtml, formatWalletDetails, formatWalletDetailsLarge, getWalletTypeLabel, showToast, showConfirmModal } from '../utils.js';

// ============================================
// INIT
// ============================================

export function initWalletsView() {
  setupWalletForm();
  renderWalletsList();
  updateSelectedWalletDisplay();
}

// ============================================
// WALLET FORM SETUP
// ============================================

function setupWalletForm() {
  if (getWalletFormSetup()) return;
  setWalletFormSetup(true);
  const typeSelect = document.getElementById('wallet-type');
  const form = document.getElementById('wallet-form');

  if (typeSelect) {
    typeSelect.addEventListener('change', updateWalletFormFields);
  }

  if (form) {
    form.addEventListener('submit', handleCreateWallet);
  }
}

function updateWalletFormFields() {
  const type = document.getElementById('wallet-type')?.value;

  const aliasField = document.getElementById('alias-field');
  const cbuField = document.getElementById('cbu-field');
  const cvuField = document.getElementById('cvu-field');
  const bankField = document.getElementById('bank-field');

  [aliasField, cbuField, cvuField, bankField].forEach(f => f?.classList.add('hidden'));

  if (type === 'MERCADOPAGO' || type === 'RIPIO' || type === 'FIWIND' || type === 'PREX') {
    aliasField?.classList.remove('hidden');
  } else if (type === 'CBU') {
    cbuField?.classList.remove('hidden');
    bankField?.classList.remove('hidden');
  } else if (type === 'CVU') {
    cvuField?.classList.remove('hidden');
  }
}

// ============================================
// CREATE WALLET
// ============================================

async function handleCreateWallet(event) {
  event.preventDefault();

  const type = document.getElementById('wallet-type')?.value;
  const label = document.getElementById('wallet-label')?.value?.trim();
  const holderName = document.getElementById('wallet-holder')?.value?.trim();
  const holderLegalName = document.getElementById('wallet-legal-name')?.value?.trim() || undefined;
  const holderDni = document.getElementById('wallet-dni')?.value?.trim() || undefined;

  if (!type || !label || !holderName) {
    showToast('Completa todos los campos requeridos', 'error');
    return;
  }

  // Validate DNI format (7-11 digits)
  if (holderDni && !/^\d{7,11}$/.test(holderDni)) {
    showToast('DNI debe tener entre 7 y 11 d\u00edgitos', 'error');
    return;
  }

  const details = {};
  if (type === 'MERCADOPAGO') {
    const alias = document.getElementById('wallet-alias')?.value?.trim() || '';
    if (!alias) {
      showToast('El alias es requerido para MercadoPago', 'error');
      return;
    }
    details.alias = alias;
  } else if (type === 'RIPIO' || type === 'FIWIND' || type === 'PREX') {
    const alias = document.getElementById('wallet-alias')?.value?.trim() || '';
    if (alias) details.alias = alias;
  } else if (type === 'CBU') {
    const cbu = (document.getElementById('wallet-cbu')?.value || '').replace(/\s/g, '').trim();
    if (!cbu || cbu.length !== 22 || !/^\d{22}$/.test(cbu)) {
      showToast('CBU debe tener exactamente 22 d\u00edgitos num\u00e9ricos', 'error');
      return;
    }
    details.cbu = cbu;
    details.bank = document.getElementById('wallet-bank')?.value?.trim() || '';
  } else if (type === 'CVU') {
    const cvu = (document.getElementById('wallet-cvu')?.value || '').replace(/\s/g, '').trim();
    if (!cvu || cvu.length !== 22 || !/^\d{22}$/.test(cvu)) {
      showToast('CVU debe tener exactamente 22 d\u00edgitos num\u00e9ricos', 'error');
      return;
    }
    details.cvu = cvu;
  }

  const amountLimitStr = document.getElementById('wallet-amount-limit')?.value?.trim();
  const amountLimit = amountLimitStr ? parseFloat(amountLimitStr) : undefined;
  if (amountLimit !== undefined && (isNaN(amountLimit) || amountLimit <= 0)) {
    showToast('El limite debe ser un numero positivo', 'error');
    return;
  }

  const submitBtn = document.querySelector('#wallet-form button[type="submit"]');
  const submitOriginal = submitBtn?.innerHTML;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Creando...';
  }

  try {
    const result = await window.api.createWallet({ type, label, holderName, holderLegalName, holderDni, details, amountLimit });
    if (result.success) {
      document.getElementById('wallet-form')?.reset();
      document.getElementById('wallet-amount-limit').value = '';
      updateWalletFormFields();
    } else {
      showToast('Error: ' + (result.error || 'No se pudo crear'), 'error');
    }
  } catch (error) {
    showToast('Error al crear billetera', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitOriginal;
    }
  }
}

// ============================================
// WALLET ACTIONS
// ============================================

export async function selectWallet(id) {
  try {
    const result = await window.api.selectWallet(id);
    if (!result.success) {
      showToast('Error: ' + (result.error || 'No se pudo activar'), 'error');
    }
  } catch (error) {
    showToast('Error al activar billetera', 'error');
  }
}

export async function deleteWallet(id) {
  const confirmed = await showConfirmModal(
    'Eliminar billetera',
    '\u00bfSeguro que quieres eliminar esta billetera? Esta acci\u00f3n no se puede deshacer.',
    'Eliminar'
  );
  if (!confirmed) return;

  try {
    const result = await window.api.deleteWallet(id);
    if (!result.success) {
      showToast('Error: ' + (result.error || 'No se pudo eliminar'), 'error');
    }
  } catch (error) {
    showToast('Error al eliminar billetera', 'error');
  }
}

export async function toggleWalletVerification(id, requiresVerification) {
  try {
    const result = await window.api.updateWallet({ id, requiresVerification });
    if (result.success) {
      showToast(requiresVerification ? 'Verificacion de pago activada' : 'Verificacion de pago desactivada', 'success');
    } else {
      showToast('Error: ' + (result.error || 'No se pudo actualizar'), 'error');
      renderWalletsList(); // Re-render to revert checkbox
    }
  } catch (error) {
    showToast('Error al actualizar verificacion', 'error');
    renderWalletsList(); // Re-render to revert checkbox
  }
}

export async function emptyWallet(id) {
  if (!confirm('\u00bfVaciar billetera? Esto resetea el monto acumulado a $0. Confirma que ya retiraste los fondos.')) return;
  try {
    const result = await window.api.emptyWallet(id);
    if (result.success) {
      showToast('Billetera vaciada', 'success');
    } else {
      showToast('Error: ' + (result.error || 'No se pudo vaciar'), 'error');
    }
  } catch (error) {
    showToast('Error al vaciar billetera', 'error');
  }
}

// ============================================
// RENDER WALLETS LIST
// ============================================

export function renderWalletsList() {
  const container = document.getElementById('wallets-list');
  if (!container) return;

  const wallets = store.wallets || [];

  if (wallets.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
        </svg>
        <p>No hay billeteras configuradas</p>
        <p class="text-muted">Agrega una billetera usando el formulario de arriba</p>
      </div>
    `;
    return;
  }

  container.innerHTML = wallets.map(wallet => {
    const limit = wallet.amountLimit ? Number(wallet.amountLimit) : null;
    const accumulated = Number(wallet.accumulatedAmount || 0);
    const percentage = limit ? Math.min(100, (accumulated / limit) * 100) : 0;
    const isFull = limit && accumulated >= limit;

    return `
    <div class="wallet-item ${wallet.isSelected ? 'selected' : ''}">
      <div class="wallet-info">
        <div class="wallet-header">
          <span class="wallet-type-badge ${wallet.type.toLowerCase()}">${getWalletTypeLabel(wallet.type)}</span>
          <span class="wallet-label">${escapeHtml(wallet.label)}</span>
          ${wallet.isSelected ? '<span class="badge badge-success">ACTIVA</span>' : ''}
        </div>
        <div class="wallet-holder">${escapeHtml(wallet.holderName)}</div>
        ${wallet.holderLegalName ? `<div class="wallet-legal-name text-muted" style="font-size:0.85em">Legal: ${escapeHtml(wallet.holderLegalName)}</div>` : ''}
        ${wallet.holderDni ? `<div class="wallet-dni text-muted" style="font-size:0.85em">DNI/CUIT: ${escapeHtml(wallet.holderDni)}</div>` : ''}
        <div class="wallet-details">${formatWalletDetails(wallet)}</div>
        ${limit !== null ? `
          <div class="wallet-accumulation">
            <div class="wallet-progress-bar">
              <div class="wallet-progress-fill ${isFull ? 'full' : ''}" style="width: ${percentage}%"></div>
            </div>
            <span class="wallet-accumulation-text">
              $${accumulated.toLocaleString('es-AR')} / $${limit.toLocaleString('es-AR')}${isFull ? ' (LLENA)' : ''}
            </span>
          </div>
        ` : accumulated > 0 ? `
          <div class="wallet-accumulation">
            <span class="wallet-accumulation-text text-muted">
              Acumulado: $${accumulated.toLocaleString('es-AR')} (sin limite)
            </span>
          </div>
        ` : ''}
      </div>
      <div class="wallet-verification-toggle" style="margin-top:6px;">
        <label class="toggle-label" style="display:flex;align-items:center;gap:6px;font-size:0.85em;cursor:pointer;">
          <input type="checkbox" ${wallet.requiresVerification ? 'checked' : ''}
            onchange="toggleWalletVerification('${wallet.id}', this.checked)"
            style="accent-color:var(--accent-color,#10b981);">
          <span style="color:${wallet.requiresVerification ? 'var(--success-color,#4CAF50)' : 'var(--text-muted,#888)'}">
            ${wallet.requiresVerification ? 'Verificacion de pago activa' : 'Sin verificacion de pago'}
          </span>
        </label>
      </div>
      <div class="wallet-actions">
        ${!wallet.isSelected ? `
          <button class="btn btn-sm btn-primary" onclick="selectWallet('${wallet.id}')" aria-label="Activar billetera">
            Activar
          </button>
        ` : ''}
        <button class="btn btn-sm btn-ghost" onclick="emptyWallet('${wallet.id}')" title="Resetear monto acumulado">Vaciar</button>
        <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteWallet('${wallet.id}')" aria-label="Eliminar billetera">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  }).join('');
}

// ============================================
// SELECTED WALLET DISPLAY
// ============================================

export function updateSelectedWalletDisplay() {
  const container = document.getElementById('selected-wallet-display');
  if (!container) return;

  const selectedWallet = (store.wallets || []).find(w => w.isSelected);

  if (!selectedWallet) {
    container.innerHTML = `
      <div class="empty-state small">
        <p>No hay billetera seleccionada</p>
      </div>
    `;
    return;
  }

  const limit = selectedWallet.amountLimit ? Number(selectedWallet.amountLimit) : null;
  const accumulated = Number(selectedWallet.accumulatedAmount || 0);
  const percentage = limit ? Math.min(100, (accumulated / limit) * 100) : 0;
  const isFull = limit && accumulated >= limit;

  container.innerHTML = `
    <div class="selected-wallet-info">
      <div class="wallet-type-badge large ${selectedWallet.type.toLowerCase()}">${getWalletTypeLabel(selectedWallet.type)}</div>
      <h4>${escapeHtml(selectedWallet.label)}</h4>
      <p class="wallet-holder-name">${escapeHtml(selectedWallet.holderName)}</p>
      ${selectedWallet.holderLegalName ? `<p class="text-muted" style="margin:2px 0;font-size:0.9em">Nombre legal: ${escapeHtml(selectedWallet.holderLegalName)}</p>` : ''}
      ${selectedWallet.holderDni ? `<p class="text-muted" style="margin:2px 0;font-size:0.9em">DNI/CUIT: ${escapeHtml(selectedWallet.holderDni)}</p>` : ''}
      <div class="wallet-details-display">${formatWalletDetailsLarge(selectedWallet)}</div>
      ${limit !== null ? `
        <div class="wallet-accumulation">
          <div class="wallet-progress-bar large">
            <div class="wallet-progress-fill ${isFull ? 'full' : ''}" style="width: ${percentage}%"></div>
          </div>
          <span class="wallet-accumulation-text">
            $${accumulated.toLocaleString('es-AR')} / $${limit.toLocaleString('es-AR')}${isFull ? ' (LLENA)' : ''}
          </span>
        </div>
      ` : accumulated > 0 ? `
        <div class="wallet-accumulation">
          <span class="wallet-accumulation-text text-muted">
            Acumulado: $${accumulated.toLocaleString('es-AR')} (sin limite)
          </span>
        </div>
      ` : ''}
    </div>
  `;
}
