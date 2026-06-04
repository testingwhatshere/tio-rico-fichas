// Popup UI Logic - Glassmorphism Design

let state = null;
let jobStartTime = null;
let timerInterval = null;

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

// Status configurations
const STATUS_CONFIG = {
  'IDLE': {
    label: 'INACTIVO',
    classes: 'bg-gray-500/30 text-gray-300 border-gray-500/30'
  },
  'CONNECTED': {
    label: 'CONECTADO',
    classes: 'bg-emerald-500/30 text-emerald-300 border-emerald-500/30'
  },
  'PROCESSING': {
    label: 'PROCESANDO',
    classes: 'bg-amber-500/30 text-amber-300 border-amber-500/30 animate-pulse'
  },
  'ERROR': {
    label: 'ERROR',
    classes: 'bg-red-500/30 text-red-300 border-red-500/30'
  }
};

const CONNECTION_CONFIG = {
  'NONE': { label: 'NINGUNA', color: 'bg-gray-500' },
  'WEBSOCKET': { label: 'WEBSOCKET', color: 'bg-emerald-500' },
  'POLLING': { label: 'POLLING', color: 'bg-amber-500' }
};

// Progress step states
const STEP_STATES = {
  pending: 'bg-white/10 text-white/40',
  active: 'bg-purple-500 text-white step-active shadow-lg shadow-purple-500/50',
  completed: 'bg-emerald-500 text-white',
  error: 'bg-red-500 text-white'
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await loadStats();
  await loadRecentJobs();
  setupEventListeners();

  // Refresh state every 2 seconds
  setInterval(loadState, 2000);

  // Refresh stats every 30 seconds
  setInterval(loadStats, 30000);

  // Refresh recent jobs every 10 seconds
  setInterval(loadRecentJobs, 10000);
});

// Load state from service worker
async function loadState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response) {
      // SW returned undefined — it's alive but state is null (just started)
      document.getElementById('status-badge').textContent = 'INICIANDO...';
      return;
    }
    const previousStatus = state?.status;
    state = response;
    updateUI();

    // Handle job timer — use actual start time from service worker
    if (state.status === 'PROCESSING' && state.currentJob) {
      if (!jobStartTime) {
        // Use the real job start time, not popup open time
        jobStartTime = state.currentJob.startTime || Date.now();
        startTimer();
      }
    } else {
      stopTimer();
    }

    // Show notification on status change
    if (previousStatus && previousStatus !== state.status) {
      if (state.status === 'ERROR') {
        showToast('Error en la conexión', 'error');
      } else if (state.status === 'CONNECTED' && previousStatus === 'ERROR') {
        showToast('Conexión restablecida', 'success');
      }
    }
  } catch (error) {
    console.error('Error loading state:', error);
    // SW is dead — show error and enable reconnect
    document.getElementById('status-badge').textContent = 'SW MUERTO';
    document.getElementById('status-badge').className = 'px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500/30 text-red-300 border border-red-500/30';
  }
}

// Update UI based on state
function updateUI() {
  if (!state) return;

  // Status badge
  const statusBadge = document.getElementById('status-badge');
  const statusConfig = STATUS_CONFIG[state.status] || STATUS_CONFIG['IDLE'];
  statusBadge.textContent = statusConfig.label;
  statusBadge.className = `px-3 py-1.5 rounded-full text-xs font-semibold border ${statusConfig.classes}`;

  // Connection indicator with pulse animation
  const connectionIndicator = document.getElementById('connection-indicator');
  const connConfig = CONNECTION_CONFIG[state.connectionType] || CONNECTION_CONFIG['NONE'];
  connectionIndicator.className = `w-2 h-2 rounded-full ${connConfig.color}`;

  // Add pulse animation based on status
  if (state.status === 'PROCESSING') {
    connectionIndicator.classList.add('pulse-processing');
  } else if (state.status === 'ERROR') {
    connectionIndicator.classList.add('pulse-error');
  } else if (state.connectionType !== 'NONE') {
    connectionIndicator.classList.add('pulse-connected');
  }

  // Connection type
  document.getElementById('connection-type').textContent = connConfig.label;

  // Backend URL
  const backendUrl = state.config?.backendUrl || '';
  const backendUrlEl = document.getElementById('backend-url');
  let hostname = 'No configurado';
  if (backendUrl) {
    try {
      hostname = new URL(backendUrl).hostname;
    } catch {
      hostname = backendUrl;
    }
  }
  backendUrlEl.textContent = hostname;
  backendUrlEl.title = backendUrl || '';

  // Current job
  updateJobInfo();

  // Update button states
  const killSwitchBtn = document.getElementById('btn-kill-switch');
  killSwitchBtn.disabled = state.status === 'IDLE';
  killSwitchBtn.classList.toggle('opacity-50', state.status === 'IDLE');
  killSwitchBtn.classList.toggle('cursor-not-allowed', state.status === 'IDLE');

  const reconnectBtn = document.getElementById('btn-reconnect');
  reconnectBtn.disabled = state.status === 'PROCESSING';
  reconnectBtn.classList.toggle('opacity-50', state.status === 'PROCESSING');
  reconnectBtn.classList.toggle('cursor-not-allowed', state.status === 'PROCESSING');
}

