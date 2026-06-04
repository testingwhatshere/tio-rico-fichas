// renderer/views/users.js — Users management view

import { store } from '../state.js';
import { escapeHtml, showToast } from '../utils.js';

export async function initUsersView() {
  if (store.clients.length === 0) {
    try {
      const result = await window.api.getClients();
      if (result.success) {
        store.clients = result.data;
      }
    } catch (err) {
      console.error('Failed to load clients:', err);
    }
  }
  renderUsersList();

  const searchInput = document.getElementById('users-search');
  if (searchInput && !searchInput._hasListener) {
    searchInput.addEventListener('input', () => renderUsersList());
    searchInput._hasListener = true;
  }
}

function getInitials(name) {
  if (!name || name === '-') return '?';
  return name.slice(0, 2).toUpperCase();
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Hace ${months}m`;
  return `Hace ${Math.floor(months / 12)}a`;
}

export function renderUsersList() {
  const container = document.getElementById('users-list');
  if (!container) return;

  const searchTerm = (document.getElementById('users-search')?.value || '').toLowerCase().trim();

  let filtered = store.clients;
  if (searchTerm) {
    filtered = store.clients.filter(u =>
      (u.username || '').toLowerCase().includes(searchTerm) ||
      (u.phone || '').includes(searchTerm)
    );
  }

  // Stats bar
  const total = store.clients.length;
  const active = store.clients.filter(u => u.isActive).length;
  const blocked = total - active;

  const createUserHtml = `
    <div class="create-user-bar" style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px; padding: 10px 12px; background: var(--bg-card, #182030); border-radius: 10px; border: 1px dashed var(--border-color);">
      <input type="text" id="create-panel-user-input" placeholder="Nickname para el panel"
             style="flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); font-size: 14px;" />
      <button onclick="createPanelUser()"
              style="padding: 8px 16px; border-radius: 8px; border: none; background: var(--gold-500, #D4A017); color: #1a1a2e; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">
        Crear en Panel
      </button>
    </div>
  `;

  const statsHtml = `
    <div class="users-stats" style="display: flex; align-items: center; gap: 12px;">
      <div class="users-stat">
        <span class="users-stat-value">${total}</span>
        <span class="users-stat-label">Total</span>
      </div>
      <div class="users-stat">
        <span class="users-stat-value users-stat-active">${active}</span>
        <span class="users-stat-label">Activos</span>
      </div>
      <div class="users-stat">
        <span class="users-stat-value users-stat-blocked">${blocked}</span>
        <span class="users-stat-label">Bloqueados</span>
      </div>
      <button onclick="refreshClients()" title="Refrescar lista"
              style="margin-left: auto; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border, #333); background: transparent; color: var(--text-muted, #999); font-size: 12px; cursor: pointer;">
        Refrescar
      </button>
    </div>
  `;

  if (filtered.length === 0) {
    container.innerHTML = createUserHtml + statsHtml + `
      <div class="empty-state">
        <p>${searchTerm ? 'No se encontraron usuarios' : 'No hay usuarios registrados'}</p>
      </div>`;
    return;
  }

  container.innerHTML = createUserHtml + statsHtml + `
    <div class="users-grid">
      ${filtered.map(user => {
        const reqCount = user._count?.requests ?? 0;
        const initials = getInitials(user.username);
        const registered = timeAgo(user.createdAt);
        const isActive = user.isActive;

        return `
          <div class="user-card ${!isActive ? 'user-card--blocked' : ''}">
            <div class="user-card-main">
              <div class="user-avatar ${isActive ? 'user-avatar--active' : 'user-avatar--blocked'}">
                ${escapeHtml(initials)}
              </div>
              <div class="user-info">
                <div class="user-name">${escapeHtml(user.username || '-')}</div>
                <div class="user-phone">${escapeHtml(user.phone || 'Sin telefono')}</div>
              </div>
              <span class="user-status ${isActive ? 'user-status--active' : 'user-status--blocked'}">
                ${isActive ? 'Activo' : 'Bloqueado'}
              </span>
            </div>
            ${user.totalLoaded > 0 ? `
            <div class="user-card-ltv" style="padding: 6px 12px; margin: 0 12px; background: rgba(76, 175, 80, 0.08); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
              <span style="color: var(--text-muted);">Total cargado: <strong style="color: var(--success); font-size: 14px;">$${user.totalLoaded.toLocaleString('es-AR')}</strong></span>
              <span style="color: var(--text-muted);">${user.completedCount} carga${user.completedCount !== 1 ? 's' : ''}</span>
              ${user.lastLoadAt ? `<span style="color: var(--text-muted);">Última: ${timeAgo(user.lastLoadAt)}</span>` : ''}
            </div>` : ''}
            <div class="user-card-footer">
              <div class="user-meta">
                <span class="user-meta-item" title="Solicitudes totales">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  ${reqCount} solicitud${reqCount !== 1 ? 'es' : ''}
                </span>
                <span class="user-meta-item" title="Registrado">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  ${registered}
                </span>
                ${user.savedTargetUsername ? `
                <span class="user-meta-item" title="Usuario del panel">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  ${escapeHtml(user.savedTargetUsername)}
                </span>` : ''}
              </div>
              <button class="user-action-btn ${isActive ? 'user-action-btn--block' : 'user-action-btn--unblock'}"
                      onclick="toggleUserActive('${user.id}', ${!isActive})">
                ${isActive ? 'Bloquear' : 'Desbloquear'}
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export async function refreshClients() {
  try {
    const result = await window.api.getClients();
    if (result.success) {
      store.clients = result.data;
      renderUsersList();
      showToast('Lista actualizada', 'success');
    } else {
      showToast('Error al refrescar', 'error');
    }
  } catch (error) {
    showToast('Error al refrescar usuarios', 'error');
  }
}

export async function createPanelUser() {
  const input = document.getElementById('create-panel-user-input');
  const username = (input?.value || '').trim();
  if (!username || username.length < 3) {
    showToast('El nombre de usuario debe tener al menos 3 caracteres', 'error');
    return;
  }

  try {
    const result = await window.api.createPanelUser(username);
    if (result.success) {
      showToast('Creación de "' + username + '" en proceso', 'success');
      if (input) input.value = '';
    } else {
      showToast('Error: ' + (result.error || 'No se pudo crear usuario'), 'error');
    }
  } catch (error) {
    showToast('Error al crear usuario en panel', 'error');
  }
}

export async function toggleUserActive(userId, isActive) {
  const action = isActive ? 'desbloquear' : 'bloquear';
  if (!confirm('\u00bfSeguro que deseas ' + action + ' a este usuario?')) return;

  try {
    const result = await window.api.toggleUserActive(userId, isActive);
    if (result.success) {
      showToast('Usuario ' + (isActive ? 'desbloqueado' : 'bloqueado'), 'success');
      const idx = store.clients.findIndex(c => c.id === userId);
      if (idx >= 0) {
        store.clients[idx].isActive = isActive;
        renderUsersList();
      }
    } else {
      showToast('Error: ' + (result.error || 'No se pudo ' + action), 'error');
    }
  } catch (error) {
    showToast('Error al ' + action + ' usuario', 'error');
  }
}
