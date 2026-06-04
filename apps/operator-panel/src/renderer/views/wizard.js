// renderer/views/wizard.js — Setup wizard

import { state, getWizardStep, setWizardStep, wizardConfig } from '../state.js';
import { showToast } from '../utils.js';

// ============================================
// SETUP
// ============================================

export function setupWizard() {
  console.log('[Wizard] Setting up wizard...');

  const nextBtn = document.getElementById('wizard-next');
  const backBtn = document.getElementById('wizard-back');

  if (nextBtn) {
    nextBtn.addEventListener('click', wizardNext);
    console.log('[Wizard] Next button listener attached');
  } else {
    console.error('[Wizard] Next button not found!');
  }

  if (backBtn) {
    backBtn.addEventListener('click', wizardBack);
    console.log('[Wizard] Back button listener attached');
  } else {
    console.error('[Wizard] Back button not found!');
  }

  const testBtn = document.getElementById('wizard-test-connection');
  if (testBtn) {
    testBtn.addEventListener('click', wizardTestConnection);
    console.log('[Wizard] Test connection button listener attached');
  } else {
    console.error('[Wizard] Test connection button not found!');
  }

  const toggleBtn = document.getElementById('toggle-api-key');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleApiKeyVisibility);
    console.log('[Wizard] Toggle API key button listener attached');
  } else {
    console.error('[Wizard] Toggle API key button not found!');
  }

  const urlInput = document.getElementById('wizard-backend-url');
  const keyInput = document.getElementById('wizard-api-key');

  if (urlInput) {
    urlInput.addEventListener('input', (e) => {
      wizardConfig.backendUrl = e.target.value.trim();
      console.log('[Wizard] Backend URL updated:', wizardConfig.backendUrl);
    });
    console.log('[Wizard] Backend URL input listener attached');
  } else {
    console.error('[Wizard] Backend URL input not found!');
  }

  if (keyInput) {
    keyInput.addEventListener('input', (e) => {
      wizardConfig.apiKey = e.target.value.trim();
      console.log('[Wizard] API Key updated (length):', wizardConfig.apiKey.length);
    });
    console.log('[Wizard] API Key input listener attached');
  } else {
    console.error('[Wizard] API Key input not found!');
  }

  const nameInput = document.getElementById('wizard-operator-name');
  if (nameInput) {
    nameInput.addEventListener('input', (e) => {
      wizardConfig.operatorName = e.target.value.trim();
      console.log('[Wizard] Operator name updated:', wizardConfig.operatorName);
    });
    console.log('[Wizard] Operator name input listener attached');
  }

  console.log('[Wizard] Setup complete');
}

// ============================================
// WIZARD NAVIGATION
// ============================================

export function checkShowWizard() {
  console.log('[Wizard] Checking if wizard should be shown...');
  console.log('[Wizard] Current config:', JSON.stringify(state.config));

  if (!state.config?.backendUrl || !state.config?.apiKey) {
    console.log('[Wizard] Config missing or incomplete, showing wizard');
    showWizard();
  } else {
    console.log('[Wizard] Config exists, skipping wizard');
  }
}

function showWizard() {
  console.log('[Wizard] Showing wizard...');

  const wizard = document.getElementById('setup-wizard');
  wizard?.classList.remove('hidden');
  setWizardStep(1);

  const urlInput = document.getElementById('wizard-backend-url');
  const keyInput = document.getElementById('wizard-api-key');

  if (urlInput && state.config?.backendUrl) {
    urlInput.value = state.config.backendUrl;
    wizardConfig.backendUrl = state.config.backendUrl;
    console.log('[Wizard] Pre-populated backend URL');
  }
  if (keyInput && state.config?.apiKey) {
    keyInput.value = state.config.apiKey;
    wizardConfig.apiKey = state.config.apiKey;
    console.log('[Wizard] Pre-populated API key');
  }

  const nameInput = document.getElementById('wizard-operator-name');
  if (nameInput && state.config?.operatorName) {
    nameInput.value = state.config.operatorName;
    wizardConfig.operatorName = state.config.operatorName;
    console.log('[Wizard] Pre-populated operator name');
  }

  updateWizardUI();
}

