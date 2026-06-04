#!/usr/bin/env node
// Mock automation bot. Connects to backend /bot namespace as panelId=e2e-panel-1.
// - Responds to `search_user` with discovery_result(found=true).
// - Responds to `new_job` with an ACK, then emits `job_status` COMPLETED after 1s.
// - Sends heartbeats every 30s.

import { io } from 'socket.io-client';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3005';
const API_KEY = process.env.BOT_API_KEY || 'Narciso';
const PANEL_ID = process.env.PANEL_ID || 'e2e-panel-1';

const socket = io(`${BACKEND}/bot`, {
  query: { apiKey: API_KEY, panelId: PANEL_ID },
  auth: { apiKey: API_KEY, panelId: PANEL_ID },
  transports: ['websocket'],
  reconnection: true,
});

socket.on('connect', () => {
  console.log(`[mock-bot] connected: ${socket.id} (panel=${PANEL_ID})`);
  // Initial heartbeat so backend marks us online
  socket.emit('heartbeat', { status: 'online', timestamp: new Date().toISOString() });
  setInterval(() => {
    socket.emit('heartbeat', { status: 'online', timestamp: new Date().toISOString() });
  }, 30_000);
});

socket.on('connect_error', (err) => console.error('[mock-bot] connect_error:', err.message));
socket.on('disconnect', (reason) => console.warn('[mock-bot] disconnected:', reason));

socket.on('connected', (d) => console.log('[mock-bot] ack:', d));

// Discovery: backend asks "does panelId have targetUsername?"
socket.on('search_user', (data) => {
  console.log(`[mock-bot] search_user:`, data);
  // Pretend the user exists on this panel
  setTimeout(() => {
    socket.emit('discovery_result', {
      taskId: data.taskId,
      panelId: PANEL_ID,
      found: true,
    });
    console.log(`[mock-bot] discovery_result sent: taskId=${data.taskId} found=true`);
  }, 500);
});

// Job dispatch
socket.on('new_job', async (job, ack) => {
  console.log(`[mock-bot] new_job:`, job?.id, job?.type, job?.targetUsername, job?.amount);
  // ACK so dispatcher marks as accepted
  if (typeof ack === 'function') ack({ accepted: true });

  // Notify started (HTTP)
  try {
    await fetch(`${BACKEND}/api/bot/jobs/${job.id}/started`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-api-key': API_KEY },
      body: JSON.stringify({ startedAt: new Date().toISOString() }),
    });
  } catch (e) { console.error('[mock-bot] started POST failed:', e.message); }

  // Simulate processing → POST result
  setTimeout(async () => {
    try {
      const res = await fetch(`${BACKEND}/api/bot/jobs/${job.id}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': API_KEY },
        body: JSON.stringify({ success: true, duration: 1500 }),
      });
      const body = await res.text();
      console.log(`[mock-bot] job result POST -> ${res.status} ${body.substring(0, 200)}`);
    } catch (e) {
      console.error('[mock-bot] result POST failed:', e.message);
    }
  }, 1500);
});

// Create user (in case panel asks)
socket.on('create_user', (data) => {
  console.log(`[mock-bot] create_user:`, data);
  setTimeout(() => {
    socket.emit('create_user_result', {
      taskId: data.taskId || data.id,
      success: true,
      username: data.targetUsername,
    });
  }, 500);
});

socket.on('check_balance', (data) => {
  console.log(`[mock-bot] check_balance:`, data);
  socket.emit('balance_result', { balance: 99999, timestamp: new Date().toISOString() });
});

socket.on('kill_switch', (d) => console.log('[mock-bot] kill_switch:', d));
socket.on('reset_circuit_breaker', (d) => console.log('[mock-bot] reset_circuit_breaker:', d));

console.log(`[mock-bot] connecting to ${BACKEND}/bot ...`);
