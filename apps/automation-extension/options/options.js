// Options Page Logic - Glassmorphism Design

// HTML escape utility to prevent XSS when injecting dynamic values into innerHTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadNotificationSettings();
  await loadPanelProfile();
  setupEventListeners();
  setupPasswordToggles();
  setupNotificationToggles();
  setupExportButtons();
  setupPanelProfile();
  updateStatus();
  loadDashboardStats();
  // Load panels for the dropdown after settings are loaded (needs backendUrl + apiKey)
  await loadPanels();
});

// Load settings from storage
async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(['config']);
    if (stored.config) {
      populateForm(stored.config);
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast('Error al cargar configuración', 'error');
  }
}

// Populate form with saved config
function populateForm(config) {
  document.getElementById('backend-url').value = config.backendUrl || '';
  document.getElementById('api-key').value = config.apiKey || '';
  // panelId is now a <select> — set value after panels are loaded, store for later
  document.getElementById('panel-id').dataset.savedValue = config.panelId || '';
  document.getElementById('panel-url').value = config.panelUrl || '';
  if (document.getElementById('panelProfileUrl')) {
    document.getElementById('panelProfileUrl').value = config.panelProfileUrl || '';
  }
  document.getElementById('panel-username').value = config.panelUsername || '';
  document.getElementById('panel-password').value = config.panelPassword || '';
  const MIN_ALLOWED_DELAY = 1000;
  const MAX_ALLOWED_DELAY = 15000;
  const minDelay = Math.max(MIN_ALLOWED_DELAY, Math.min(MAX_ALLOWED_DELAY, config.minDelay ?? 2000));
  const maxDelay = Math.max(MIN_ALLOWED_DELAY, Math.min(MAX_ALLOWED_DELAY, config.maxDelay ?? 7000));
  document.getElementById('min-delay').value = minDelay;
  document.getElementById('max-delay').value = Math.max(minDelay, maxDelay);
  document.getElementById('debug-mode').checked = config.debugMode || false;
}

// Setup event listeners
function setupEventListeners() {
  // Save settings
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
  });

  // Test connection
  document.getElementById('btn-test-connection').addEventListener('click', async () => {
    await testConnection();
  });

  // Clear session
  document.getElementById('btn-clear-session').addEventListener('click', async () => {
    await clearSession();
  });
}

// Setup password visibility toggles
function setupPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.target;
      const input = document.getElementById(targetId);
      const eyeOpen = button.querySelector('.eye-open');
      const eyeClosed = button.querySelector('.eye-closed');

      if (input.type === 'password') {
        input.type = 'text';
        eyeOpen.classList.add('hidden');
        eyeClosed.classList.remove('hidden');
      } else {
        input.type = 'password';
        eyeOpen.classList.remove('hidden');
        eyeClosed.classList.add('hidden');
      }
    });
  });
}

