// renderer/views/chats.js — Chat view: list, messages, send, typing, quick replies, image

import {
  store, ollamaState,
  getSelectedChat, setSelectedChat,
  getChatMessages, setChatMessages, pushChatMessage, prependChatMessages,
  getPendingChatMessages, setPendingChatMessages,
  getIsLoadingMessages, setIsLoadingMessages,
  getLoadingChatId, setLoadingChatId,
  getLoadChatTimeout, setLoadChatTimeout,
  getChatListDirty, setChatListDirty,
  getUserTypingTimeout, setUserTypingTimeout,
  getOperatorTypingTimeout, setOperatorTypingTimeout,
  getPendingImageData, setPendingImageData,
  recentMessageIds, trackMessageId,
  state,
  clearTracked, trackTimeout,
  getChatMessagesCursor, setChatMessagesCursor,
  getChatMessagesHasMore, setChatMessagesHasMore,
  getIsLoadingMoreMessages, setIsLoadingMoreMessages,
} from '../state.js';
import { MAX_PENDING_CHAT_MESSAGES, DUCK_SVG } from '../constants.js';
import { escapeHtml, formatMessageTime, getTimeAgo, showToast, showTextInputModal, openImageZoom } from '../utils.js';
import { requestSuggestedReplies, fillChatInputFromSuggestion } from '../ai/ollama.js';
import { updateBadges } from '../entry-helpers.js';

// ============================================
// CHAT LIST
// ============================================

