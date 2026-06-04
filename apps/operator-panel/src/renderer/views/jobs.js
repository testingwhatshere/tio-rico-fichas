// renderer/views/jobs.js — Jobs view: list, retry

import { store } from '../state.js';
import { JOB_STATUS_CONFIG, DUCK_SVG } from '../constants.js';
import { escapeHtml, formatAmount, getTimeAgo, showToast } from '../utils.js';

export function renderJobsList(filter = 'all') {
  const container = document.getElementById('jobs-list');
  let jobs = store.jobs;

  if (filter === 'processing') jobs = jobs.filter(j => j.status === 'PROCESSING' || j.status === 'QUEUED');
  else if (filter === 'completed') jobs = jobs.filter(j => j.status === 'COMPLETED');
  else if (filter === 'failed') jobs = jobs.filter(j => j.status === 'FAILED');

  // Search filter
  const searchInput = document.getElementById('jobs-search');
  const searchTerm = (searchInput?.value || '').trim().toLowerCase();
  if (searchTerm) {
    jobs = jobs.filter(j =>
      (j.targetUsername || j.request?.targetUsername || '').toLowerCase().includes(searchTerm) ||
      (j.amount?.toString() || j.request?.amount?.toString() || '').includes(searchTerm)
    );
  }

  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        ${DUCK_SVG}
        <p>No hay trabajos</p>
        <span class="empty-state-hint">La cola esta vac\u00eda</span>
      </div>
    `;
    return;
  }

  container.innerHTML = jobs.map(renderJobItem).join('');
}

export function renderJobItem(job) {
  const config = JOB_STATUS_CONFIG[job.status] || JOB_STATUS_CONFIG.QUEUED;
  const username = job.targetUsername || job.request?.targetUsername || 'Usuario';
  const amount = job.amount || job.request?.amount || 0;

  return `
    <div class="job-item ${config.class}">
      <div class="job-status-icon ${config.class}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="${config.icon}"/>
        </svg>
      </div>
      <div class="job-content">
        <span class="job-username">${escapeHtml(username)}</span>
        <span class="job-amount">$${formatAmount(amount)}</span>
      </div>
      <span class="job-status-badge ${config.class}">${escapeHtml(job.status)}</span>
      <span class="job-time">${getTimeAgo(job.createdAt)}</span>
      ${job.status === 'FAILED' ? `
        <button class="btn btn-sm btn-ghost job-retry-btn" onclick="retryJob('${job.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
        </button>
      ` : ''}
    </div>
  `;
}

export async function retryJob(jobId) {
  const result = await window.api.retryJob(jobId);
  if (result.success) {
    showToast('Trabajo reintentado', 'success');
    renderJobsList();
  } else {
    showToast('Error: ' + (result.error || 'No se pudo reintentar'), 'error');
  }
}