// Save settings
async function saveSettings() {
  const submitBtn = document.querySelector('button[type="submit"]');
  const originalContent = submitBtn.innerHTML;

  try {
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Guardando...
    `;

    const formData = new FormData(document.getElementById('settings-form'));
    const minDelayRaw = parseInt(formData.get('minDelay'));
    const maxDelayRaw = parseInt(formData.get('maxDelay'));

    // Validate parsed numbers before building config
    if (isNaN(minDelayRaw) || isNaN(maxDelayRaw)) {
      showToast('Las demoras deben ser números válidos', 'error');
      return;
    }

    const config = {
      backendUrl: formData.get('backendUrl'),
      apiKey: formData.get('apiKey'),
      panelId: formData.get('panelId') || '',
      panelUrl: formData.get('panelUrl'),
      panelProfileUrl: document.getElementById('panelProfileUrl')?.value?.trim() || '',
      panelUsername: formData.get('panelUsername'),
      panelPassword: formData.get('panelPassword'),
      minDelay: minDelayRaw,
      maxDelay: maxDelayRaw,
      debugMode: formData.get('debugMode') === 'on'
    };

    // Validate
    if (config.minDelay >= config.maxDelay) {
      showToast('La demora mínima debe ser menor que la máxima', 'error');
      return;
    }

    // Enforce absolute bounds (Golden Rule #1: slower than human)
    const MIN_ALLOWED_DELAY = 1000;  // 1 second minimum
    const MAX_ALLOWED_DELAY = 15000; // 15 seconds maximum
    if (config.minDelay < MIN_ALLOWED_DELAY || config.maxDelay > MAX_ALLOWED_DELAY) {
      showToast(
        `Las demoras deben estar entre ${MIN_ALLOWED_DELAY / 1000}s y ${MAX_ALLOWED_DELAY / 1000}s`,
        'error'
      );
      return;
    }

    // Save to storage (critical — persists even if SW is suspended)
    await chrome.storage.local.set({ config });
    showToast('Configuración guardada exitosamente', 'success');
    updateStatus();

    // Notify service worker to reload config (best-effort — SW might be suspended)
    try {
      await chrome.runtime.sendMessage({ type: 'UPDATE_CONFIG' });
    } catch (swError) {
      console.warn('Could not notify service worker:', swError.message);
      showToast('Config guardada. Recargá la extensión si no se conecta.', 'warning');
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('Error al guardar: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalContent;
  }
}

// Test connection to backend
async function testConnection() {
  const backendUrl = document.getElementById('backend-url').value;
  const apiKey = document.getElementById('api-key').value;

  if (!backendUrl || !apiKey) {
    showToast('Ingresa la URL del backend y la clave API primero', 'warning');
    return;
  }

  const testBtn = document.getElementById('btn-test-connection');
  const originalContent = testBtn.innerHTML;

  try {
    testBtn.disabled = true;
    testBtn.innerHTML = `
      <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Probando...
    `;

    const response = await fetch(`${backendUrl}/api/bot/health`, {
      method: 'GET',
      headers: {
        'X-Bot-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      showToast(`Conexión exitosa! Backend: ${data.status || 'OK'}`, 'success');
      updateStatusIcon('backend', true);
      // Refresh panels dropdown after successful connection
      await loadPanels();
    } else {
      showToast(`Conexión fallida: ${response.statusText}`, 'error');
      updateStatusIcon('backend', false);
    }
  } catch (error) {
    showToast(`Error de conexión: ${error.message}`, 'error');
    updateStatusIcon('backend', false);
  } finally {
    testBtn.disabled = false;
    testBtn.innerHTML = originalContent;
  }
}

// Clear session data
async function clearSession() {
  if (!confirm('¿Limpiar todos los datos de sesión? Esto te deslogueará del panel.')) {
    return;
  }

  try {
    const panelUrl = document.getElementById('panel-url').value;
    if (panelUrl) {
      const url = new URL(panelUrl);
      const cookies = await chrome.cookies.getAll({ domain: url.hostname });
      for (const cookie of cookies) {
        await chrome.cookies.remove({
          url: panelUrl,
          name: cookie.name
        });
      }
    }

    showToast('Datos de sesión limpiados', 'success');
  } catch (error) {
    console.error('Error clearing session:', error);
    showToast('Error al limpiar sesión: ' + error.message, 'error');
  }
}

// Update status display
async function updateStatus() {
  try {
    const stored = await chrome.storage.local.get(['config']);

    if (stored.config?.backendUrl) {
      document.getElementById('backend-status').textContent = 'Configurado';
      updateStatusIcon('backend', null); // neutral
    } else {
      document.getElementById('backend-status').textContent = 'No configurado';
      updateStatusIcon('backend', false);
    }

    if (stored.config?.panelUrl) {
      document.getElementById('panel-status').textContent = 'Configurado';
      updateStatusIcon('panel', null);
    } else {
      document.getElementById('panel-status').textContent = 'No configurado';
      updateStatusIcon('panel', false);
    }

    // Get extension version
    const manifest = chrome.runtime.getManifest();
    document.getElementById('extension-version').textContent = manifest.version;
  } catch (error) {
    console.error('Error updating status:', error);
  }
}

// Update status icon
function updateStatusIcon(type, success) {
  const iconEl = document.getElementById(`${type}-status-icon`);

  if (success === true) {
    iconEl.className = 'w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-2';
    iconEl.innerHTML = `<svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
  } else if (success === false) {
    iconEl.className = 'w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-2';
    iconEl.innerHTML = `<svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;
  } else {
    iconEl.className = 'w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-2';
    iconEl.innerHTML = `<svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
  }
}

