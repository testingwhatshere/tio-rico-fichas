#!/usr/bin/env node
// Mock validator that connects to backend /validator namespace.
// Replies to 'validate' with a score derived from the filename in proofUrl:
//   01_readable_clean    -> isValid:true,  confidence:0.95, extractedAmount = requested
//   02_readable_with_noise -> isValid:true, confidence:0.78, extractedAmount = requested
//   03_illegible_blur    -> isValid:false, confidence:0.30, no extractedAmount
//   04_wrong_amount      -> isValid:false, confidence:0.85, extractedAmount = requested+5000
//   05_non_proof         -> isValid:false, confidence:0.10
//   anything else        -> default valid 0.92
//
// Usage: VALIDATOR_API_KEY=... BACKEND_URL=http://localhost:3005 node mock-validator.mjs

import { io } from 'socket.io-client';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3005';
const API_KEY = process.env.VALIDATOR_API_KEY || 'Narciso';

const socket = io(`${BACKEND}/validator`, {
  auth: { apiKey: API_KEY },
  transports: ['websocket'],
  reconnection: true,
});

socket.on('connect', () => {
  console.log(`[mock-validator] connected: ${socket.id}`);
  // Send heartbeat every 30s
  setInterval(() => socket.emit('heartbeat', { timestamp: new Date().toISOString() }), 30_000);
});

socket.on('connected', (data) => {
  console.log('[mock-validator] backend ack:', data);
});

socket.on('connect_error', (err) => {
  console.error('[mock-validator] connect_error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.warn('[mock-validator] disconnected:', reason);
});

function classify(proofUrl, expectedAmount) {
  const url = (proofUrl || '').toLowerCase();
  if (url.includes('01_readable_clean')) return { isValid: true, confidence: 0.95, extractedAmount: expectedAmount };
  if (url.includes('02_readable_with_noise')) return { isValid: true, confidence: 0.78, extractedAmount: expectedAmount };
  if (url.includes('03_illegible_blur')) return { isValid: false, confidence: 0.30, extractedAmount: null };
  if (url.includes('04_wrong_amount')) return { isValid: false, confidence: 0.85, extractedAmount: (expectedAmount || 0) + 5000 };
  if (url.includes('05_non_proof')) return { isValid: false, confidence: 0.10, extractedAmount: null };
  return { isValid: true, confidence: 0.92, extractedAmount: expectedAmount };
}

socket.on('validate', (request) => {
  console.log(`[mock-validator] validate received: id=${request.id} requestId=${request.requestId} amount=${request.amount}`);
  const verdict = classify(request.proofUrl, request.amount);

  // Simulate small processing delay
  setTimeout(() => {
    const result = {
      id: request.id,
      requestId: request.requestId,
      isValid: verdict.isValid,
      confidence: verdict.confidence,
      extractedAmount: verdict.extractedAmount,
      extractedDate: new Date().toISOString(),
      paymentMethod: 'MERCADOPAGO',
      reasoning: `Mock validator verdict for ${request.proofUrl?.split('/').pop()}`,
      flags: verdict.isValid ? [] : ['MOCK_REJECTION'],
    };
    console.log(`[mock-validator] sending result:`, JSON.stringify(result));
    socket.emit('validation_result', result);
  }, 500);
});

console.log(`[mock-validator] connecting to ${BACKEND}/validator ...`);