// Update job info section
function updateJobInfo() {
  const jobInfo = document.getElementById('job-info');
  const progressSteps = document.getElementById('progress-steps');
  const jobTimer = document.getElementById('job-timer');

  if (state.currentJob) {
    jobTimer.classList.remove('hidden');
    progressSteps.classList.remove('hidden');

    jobInfo.innerHTML = `
      <div class="grid grid-cols-3 gap-3 text-center">
        <div class="bg-white/5 rounded-xl p-2">
          <p class="text-purple-300 text-xs mb-0.5">ID</p>
          <p class="text-white font-mono text-xs">${escapeHtml(state.currentJob.id.substring(0, 8))}</p>
        </div>
        <div class="bg-white/5 rounded-xl p-2">
          <p class="text-purple-300 text-xs mb-0.5">Usuario</p>
          <p class="text-white font-semibold text-sm truncate">${escapeHtml(state.currentJob.targetUsername)}</p>
        </div>
        <div class="bg-white/5 rounded-xl p-2">
          <p class="text-purple-300 text-xs mb-0.5">Monto</p>
          <p class="text-emerald-400 font-bold text-sm">$${escapeHtml(String(state.currentJob.amount))}</p>
        </div>
      </div>
    `;

    // Update progress steps
    updateProgressSteps(state.currentJob.step || 'login');
  } else {
    jobTimer.classList.add('hidden');
    progressSteps.classList.add('hidden');

    jobInfo.innerHTML = `
      <div class="text-center py-6">
        <div class="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
          <svg class="w-6 h-6 text-purple-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
          </svg>
        </div>
        <p class="text-white/40 text-sm">Esperando trabajos...</p>
      </div>
    `;
  }
}

// Update progress steps visualization
function updateProgressSteps(currentStep) {
  const steps = ['login', 'search', 'credit', 'confirm'];
  const currentIndex = steps.indexOf(currentStep);

  steps.forEach((step, index) => {
    const stepEl = document.getElementById(`step-${step}`);
    const lineEl = document.getElementById(`line-${index + 1}`);

    // Reset classes
    stepEl.className = 'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all';

    if (index < currentIndex) {
      // Completed
      stepEl.classList.add(...STEP_STATES.completed.split(' '));
      stepEl.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
      if (lineEl) lineEl.classList.add('bg-emerald-500');
    } else if (index === currentIndex) {
      // Active
      stepEl.classList.add(...STEP_STATES.active.split(' '));
      stepEl.textContent = index + 1;
    } else {
      // Pending
      stepEl.classList.add(...STEP_STATES.pending.split(' '));
      stepEl.textContent = index + 1;
      if (lineEl) lineEl.classList.remove('bg-emerald-500');
    }
  });
}

