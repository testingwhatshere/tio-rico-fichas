#!/usr/bin/env node
// Walk the prize-claim flow end-to-end:
//   USER  POST /api/prize-claims                              → PENDING_PAYMENT_DETAILS
//   USER  socket prize_claim:set_payment                      → PENDING_VERIFICATION → VERIFIED (mock)
//   OP    socket operator:process_prize_claim                 → PROCESSING → CHIPS_WITHDRAWN (mock-bot)
//   OP    POST   /api/prize-claims/:id/complete (payment ref) → COMPLETED
//
// Requires backend + mock-bot running on :3005.
import { io } from 'socket.io-client';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3005';

const j = async (url, opts = {}) => {
  const r = await fetch(`${BACKEND}${url}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await r.text();
  try { return { status: r.status, body: JSON.parse(body) }; } catch { return { status: r.status, body }; }
};

// 1. login as client
const clientLogin = await j('/api/auth/client', {
  method: 'POST',
  body: JSON.stringify({ username: 'e2e_user', phone: '1100000001' }),
});
const clientTok = clientLogin.body.accessToken;
console.log(`✓ client token`);

// 2. login as admin
const adminLogin = await j('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'op@e2e.local', password: 'test1234' }),
});
const adminTok = adminLogin.body.accessToken;
console.log(`✓ admin token`);

// 3. List pending claims (admin endpoint) to know starting state
const pending = await j('/api/prize-claims/pending', { headers: { Authorization: `Bearer ${adminTok}` } });
console.log(`(pending claims in system: ${Array.isArray(pending.body) ? pending.body.length : '?'})`);

// 4. CREATE prize claim — the new flow expects payment details up front
console.log('\n4) POST /api/prize-claims');
const created = await j('/api/prize-claims', {
  method: 'POST',
  headers: { Authorization: `Bearer ${clientTok}` },
  body: JSON.stringify({
    amount: 8000,
    paymentMethod: 'CBU',
    paymentDetails: { cbu: '0000003100000000000123', accountHolder: 'E2E Test User' },
  }),
});
console.log(`   status=${created.status} body=${JSON.stringify(created.body).substring(0, 200)}`);
if (created.status >= 400) {
  console.error('   ❌ failed to create — aborting');
  process.exit(1);
}
const claimId = created.body.id;
console.log(`   ✓ claim id=${claimId}`);

// 5. Poll claim status (admin endpoint to read it back)
console.log('\n5) poll claim status (waiting for verification)');
let claim;
for (let i = 1; i <= 20; i++) {
  const r = await j(`/api/prize-claims/${claimId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
  claim = r.body;
  console.log(`   [t+${i}s] status=${claim.status} verifiedBalance=${claim.verifiedBalance}`);
  if (['VERIFIED', 'VERIFICATION_FAILED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'].includes(claim.status)) break;
  await new Promise((res) => setTimeout(res, 1000));
}

// 6. Operator processes (VERIFIED → PROCESSING)
if (['VERIFIED', 'PENDING_VERIFICATION'].includes(claim.status)) {
  console.log('\n6) POST /api/prize-claims/:id/process (operator)');
  const processed = await j(`/api/prize-claims/${claimId}/process`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminTok}` },
  });
  console.log(`   status=${processed.status} body=${JSON.stringify(processed.body).substring(0, 200)}`);

  for (let i = 1; i <= 15; i++) {
    const r = await j(`/api/prize-claims/${claimId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    claim = r.body;
    console.log(`   [t+${i}s] status=${claim.status}`);
    if (['CHIPS_WITHDRAWN', 'COMPLETED', 'FAILED', 'REJECTED'].includes(claim.status)) break;
    await new Promise((res) => setTimeout(res, 1000));
  }

  // 7. Operator completes (CHIPS_WITHDRAWN → COMPLETED)
  if (claim.status === 'CHIPS_WITHDRAWN') {
    console.log('\n7) POST /api/prize-claims/:id/complete');
    const completed = await j(`/api/prize-claims/${claimId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminTok}` },
    });
    console.log(`   status=${completed.status} body=${JSON.stringify(completed.body).substring(0, 200)}`);
  } else {
    console.log(`\n(skipping complete — claim ended at ${claim.status})`);
  }
}

// 8. Final state
const final = await j(`/api/prize-claims/${claimId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
console.log(`\nFINAL: status=${final.body.status}, amount=${final.body.amount}, verifiedBalance=${final.body.verifiedBalance}`);
process.exit(0);
