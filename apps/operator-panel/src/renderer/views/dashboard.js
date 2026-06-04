// renderer/views/dashboard.js — Dashboard view rendering

import { store } from '../state.js';
import { escapeHtml, formatAmount, getTimeAgo } from '../utils.js';
import { DUCK_SVG } from '../constants.js';
import { renderFailureItem } from './failures.js';
import { renderJobItem } from './jobs.js';

export function updateDashboard() {
  const statCompleted = document.getElementById('stat-today-completed');
  const statFailed = document.getElementById('stat-today-failed');
  const statPending = document.getElementById('stat-pending');
  const statProcessing = document.getElementById('stat-processing');

  if (statCompleted) { statCompleted.textContent = store.stats.requests?.completed || 0; statCompleted.classList.remove('skeleton-text'); }
  if (statFailed) { statFailed.textContent = store.stats.requests?.failed || 0; statFailed.classList.remove('skeleton-text'); }
  if (statPending) { statPending.textContent = store.failures.filter(f => !f.resolvedAt).length; statPending.classList.remove('skeleton-text'); }
  if (statProcessing) { statProcessing.textContent = store.jobs.filter(j => j.status === 'PROCESSING').length; statProcessing.classList.remove('skeleton-text'); }

  updateWeeklyChart();

  // Recent failures
  const failuresContainer = document.getElementById('recent-failures-list');
  if (failuresContainer) {
    const pendingFailures = store.failures.filter(f => !f.resolvedAt).slice(0, 5);

    if (pendingFailures.length === 0) {
      failuresContainer.innerHTML = `
        <div class="empty-state small">
          ${DUCK_SVG}
          <p>No hay fallos pendientes</p>
        </div>
      `;
    } else {
      failuresContainer.innerHTML = pendingFailures.map(renderFailureItem).join('');
    }
  }

  // Recent jobs
  const jobsContainer = document.getElementById('recent-jobs-list');
  if (jobsContainer) {
    const recentJobs = store.jobs.slice(0, 5);

    if (recentJobs.length === 0) {
      jobsContainer.innerHTML = `
        <div class="empty-state small">
          ${DUCK_SVG}
          <p>Sin trabajos recientes</p>
        </div>
      `;
    } else {
      jobsContainer.innerHTML = recentJobs.map(renderJobItem).join('');
    }
  }
}

function updateWeeklyChart() {
  const container = document.getElementById('weekly-chart');
  if (!container) return;

  const trends = store.trends || [];

  if (trends.length === 0) {
    container.innerHTML = '<div class="chart-empty">Sin datos disponibles</div>';
    return;
  }

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const maxTotal = Math.max(...trends.map(t => (t.completed || 0) + (t.failed || 0)), 1);

  // Build Y-axis gridlines
  const gridSteps = 4;
  const stepValue = Math.ceil(maxTotal / gridSteps);
  let gridHTML = '';
  for (let i = gridSteps; i >= 0; i--) {
    const val = stepValue * i;
    const pct = (val / (stepValue * gridSteps)) * 100;
    gridHTML += `<div class="chart-gridline" style="bottom: ${pct}%"><span class="chart-gridline-label">${val}</span></div>`;
  }

  const barsHTML = trends.map((trend, i) => {
    const completed = trend.completed || 0;
    const failed = trend.failed || 0;
    const created = trend.created || 0;
    const total = completed + failed;
    const completedH = (completed / (stepValue * gridSteps)) * 100;
    const failedH = (failed / (stepValue * gridSteps)) * 100;
    const isToday = i === trends.length - 1;

    const date = trend.date ? new Date(trend.date + 'T12:00:00') : null;
    const dayLabel = date ? dayNames[date.getDay()] : '';
    const dateLabel = trend.date ? trend.date.slice(5) : '';

    return `
      <div class="chart-col ${isToday ? 'today' : ''}">
        <div class="chart-tooltip">
          <strong>${dateLabel}</strong>
          <span class="tt-row"><span class="tt-dot tt-completed"></span>Completados: ${completed}</span>
          <span class="tt-row"><span class="tt-dot tt-failed"></span>Fallidos: ${failed}</span>
          <span class="tt-row tt-muted">Creados: ${created}</span>
        </div>
        <div class="chart-bar-stack">
          ${failed > 0 ? `<div class="chart-bar failed" style="height: ${failedH}%"></div>` : ''}
          ${completed > 0 ? `<div class="chart-bar completed" style="height: ${completedH}%"></div>` : ''}
          ${total === 0 ? '<div class="chart-bar empty"></div>' : ''}
        </div>
        <span class="chart-day-label">${dayLabel}</span>
        <span class="chart-date-label">${dateLabel}</span>
      </div>
    `;
  }).join('');

  // Summary line
  const totalCompleted = trends.reduce((s, t) => s + (t.completed || 0), 0);
  const totalFailed = trends.reduce((s, t) => s + (t.failed || 0), 0);
  const totalCreated = trends.reduce((s, t) => s + (t.created || 0), 0);

  container.innerHTML = `
    <div class="chart-summary">
      <span class="chart-summary-item"><span class="tt-dot tt-completed"></span>${totalCompleted} completados</span>
      <span class="chart-summary-item"><span class="tt-dot tt-failed"></span>${totalFailed} fallidos</span>
      <span class="chart-summary-item chart-summary-muted">${totalCreated} creados</span>
    </div>
    <div class="chart-area">
      <div class="chart-grid">${gridHTML}</div>
      <div class="chart-bars">${barsHTML}</div>
    </div>
  `;
}