export function renderChatsList() {
  const container = document.getElementById('chats-list');
  const countEl = document.getElementById('chats-count');

  if (countEl) {
    countEl.textContent = store.chats.length;
  }

  // Search filter
  const searchInput = document.getElementById('chats-search');
  const searchTerm = (searchInput?.value || '').trim().toLowerCase();
  let chatsToRender = store.chats;
  if (searchTerm) {
    chatsToRender = chatsToRender.filter(c =>
      (c.user?.username || '').toLowerCase().includes(searchTerm) ||
      (c.lastMessage?.content || '').toLowerCase().includes(searchTerm)
    );
  }

  if (chatsToRender.length === 0) {
    container.innerHTML = `
      <div class="empty-state small">
        ${DUCK_SVG}
        <p>No hay conversaciones</p>
      </div>
    `;
    return;
  }

  const selectedChat = getSelectedChat();

  // Sort chats: needsHelp first (newest first), then by most recent activity.
  const sortedChats = [...chatsToRender].sort((a, b) => {
    if (a.needsHelp && !b.needsHelp) return -1;
    if (!a.needsHelp && b.needsHelp) return 1;
    const timeA = a.lastMessage?.createdAt || a.updatedAt || a.createdAt || '';
    const timeB = b.lastMessage?.createdAt || b.updatedAt || b.createdAt || '';
    return timeB.localeCompare(timeA);
  });

  container.innerHTML = sortedChats.map(chat => {
    const userName = chat.user?.username || chat.user?.email || chat.userName || 'Usuario';
    const lastMsg = chat.lastMessage?.content || 'Sin mensajes';
    const unread = chat.unread || chat.unreadCount || 0;
    const status = chat.status || 'OPEN';
    const isActive = selectedChat?.id === chat.id;
    const needsHelp = !!chat.needsHelp;
    const helpContextLabel = chat.helpContext === 'prize' ? 'premio' : 'chat';

    return `
      <div class="chat-item ${unread > 0 ? 'unread' : ''} ${isActive ? 'active' : ''} ${needsHelp ? 'needs-help' : ''}"
           onclick="selectChat('${chat.id}')">
        ${needsHelp ? `<div class="chat-help-banner">🙋 AYUDA · ${helpContextLabel}</div>` : ''}
        <div class="chat-item-header">
          <span class="chat-name">${escapeHtml(userName)}</span>
          ${unread > 0 ? `<span class="chat-unread-badge">${unread}</span>` : ''}
        </div>
        <div class="chat-preview">${escapeHtml(lastMsg)}</div>
        <div class="chat-item-footer">
          <span class="chat-status ${status.toLowerCase()}">${status}</span>
          <span class="chat-time">${getTimeAgo(chat.lastMessage?.createdAt || chat.updatedAt)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Auto-select first chat if none selected
  if (!selectedChat && sortedChats.length > 0) {
    selectChat(sortedChats[0].id);
  }
}

// ============================================
// SELECT CHAT
// ============================================

export async function selectChat(chatId) {
  setSelectedChat(store.chats.find(c => c.id === chatId) || null);
  const selectedChat = getSelectedChat();
  if (!selectedChat) return;

  // Clear global dedup set for new chat context
  recentMessageIds.clear();

  // O2 FIX: Clear typing timeout on chat switch
  const prevTypingTimeout = getUserTypingTimeout();
  if (prevTypingTimeout) {
    clearTimeout(prevTypingTimeout);
    setUserTypingTimeout(null);
  }
  const typingIndicator = document.getElementById('user-typing-indicator');
  if (typingIndicator) typingIndicator.classList.add('hidden');

  window.api.markChatRead(chatId);
  selectedChat.unread = 0;
  selectedChat.unreadCount = 0;

  renderChatsList();
  await loadChatMessages(chatId);
  updateBadges();
}

// ============================================
// LOAD CHAT MESSAGES
// ============================================

export async function loadChatMessages(chatId) {
  setLoadingChatId(chatId);
  setIsLoadingMessages(true);
  setPendingChatMessages([]);

  // Clear previous timeout to prevent leak on rapid switching (O2 FIX)
  const prevTimeout = getLoadChatTimeout();
  if (prevTimeout) {
    clearTimeout(prevTimeout);
    setLoadChatTimeout(null);
  }

  const container = document.getElementById('chat-main');
  container.innerHTML = `<div class="chat-loading"><div class="loading-spinner"></div><p>Cargando...</p></div>`;

  const timeoutId = setTimeout(() => {
    if (getIsLoadingMessages() && getLoadingChatId() === chatId) {
      setIsLoadingMessages(false);
      setLoadingChatId(null);
      container.innerHTML = `
        <div class="chat-error">
          <p>Tiempo de espera agotado</p>
          <button class="btn btn-sm btn-primary" onclick="loadChatMessages('${chatId}')">Reintentar</button>
        </div>
      `;
    }
  }, 20000);
  setLoadChatTimeout(timeoutId);

  try {
    const result = await window.api.getChatMessages(chatId);
    clearTimeout(timeoutId);
    setLoadChatTimeout(null);
    if (getLoadingChatId() !== chatId) return;
    if (result.success) {
      const data = result.data || {};
      setChatMessages((data.messages || []).slice().reverse());
      setChatMessagesCursor(data.nextCursor || null);
      setChatMessagesHasMore(!!data.hasMore);
      const messages = getChatMessages();
      for (const m of messages) {
        trackMessageId(m.id);
      }
      // Flush pending
      const pending = getPendingChatMessages();
      if (pending.length > 0) {
        for (const msg of pending) {
          if (trackMessageId(msg.id)) {
            pushChatMessage(msg);
          }
        }
        setPendingChatMessages([]);
      }
      renderChatMain();
    } else {
      container.innerHTML = `
        <div class="chat-error">
          <p>Error al cargar mensajes</p>
          <button class="btn btn-sm btn-primary" onclick="loadChatMessages('${chatId}')">Reintentar</button>
        </div>
      `;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    setLoadChatTimeout(null);
    if (getLoadingChatId() !== chatId) return;
    container.innerHTML = `
      <div class="chat-error">
        <p>Error al cargar mensajes</p>
        <button class="btn btn-sm btn-primary" onclick="loadChatMessages('${chatId}')">Reintentar</button>
      </div>
    `;
  } finally {
    if (getLoadingChatId() === chatId) {
      setIsLoadingMessages(false);
      setLoadingChatId(null);
    }
  }
}

// ============================================
// LOAD MORE (PAGINATION)
// ============================================

export async function loadMoreChatMessages() {
  const cursor = getChatMessagesCursor();
  if (!cursor || !getChatMessagesHasMore() || getIsLoadingMoreMessages()) return;

  const selectedChat = getSelectedChat();
  if (!selectedChat) return;

  setIsLoadingMoreMessages(true);

  const loader = document.getElementById('chat-load-more');
  if (loader) loader.innerHTML = '<div class="loading-spinner small"></div>';

  try {
    const result = await window.api.getChatMessages(selectedChat.id, cursor);
    if (!result.success) return;

    const data = result.data || {};
    const olderMessages = (data.messages || []).slice().reverse();

    for (const m of olderMessages) {
      trackMessageId(m.id);
    }

    const container = document.getElementById('chat-messages-container');
    const prevScrollHeight = container ? container.scrollHeight : 0;

    prependChatMessages(olderMessages);
    setChatMessagesCursor(data.nextCursor || null);
    setChatMessagesHasMore(!!data.hasMore);

    // Re-render messages and preserve scroll position
    if (container) {
      const allMessages = getChatMessages();
      const hasMore = getChatMessagesHasMore();
      container.innerHTML =
        (hasMore ? '<div id="chat-load-more" class="chat-load-more"><button class="btn btn-sm btn-ghost" onclick="loadMoreChatMessages()">Cargar anteriores</button></div>' : '') +
        allMessages.map(renderMessage).join('');
      // Keep scroll at the same relative position
      container.scrollTop = container.scrollHeight - prevScrollHeight;
    }
  } catch (error) {
    console.error('Error loading more messages:', error);
  } finally {
    setIsLoadingMoreMessages(false);
  }
}

// ============================================
// RENDER CHAT MAIN
// ============================================

export function renderChatMain() {
  const container = document.getElementById('chat-main');
  const selectedChat = getSelectedChat();
  const chatMessages = getChatMessages();

  const prevMessagesContainer = document.getElementById('chat-messages-container');
  const wasNearBottom = !prevMessagesContainer ||
    (prevMessagesContainer.scrollHeight - prevMessagesContainer.scrollTop - prevMessagesContainer.clientHeight) < 100;

  if (!selectedChat) {
    container.innerHTML = `
      <div class="chat-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        </svg>
        <p>Selecciona una conversaci\u00f3n</p>
      </div>
    `;
    return;
  }

  const userName = selectedChat.user?.username || selectedChat.user?.email || selectedChat.userName || 'Usuario';
  const userPhone = selectedChat.user?.phone || '';
  // savedTargetUsername viene en el chat list desde el backend (chats.service.ts:254).
  // Mostrarlo en el header de una para que el operador no espere el async loading.
  const playerName = selectedChat.user?.savedTargetUsername || '';
  const chatStatus = selectedChat.status || 'OPEN';
  const isClosed = chatStatus === 'CLOSED';

  const userId = selectedChat.user?.id || selectedChat.userId;
  const subtitleParts = [];
  if (userPhone) subtitleParts.push(escapeHtml(userPhone));
  if (playerName) subtitleParts.push(`Jugador: <strong>${escapeHtml(playerName)}</strong>`);
  const subtitle = subtitleParts.join(' · ');

  container.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-info">
        <h3 class="chat-header-name">${escapeHtml(userName)}</h3>
        ${subtitle ? `<div class="chat-header-subtitle">${subtitle}</div>` : ''}
        <span class="chat-header-status ${chatStatus.toLowerCase()}">${escapeHtml(chatStatus)}</span>
      </div>
      <div class="chat-header-actions">
        ${!isClosed ? `<button class="btn btn-sm btn-secondary" onclick="closeCurrentChat()">Cerrar Chat</button>` : ''}
      </div>
    </div>
    ${userId ? renderPanelInfoBlock(userId) : ''}
    ${selectedChat.id ? `<div id="pending-summary-container" data-chat-id="${selectedChat.id}"></div>` : ''}

    <div class="chat-messages" id="chat-messages-container">
      ${chatMessages.length === 0 ? `<div class="chat-messages-empty"><p>No hay mensajes</p></div>`
      : (getChatMessagesHasMore() ? '<div id="chat-load-more" class="chat-load-more"><button class="btn btn-sm btn-ghost" onclick="loadMoreChatMessages()">Cargar anteriores</button></div>' : '')
        + chatMessages.map(renderMessage).join('')}
    </div>

    <div class="typing-indicator hidden" id="user-typing-indicator">
      <div class="typing-dots"><span></span><span></span><span></span></div>
      Usuario escribiendo...
    </div>

    ${!isClosed ? `
      <div id="pending-image-preview" class="pending-image-preview hidden">
        <img id="pending-image-img" class="pending-image-thumb" />
        <button class="pending-image-remove" onclick="clearPendingImage()">&times;</button>
      </div>
      <div class="chat-input-container">
        <form class="chat-input-form" onsubmit="sendChatMessage(event)">
          <label class="chat-image-btn" title="Adjuntar imagen">
            <input type="file" accept="image/*" id="chat-image-input" style="display:none" onchange="handleImageSelected(event)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
          </label>
          <input type="text" class="chat-input" placeholder="Escribe un mensaje..." id="chat-message-input" autocomplete="off" oninput="handleOperatorTyping()"/>
          <button type="submit" class="btn btn-primary chat-send-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </form>
      </div>
      <div class="ai-suggested-replies" id="ai-suggested-replies">
        ${ollamaState.suggestedRepliesEnabled ? `
          <button class="ai-suggest-btn" id="ai-suggest-btn" onclick="requestSuggestedReplies()" ${!ollamaState.available ? 'disabled' : ''}>
            <span>&#10024;</span> ${ollamaState.available ? 'Sugerir respuestas' : 'AI no disponible'}
          </button>
          <div id="ai-suggest-chips" class="ai-suggest-chips" style="display:none"></div>
        ` : ''}
      </div>
    ` : `<div class="chat-closed-notice"><p>Esta conversaci\u00f3n est\u00e1 cerrada</p></div>`}
  `;

  const messagesContainer = document.getElementById('chat-messages-container');
  if (messagesContainer) {
    if (wasNearBottom) {
      messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
    }
    // Auto-load more when scrolling near top
    messagesContainer.addEventListener('scroll', () => {
      if (messagesContainer.scrollTop < 80 && getChatMessagesHasMore() && !getIsLoadingMoreMessages()) {
        loadMoreChatMessages();
      }
    });
  }

  // Load pending Requests/PrizeClaims for this user (async, doesn't block chat render)
  if (selectedChat.id) {
    setTimeout(() => loadPendingSummary(selectedChat.id), 0);
  }
}

function renderMessage(msg) {
  const isOperator = msg.type === 'OPERATOR';
  const isSystem = msg.type === 'SYSTEM';

  const rawUrl = msg.imageUrl || '';
  const imageHtml = rawUrl
    ? `<div class="chat-msg-image-wrap">
        <img src="${escapeHtml(rawUrl)}" alt="Imagen" class="chat-msg-image"
          onclick="openImageZoom('${escapeHtml(rawUrl)}')"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="chat-msg-fallback" style="display:none" onclick="window.open('${escapeHtml(rawUrl)}','_blank')">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>Ver imagen</span>
        </div>
      </div>`
    : '';

  const contentHtml = msg.content
    ? `<div class="message-content">${escapeHtml(msg.content)}</div>`
    : '';

  // If the message is linked to a Request, render an inline card with the
  // amount/status so the operator can see at a glance which carga corresponds.
  const requestCardHtml = msg.request
    ? `<div class="chat-msg-request-card">
        <span class="chat-msg-request-icon">💰</span>
        <div class="chat-msg-request-body">
          <div class="chat-msg-request-line1">
            <span class="chat-msg-request-amount">${formatAmount(msg.request.amount)}</span>
            <span class="pending-card-badge pending-card-badge-${(msg.request.status || '').toLowerCase()}">${escapeHtml(REQUEST_STATUS_LABELS[msg.request.status] || msg.request.status)}</span>
          </div>
          <div class="chat-msg-request-line2">${escapeHtml(msg.request.targetUsername || '-')} · #${escapeHtml((msg.request.id || '').slice(0, 8))}</div>
        </div>
      </div>`
    : '';

  if (isSystem) {
    return `
      <div class="chat-message system">
        ${contentHtml}
        ${imageHtml}
        ${requestCardHtml}
        <div class="message-time">${formatMessageTime(msg.createdAt)}</div>
      </div>
    `;
  }

  const senderName = isOperator ? (msg.sender?.displayName || msg.sender?.email || msg.senderName || '') : '';
  return `
    <div class="chat-message ${isOperator ? 'operator' : 'user'}">
      ${senderName ? `<div class="message-sender">${escapeHtml(senderName)}</div>` : ''}
      ${imageHtml}
      ${contentHtml}
      ${requestCardHtml}
      <div class="message-time">${formatMessageTime(msg.createdAt)}</div>
    </div>
  `;
}

// ============================================
// TYPING INDICATORS
// ============================================

export function showUserTyping() {
  const indicator = document.getElementById('user-typing-indicator');
  if (indicator) {
    indicator.classList.remove('hidden');
    const prev = getUserTypingTimeout();
    if (prev) clearTimeout(prev);
    setUserTypingTimeout(setTimeout(() => {
      indicator.classList.add('hidden');
    }, 3000));
  }
}

export function handleOperatorTyping() {
  const chatId = getSelectedChat()?.id;
  if (!chatId) return;
  if (getOperatorTypingTimeout()) return;
  try { window.api.sendTyping(chatId); } catch (e) { /* ignore */ }
  setOperatorTypingTimeout(setTimeout(() => {
    setOperatorTypingTimeout(null);
  }, 2000));
}

// ============================================
// IMAGE HANDLING
// ============================================

export function handleImageSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    setPendingImageData({
      buffer: e.target.result,
      filename: file.name,
      mimeType: file.type,
    });
    const preview = document.getElementById('pending-image-preview');
    const img = document.getElementById('pending-image-img');
    if (preview && img) {
      img.src = URL.createObjectURL(file);
      preview.classList.remove('hidden');
    }
  };
  reader.readAsArrayBuffer(file);
}

