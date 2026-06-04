// renderer/ai/ollama.js — AI features: Ollama status, suggested replies, failure analysis

import {
  ollamaState,
  getOllamaSettingsSetup, setOllamaSettingsSetup,
  getIsSuggestingReplies, setIsSuggestingReplies,
  getSelectedChat, getChatMessages,
} from '../state.js';
import { escapeHtml, showToast } from '../utils.js';

// ============================================
// OLLAMA STATUS (sidebar indicator)
// ============================================

export function updateOllamaStatus() {
  const ollamaStatusEl = document.getElementById('ollama-status');
  if (!ollamaStatusEl) return;

  const dot = ollamaStatusEl.querySelector('.bot-status-dot');
  const text = ollamaStatusEl.querySelector('.bot-status-text');

  if (ollamaState.available && ollamaState.botEnabled) {
    if (dot) dot.className = 'bot-status-dot ai-active';
    if (text) text.textContent = 'Bot AI Activo';
  } else if (ollamaState.available && !ollamaState.botEnabled) {
    if (dot) dot.className = 'bot-status-dot ai-disabled';
    if (text) text.textContent = 'Bot AI Desactivado';
  } else {
    if (dot) dot.className = 'bot-status-dot ai-unavailable';
    if (text) text.textContent = 'Sin AI';
  }

  // Sync the settings toggle if visible
  const botToggle = document.getElementById('setting-ai-bot-enabled');
  if (botToggle) botToggle.checked = ollamaState.botEnabled;
}

// ============================================
// OLLAMA SETTINGS (in settings view)
// ============================================

export async function loadOllamaSettings() {
  const urlField = document.getElementById('ollama-url');
  const modelDisplay = document.getElementById('ollama-model-display');
  const botToggle = document.getElementById('setting-ai-bot-enabled');
  const suggestedToggle = document.getElementById('setting-ai-suggested-replies');
  const failureToggle = document.getElementById('setting-ai-failure-analysis');

  // Fetch fresh status
  try {
    if (window.api.getOllamaStatus) {
      const data = await window.api.getOllamaStatus();
      if (data) {
        ollamaState.available = data.available || false;
        ollamaState.model = data.model || null;
        if (data.config) {
          ollamaState.botEnabled = data.config.botEnabled || false;
          ollamaState.suggestedRepliesEnabled = data.config.suggestedRepliesEnabled !== false;
          ollamaState.failureAnalysisEnabled = data.config.failureAnalysisEnabled !== false;
          if (urlField && data.config.ollamaUrl) urlField.value = data.config.ollamaUrl;
        }
        updateOllamaStatus();
      }
    }
  } catch (err) {
    console.log('[AI] Could not load Ollama status for settings:', err.message);
  }

  if (modelDisplay) {
    modelDisplay.textContent = ollamaState.available
      ? escapeHtml(ollamaState.model || 'Conectado (modelo desconocido)')
      : 'No conectado';
  }

  if (botToggle) botToggle.checked = ollamaState.botEnabled;
  if (suggestedToggle) suggestedToggle.checked = ollamaState.suggestedRepliesEnabled;
  if (failureToggle) failureToggle.checked = ollamaState.failureAnalysisEnabled;

  if (!getOllamaSettingsSetup()) {
    setOllamaSettingsSetup(true);
    setupOllamaSettingsListeners();
  }
}

