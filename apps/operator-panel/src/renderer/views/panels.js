// renderer/views/panels.js — Panels management view

import { store } from '../state.js';
import { escapeHtml, showToast, showConfirmModal } from '../utils.js';

let panelsSetup = false;

export function setupPanelsView() {
  if (panelsSetup) return;
  panelsSetup = true;

  document.getElementById('add-panel-btn')?.addEventListener('click', () => {
    openPanelModal(null);
  });
}

export async function loadPanels() {
  const container = document.getElementById('panels-list');
  if (!container) return;

  try {
    const result = await window.api.getPanels();
    if (result?.success && result.panels) {
      store.panels = result.panels;
    }
    renderPanelsList();
  } catch (error) {
    container.innerHTML = `<div class="empty-state"><p>Error al cargar paneles</p></div>`;
  }
}

export function renderPanelsList() {
  const container = document.getElementById('panels-list');
  if (!container) return;

  const panels = store.panels || [];

  if (panels.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No hay paneles configurados</p></div>`;
    return;
  }

  const defaultPanelId = store.settings?.defaultNewUserPanelId || '';

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Estado</th>
          <th>Bot</th>
          <th>Usuarios</th>
          <th>Jobs</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${panels.map(panel => {
          const isDefault = panel.id === defaultPanelId;
          const statusClass = panel.isActive ? 'completed' : 'failed';
          const statusLabel = panel.isActive ? 'Activo' : 'Inactivo';
          const botClass = panel.botConnected ? 'completed' : 'failed';
          const botLabel = panel.botConnected ? 'Conectado' : 'Offline';
          const userCount = panel._count?.users ?? 0;
          const jobCount = panel._count?.jobs ?? 0;

          return `
            <tr>
              <td>
                <strong>${escapeHtml(panel.name)}</strong>
                ${isDefault ? '<span class="badge badge-info" style="margin-left:6px;font-size:10px;">Default</span>' : ''}
              </td>
              <td><span class="badge badge-${statusClass}">${statusLabel}</span></td>
              <td><span class="badge badge-${botClass}">${botLabel}</span></td>
              <td>${userCount}</td>
              <td>${jobCount}</td>
              <td>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-sm btn-secondary" onclick="editPanel('${escapeHtml(panel.id)}')">Editar</button>
                  ${panel.isActive
                    ? `<button class="btn btn-sm btn-danger" onclick="deactivatePanel('${escapeHtml(panel.id)}')">Desactivar</button>`
                    : `<button class="btn btn-sm btn-success" onclick="activatePanel('${escapeHtml(panel.id)}')">Activar</button>`
                  }
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function openPanelModal(panelId) {
  const panel = panelId ? (store.panels || []).find(p => p.id === panelId) : null;
  const title = panel ? 'Editar Panel' : 'Agregar Panel';
  const currentName = panel ? panel.name : '';

  // Simple prompt-style modal using the existing text input modal pattern
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:400px;">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" id="panel-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <label style="display:block;margin-bottom:8px;color:var(--text-secondary);font-size:13px;">Nombre del panel</label>
        <input type="text" id="panel-name-input" class="text-input" placeholder="Ej: Panel Principal" value="${escapeHtml(currentName)}" style="width:100%;">
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="panel-modal-cancel">Cancelar</button>
        <button class="btn btn-primary" id="panel-modal-save">${panel ? 'Guardar' : 'Crear'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const nameInput = document.getElementById('panel-name-input');
  setTimeout(() => nameInput?.focus(), 100);

  const close = () => modal.remove();

  document.getElementById('panel-modal-close').onclick = close;
  document.getElementById('panel-modal-cancel').onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.getElementById('panel-modal-save').onclick = async () => {
    const name = nameInput?.value?.trim();
    if (!name) {
      showToast('El nombre es requerido', 'error');
      return;
    }

    try {
      let result;
      if (panel) {
        result = await window.api.updatePanel(panel.id, { name });
      } else {
        result = await window.api.createPanel(name);
      }

      if (result?.success) {
        showToast(panel ? 'Panel actualizado' : 'Panel creado', 'success');
        close();
        await loadPanels();
      } else {
        showToast('Error: ' + (result?.error || 'Desconocido'), 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  };

  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('panel-modal-save')?.click();
    if (e.key === 'Escape') close();
  });
}

export async function editPanel(id) {
  openPanelModal(id);
}

export async function deactivatePanel(id) {
  const panel = (store.panels || []).find(p => p.id === id);
  if (!panel) return;

  const confirmed = await showConfirmModal(
    'Desactivar Panel',
    `Desactivar "${panel.name}"? Las extensions conectadas seran desconectadas.`,
    'Desactivar'
  );
  if (!confirmed) return;

  try {
    const result = await window.api.updatePanel(id, { isActive: false });
    if (result?.success) {
      showToast('Panel desactivado', 'success');
      await loadPanels();
    } else {
      showToast('Error: ' + (result?.error || 'Desconocido'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

export async function activatePanel(id) {
  try {
    const result = await window.api.updatePanel(id, { isActive: true });
    if (result?.success) {
      showToast('Panel activado', 'success');
      await loadPanels();
    } else {
      showToast('Error: ' + (result?.error || 'Desconocido'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}