export function clearPendingImage() {
  setPendingImageData(null);
  const preview = document.getElementById('pending-image-preview');
  if (preview) preview.classList.add('hidden');
  const input = document.getElementById('chat-image-input');
  if (input) input.value = '';
}

// ============================================
// SEND MESSAGE
// ============================================

export async function sendChatMessage(event) {
  event.preventDefault();
  const selectedChat = getSelectedChat();
  if (!selectedChat) return;

  const input = document.getElementById('chat-message-input');
  const content = input.value.trim();
  const pendingImage = getPendingImageData();
  if (!content && !pendingImage) return;

  if (!state.connected) {
    showToast('Sin conexi\u00f3n al servidor', 'error');
    return;
  }

  input.disabled = true;
  const sendBtn = document.querySelector('.chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    let imageUrl = null;
    if (pendingImage) {
      const uploadResult = await window.api.uploadChatImage(
        pendingImage.buffer, pendingImage.filename, pendingImage.mimeType
      );
      if (uploadResult.url) {
        imageUrl = uploadResult.url;
      } else {
        showToast(uploadResult.error || 'Error al subir imagen', 'error');
        return;
      }
      clearPendingImage();
    }

    const result = await window.api.sendMessage(selectedChat.id, content || ' ', imageUrl);
    if (result.success) {
      const freshInput = document.getElementById('chat-message-input');
      if (freshInput) freshInput.value = '';
    } else {
      showToast(result.error || 'Error al enviar mensaje', 'error');
    }
  } catch (error) {
    showToast('Error al enviar mensaje', 'error');
  } finally {
    const currentInput = document.getElementById('chat-message-input');
    if (currentInput) {
      currentInput.disabled = false;
      currentInput.focus();
    }
    const currentSendBtn = document.querySelector('.chat-send-btn');
    if (currentSendBtn) currentSendBtn.disabled = false;
  }
}

