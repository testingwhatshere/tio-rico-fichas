// renderer/views/preload-users.js — Bulk import of preloaded client users from CSV
// CSV columns: username, phone, panelId (panelId optional)
// On import: server creates/updates User with isPreloaded=true. At login time the
// phone is locked — clientAuth rejects mismatched phones for preloaded users.

import { escapeHtml, showToast } from '../utils.js';

let parsedEntries = [];

/**
 * Split one CSV line respecting double-quoted fields (Google Contacts uses quotes
 * when a field has commas inside).
 */
function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

/** Strip emojis, leading symbols, accents; keep [a-z0-9_]. */
function normalizeUsername(s) {
  if (!s) return '';
  return s
    .normalize('NFD')                          // decompose accents (é → e + ́)
    .replace(/[̀-ͯ]/g, '')           // strip combining diacritical marks
    .replace(/[^a-zA-Z0-9_]/g, '')             // strip emojis, spaces, symbols, ⭐
    .toLowerCase();
}

/**
 * Parse a CSV blob. Supports two formats:
 *   A) Plain: username,phone,panelId   (panelId optional)
 *   B) Google Contacts export: First Name in col 0 (may include "⭐ "),
 *      Phone 1 - Value in the LAST column with "+54..." format.
 */
function parseCSV(text) {
  const errors = [];
  const entries = [];
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { entries, errors };

  // Detect Google Contacts format by header
  const header = (lines[0] || '').toLowerCase();
  const isGoogle = header.includes('first name') && header.includes('phone');
  // Detect plain header
  const isPlainHeader =
    header.includes('username') && (header.includes('phone') || header.includes('tel'));
  const startIdx = isGoogle || isPlainHeader ? 1 : 0;

  // For Google Contacts: find phone column index
  let phoneColIdx = -1;
  if (isGoogle) {
    const headerCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
    phoneColIdx = headerCells.findIndex((c) => /phone\s*1\s*-\s*value/.test(c));
    if (phoneColIdx === -1) {
      // Fallback: last column
      phoneColIdx = headerCells.length - 1;
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cells = splitCsvLine(raw);
    let username, phone, panelId;

    if (isGoogle) {
      // First Name → username, Phone 1 - Value → phone, no panelId from Google
      username = (cells[0] || '').trim();
      phone = (cells[phoneColIdx] || '').trim();
      panelId = undefined;
    } else {
      [username, phone, panelId] = cells.map((c) => c.trim());
    }

    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername || cleanUsername.length < 3) {
      errors.push({ row: i + 1, error: `Username inválido tras limpiar: "${username}"` });
      continue;
    }
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      errors.push({ row: i + 1, error: `Teléfono inválido: "${phone}"` });
      continue;
    }
    entries.push({
      username: cleanUsername,
      phone: cleanPhone,
      panelId: (panelId || '').trim() || undefined,
    });
  }
  return { entries, errors };
}

