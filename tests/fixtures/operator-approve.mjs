#!/usr/bin/env node
// Simulate operator clicking "approve" on a failed request, like a human would do
// from the operator panel. Uses the same Socket.IO actions main.js exposes via IPC.
import { io } from 'socket.io-client';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3005';
const OP_API_KEY = process.env.OPERATOR_API_KEY || 'Narciso';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const FAILURE_ID = process.env.FAILURE_ID;

if (!ADMIN_TOKEN || !FAILURE_ID) {
  console.error('Need ADMIN_TOKEN and FAILURE_ID env vars');
  process.exit(1);
}

const socket = io(`${BACKEND}/operator`, {
  auth: { token: ADMIN_TOKEN, apiKey: OP_API_KEY, operatorName: 'e2e-admin' },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log(`[operator] connected: ${socket.id}`);
  socket.emit('get_initial_data', {}, (res) => {
    console.log(`[operator] initial: failures=${res?.data?.failures?.length || 0}`);
    socket.emit('approve_failure', { failureId: FAILURE_ID, note: 'manual approval E2E' }, (ack) => {
      console.log(`[operator] approve_failure ack:`, JSON.stringify(ack));
      setTimeout(() => { socket.disconnect(); process.exit(0); }, 500);
    });
  });
});
socket.on('connect_error', (e) => console.error('connect_error:', e.message));
socket.on('failure_resolved', (d) => console.log('failure_resolved:', JSON.stringify(d).substring(0, 200)));
socket.on('error', (e) => console.error('error:', e));