function hideWizard() {
  const wizard = document.getElementById('setup-wizard');
  wizard?.classList.add('hidden');
}

function updateWizardUI() {
  const wizardStep = getWizardStep();

  document.querySelectorAll('.wizard-step').forEach((step, index) => {
    const stepNum = index + 1;
    step.classList.remove('active', 'completed');
    if (stepNum < wizardStep) step.classList.add('completed');
    else if (stepNum === wizardStep) step.classList.add('active');
  });

  document.querySelectorAll('.wizard-step-line').forEach((line, index) => {
    line.classList.toggle('completed', index + 1 < wizardStep);
  });

  document.querySelectorAll('.wizard-page').forEach(page => {
    const pageNum = parseInt(page.dataset.page);
    page.classList.toggle('active', pageNum === wizardStep);
  });

  const backBtn = document.getElementById('wizard-back');
  const nextBtn = document.getElementById('wizard-next');

  if (!backBtn || !nextBtn) {
    console.error('[Wizard] Wizard buttons not found!');
    return;
  }

  backBtn.disabled = wizardStep === 1;

  if (wizardStep === 1) {
    nextBtn.innerHTML = `
      Comenzar
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 5l7 7-7 7"/>
      </svg>
    `;
    nextBtn.classList.remove('finish');
  } else if (wizardStep === 4) {
    nextBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 13l4 4L19 7"/>
      </svg>
      Finalizar
    `;
    nextBtn.classList.add('finish');
  } else {
    nextBtn.innerHTML = `
      Siguiente
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 5l7 7-7 7"/>
      </svg>
    `;
    nextBtn.classList.remove('finish');
  }

  if (wizardStep === 4) {
    updateWizardSummary();
  }
}

function wizardNext() {
  console.log('[Wizard] wizardNext called, step:', getWizardStep());

  const urlInput = document.getElementById('wizard-backend-url');
  const keyInput = document.getElementById('wizard-api-key');
  const nameInput = document.getElementById('wizard-operator-name');

  if (urlInput) wizardConfig.backendUrl = urlInput.value.trim();
  if (keyInput) wizardConfig.apiKey = keyInput.value.trim();
  if (nameInput) wizardConfig.operatorName = nameInput.value.trim();

  console.log('[Wizard] Current config:', JSON.stringify(wizardConfig));

  if (!validateWizardStep()) return;

  const step = getWizardStep();
  if (step < 4) {
    setWizardStep(step + 1);
    updateWizardUI();
  } else {
    finishWizard();
  }
}

function wizardBack() {
  const step = getWizardStep();
  if (step > 1) {
    setWizardStep(step - 1);
    updateWizardUI();
  }
}

function validateWizardStep() {
  const step = getWizardStep();

  switch (step) {
    case 2: {
      const url = wizardConfig.backendUrl;
      if (!url) {
        showWizardError('Por favor ingresa la URL del servidor');
        return false;
      }
      try {
        new URL(url);
      } catch {
        showWizardError('La URL ingresada no es v\u00e1lida');
        return false;
      }
      return true;
    }
    case 3:
      if (!wizardConfig.apiKey) {
        showWizardError('Por favor ingresa tu API Key');
        return false;
      }
      return true;
    default:
      return true;
  }
}

function showWizardError(message) {
  const resultEl = document.getElementById('wizard-test-result');
  if (resultEl) {
    resultEl.className = 'wizard-test-result error';
    resultEl.textContent = message;
  } else {
    showToast(message, 'error');
  }
}

async function wizardTestConnection() {
  console.log('[Wizard] Testing connection...');

  const resultEl = document.getElementById('wizard-test-result');
  const btn = document.getElementById('wizard-test-connection');

  const urlInput = document.getElementById('wizard-backend-url');
  const keyInput = document.getElementById('wizard-api-key');
  const nameInput = document.getElementById('wizard-operator-name');

  if (urlInput) wizardConfig.backendUrl = urlInput.value.trim();
  if (keyInput) wizardConfig.apiKey = keyInput.value.trim();
  if (nameInput) wizardConfig.operatorName = nameInput.value.trim();

  console.log('[Wizard] Testing with URL:', wizardConfig.backendUrl);
  console.log('[Wizard] Testing with API Key length:', wizardConfig.apiKey?.length || 0);

  if (!wizardConfig.backendUrl || !wizardConfig.apiKey) {
    if (resultEl) {
      resultEl.className = 'wizard-test-result error';
      resultEl.textContent = 'Completa la URL y API Key primero';
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (resultEl) {
    resultEl.className = 'wizard-test-result loading';
    resultEl.textContent = 'Probando conexi\u00f3n...';
  }

  try {
    const result = await window.api.testConnection({
      backendUrl: wizardConfig.backendUrl,
      apiKey: wizardConfig.apiKey
    });

    console.log('[Wizard] Test result:', JSON.stringify(result));

    if (resultEl) {
      if (result.success) {
        resultEl.className = 'wizard-test-result success';
        resultEl.textContent = '\u00a1Conexi\u00f3n exitosa!';
      } else {
        resultEl.className = 'wizard-test-result error';
        resultEl.textContent = result.error || 'Error al conectar';
      }
    }
  } catch (error) {
    console.error('[Wizard] Test connection error:', error);
    if (resultEl) {
      resultEl.className = 'wizard-test-result error';
      resultEl.textContent = 'Error: ' + error.message;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('wizard-api-key');
  const eyeIcon = document.querySelector('#toggle-api-key .eye-icon');
  const eyeOffIcon = document.querySelector('#toggle-api-key .eye-off-icon');

  if (input.type === 'password') {
    input.type = 'text';
    eyeIcon?.classList.add('hidden');
    eyeOffIcon?.classList.remove('hidden');
  } else {
    input.type = 'password';
    eyeIcon?.classList.remove('hidden');
    eyeOffIcon?.classList.add('hidden');
  }
}

function updateWizardSummary() {
  const urlEl = document.getElementById('summary-url');
  if (urlEl) {
    try {
      const url = new URL(wizardConfig.backendUrl);
      urlEl.textContent = url.hostname;
    } catch {
      urlEl.textContent = wizardConfig.backendUrl || '-';
    }
  }
}

async function finishWizard() {
  console.log('[Wizard] Finishing wizard...');
  console.log('[Wizard] Config to save:', JSON.stringify(wizardConfig));

  try {
    if (!wizardConfig.backendUrl || !wizardConfig.apiKey) {
      console.error('[Wizard] Invalid config - missing required fields');
      showToast('Error: Configuraci\u00f3n incompleta', 'error');
      return;
    }

    const result = await window.api.saveConfig({
      backendUrl: wizardConfig.backendUrl,
      apiKey: wizardConfig.apiKey,
      operatorName: wizardConfig.operatorName
    });

    console.log('[Wizard] Save result:', JSON.stringify(result));

    if (result.success) {
      state.config = {
        backendUrl: wizardConfig.backendUrl,
        apiKey: wizardConfig.apiKey,
        operatorName: wizardConfig.operatorName
      };

      const urlField = document.getElementById('backend-url');
      const keyField = document.getElementById('api-key');
      const nameField = document.getElementById('operator-name');
      if (urlField) urlField.value = wizardConfig.backendUrl;
      if (keyField) keyField.value = wizardConfig.apiKey;
      if (nameField) nameField.value = wizardConfig.operatorName;

      hideWizard();
      showToast('\u00a1Configuraci\u00f3n guardada! Conectando...', 'success');
    } else {
      console.error('[Wizard] Save failed:', result.error);
      showToast('Error al guardar: ' + (result.error || 'Desconocido'), 'error');
    }
  } catch (error) {
    console.error('[Wizard] Save error:', error);
    showToast('Error: ' + error.message, 'error');
  }
}
