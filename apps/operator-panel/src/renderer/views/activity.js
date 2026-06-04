// renderer/views/activity.js — Activity log view

import { getActivityLog } from '../state.js';
import { ACTION_ICONS } from '../constants.js';
import { escapeHtml, getTimeAgo } from '../utils.js';

export function renderActivityList(filter = 'all') {
  const container = document.getElementById('activity-list');
  let activities = getActivityLog();

  if (filter === 'failures') {
    activities = activities.filter(a => a.action.includes('FAILURE') || a.action.includes('VALIDATION'));
  } else if (filter === 'jobs') {
    activities = activities.filter(a => a.action.includes('JOB'));
  } else if (filter === 'chats') {
    activities = activities.filter(a => a.action.includes('CHAT') || a.action.includes('MESSAGE'));
  }

  if (activities.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
        </svg>
        <p>No hay actividad registrada</p>
      </div>
    `;
    return;
  }

  container.innerHTML = activities.map(renderActivityItem).join('');
}

function renderActivityItem(entry) {
  const icon = ACTION_ICONS[entry.action] || '\u{1F4CB}';
  const details = entry.details ? Object.entries(entry.details)
    .filter(([k, v]) => v)
    .map(([k, v]) => `${escapeHtml(String(k))}: ${escapeHtml(String(v))}`)
    .join(' \u2022 ') : '';

  return `
    <div class="activity-item">
      <span class="activity-icon">${icon}</span>
      <div class="activity-content">
        <span class="activity-action">${escapeHtml(entry.action.replace(/_/g, ' '))}</span>
        ${details ? `<span class="activity-details">${details}</span>` : ''}
      </div>
      <span class="activity-time">${getTimeAgo(entry.timestamp)}</span>
    </div>
  `;
}