// ============================================
// CLOSE CHAT
// ============================================

export async function closeCurrentChat() {
  const selectedChat = getSelectedChat();
  if (!selectedChat) return;

  const reason = await showTextInputModal('Motivo de cierre (opcional)', 'Motivo del cierre...', 'Cerrar Chat');
  if (reason === null) return;

  try {
    const result = await window.api.closeChat(selectedChat.id, reason || 'Cerrado por operador');
    if (result.success) {
      selectedChat.status = 'CLOSED';
      renderChatsList();
      renderChatMain();
      showToast('Chat cerrado', 'success');
    } else {
      showToast('Error al cerrar', 'error');
    }
  } catch (error) {
    showToast('Error al cerrar', 'error');
  }
}

// ============================================
// Panel info (game-panel credentials for support)
// ============================================

const _panelInfoCache = new Map(); // userId -> { savedTargetUsername, panelPassword, panelPasswordUpdatedAt }

export function renderPanelInfoBlock(userId) {
  const cached = _panelInfoCache.get(userId);
  // Always render the block; load async if no cache yet.
  if (!cached) {
    setTimeout(() => loadPanelInfo(userId), 0);
    return `
      <div class="panel-info-block" id="panel-info-${userId}">
        <span class="panel-info-loading">Cargando datos del panel…</span>
      </div>
    `;
  }
  return renderPanelInfoContent(userId, cached);
}

