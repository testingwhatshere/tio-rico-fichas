#!/usr/bin/env node
/**
 * Script para testear la comunicación con el bot.
 * Conecta al backend via Socket.IO y envía eventos de prueba.
 *
 * Uso:
 *   node scripts/test-bot-events.js [comando]
 *
 * Comandos:
 *   status     - Ver estado del bot
 *   search     - Enviar search_user de prueba
 *   create     - Enviar create_user de prueba
 *   job        - Crear un job QUEUED y forzar dispatch
 *   ping       - Ping al bot via WebSocket
 *
 * Variables de entorno:
 *   BACKEND_URL  - URL del backend (default: https://tiorico-api.onrender.com)
 *   BOT_API_KEY  - API key del bot
 *   PANEL_ID     - Panel ID
 */

const BACKEND_URL = process.env.BACKEND_URL || 'https://tiorico-api.onrender.com';
const BOT_API_KEY = process.env.BOT_API_KEY || '';
const PANEL_ID = process.env.PANEL_ID || '';
const TARGET_USERNAME = process.argv[3] || 'test_user_' + Date.now();
const COMMAND = process.argv[2] || 'status';

async function main() {
  console.log(`Backend: ${BACKEND_URL}`);
  console.log(`Command: ${COMMAND}`);
  console.log(`Target: ${TARGET_USERNAME}`);
  console.log('---');

  const headers = {
    'Content-Type': 'application/json',
    'X-Bot-API-Key': BOT_API_KEY,
  };
  if (PANEL_ID) headers['X-Panel-Id'] = PANEL_ID;

  if (COMMAND === 'status') {
    // Check bot health
    const res = await fetch(`${BACKEND_URL}/api/bot/health`, { headers });
    console.log('Bot health:', res.status, await res.json());

    // Check bot status
    const res2 = await fetch(`${BACKEND_URL}/api/bot/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'ping', timestamp: new Date().toISOString() }),
    });
    console.log('Bot status endpoint:', res2.status, await res2.text());
  }

  else if (COMMAND === 'search') {
    // Trigger discovery via HTTP
    console.log(`Searching for user "${TARGET_USERNAME}" via bot endpoints...`);
    const res = await fetch(`${BACKEND_URL}/api/bot/discovery/test-${Date.now()}/result`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ found: false }),
    });
    console.log('Discovery result endpoint:', res.status, await res.text());
  }

  else if (COMMAND === 'create') {
    console.log(`Testing create-user endpoint for "${TARGET_USERNAME}"...`);
    const res = await fetch(`${BACKEND_URL}/api/bot/create-user/test-${Date.now()}/result`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ success: true, targetUsername: TARGET_USERNAME, password: '123casino' }),
    });
    console.log('Create user result endpoint:', res.status, await res.text());
  }

  else if (COMMAND === 'jobs') {
    // List pending jobs
    const res = await fetch(`${BACKEND_URL}/api/bot/jobs/next`, { headers });
    console.log('Next job:', res.status, await res.json().catch(() => 'no json'));
  }

  else if (COMMAND === 'http-test') {
    // Test all bot HTTP endpoints to see which work
    const endpoints = [
      { method: 'GET', path: '/api/bot/health' },
      { method: 'POST', path: '/api/bot/status', body: { status: 'test' } },
      { method: 'POST', path: '/api/bot/heartbeat', body: { timestamp: new Date().toISOString() } },
      { method: 'GET', path: '/api/bot/jobs/next' },
    ];

    for (const ep of endpoints) {
      try {
        const opts = { method: ep.method, headers };
        if (ep.body) opts.body = JSON.stringify(ep.body);
        const res = await fetch(`${BACKEND_URL}${ep.path}`, opts);
        const body = await res.text().catch(() => '');
        console.log(`${ep.method} ${ep.path}: ${res.status} ${res.statusText} ${body.substring(0, 200)}`);
      } catch (err) {
        console.log(`${ep.method} ${ep.path}: ERROR ${err.message}`);
      }
    }
  }

  else {
    console.log('Comandos: status, search, create, jobs, http-test');
  }
}

main().catch(console.error);
