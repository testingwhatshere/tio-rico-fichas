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

  // Sort chats by most recent activity
  const sortedChats = [...chatsToRender].sort((a, b) => {
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

    return `
      <div class="chat-item ${unread > 0 ? 'unread' : ''} ${isActive ? 'active' : ''}"
           onclick="selectChat('${chat.id}')">
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
  const chatStatus = selectedChat.status || 'OPEN';
  const isClosed = chatStatus === 'CLOSED';

  container.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-info">
        <h3 class="chat-header-name">${escapeHtml(userName)}</h3>
        <span class="chat-header-status ${chatStatus.toLowerCase()}">${escapeHtml(chatStatus)}</span>
      </div>
      <div class="chat-header-actions">
        ${!isClosed ? `<button class="btn btn-sm btn-secondary" onclick="closeCurrentChat()">Cerrar Chat</button>` : ''}
      </div>
    </div>

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

  if (isSystem) {
    return `
      <div class="chat-message system">
        ${contentHtml}
        ${imageHtml}
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