// Timer functions
function startTimer() {
  if (timerInterval) return;

  const timerEl = document.getElementById('job-timer');
  timerInterval = setInterval(() => {
    if (!jobStartTime) return;

    const elapsed = Math.floor((Date.now() - jobStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    timerEl.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  jobStartTime = null;
  document.getElementById('job-timer').textContent = '00:00';
}

// Setup event listeners
function setupEventListeners() {
  // Open panel button
  document.getElementById('btn-open-panel').addEventListener('click', async () => {
    if (!state?.config?.panelUrl) {
      showToast('URL del panel no configurada', 'error');
      return;
    }

    // Open directly to /users page (auto-login will handle login if needed)
    const usersUrl = new URL('/users', state.config.panelUrl).href;
    chrome.tabs.create({ url: usersUrl });
    showToast('Abriendo panel de usuarios...', 'info');
  });

  // Reconnect button
  document.getElementById('btn-reconnect').addEventListener('click', async () => {
    try {
      const btn = document.getElementById('btn-reconnect');
      btn.disabled = true;
      btn.innerHTML = `
        <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Conectando...
      `;

      await chrome.runtime.sendMessage({ type: 'RECONNECT' });
      await loadState();
      showToast('Reconectando...', 'info');

      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Reconectar
        `;
      }, 2000);
    } catch (error) {
      console.error('Reconnect failed:', error);
      showToast('Service Worker no responde. Recargá la extensión en chrome://extensions', 'error');
    }
  });

  // Kill switch button
  document.getElementById('btn-kill-switch').addEventListener('click', async () => {
    if (!confirm('¿Detener toda la automatización? Esta acción parará todos los procesos inmediatamente.')) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({ type: 'DISCONNECT' });
      await loadState();
      showToast('Automatización detenida', 'success');
    } catch (error) {
      showToast('Error al detener', 'error');
    }
  });

  // Options link
  document.getElementById('link-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Logs link
  document.getElementById('link-logs').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('logs/logs.html') });
  });
}

// Load stats from backend
async function loadStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    if (stats) {
      const todayCompleted = stats.todayCompleted || 0;
      const todayFailed = stats.todayFailed || 0;
      const completed = stats.completed || 0;
      const failed = stats.failed || 0;

      document.getElementById('jobs-today').textContent = todayCompleted;
      document.getElementById('failed-today').textContent = todayFailed;
      document.getElementById('success-rate').textContent = completed;

      // Render donut chart
      if (window.Charts) {
        const donutContainer = document.getElementById('donut-chart');
        donutContainer.innerHTML = Charts.createDonutChart({
          success: completed,
          failed: failed,
          size: 80,
          strokeWidth: 8,
          showLabel: true,
          compact: true
        });

        // Render sparkline with weekly data
        const weeklyData = stats.weeklyData || [0, 0, 0, 0, 0, 0, 0];
        const sparklineContainer = document.getElementById('sparkline-chart');
        sparklineContainer.innerHTML = Charts.createSparkline({
          data: weeklyData,
          width: 100,
          height: 30,
          color: '#a855f7',
          fill: true
        });
      }
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load recent jobs from job history
async function loadRecentJobs() {
  try {
    const jobs = await chrome.runtime.sendMessage({ type: 'GET_JOB_HISTORY' });
    const container = document.getElementById('recent-jobs');

    // Filter out invalid/phantom jobs (jobs without valid data)
    const validJobs = (jobs || []).filter(job =>
      job &&
      job.id &&
      job.timestamp &&
      job.targetUsername &&
      job.amount !== undefined
    );

    if (validJobs.length === 0) {
      container.innerHTML = '<p class="text-white/30 text-xs text-center py-4">Sin trabajos recientes</p>';
      return;
    }

    container.innerHTML = validJobs.slice(0, 5).map(job => {
      const isSuccess = job.success;
      const statusIcon = isSuccess
        ? '<svg class="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
        : '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';

      const timeAgo = getTimeAgo(new Date(job.timestamp));
      const durationStr = job.duration ? `${job.duration}s` : '';

      return `
        <div class="flex items-center justify-between bg-white/5 rounded-lg p-2.5 hover:bg-white/10 transition-colors" title="${escapeHtml(job.error || '')}">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-full ${isSuccess ? 'bg-emerald-500/20' : 'bg-red-500/20'} flex items-center justify-center">
              ${statusIcon}
            </div>
            <div>
              <p class="text-white text-xs font-medium">${escapeHtml(job.targetUsername || 'Usuario')}</p>
              <div class="flex items-center gap-2">
                <span class="text-emerald-400/70 text-xs font-medium">$${escapeHtml(String(job.amount || 0))}</span>
                ${durationStr ? `<span class="text-white/30 text-xs">${escapeHtml(durationStr)}</span>` : ''}
              </div>
            </div>
          </div>
          <span class="text-white/30 text-xs">${escapeHtml(timeAgo)}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading recent jobs:', error);
  }
}

// Helper: Get time ago string
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'ahora';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
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
    success: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>',
    error: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>',
    info: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    warning: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
  };

  const toast = document.createElement('div');
  toast.className = `flex items-center gap-2 px-4 py-3 rounded-xl ${colors[type]} border backdrop-blur-sm text-white text-sm font-medium shadow-lg transform translate-y-2 opacity-0 transition-all duration-300`;
  toast.innerHTML = `${icons[type]}<span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