function setupOllamaSettingsListeners() {
  const testBtn = document.getElementById('test-ollama-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const urlField = document.getElementById('ollama-url');
      const resultEl = document.getElementById('ollama-test-result');
      const ollamaUrl = urlField ? urlField.value.trim() : '';

      if (!ollamaUrl) {
        if (resultEl) {
          resultEl.style.display = '';
          resultEl.className = 'ollama-test-result error';
          resultEl.textContent = 'Ingresa la URL de Ollama';
        }
        return;
      }

      testBtn.disabled = true;
      if (resultEl) {
        resultEl.style.display = '';
        resultEl.className = 'ollama-test-result loading';
        resultEl.textContent = 'Probando conexion...';
      }

      try {
        await window.api.setOllamaConfig({ ollamaUrl });
        const result = await window.api.testOllama();
        if (result && result.success) {
          ollamaState.available = true;
          ollamaState.model = result.model || null;
          if (resultEl) {
            resultEl.className = 'ollama-test-result success';
            resultEl.textContent = 'Conexion exitosa! Modelo: ' + (result.model || 'desconocido');
          }
          const modelDisplay = document.getElementById('ollama-model-display');
          if (modelDisplay) modelDisplay.textContent = result.model || 'Conectado';
          updateOllamaStatus();
        } else {
          ollamaState.available = false;
          if (resultEl) {
            resultEl.className = 'ollama-test-result error';
            resultEl.textContent = 'Error: ' + (result?.error || 'No se pudo conectar');
          }
          updateOllamaStatus();
        }
      } catch (err) {
        if (resultEl) {
          resultEl.className = 'ollama-test-result error';
          resultEl.textContent = 'Error: ' + (err.message || 'Desconocido');
        }
      } finally {
        testBtn.disabled = false;
      }
    });
  }

  // AI toggle listeners
  const toggleConfig = [
    { id: 'setting-ai-bot-enabled', key: 'botEnabled', stateKey: 'botEnabled', onToggle: (val) => {
      ollamaState.botEnabled = val;
      updateOllamaStatus();
      if (window.api.toggleBot) window.api.toggleBot(val);
    }},
    { id: 'setting-ai-suggested-replies', key: 'suggestedRepliesEnabled', stateKey: 'suggestedRepliesEnabled' },
    { id: 'setting-ai-failure-analysis', key: 'failureAnalysisEnabled', stateKey: 'failureAnalysisEnabled' }
  ];

  toggleConfig.forEach(({ id, key, stateKey, onToggle }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        const newValue = el.checked;
        ollamaState[stateKey] = newValue;
        try {
          await window.api.setOllamaConfig({ [key]: newValue });
          if (onToggle) onToggle(newValue);
        } catch {
          el.checked = !newValue;
          ollamaState[stateKey] = !newValue;
          showToast('Error al guardar configuracion AI', 'error');
        }
      });
    }
  });
}

// ============================================
// SUGGESTED REPLIES
// ============================================

export async function requestSuggestedReplies() {
  const selectedChat = getSelectedChat();
  if (getIsSuggestingReplies() || !selectedChat || !window.api.getSuggestedReplies) return;
  if (!ollamaState.available) {
    showToast('AI no disponible', 'warning');
    return;
  }

  setIsSuggestingReplies(true);
  const suggestBtn = document.getElementById('ai-suggest-btn');
  const chipsContainer = document.getElementById('ai-suggest-chips');

  if (suggestBtn) {
    suggestBtn.disabled = true;
    suggestBtn.innerHTML = '<span class="spinner-sm"></span> Generando...';
  }
  if (chipsContainer) {
    chipsContainer.style.display = 'none';
    chipsContainer.innerHTML = '';
  }

  try {
    const chatMessages = getChatMessages();
    const recentMessages = chatMessages.slice(-10).map(m => ({
      type: m.type,
      content: m.content || '',
      createdAt: m.createdAt
    }));

    const result = await window.api.getSuggestedReplies(selectedChat.id, recentMessages);

    if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
      if (chipsContainer) {
        chipsContainer.innerHTML = result.data.map((reply, idx) =>
          `<button class="ai-suggest-chip" onclick="fillChatInputFromSuggestion(${idx})" data-suggestion="${escapeHtml(reply)}" title="${escapeHtml(reply)}">${escapeHtml(reply)}</button>`
        ).join('');
        chipsContainer.style.display = 'flex';
      }
      if (suggestBtn) {
        suggestBtn.innerHTML = '<span>&#10024;</span> Sugerir respuestas';
        suggestBtn.disabled = false;
      }
    } else {
      if (suggestBtn) {
        suggestBtn.innerHTML = '<span>&#10024;</span> Sin sugerencias';
        suggestBtn.disabled = false;
        setTimeout(() => {
          const btn = document.getElementById('ai-suggest-btn');
          if (btn) btn.innerHTML = '<span>&#10024;</span> Sugerir respuestas';
        }, 2000);
      }
    }
  } catch (err) {
    console.error('[AI] Suggested replies error:', err);
    if (suggestBtn) {
      suggestBtn.innerHTML = '<span>&#10024;</span> Error al generar';
      suggestBtn.disabled = false;
      setTimeout(() => {
        const btn = document.getElementById('ai-suggest-btn');
        if (btn) btn.innerHTML = '<span>&#10024;</span> Sugerir respuestas';
      }, 2000);
    }
  } finally {
    setIsSuggestingReplies(false);
  }
}