function renderPanelInfoContent(userId, info) {
  const username = info.savedTargetUsername || '(sin asignar)';
  const hasPwd = info.panelPassword != null && info.panelPassword !== '';
  const pwdValue = hasPwd ? info.panelPassword : '';
  const pwdNote = hasPwd
    ? ''
    : '<span class="panel-info-hint">Default: 123casino (si no la cambió)</span>';
  return `
    <div class="panel-info-block" id="panel-info-${userId}" data-user-id="${userId}">
      <div class="panel-info-row">
        <span class="panel-info-label">Usuario panel:</span>
        <span class="panel-info-value">${escapeHtml(username)}</span>
        ${info.savedTargetUsername
          ? `<button class="panel-info-btn" title="Copiar" onclick="copyPanelInfoValue('${escapeHtml(info.savedTargetUsername)}')">📋</button>`
          : ''}
        <button class="panel-info-btn" title="Cambiar usuario del panel" onclick="changePanelUsernameFor('${userId}')">✏️</button>
      </div>
      <div class="panel-info-row">
        <span class="panel-info-label">Contraseña:</span>
        ${hasPwd
          ? `<span class="panel-info-value panel-info-pwd" id="panel-info-pwd-${userId}" data-pwd="${escapeHtml(pwdValue)}" data-shown="0">••••••••</span>
             <button class="panel-info-btn" title="Mostrar/ocultar" onclick="togglePanelInfoPwd('${userId}')">👁</button>
             <button class="panel-info-btn" title="Copiar" onclick="copyPanelInfoValue('${escapeHtml(pwdValue)}')">📋</button>`
          : `<span class="panel-info-value panel-info-default">123casino</span>
             <button class="panel-info-btn" title="Copiar" onclick="copyPanelInfoValue('123casino')">📋</button>`}
        ${pwdNote}
      </div>
    </div>
  `;
}

