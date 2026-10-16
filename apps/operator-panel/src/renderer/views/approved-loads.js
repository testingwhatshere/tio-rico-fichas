// renderer/views/approved-loads.js — Cargas Aprobadas view
// Muestra las cargas ya aprobadas/acreditadas con su comprobante visible, para que
// el operador tenga seguimiento y detecte si le intentan encajar un comprobante repetido.
// Aditivo: no toca ninguna vista existente.

import { REQUEST_STATUS_CONFIG, DUCK_SVG } from '../constants.js';
import { escapeHtml, formatAmount, getTimeAgo, showToast, openImageZoom } from '../utils.js';

let loadsData = [];
let currentFilter = 'COMPLETED';
let currentPage = 0;
const PAGE_SIZE = 50;

// Cache de imágenes ya resueltas (proofUrl -> dataUrl/http) para no re-fetchear al re-render
const imageCache = new Map();

export async function initApprovedLoadsView() {
  currentPage = 0;
  await loadApprovedLoads();

  const searchInput = document.getElementById('approved-loads-search');
  if (searchInput && !searchInput._hasListener) {
    searchInput.addEventListener('input', () => renderApprovedLoadsList());
    searchInput._hasListener = true;
  }

  document.querySelectorAll('[data-approved-loads-filter]').forEach(btn => {
    if (!btn._hasListener) {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.approvedLoadsFilter;
        document.querySelectorAll('[data-approved-loads-filter]').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
        currentPage = 0;
        loadApprovedLoads();
      });
      btn._hasListener = true;
    }
  });
}

async function loadApprovedLoads() {
  const container = document.getElementById('approved-loads-list');
  if (container) container.innerHTML = `<div class="loading-spinner"></div>`;
  try {
    const params = {
      status: currentFilter,
      limit: PAGE_SIZE,
      offset: currentPage * PAGE_SIZE,
    };
    const result = await window.api.getRequests(params);
    if (result && result.success) {
      loadsData = result.data || [];
    } else {
      showToast('Error al cargar cargas aprobadas: ' + (result?.error || ''), 'error');
      loadsData = [];
    }
  } catch (err) {
    showToast('Error de conexion al cargar cargas aprobadas', 'error');
    loadsData = [];
  }
  renderApprovedLoadsList();
}

// Marca como "repetido" cualquier carga cuyo comprobante (hash o nro de operación)
// aparezca más de una vez en el set cargado.
function computeDuplicateKeys(list) {
  const counts = new Map();
  const keyFor = (r) => r.proofHash || r.extractedTransactionId || null;
  for (const r of list) {
    const k = keyFor(r);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const dupKeys = new Set();
  for (const [k, n] of counts) {
    if (n > 1) dupKeys.add(k);
  }
  return { dupKeys, keyFor };
}

export function renderApprovedLoadsList() {
  const container = document.getElementById('approved-loads-list');
  if (!container) return;

  const searchTerm = (document.getElementById('approved-loads-search')?.value || '').trim().toLowerCase();

  let filtered = loadsData;
  if (searchTerm) {
    filtered = filtered.filter(r =>
      (r.targetUsername || '').toLowerCase().includes(searchTerm) ||
      (r.user?.email || '').toLowerCase().includes(searchTerm) ||
      (r.extractedTransactionId || '').toLowerCase().includes(searchTerm) ||
      (r.id || '').toLowerCase().includes(searchTerm)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        ${DUCK_SVG}
        <p>No hay cargas aprobadas</p>
        <span class="empty-state-hint">No se encontraron resultados</span>
      </div>
    `;
    return;
  }

  // Detectar duplicados sobre el set completo cargado (no sobre el filtrado por búsqueda),
  // así el badge de repetido sigue siendo correcto aunque el operador busque.
  const { dupKeys, keyFor } = computeDuplicateKeys(loadsData);

  container.innerHTML = filtered.map(r => renderLoadCard(r, dupKeys.has(keyFor(r)))).join('');

  // Cargar los thumbnails de comprobante (lazy, uno por uno)
  container.querySelectorAll('.al-card').forEach(card => {
    const proofUrl = card.dataset.proofUrl;
    if (proofUrl) loadThumbnail(card, proofUrl);
  });
}

function renderLoadCard(request, isDuplicate) {
  const config = REQUEST_STATUS_CONFIG[request.status] || REQUEST_STATUS_CONFIG.COMPLETED;
  const username = request.targetUsername || 'N/A';
  const amount = request.amount || 0;
  const userEmail = request.user?.email || 'N/A';
  const shortId = request.id ? request.id.slice(-6) : '---';
  const proofUrl = request.proofUrl || '';
  const txId = request.extractedTransactionId || '';

  return `
    <div class="al-card ${isDuplicate ? 'al-card-duplicate' : ''}" data-proof-url="${escapeHtml(proofUrl)}">
      <div class="al-thumb">
        ${proofUrl ? `
          <div class="al-thumb-loading"><div class="spinner-sm"></div></div>
          <img class="al-thumb-img" src="" alt="Comprobante" style="display:none">
        ` : `
          <div class="al-thumb-empty" title="Sin comprobante">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
              <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span>Sin comprobante</span>
          </div>
        `}
      </div>
      <div class="al-info">
        <div class="al-info-top">
          <span class="al-username">${escapeHtml(username)}</span>
          <span class="job-status-badge ${config.class}">${escapeHtml(config.label)}</span>
        </div>
        <span class="al-email">${escapeHtml(userEmail)}</span>
        <div class="al-info-bottom">
          <span class="al-amount">$${formatAmount(amount)}</span>
          <span class="al-time">${getTimeAgo(request.createdAt)}</span>
          <span class="al-id">#${escapeHtml(shortId)}</span>
        </div>
        ${txId ? `<span class="al-txid" title="Nro de operacion del comprobante">Op: ${escapeHtml(txId)}</span>` : ''}
        ${isDuplicate ? `
          <span class="al-dup-badge" title="Este comprobante (mismo hash / nro de operacion) figura en mas de una carga">
            ⚠️ Comprobante repetido
          </span>
        ` : ''}
      </div>
    </div>
  `;
}

function loadThumbnail(card, proofUrl) {
  const loading = card.querySelector('.al-thumb-loading');
  const img = card.querySelector('.al-thumb-img');
  if (!img) return;

  const showImage = (src) => {
    if (loading) loading.style.display = 'none';
    img.src = src;
    img.style.display = '';
    img.onclick = () => openImageZoom(src);
  };
  const showError = () => {
    const thumb = card.querySelector('.al-thumb');
    if (thumb) {
      thumb.innerHTML = `
        <div class="al-thumb-empty" title="Imagen no disponible">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
            <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <span>No disponible</span>
        </div>`;
    }
  };

  if (imageCache.has(proofUrl)) {
    showImage(imageCache.get(proofUrl));
    return;
  }

  if (proofUrl.startsWith('http')) {
    img.onload = () => {
      if (loading) loading.style.display = 'none';
      imageCache.set(proofUrl, proofUrl);
    };
    img.onerror = showError;
    img.src = proofUrl;
    img.style.display = '';
    img.onclick = () => openImageZoom(proofUrl);
  } else {
    window.api.fetchProofImage(proofUrl).then(result => {
      if (result && result.dataUrl) {
        imageCache.set(proofUrl, result.dataUrl);
        showImage(result.dataUrl);
      } else {
        showError();
      }
    }).catch(showError);
  }
}