export function fillChatInputFromSuggestion(index) {
  const chip = document.querySelectorAll('.ai-suggest-chip')[index];
  if (!chip) return;

  const suggestion = chip.dataset.suggestion;
  const input = document.getElementById('chat-message-input');
  if (input && suggestion) {
    input.value = suggestion;
    input.focus();
  }
}

// ============================================
// FAILURE ANALYSIS
// ============================================

export async function triggerFailureAnalysis(failure) {
  if (!window.api.getFailureAnalysis) return;

  const contentEl = document.getElementById('ai-analysis-content');
  if (!contentEl) return;

  try {
    const failureData = {
      id: failure.id,
      type: failure.type,
      targetUsername: failure.targetUsername || failure.request?.targetUsername,
      amount: failure.amount || failure.request?.amount,
      userEmail: failure.userEmail || failure.user?.email || failure.request?.user?.email,
      error: failure.validationError || failure.error || failure.reason,
      validationScore: failure.validationScore,
      fraudFlags: failure.validationDetails?.fraudFlags || [],
      extractedAmount: failure.validationDetails?.extractedAmount,
      createdAt: failure.createdAt
    };

    const result = await window.api.getFailureAnalysis(failureData);

    const currentContentEl = document.getElementById('ai-analysis-content');
    if (!currentContentEl) return;

    if (result && result.success && result.data) {
      const { resumen, problema, sugerencia, razon } = result.data;
      const badgeClass = sugerencia === 'APROBAR' ? 'approve'
        : sugerencia === 'RECHAZAR' ? 'reject'
        : sugerencia === 'PEDIR_NUEVO' ? 'request-new'
        : '';
      const badgeLabel = sugerencia === 'APROBAR' ? 'Aprobar'
        : sugerencia === 'RECHAZAR' ? 'Rechazar'
        : sugerencia === 'PEDIR_NUEVO' ? 'Pedir Nuevo'
        : escapeHtml(sugerencia || 'N/A');

      currentContentEl.className = 'ai-analysis-result';
      currentContentEl.innerHTML = `
        ${resumen ? `<div class="ai-line"><span class="ai-analysis-label">Resumen:</span> ${escapeHtml(resumen)}</div>` : ''}
        ${problema ? `<div class="ai-line"><span class="ai-analysis-label">Problema:</span> ${escapeHtml(problema)}</div>` : ''}
        ${sugerencia ? `<div class="ai-line"><span class="ai-analysis-label">Sugerencia:</span> <span class="ai-suggestion-badge ${badgeClass}">${badgeLabel}</span></div>` : ''}
        ${razon ? `<div class="ai-line" style="font-size:12px;color:var(--text-muted);margin-top:4px">${escapeHtml(razon)}</div>` : ''}
      `;
    } else {
      currentContentEl.className = 'ai-analysis-error';
      currentContentEl.innerHTML = 'No se pudo generar el analisis';
    }
  } catch (err) {
    console.error('[AI] Failure analysis error:', err);
    const currentContentEl = document.getElementById('ai-analysis-content');
    if (currentContentEl) {
      currentContentEl.className = 'ai-analysis-error';
      currentContentEl.innerHTML = 'Error al analizar con AI';
    }
  }
}
