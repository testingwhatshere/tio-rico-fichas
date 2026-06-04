// renderer/views/requests.js — Requests view: list all requests with filter/search/pagination

import { REQUEST_STATUS_CONFIG, DUCK_SVG } from '../constants.js';
import { escapeHtml, formatAmount, getTimeAgo, showToast } from '../utils.js';

let requestsData = [];
let currentFilter = 'all';
let currentPage = 0;
const PAGE_SIZE = 50;

export async function initRequestsView() {
  currentPage = 0;
  await loadRequests();

  const searchInput = document.getElementById('requests-search');
  if (searchInput && !searchInput._hasListener) {
    searchInput.addEventListener('input', () => renderRequestsList());
    searchInput._hasListener = true;
  }

  document.querySelectorAll('[data-requests-filter]').forEach(btn => {
    if (!btn._hasListener) {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.requestsFilter;
        document.querySelectorAll('[data-requests-filter]').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
        currentPage = 0;
        loadRequests();
      });
      btn._hasListener = true;
    }
  });
}

async function loadRequests() {
  const container = document.getElementById('requests-list');
  if (container) container.innerHTML = `<div class="loading-spinner"></div>`;
  try {
    const params = {
      limit: PAGE_SIZE,
      offset: currentPage * PAGE_SIZE,
    };
    if (currentFilter !== 'all') {
      params.status = currentFilter;
    }
    const result = await window.api.getRequests(params);
    if (result.success) {
      requestsData = result.data || [];
    } else {
      showToast('Error al cargar solicitudes: ' + (result.error || ''), 'error');
      requestsData = [];
    }
  } catch (err) {
    showToast('Error de conexion al cargar solicitudes', 'error');
    requestsData = [];
  }
  renderRequestsList();
}

export function renderRequestsList() {
  const container = document.getElementById('requests-list');
  if (!container) return;

  const searchTerm = (document.getElementById('requests-search')?.value || '').trim().toLowerCase();

  let filtered = requestsData;

  if (searchTerm) {
    filtered = filtered.filter(r =>
      (r.targetUsername || '').toLowerCase().includes(searchTerm) ||
      (r.user?.email || '').toLowerCase().includes(searchTerm) ||
      (r.id || '').toLowerCase().includes(searchTerm)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        ${DUCK_SVG}
        <p>No hay solicitudes</p>
        <span class="empty-state-hint">No se encontraron resultados</span>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(renderRequestItem).join('');
}

function renderRequestItem(request) {
  const config = REQUEST_STATUS_CONFIG[request.status] || REQUEST_STATUS_CONFIG.PENDING;
  const username = request.targetUsername || 'N/A';
  const amount = request.amount || 0;
  const userEmail = request.user?.email || 'N/A';
  const shortId = request.id ? request.id.slice(-6) : '---';

  return `
    <div class="job-item ${config.class}">
      <div class="job-status-icon ${config.class}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
      </div>
      <div class="job-content">
        <span class="job-username">${escapeHtml(username)}</span>
        <span class="text-muted" style="font-size: 0.75rem;">${escapeHtml(userEmail)}</span>
      </div>
      <span class="job-amount">$${formatAmount(amount)}</span>
      <span class="job-status-badge ${config.class}">${escapeHtml(config.label)}</span>
      <span class="job-time">${getTimeAgo(request.createdAt)}</span>
      <span class="text-muted" style="font-size: 0.7rem; font-family: monospace;">#${escapeHtml(shortId)}</span>
    </div>
  `;
}
