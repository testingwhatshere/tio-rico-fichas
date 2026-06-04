// renderer/views/settings.js — Settings view: config, notifications, system settings, quick replies

import {
  state, store, ollamaState,
  getNotificationSettings, setNotificationSettings,
  getQuickReplies, setQuickReplies,
  getEditingQuickReplyId, setEditingQuickReplyId,
  getQuickRepliesSetup, setQuickRepliesSetup,
} from '../state.js';
import { MAX_QUICK_REPLIES, DEFAULT_QUICK_REPLIES } from '../constants.js';
import { escapeHtml, showToast, showConfirmModal } from '../utils.js';
import { loadOllamaSettings } from '../ai/ollama.js';

// ============================================
// LOAD SETTINGS
// ============================================

export function loadSettings() {
  try {
    const backendUrlField = document.getElementById('backend-url');
    const apiKeyField = document.getElementById('api-key');
    const operatorNameField = document.getElementById('operator-name');

    if (backendUrlField && state.config?.backendUrl) {
      backendUrlField.value = state.config.backendUrl;
    }
    if (apiKeyField && state.config?.apiKey) {
      apiKeyField.value = state.config.apiKey;
    }
    if (operatorNameField && state.config?.operatorName) {
      operatorNameField.value = state.config.operatorName;
    }
    const supportPhoneField = document.getElementById('support-phone');
    if (supportPhoneField && store.settings?.supportPhoneNumber) {
      supportPhoneField.value = store.settings.supportPhoneNumber;
    }

    // Load system settings
    if (store.settings) {
      const s = store.settings;
      const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
      const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
      setVal('sys-validation-threshold', s.validationThreshold);
      setVal('sys-validation-timeout', s.validationTimeoutMs ? Math.round(s.validationTimeoutMs / 1000) : '');
      setVal('sys-queue-cooldown', s.queueCooldownMs ? Math.round(s.queueCooldownMs / 1000) : '');
      setVal('sys-max-requests-hour', s.maxRequestsPerUserPerHour);
      setVal('sys-activity-start', s.botActivityWindowStart || '00:00');
      setVal('sys-activity-end', s.botActivityWindowEnd || '00:00');
      setVal('sys-panel-balance-threshold', s.panelBalanceThreshold ?? 1000);
      setChecked('sys-bot-enabled', s.botEnabled);
      // Auto-payment settings
      setChecked('sys-auto-payment-enabled', s.autoPaymentEnabled);
      setChecked('sys-auto-payment-requires-confirm', s.autoPaymentRequiresConfirm !== false);
      setVal('sys-auto-payment-max-amount', s.autoPaymentMaxAmount ?? 50000);

      // Populate panel selector for new user creation
      const panelSelect = document.getElementById('sys-default-new-user-panel');
      if (panelSelect) {
        // Keep the first option (disabled)
        panelSelect.innerHTML = '<option value="">-- No crear automaticamente --</option>';
        // Populate from store.panels (sent in initial_data)
        if (store.panels && Array.isArray(store.panels)) {
          store.panels.forEach(panel => {
            if (panel.isActive) {
              const opt = document.createElement('option');
              opt.value = panel.id;
              opt.textContent = escapeHtml(panel.name);
              panelSelect.appendChild(opt);
            }
          });
        }
        // Set selected value
        if (s.defaultNewUserPanelId) {
          panelSelect.value = s.defaultNewUserPanelId;
        }
      }
    }

    loadNotificationSettings();
    renderQuickRepliesSettingsList();
    loadOllamaSettings();
    setupPromoBroadcast();
    setupAppUpdate();
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// ============================================
// NOTIFICATION SETTINGS
// ============================================

export function loadNotificationSettings() {
  const settings = getNotificationSettings();
  const mappings = {
    'setting-sound': 'soundEnabled',
    'setting-validation-failures': 'validationFailures',
    'setting-job-failures': 'jobFailures',
    'setting-new-messages': 'newMessages',
    'setting-connection-status': 'connectionStatus',
    'setting-job-completed': 'jobCompleted'
  };

  Object.entries(mappings).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && settings[key] !== undefined) {
      el.checked = settings[key];
    }
  });
}