// Fetch available panels from backend and populate the dropdown
async function loadPanels() {
  const backendUrl = document.getElementById('backend-url').value;
  const apiKey = document.getElementById('api-key').value;
  const selectEl = document.getElementById('panel-id');
  const loadingEl = document.getElementById('panel-id-loading');

  if (!backendUrl || !apiKey) return;

  try {
    if (loadingEl) loadingEl.style.display = 'block';
    const response = await fetch(`${backendUrl}/api/bot/panels`, {
      method: 'GET',
      headers: { 'X-Bot-API-Key': apiKey, 'Content-Type': 'application/json' },
    });

    if (!response.ok) return;
    const panels = await response.json();

    // Keep first default option, clear the rest
    const savedValue = selectEl.dataset.savedValue || selectEl.value || '';
    selectEl.innerHTML = '<option value="" style="background:#1e1b4b;color:#a78bfa;">Seleccionar panel...</option>';

    for (const panel of panels) {
      const opt = document.createElement('option');
      opt.value = panel.id;
      opt.textContent = escapeHtml(panel.name);
      opt.style.cssText = 'background:#1e1b4b;color:white;';
      if (!panel.isActive) {
        opt.textContent += ' [inactivo]';
        opt.style.color = '#6b7280';
      }
      selectEl.appendChild(opt);
    }

    // Restore saved value
    if (savedValue) selectEl.value = savedValue;
  } catch (e) {
    console.warn('Could not load panels:', e.message);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// Toast notification system
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');

  const colors = {
    success: 'bg-emerald-500/90 border-emerald-400/50',
    error: 'bg-red-500/90 border-red-400/50',
    info: 'bg-purple-500/90 border-purple-400/50',
    warning: 'bg-amber-500/90 border-amber-400/50'
  };

  const icons = {
    success: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>',
    error: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>',
    info: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    warning: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
  };

  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl ${colors[type]} border backdrop-blur-sm text-white text-sm font-medium shadow-lg transform translate-x-full opacity-0 transition-all duration-300`;
  toast.innerHTML = `${icons[type]}<span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full', 'opacity-0');
  });

  // Remove after 4 seconds
  setTimeout(() => {
    toast.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Load and render dashboard statistics with charts
async function loadDashboardStats() {
  try {
    // Get stats from service worker
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

    // Default values if no stats
    const completed = stats?.completed || 0;
    const failed = stats?.failed || 0;
    const total = completed + failed;
    const avgTime = stats?.avgTime || 0;
    const weeklyData = stats?.weeklyData || [0, 0, 0, 0, 0, 0, 0];

    // Update stat numbers
    document.getElementById('stat-total-jobs').textContent = total;
    document.getElementById('stat-completed-jobs').textContent = completed;
    document.getElementById('stat-failed-jobs').textContent = failed;
    document.getElementById('stat-avg-time').textContent = avgTime > 0 ? `${Math.round(avgTime)}s` : '0s';

    // Render charts if Charts library is available
    if (window.Charts) {
      // Render donut chart with legend (larger size for options page)
      const donutContainer = document.getElementById('options-donut-chart');
      if (donutContainer) {
        donutContainer.innerHTML = Charts.createDonutChart({
          success: completed,
          failed: failed,
          size: 140,
          strokeWidth: 14,
          showLabel: true,
          showLegend: true,
          compact: false
        });
      }

      // Render area chart with day labels
      const areaContainer = document.getElementById('options-area-chart');
      if (areaContainer) {
        const dayLabels = getDayLabels(7);
        const areaData = weeklyData.map((value, index) => ({
          label: dayLabels[index],
          value: value
        }));

        areaContainer.innerHTML = Charts.createAreaChart({
          data: areaData,
          width: 280,
          height: 160,
          color: '#a855f7'
        });
      }
    }
  } catch (error) {
    console.error('Error loading dashboard stats:', error);
    // Show error-specific message (distinct from "no data")
    if (window.Charts) {
      const donutContainer = document.getElementById('options-donut-chart');
      if (donutContainer) {
        donutContainer.innerHTML = Charts.createDonutChart({
          success: 0, failed: 0, size: 140, strokeWidth: 14,
          showLabel: true, showLegend: true, compact: false
        });
      }
      const areaContainer = document.getElementById('options-area-chart');
      if (areaContainer) {
        areaContainer.innerHTML = `
          <div class="flex items-center justify-center" style="width: 280px; height: 160px;">
            <span class="text-white/30 text-sm">Error al cargar estadisticas</span>
          </div>
        `;
      }
    }
  }
}

// Get day labels for the past N days
function getDayLabels(days) {
  const labels = [];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    labels.push(dayNames[date.getDay()]);
  }

  return labels;
}

// Render placeholder charts when no data
function renderPlaceholderCharts() {
  if (window.Charts) {
    const donutContainer = document.getElementById('options-donut-chart');
    if (donutContainer) {
      donutContainer.innerHTML = Charts.createDonutChart({
        success: 0,
        failed: 0,
        size: 140,
        strokeWidth: 14,
        showLabel: true,
        showLegend: true,
        compact: false
      });
    }

    const areaContainer = document.getElementById('options-area-chart');
    if (areaContainer) {
      areaContainer.innerHTML = `
        <div class="flex items-center justify-center" style="width: 280px; height: 160px;">
          <span class="text-white/30 text-sm">Sin datos de actividad</span>
        </div>
      `;
    }
  }
}

// Load notification settings from service worker
async function loadNotificationSettings() {
  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_NOTIFICATION_SETTINGS' });
    if (settings) {
      document.getElementById('notify-job-started').checked = settings.jobStarted !== false;
      document.getElementById('notify-job-completed').checked = settings.jobCompleted !== false;
      document.getElementById('notify-job-failed').checked = settings.jobFailed !== false;
      document.getElementById('notify-connection-lost').checked = settings.connectionLost !== false;
    }
  } catch (error) {
    console.error('Error loading notification settings:', error);
  }
}