async function loadPanelInfo(userId) {
  try {
    const result = await window.api.getUserPanelInfo(userId);
    if (result?.success && result.data) {
      _panelInfoCache.set(userId, result.data);
      const el = document.getElementById(`panel-info-${userId}`);
      if (el) el.outerHTML = renderPanelInfoContent(userId, result.data);
    } else {
      const el = document.getElementById(`panel-info-${userId}`);
      if (el) el.innerHTML = `<span class="panel-info-error">No se pudo cargar los datos del panel</span>`;
    }
  } catch (e) {
    const el = document.getElementById(`panel-info-${userId}`);
    if (el) el.innerHTML = `<span class="panel-info-error">Error: ${escapeHtml(e.message || 'desconocido')}</span>`;
  }
}

export function togglePanelInfoPwd(userId) {
  const el = document.getElementById(`panel-info-pwd-${userId}`);
  if (!el) return;
  const shown = el.dataset.shown === '1';
  if (shown) {
    el.textContent = '••••••••';
    el.dataset.shown = '0';
  } else {
    el.textContent = el.dataset.pwd || '';
    el.dataset.shown = '1';
  }
}

export async function copyPanelInfoValue(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast('Copiado', 'success');
  } catch {
    showToast('No se pudo copiar', 'error');
  }
}

// Invalidate panel-info cache when bot reports a password change so the next
// render shows the new value. Called from renderer.js socket handler.
export function invalidatePanelInfo(userId) {
  _panelInfoCache.delete(userId);
}

// ============================================
// Pending summary (cargas + premios pendientes del usuario asociado al chat)
// ============================================

const REQUEST_STATUS_LABELS = {
  VALIDATING: 'Validando',
  VALIDATION_FAILED: 'Validación falló',
  PENDING_MP_VERIFICATION: 'Esperando MP',
  APPROVED: 'Aprobado',
  PROCESSING: 'Cargando',
};

const PRIZE_STATUS_LABELS = {
  PENDING_PAYMENT_DETAILS: 'Esperando datos',
  PENDING_VERIFICATION: 'Por verificar',
  VERIFYING_CHIPS: 'Verificando fichas',
  VERIFIED: 'Verificado',
  PROCESSING: 'Retirando',
  CHIPS_WITHDRAWN: 'Pagar al usuario',
};

function formatAmount(value) {
  const n = Number(value);
  if (!isFinite(n)) return value;
  return '$' + n.toLocaleString('es-AR');
}