export function setupNotificationSettingsListeners() {
  const settingIds = [
    { id: 'setting-sound', key: 'soundEnabled' },
    { id: 'setting-validation-failures', key: 'validationFailures' },
    { id: 'setting-job-failures', key: 'jobFailures' },
    { id: 'setting-new-messages', key: 'newMessages' },
    { id: 'setting-connection-status', key: 'connectionStatus' },
    { id: 'setting-job-completed', key: 'jobCompleted' }
  ];

  settingIds.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        const newValue = el.checked;
        const settings = { [key]: newValue };
        try {
          await window.api.saveNotificationSettings(settings);
        } catch {
          el.checked = !newValue;
          showToast('Error al guardar configuraci\u00f3n', 'error');
        }
      });
    }
  });
}

// ============================================
// QUICK REPLIES
// ============================================

export function getEffectiveQuickReplies() {
  const qr = getQuickReplies();
  if (qr && Array.isArray(qr) && qr.length > 0) {
    return [...qr].sort((a, b) => a.order - b.order);
  }
  return [...DEFAULT_QUICK_REPLIES];
}

export function setupQuickReplies() {
  if (getQuickRepliesSetup()) return;
  setQuickRepliesSetup(true);
  renderQuickRepliesButtons();
}

export function renderQuickRepliesButtons() {
  const container = document.getElementById('quick-replies-list');
  if (!container) return;

  const replies = getEffectiveQuickReplies();
  container.innerHTML = '';

  replies.forEach(reply => {
    const btn = document.createElement('button');
    btn.className = 'quick-reply-btn';
    btn.innerHTML = `<span class="quick-reply-icon">${escapeHtml(reply.icon)}</span><span class="quick-reply-text">${escapeHtml(reply.label)}</span>`;
    btn.addEventListener('click', () => {
      const input = document.getElementById('chat-message-input');
      if (input && reply.text) {
        input.value = reply.text;
        input.focus();
        const form = input.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
        btn.classList.add('quick-reply-sent');
        setTimeout(() => btn.classList.remove('quick-reply-sent'), 800);
      }
    });
    container.appendChild(btn);
  });
}

// ============================================
// QUICK REPLIES SETTINGS
// ============================================

function generateQuickReplyId() {
  return 'qr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
}