export async function initPreloadUsersView() {
  // Wire CSV picker
  const pickBtn = document.getElementById('preload-pick-btn');
  const fileInput = document.getElementById('preload-csv-input');
  const filenameSpan = document.getElementById('preload-filename');
  const previewBox = document.getElementById('preload-preview');
  const previewList = document.getElementById('preload-preview-list');
  const previewCount = document.getElementById('preload-preview-count');
  const submitBtn = document.getElementById('preload-submit-btn');
  const resultBox = document.getElementById('preload-result');
  const refreshBtn = document.getElementById('preload-refresh-btn');

  if (pickBtn && !pickBtn._hasListener) {
    pickBtn.addEventListener('click', () => fileInput?.click());
    pickBtn._hasListener = true;
  }

  if (fileInput && !fileInput._hasListener) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (filenameSpan) filenameSpan.textContent = file.name;
      try {
        const text = await file.text();
        const { entries, errors } = parseCSV(text);
        parsedEntries = entries;
        previewBox?.classList.remove('hidden');
        if (previewCount) previewCount.textContent = String(entries.length);
        if (previewList) {
          const validHtml = entries
            .slice(0, 50)
            .map(
              (e) =>
                `<div>${escapeHtml(e.username)} · ${escapeHtml(e.phone)}${e.panelId ? ' · panel=' + escapeHtml(e.panelId) : ''}</div>`,
            )
            .join('');
          const errorsHtml = errors.length
            ? `<div style="color:#fca5a5; margin-top:6px;">${errors.length} línea(s) con errores</div>` +
              errors
                .slice(0, 10)
                .map((e) => `<div style="color:#fca5a5;">fila ${e.row}: ${escapeHtml(e.error)}</div>`)
                .join('')
            : '';
          previewList.innerHTML = (validHtml || '<div style="color:#94a3b8;">Sin filas válidas</div>') + errorsHtml;
        }
        if (submitBtn) submitBtn.disabled = entries.length === 0;
        resultBox?.classList.add('hidden');
      } catch (err) {
        showToast('Error al leer el archivo', 'error');
        console.error(err);
      }
    });
    fileInput._hasListener = true;
  }

  if (submitBtn && !submitBtn._hasListener) {
    submitBtn.addEventListener('click', async () => {
      if (parsedEntries.length === 0) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Importando...';
      try {
        const result = await window.api.bulkImportPreloaded(parsedEntries);
        if (result?.success === false || result?.error) {
          throw new Error(result?.error || 'Error desconocido');
        }
        const data = result?.data || result;
        if (resultBox) {
          resultBox.classList.remove('hidden');
          resultBox.style.background = 'rgba(74,222,128,0.1)';
          resultBox.innerHTML = `
            <div style="color:#4ade80;"><b>Importación exitosa</b></div>
            <div style="font-size:0.85rem; margin-top:4px;">Nuevos: ${data.created} · Actualizados: ${data.updated} · Errores: ${data.errors?.length || 0}</div>
            ${(data.errors || [])
              .slice(0, 10)
              .map(
                (e) =>
                  `<div style="color:#fca5a5; font-size:0.8rem;">fila ${e.row} (${escapeHtml(e.username || '?')}): ${escapeHtml(e.error)}</div>`,
              )
              .join('')}
          `;
        }
        showToast(`Importados ${data.created + data.updated} usuarios`, 'success');
        // Reset and refresh list
        parsedEntries = [];
        if (fileInput) fileInput.value = '';
        if (filenameSpan) filenameSpan.textContent = 'Ningún archivo seleccionado';
        previewBox?.classList.add('hidden');
        await loadPreloadedList();
      } catch (err) {
        if (resultBox) {
          resultBox.classList.remove('hidden');
          resultBox.style.background = 'rgba(248,113,113,0.1)';
          resultBox.innerHTML = `<div style="color:#f87171;"><b>Error:</b> ${escapeHtml(err.message)}</div>`;
        }
        showToast('Error en la importación', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Importar al sistema';
      }
    });
    submitBtn._hasListener = true;
  }

  if (refreshBtn && !refreshBtn._hasListener) {
    refreshBtn.addEventListener('click', () => loadPreloadedList());
    refreshBtn._hasListener = true;
  }

  await loadPreloadedList();
}

async function loadPreloadedList() {
  const listEl = document.getElementById('preload-list');
  const countEl = document.getElementById('preload-count');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state"><p>Cargando...</p></div>';
  try {
    const result = await window.api.listPreloadedUsers();
    const data = result?.data || result || [];
    const list = Array.isArray(data) ? data : [];
    if (countEl) countEl.textContent = String(list.length);
    if (list.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>No hay usuarios pre-cargados todavía.</p></div>';
      return;
    }
    listEl.innerHTML = list
      .map(
        (u) => `
        <div style="display:flex; align-items:center; padding:10px; border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="flex:1;">
            <div style="font-weight:600;">${escapeHtml(u.username || '-')}</div>
            <div style="font-size:0.8rem; color:#94a3b8;">${escapeHtml(u.phone || '-')}${u.panelId ? ' · panel ' + escapeHtml(u.panelId) : ''}</div>
          </div>
          <button data-unflag-id="${escapeHtml(u.id)}" class="btn btn-secondary btn-sm">Quitar</button>
        </div>
      `,
      )
      .join('');
    listEl.querySelectorAll('button[data-unflag-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-unflag-id');
        if (!id) return;
        if (!confirm('¿Quitar de la lista de pre-cargados?')) return;
        try {
          await window.api.unflagPreloadedUser(id);
          showToast('Quitado de pre-cargados', 'success');
          await loadPreloadedList();
        } catch (err) {
          showToast('Error al quitar', 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state"><p style="color:#f87171;">Error: ${escapeHtml(err.message || 'desconocido')}</p></div>`;
  }
}