function renderPendingCard(kind, item) {
  const labelMap = kind === 'request' ? REQUEST_STATUS_LABELS : PRIZE_STATUS_LABELS;
  const label = labelMap[item.status] || item.status;
  const icon = kind === 'request' ? '💰' : '🏆';
  const proofLink = kind === 'request' && item.proofUrl
    ? `<a href="#" class="pending-card-link" onclick="event.preventDefault(); openImageZoom('${escapeHtml(item.proofUrl)}')">Ver comprobante</a>`
    : '';
  const time = getTimeAgo(item.createdAt);
  return `
    <div class="pending-card pending-card-${kind}">
      <span class="pending-card-icon">${icon}</span>
      <div class="pending-card-body">
        <div class="pending-card-line1">
          <span class="pending-card-amount">${formatAmount(item.amount)}</span>
          <span class="pending-card-badge pending-card-badge-${item.status.toLowerCase()}">${escapeHtml(label)}</span>
        </div>
        <div class="pending-card-line2">
          ${escapeHtml(item.targetUsername || '-')} · hace ${escapeHtml(time)}
          ${proofLink}
        </div>
      </div>
    </div>
  `;
}

function renderPendingSummaryHtml(summary) {
  const { requests = [], prizeClaims = [] } = summary || {};
  if (requests.length === 0 && prizeClaims.length === 0) {
    return `<div class="pending-summary-empty">Sin cargas ni premios pendientes</div>`;
  }
  const requestCards = requests.map(r => renderPendingCard('request', r)).join('');
  const prizeCards = prizeClaims.map(p => renderPendingCard('prize', p)).join('');
  return `
    ${requests.length > 0 ? `
      <div class="pending-section">
        <div class="pending-section-title">Cargas pendientes <span class="pending-section-count">${requests.length}</span></div>
        <div class="pending-cards">${requestCards}</div>
      </div>
    ` : ''}
    ${prizeClaims.length > 0 ? `
      <div class="pending-section">
        <div class="pending-section-title">Premios pendientes <span class="pending-section-count">${prizeClaims.length}</span></div>
        <div class="pending-cards">${prizeCards}</div>
      </div>
    ` : ''}
  `;
}

export async function loadPendingSummary(chatId) {
  if (!chatId) return;
  const container = document.getElementById('pending-summary-container');
  if (!container || container.dataset.chatId !== chatId) return;
  container.innerHTML = `<div class="pending-summary-loading">Cargando pendientes…</div>`;
  try {
    const result = await window.api.getPendingSummary(chatId);
    // Re-verify the container is still for this chat (operator may have switched)
    const current = document.getElementById('pending-summary-container');
    if (!current || current.dataset.chatId !== chatId) return;
    if (result?.success) {
      current.innerHTML = `<div class="pending-summary-block">${renderPendingSummaryHtml(result.data)}</div>`;
    } else {
      current.innerHTML = `<div class="pending-summary-error">No se pudieron cargar pendientes: ${escapeHtml(result?.error || 'error')}</div>`;
    }
  } catch (e) {
    const current = document.getElementById('pending-summary-container');
    if (current && current.dataset.chatId === chatId) {
      current.innerHTML = `<div class="pending-summary-error">Error: ${escapeHtml(e.message || 'desconocido')}</div>`;
    }
  }
}

export function refreshPendingSummaryForUser(userId) {
  const selectedChat = getSelectedChat();
  if (!selectedChat) return;
  if ((selectedChat.user?.id || selectedChat.userId) !== userId) return;
  loadPendingSummary(selectedChat.id);
}

/**
 * Operator-driven flow when a user's panel-game username has to change (e.g. the
 * panel rejected auto-creation because the name was already taken). Backend
 * resets the user's panelId binding and re-runs discovery automatically — the
 * operator doesn't need to touch anything else.
 */
export async function changePanelUsernameFor(userId) {
  const newName = await showTextInputModal(
    'Cambiar usuario del panel',
    'Nuevo nombre (3-20, letras/números/_)',
    'Guardar',
  );
  if (!newName) return;
  const trimmed = newName.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 20 || !/^[a-z0-9_]+$/.test(trimmed)) {
    showToast('Nombre inválido: 3-20 chars, solo letras/números/_', 'error');
    return;
  }
  try {
    const result = await window.api.setUserTargetUsername(userId, trimmed);
    if (result?.success) {
      _panelInfoCache.delete(userId);
      const el = document.getElementById(`panel-info-${userId}`);
      if (el) el.outerHTML = renderPanelInfoBlock(userId);
      const msg = result.data?.retriedRequestId
        ? `Nombre actualizado. Discovery reiniciado para el último pedido.`
        : `Nombre actualizado.`;
      showToast(msg, 'success');
    } else {
      showToast(result?.error || 'No se pudo cambiar el nombre', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}