// Setup notification toggle listeners
function setupNotificationToggles() {
  const toggles = [
    { id: 'notify-job-started', key: 'jobStarted' },
    { id: 'notify-job-completed', key: 'jobCompleted' },
    { id: 'notify-job-failed', key: 'jobFailed' },
    { id: 'notify-connection-lost', key: 'connectionLost' }
  ];

  toggles.forEach(({ id, key }) => {
    const toggle = document.getElementById(id);
    if (toggle) {
      toggle.addEventListener('change', async () => {
        try {
          await chrome.runtime.sendMessage({
            type: 'UPDATE_NOTIFICATION_SETTINGS',
            settings: { [key]: toggle.checked }
          });
          showToast(`Notificación ${toggle.checked ? 'activada' : 'desactivada'}`, 'success');
        } catch (error) {
          console.error('Error updating notification setting:', error);
          showToast('Error al actualizar configuración', 'error');
        }
      });
    }
  });
}

// Setup export buttons
function setupExportButtons() {
  // Export Statistics
  document.getElementById('btn-export-stats')?.addEventListener('click', async () => {
    try {
      const data = await chrome.runtime.sendMessage({ type: 'EXPORT_STATS' });
      downloadJSON(data, `autobot-stats-${formatDateForFilename()}.json`);
      showToast('Estadísticas exportadas', 'success');
    } catch (error) {
      console.error('Error exporting stats:', error);
      showToast('Error al exportar estadísticas', 'error');
    }
  });

  // Export Logs
  document.getElementById('btn-export-logs')?.addEventListener('click', async () => {
    try {
      const data = await chrome.runtime.sendMessage({ type: 'EXPORT_LOGS' });
      downloadJSON(data, `autobot-logs-${formatDateForFilename()}.json`);
      showToast('Registros exportados', 'success');
    } catch (error) {
      console.error('Error exporting logs:', error);
      showToast('Error al exportar registros', 'error');
    }
  });

  // Clear Statistics
  document.getElementById('btn-clear-stats')?.addEventListener('click', async () => {
    if (!confirm('¿Estás seguro de que deseas limpiar todas las estadísticas? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_STATS' });
      showToast('Estadísticas limpiadas', 'success');
      loadDashboardStats(); // Refresh charts
    } catch (error) {
      console.error('Error clearing stats:', error);
      showToast('Error al limpiar estadísticas', 'error');
    }
  });
}

// Download JSON file
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Format date for filename
function formatDateForFilename() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ============================================
// PANEL PROFILE (custom selectors for different casino platforms)
// ============================================

async function loadPanelProfile() {
  try {
    const stored = await chrome.storage.local.get(['panelProfile']);
    const textarea = document.getElementById('panelProfileJson');
    if (textarea && stored.panelProfile) {
      textarea.value = JSON.stringify(stored.panelProfile, null, 2);
    }
  } catch (e) { /* ignore */ }
}

function setupPanelProfile() {
  const saveBtn = document.getElementById('savePanelProfile');
  const clearBtn = document.getElementById('clearPanelProfile');
  const statusEl = document.getElementById('profileStatus');

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const textarea = document.getElementById('panelProfileJson');
      const raw = (textarea?.value || '').trim();
      if (!raw) {
        statusEl.textContent = 'Vacio — usando TioRico default';
        statusEl.style.color = '#fbbf24';
        return;
      }
      try {
        const profile = JSON.parse(raw);
        if (typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Debe ser un objeto JSON');
        await chrome.storage.local.set({ panelProfile: profile });
        statusEl.textContent = `Guardado (${Object.keys(profile).length} selectores)`;
        statusEl.style.color = '#34d399';
      } catch (e) {
        statusEl.textContent = 'JSON invalido: ' + e.message;
        statusEl.style.color = '#f87171';
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await chrome.storage.local.remove('panelProfile');
      const textarea = document.getElementById('panelProfileJson');
      if (textarea) textarea.value = '';
      if (statusEl) {
        statusEl.textContent = 'Perfil limpiado — usando TioRico default';
        statusEl.style.color = '#34d399';
      }
    });
  }
}