export function renderQuickRepliesSettingsList() {
  const container = document.getElementById('quick-replies-settings-list');
  const emptyEl = document.getElementById('quick-replies-empty');
  if (!container) return;

  const replies = getEffectiveQuickReplies();

  if (replies.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  container.innerHTML = replies.map(reply => `
    <div class="qr-settings-item" data-id="${escapeHtml(reply.id)}" draggable="true">
      <span class="qr-drag-handle" title="Arrastra para reordenar">\u{2807}</span>
      <span class="qr-item-icon">${escapeHtml(reply.icon)}</span>
      <div class="qr-item-info">
        <span class="qr-item-label">${escapeHtml(reply.label)}</span>
        <span class="qr-item-preview">${escapeHtml((reply.text || '').length > 60 ? (reply.text || '').substring(0, 60) + '...' : (reply.text || ''))}</span>
      </div>
      <div class="qr-item-actions">
        <button class="btn-icon" title="Editar" onclick="editQuickReply('${escapeHtml(reply.id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="deleteQuickReply('${escapeHtml(reply.id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  setupQuickReplyDragAndDrop();
}

export function setupQuickReplySettingsListeners() {
  const addBtn = document.getElementById('add-quick-reply-btn');
  if (addBtn) {
    addBtn.onclick = () => openQuickReplyModal(null);
  }
  const resetBtn = document.getElementById('reset-quick-replies-btn');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      const confirmed = await showConfirmModal(
        'Restaurar predeterminadas',
        'Esto reemplazara todas tus respuestas rapidas personalizadas con las predeterminadas.',
        'Restaurar'
      );
      if (confirmed) {
        setQuickReplies(null);
        await saveQuickRepliesToMain(null);
        renderQuickRepliesSettingsList();
        renderQuickRepliesButtons();
        showToast('Respuestas predeterminadas restauradas', 'success');
      }
    };
  }
}

function openQuickReplyModal(replyId) {
  setEditingQuickReplyId(replyId);
  const titleEl = document.getElementById('quick-reply-modal-title');
  const iconInput = document.getElementById('qr-edit-icon');
  const labelInput = document.getElementById('qr-edit-label');
  const textInput = document.getElementById('qr-edit-text');
  const charCount = document.getElementById('qr-edit-char-count');

  if (replyId) {
    titleEl.textContent = 'Editar Respuesta Rapida';
    const replies = getEffectiveQuickReplies();
    const existing = replies.find(r => r.id === replyId);
    if (existing) {
      iconInput.value = existing.icon;
      labelInput.value = existing.label;
      textInput.value = existing.text;
      charCount.textContent = `${existing.text.length}/500`;
    }
  } else {
    titleEl.textContent = 'Agregar Respuesta Rapida';
    iconInput.value = '';
    labelInput.value = '';
    textInput.value = '';
    charCount.textContent = '0/500';
  }

  textInput.oninput = () => {
    charCount.textContent = `${textInput.value.length}/500`;
  };
  labelInput.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); textInput.focus(); }
    if (e.key === 'Escape') closeQuickReplyModal();
  };
  textInput.onkeydown = (e) => {
    if (e.key === 'Escape') closeQuickReplyModal();
  };

  document.getElementById('quick-reply-modal').classList.remove('hidden');
  setTimeout(() => iconInput.focus(), 100);
}

export function closeQuickReplyModal() {
  const modal = document.getElementById('quick-reply-modal');
  if (modal) modal.classList.add('hidden');
  setEditingQuickReplyId(null);
}

export async function saveQuickReplyFromModal() {
  const iconInput = document.getElementById('qr-edit-icon');
  const labelInput = document.getElementById('qr-edit-label');
  const textInput = document.getElementById('qr-edit-text');

  const icon = iconInput.value.trim();
  const label = labelInput.value.trim();
  const text = textInput.value.trim();

  if (!icon) { showToast('El icono es requerido', 'error'); iconInput.focus(); return; }
  if (!label) { showToast('La etiqueta es requerida', 'error'); labelInput.focus(); return; }
  if (!text) { showToast('El texto del mensaje es requerido', 'error'); textInput.focus(); return; }
  if (label.length > 30) { showToast('La etiqueta no puede tener mas de 30 caracteres', 'error'); return; }
  if (text.length > 500) { showToast('El texto no puede tener mas de 500 caracteres', 'error'); return; }

  let current = getEffectiveQuickReplies();
  const editingId = getEditingQuickReplyId();

  if (editingId) {
    current = current.map(r =>
      r.id === editingId ? { ...r, icon, label, text } : r
    );
  } else {
    if (current.length >= MAX_QUICK_REPLIES) {
      showToast(`Maximo ${MAX_QUICK_REPLIES} respuestas rapidas`, 'error');
      return;
    }
    current.push({
      id: generateQuickReplyId(),
      icon,
      label,
      text,
      order: current.length
    });
  }

  current.forEach((r, i) => r.order = i);
  setQuickReplies(current);
  await saveQuickRepliesToMain(current);
  closeQuickReplyModal();
  renderQuickRepliesSettingsList();
  renderQuickRepliesButtons();
  showToast(editingId ? 'Respuesta actualizada' : 'Respuesta agregada', 'success');
}

export function editQuickReply(id) {
  openQuickReplyModal(id);
}

export async function deleteQuickReply(id) {
  let current = getEffectiveQuickReplies();
  current = current.filter(r => r.id !== id);
  current.forEach((r, i) => r.order = i);
  setQuickReplies(current.length > 0 ? current : null);
  await saveQuickRepliesToMain(getQuickReplies());
  renderQuickRepliesSettingsList();
  renderQuickRepliesButtons();
  showToast('Respuesta eliminada', 'success');
}

async function saveQuickRepliesToMain(replies) {
  try {
    await window.api.saveQuickReplies(replies);
  } catch (error) {
    console.error('Error saving quick replies:', error);
    showToast('Error al guardar respuestas rapidas', 'error');
  }
}

function setupQuickReplyDragAndDrop() {
  const container = document.getElementById('quick-replies-settings-list');
  if (!container) return;

  let draggedItem = null;

  container.querySelectorAll('.qr-settings-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.classList.add('qr-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      if (draggedItem) draggedItem.classList.remove('qr-dragging');
      draggedItem = null;
      container.querySelectorAll('.qr-settings-item').forEach(el => el.classList.remove('qr-drag-over'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (item !== draggedItem) {
        item.classList.add('qr-drag-over');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('qr-drag-over');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('qr-drag-over');
      if (!draggedItem || draggedItem === item) return;

      const allItems = [...container.querySelectorAll('.qr-settings-item')];
      const fromIndex = allItems.indexOf(draggedItem);
      const toIndex = allItems.indexOf(item);
      if (fromIndex === -1 || toIndex === -1) return;

      let current = getEffectiveQuickReplies();
      const [moved] = current.splice(fromIndex, 1);
      current.splice(toIndex, 0, moved);
      current.forEach((r, i) => r.order = i);

      setQuickReplies(current);
      await saveQuickRepliesToMain(current);
      renderQuickRepliesSettingsList();
      renderQuickRepliesButtons();
    });
  });
}

// ============================================
// PROMOTIONAL BROADCAST
// ============================================

export function setupPromoBroadcast() {
  const btn = document.getElementById('send-promo-btn');
  if (!btn || btn._promoSetup) return;
  btn._promoSetup = true;

  btn.onclick = async () => {
    const titleInput = document.getElementById('promo-title');
    const messageInput = document.getElementById('promo-message');
    const title = titleInput?.value?.trim();
    const message = messageInput?.value?.trim();

    if (!title || !message) {
      showToast('Completa titulo y mensaje', 'error');
      return;
    }

    const confirmed = await showConfirmModal(
      'Enviar Promocion',
      `Se enviara push notification a TODOS los usuarios:\n\n"${title}"\n${message}`,
      'Enviar',
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
      const result = await window.api.broadcastPromo(title, message);
      if (result?.success) {
        showToast(`Promo enviada a ${result.pushRecipients || 0} usuarios`, 'success');
        titleInput.value = '';
        messageInput.value = '';
      } else {
        showToast(result?.error || 'Error enviando promo', 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar a Todos';
    }
  };
}

// ============================================
// APP UPDATE MANAGEMENT
// ============================================

export function setupAppUpdate() {
  const btn = document.getElementById('publish-update-btn');
  if (!btn || btn._updateSetup) return;
  btn._updateSetup = true;

  btn.onclick = async () => {
    const versionInput = document.getElementById('update-version');
    const apkUrlInput = document.getElementById('update-apk-url');
    const changelogInput = document.getElementById('update-changelog');

    const version = versionInput?.value?.trim();
    const apkUrl = apkUrlInput?.value?.trim();
    const changelog = changelogInput?.value?.trim() || '';

    if (!version) {
      showToast('Ingresa el numero de version', 'error');
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      showToast('Version invalida. Usa formato X.Y.Z (ej: 1.2.0)', 'error');
      return;
    }
    if (!apkUrl) {
      showToast('Ingresa la URL del APK', 'error');
      return;
    }

    const confirmed = await showConfirmModal(
      'Publicar Actualizacion',
      `Se forzara la actualizacion a v${version} en TODOS los usuarios.\n\nURL: ${apkUrl}\n\nEsto bloqueara la app hasta que actualicen.`,
      'Publicar',
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = 'Publicando...';

    try {
      const result = await window.api.publishAppUpdate(version, apkUrl, changelog);
      if (result?.success) {
        showToast(`v${version} publicada! ${result.notifiedUsers || 0} usuarios notificados`, 'success');
        versionInput.value = '';
        changelogInput.value = '';
      } else {
        showToast(result?.error || 'Error publicando', 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publicar y Notificar';
    }
  };
}
