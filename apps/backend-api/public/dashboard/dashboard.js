// ============================================
// Owner Analytics Dashboard - JavaScript
// ============================================

(function () {
  'use strict';

  // ============================================
  // State
  // ============================================
  let token = null;
  let backendUrl = '';
  let revenueChart = null;
  let distributionChart = null;
  let refreshInterval = null;

  // ============================================
  // Persistence
  // ============================================
  function saveSession(url, jwt) {
    try {
      localStorage.setItem('owner_session', JSON.stringify({ url, token: jwt }));
    } catch (e) { /* ignore */ }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem('owner_session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem('owner_session'); } catch (e) { /* ignore */ }
  }

  // ============================================
  // DOM Helpers
  // ============================================
  function $(id) { return document.getElementById(id); }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
  function show(id) { const el = $(id); if (el) el.style.display = ''; }
  function hide(id) { const el = $(id); if (el) el.style.display = 'none'; }

  function formatCurrency(n) {
    return '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  function formatTime(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return Math.round(seconds) + 's';
    const min = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return min + 'm ' + sec + 's';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // API Client
  // ============================================
  async function apiGet(path) {
    const res = await fetch(backendUrl + path, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 401 || res.status === 403) {
      handleLogout();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      throw new Error('API error: ' + res.status);
    }
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(backendUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Login failed');
    }
    return res.json();
  }

  // ============================================
  // Login
  // ============================================
  async function handleLogin() {
    const url = $('login-url').value.trim().replace(/\/+$/, '');
    const email = $('login-email').value.trim();
    const password = $('login-password').value.trim();
    const errEl = $('login-error');
    const btn = $('btn-login');

    errEl.textContent = '';

    if (!url) { errEl.textContent = 'Enter the backend URL'; return; }
    if (!email) { errEl.textContent = 'Enter your email'; return; }
    if (!password) { errEl.textContent = 'Enter your password'; return; }

    btn.disabled = true;
    btn.textContent = 'Logging in...';

    try {
      backendUrl = url;
      const data = await apiPost('/api/auth/login', { email, password });

      if (!data.access_token && !data.accessToken && !data.token) {
        throw new Error('No token received');
      }

      token = data.access_token || data.accessToken || data.token;

      // Verify the user is ADMIN
      if (data.user && data.user.role !== 'ADMIN') {
        throw new Error('Access denied. ADMIN role required.');
      }

      saveSession(url, token);
      showDashboard();
    } catch (err) {
      const msg = err.message || '';
      if (msg === 'Failed to fetch') {
        errEl.textContent = 'No se pudo conectar al servidor. Verifica que la URL sea correcta y el backend este activo.';
      } else {
        errEl.textContent = msg || 'Connection failed';
      }
      btn.disabled = false;
      btn.textContent = 'Login';
    }
  }

  function handleLogout() {
    clearSession();
    token = null;
    backendUrl = '';
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    $('login-overlay').classList.remove('hidden');
    $('dashboard-container').style.display = 'none';
    $('btn-login').disabled = false;
    $('btn-login').textContent = 'Login';
    $('login-error').textContent = '';
  }

  // ============================================
  // Dashboard Init
  // ============================================
  function showDashboard() {
    $('login-overlay').classList.add('hidden');
    $('dashboard-container').style.display = '';
    loadAnalytics();

    // Auto-refresh every 60 seconds
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(loadAnalytics, 60000);
  }

  async function loadAnalytics() {
    try {
      $('error-banner').classList.remove('visible');
      const data = await apiGet('/api/dashboard/analytics');
      renderDashboard(data);
      setText('last-refresh', 'Updated: ' + new Date().toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }));
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        $('error-banner').textContent = 'Failed to load analytics: ' + err.message;
        $('error-banner').classList.add('visible');
      }
    }
  }

  // ============================================
  // Render Dashboard
  // ============================================
  function renderDashboard(data) {
    // KPI Cards
    setText('kpi-dau', data.dau);
    setText('kpi-mau', data.mau);
    setText('kpi-revenue-today', formatCurrency(data.revenueToday));
    setText('kpi-total-revenue', formatCurrency(data.totalRevenue));
    setText('kpi-success-rate', data.successRate + '%');
    setText('kpi-success-detail', data.completedRequests + ' completed / ' + data.failedRequests + ' failed');
    setText('kpi-avg-time', formatTime(data.avgProcessingTimeSeconds));

    // Revenue Line Chart
    renderRevenueChart(data.revenueByDay);

    // Request Distribution Doughnut
    renderDistributionChart(data.requestDistribution);

    // Top Users Table
    renderTopUsers(data.topUsers);

    // System Balance
    setText('balance-value', formatCurrency(data.totalSystemBalance));

    // Validation Breakdown
    renderValidationBreakdown(data.validationBreakdown);

    // Revenue by week
    renderWeeklyRevenue(data.revenueByWeek);
  }

  // ============================================
  // Revenue Chart (Line - Chart.js)
  // ============================================
  function renderRevenueChart(revenueByDay) {
    if (!revenueByDay || !revenueByDay.length) return;

    const ctx = $('revenue-chart');
    if (!ctx) return;

    const labels = revenueByDay.map(function (d) {
      const dt = new Date(d.date + 'T12:00:00');
      return dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    });
    const revenues = revenueByDay.map(function (d) { return d.revenue; });
    const counts = revenueByDay.map(function (d) { return d.count; });

    if (revenueChart) {
      revenueChart.data.labels = labels;
      revenueChart.data.datasets[0].data = revenues;
      revenueChart.data.datasets[1].data = counts;
      revenueChart.update('none');
      return;
    }

    revenueChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Revenue (ARS)',
            data: revenues,
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'y',
          },
          {
            label: 'Requests',
            data: counts,
            borderColor: '#F59E0B',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            labels: { color: '#94A3B8', font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: '#1E293B',
            titleColor: '#F1F5F9',
            bodyColor: '#94A3B8',
            borderColor: '#334155',
            borderWidth: 1,
            callbacks: {
              label: function (ctx) {
                if (ctx.datasetIndex === 0) {
                  return 'Revenue: $' + Number(ctx.raw).toLocaleString('es-AR');
                }
                return 'Requests: ' + ctx.raw;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#64748B', font: { size: 11 }, maxRotation: 45 },
            grid: { color: 'rgba(30, 41, 59, 0.5)' },
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            ticks: {
              color: '#10B981',
              font: { size: 11 },
              callback: function (v) { return '$' + Number(v).toLocaleString('es-AR'); },
            },
            grid: { color: 'rgba(30, 41, 59, 0.5)' },
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            ticks: { color: '#F59E0B', font: { size: 11 } },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  // ============================================
  // Distribution Doughnut Chart
  // ============================================
  function renderDistributionChart(distribution) {
    if (!distribution || !distribution.length) return;

    const ctx = $('distribution-chart');
    if (!ctx) return;

    var statusColors = {
      PENDING_PROOF: '#64748B',
      VALIDATING: '#3B82F6',
      VALIDATION_FAILED: '#8B5CF6',
      APPROVED: '#06B6D4',
      PROCESSING: '#F59E0B',
      COMPLETED: '#10B981',
      FAILED: '#EF4444',
      REJECTED: '#F87171',
    };

    var statusLabels = {
      PENDING_PROOF: 'Pending Proof',
      VALIDATING: 'Validating',
      VALIDATION_FAILED: 'Validation Failed',
      APPROVED: 'Approved',
      PROCESSING: 'Processing',
      COMPLETED: 'Completed',
      FAILED: 'Failed',
      REJECTED: 'Rejected',
    };

    var labels = distribution.map(function (d) { return statusLabels[d.status] || d.status; });
    var counts = distribution.map(function (d) { return d.count; });
    var colors = distribution.map(function (d) { return statusColors[d.status] || '#64748B'; });

    if (distributionChart) {
      distributionChart.data.labels = labels;
      distributionChart.data.datasets[0].data = counts;
      distributionChart.data.datasets[0].backgroundColor = colors;
      distributionChart.update('none');
      return;
    }

    distributionChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: counts,
          backgroundColor: colors,
          borderColor: '#111827',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#94A3B8',
              font: { size: 11 },
              padding: 12,
              usePointStyle: true,
              pointStyleWidth: 10,
            },
          },
          tooltip: {
            backgroundColor: '#1E293B',
            titleColor: '#F1F5F9',
            bodyColor: '#94A3B8',
            borderColor: '#334155',
            borderWidth: 1,
          },
        },
        cutout: '60%',
      },
    });
  }

  // ============================================
  // Top Users Table
  // ============================================
  function renderTopUsers(topUsers) {
    var tbody = $('top-users-body');
    if (!tbody) return;

    if (!topUsers || !topUsers.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No data available</td></tr>';
      return;
    }

    tbody.innerHTML = topUsers.map(function (u, i) {
      var name = escapeHtml(u.username || u.email || u.userId.slice(0, 8));
      return '<tr>' +
        '<td class="rank">#' + (i + 1) + '</td>' +
        '<td>' + name + '</td>' +
        '<td style="text-align:right">' + u.requestCount + '</td>' +
        '<td class="amount" style="text-align:right">' + formatCurrency(u.totalAmount) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ============================================
  // Validation Breakdown
  // ============================================
  function renderValidationBreakdown(vb) {
    if (!vb) return;

    var total = vb.total || 1;
    setText('val-auto-count', vb.autoApproved);
    setText('val-auto-pct', Math.round((vb.autoApproved / total) * 100) + '%');
    setText('val-manual-count', vb.manuallyApproved);
    setText('val-manual-pct', Math.round((vb.manuallyApproved / total) * 100) + '%');
    setText('val-rejected-count', vb.rejected);
    setText('val-rejected-pct', Math.round((vb.rejected / total) * 100) + '%');
    setText('val-failed-count', vb.validationFailed);
    setText('val-failed-pct', Math.round((vb.validationFailed / total) * 100) + '%');
  }

  // ============================================
  // Weekly Revenue
  // ============================================
  function renderWeeklyRevenue(weeks) {
    var container = $('weekly-revenue');
    if (!container || !weeks || !weeks.length) return;

    container.innerHTML = weeks.map(function (w) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:13px;color:var(--text-secondary)">' + escapeHtml(w.week) + '</span>' +
        '<span style="display:flex;align-items:center;gap:12px">' +
        '<span style="font-size:12px;color:var(--text-muted)">' + w.count + ' reqs</span>' +
        '<span style="font-size:14px;font-weight:600;color:var(--primary)">' + formatCurrency(w.revenue) + '</span>' +
        '</span>' +
        '</div>';
    }).join('');
  }

  // ============================================
  // Initialization
  // ============================================
  function init() {
    // Attach event listeners
    $('btn-login').addEventListener('click', handleLogin);
    $('btn-logout').addEventListener('click', handleLogout);
    $('btn-refresh').addEventListener('click', loadAnalytics);

    // Enter key on password field
    $('login-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleLogin();
    });

    // Check for saved session
    var saved = loadSession();
    if (saved && saved.url && saved.token) {
      backendUrl = saved.url;
      token = saved.token;
      $('login-url').value = saved.url;
      showDashboard();
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
