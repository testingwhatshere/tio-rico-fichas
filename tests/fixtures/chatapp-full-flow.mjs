#!/usr/bin/env node
// Full chat-app user flow with Playwright. Goal: cover sign-up → home → load fichas →
// pick amount → upload proof → wait for COMPLETED, capturing every step.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('tests/fixtures/screenshots/full-flow');
fs.mkdirSync(outDir, { recursive: true });

// Make every run unique by copying a base proof to a randomized temp file (avoids
// the backend's "you already used this proof" dedup so the test can run repeatedly).
import crypto from 'node:crypto';
const baseProof = path.resolve('tests/fixtures/proofs/02_readable_with_noise.jpg');
const tmpDir = path.resolve('tests/fixtures/proofs/.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const PROOF_PATH = path.join(tmpDir, `e2e-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`);
fs.copyFileSync(baseProof, PROOF_PATH);
// Append a few random bytes so the file hash differs each run while staying a valid JPEG.
fs.appendFileSync(PROOF_PATH, crypto.randomBytes(64));
console.log(`Using fresh proof: ${path.basename(PROOF_PATH)}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});

const ctx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1',
  // Permissions for clipboard / file uploads
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();

let stepCounter = 0;
const snap = async (name) => {
  stepCounter += 1;
  const out = path.join(outDir, `${String(stepCounter).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  📸 ${name} → ${path.basename(out)}`);
};

// Forward browser console for debugging
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  [browser ERR] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`  [browser CRASH] ${e.message}`));

console.log('\n=== STEP 1: navigate to chat-app ===');
await page.goto('http://localhost:8081', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await snap('initial-login-or-home');

// If install prompt is visible, dismiss
const dismissPrompt = page.getByText('Ahora no').first();
if (await dismissPrompt.isVisible({ timeout: 2000 }).catch(() => false)) {
  await dismissPrompt.click();
  await page.waitForTimeout(500);
  console.log('  ✓ dismissed install prompt');
}

console.log('\n=== STEP 2: log in as e2e_user ===');
const userField = page.getByRole('textbox', { name: /juan_perez/i });
if (await userField.isVisible({ timeout: 5000 }).catch(() => false)) {
  await userField.fill('e2e_user');
  await page.getByRole('textbox', { name: /1155667788/i }).fill('1100000001');
  await snap('login-filled');
  await page.getByText('CONTINUAR', { exact: true }).click();
  await page.waitForTimeout(3000);
  console.log('  ✓ logged in');
}

// Skip onboarding if shown
const skip = page.getByText('Saltar').first();
if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) {
  await skip.click();
  await page.waitForTimeout(1500);
  console.log('  ✓ skipped onboarding');
}

await snap('home');

console.log('\n=== STEP 3: cancel any active request (clean slate) ===');
// Use the API to ensure we don't carry stale state
const token = await page.evaluate(async () => {
  const res = await fetch('http://localhost:3005/api/auth/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_user', phone: '1100000001' }),
  });
  return (await res.json()).accessToken;
});
const activeIds = await page.evaluate(async (tok) => {
  const res = await fetch('http://localhost:3005/api/requests', {
    headers: { Authorization: `Bearer ${tok}` },
  });
  const data = await res.json();
  const items = Array.isArray(data) ? data : data.data || [];
  return items
    .filter((r) => !['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED', 'VALIDATION_FAILED'].includes(r.status))
    .map((r) => r.id);
}, token);
for (const id of activeIds) {
  await page.evaluate(async ({ tok, id }) => {
    await fetch(`http://localhost:3005/api/requests/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    });
  }, { tok: token, id });
  console.log(`  ✓ cancelled stale request ${id}`);
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await snap('home-clean');

console.log('\n=== STEP 4: tap "Cargar Fichas" ===');
const cargar = page.getByText('Cargar Fichas').first();
await cargar.waitFor({ timeout: 5000 });
await cargar.click();
await page.waitForTimeout(2500);
await snap('chat-loaded');

console.log('\n=== STEP 5: select amount $5.000 ===');
// AMOUNT_SELECTOR card: tap on a preset button
const preset = page.getByText('$5.000', { exact: false }).first();
if (await preset.isVisible({ timeout: 5000 }).catch(() => false)) {
  await preset.click();
  await page.waitForTimeout(800);
  // The card may need CONTINUAR press
  const continuar = page.getByText('CONTINUAR', { exact: false }).first();
  if (await continuar.isVisible({ timeout: 2000 }).catch(() => false)) {
    await continuar.click({ force: true });
    console.log('  ✓ pressed CONTINUAR');
  }
  await page.waitForTimeout(3000);
}
await snap('amount-selected-payment-card');

console.log('\n=== STEP 6: tap "YA TRANSFERÍ, SUBIR COMPROBANTE" ===');
// The checkbox was removed — the button goes straight to the proof upload step.
const goProof = page.getByText('YA TRANSFERÍ', { exact: false }).first();
if (await goProof.isVisible({ timeout: 5000 }).catch(() => false)) {
  await goProof.click({ force: true });
  console.log('  ✓ advanced to proof step');
  await page.waitForTimeout(2500);
  await snap('proof-upload-step');
}

console.log('\n=== STEP 7: upload proof ===');
// ProofUploadCard.web.tsx hides the input. We surface every file input via DOM patch.
const fileInputCount = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  // Force every input visible + sized so Playwright's setInputFiles can find it.
  for (const i of inputs) {
    i.style.display = 'block';
    i.style.opacity = '1';
    i.style.position = 'fixed';
    i.style.top = '0';
    i.style.left = '0';
    i.style.width = '1px';
    i.style.height = '1px';
  }
  return inputs.length;
});
console.log(`  found ${fileInputCount} file inputs in DOM`);

if (fileInputCount > 0) {
  await page.locator('input[type="file"]').first().setInputFiles(PROOF_PATH);
  console.log(`  ✓ attached ${path.basename(PROOF_PATH)}`);
  await page.waitForTimeout(2000);
  await snap('proof-attached');

  // After attaching, the card switches to a state with a confirm button.
  // It's either "Enviar Comprobante" (footer, refactored) or "Confirmar" (inside the card)
  // depending on which path the app uses. Try both.
  const candidates = ['Enviar Comprobante', 'Confirmar', 'Enviar'];
  for (const label of candidates) {
    const btn = page.getByText(label, { exact: false }).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click({ force: true });
      console.log(`  ✓ clicked "${label}"`);
      break;
    }
  }
  await page.waitForTimeout(3000);
  await snap('proof-uploading-or-uploaded');
}

console.log('\n=== STEP 7: wait for VALIDATING → APPROVED → PROCESSING → COMPLETED ===');
let final = null;
for (let i = 1; i <= 30; i++) {
  await page.waitForTimeout(1000);
  const status = await page.evaluate(async (tok) => {
    const res = await fetch('http://localhost:3005/api/requests', { headers: { Authorization: `Bearer ${tok}` } });
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.data || [];
    return items[0]?.status || null;
  }, token);
  console.log(`  [t+${i}s] status: ${status}`);
  if (['APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'VALIDATION_FAILED'].includes(status)) {
    final = status;
    await snap(`status-${status}`);
  }
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'REJECTED' || status === 'VALIDATION_FAILED') break;
}

console.log(`\nFinal status: ${final}`);
await page.waitForTimeout(2500);
await snap('end-state');

console.log('\n=== STEP 8: check balance ===');
const balance = await page.evaluate(async (tok) => {
  const res = await fetch('http://localhost:3005/api/users/me/balance', {
    headers: { Authorization: `Bearer ${tok}` },
  });
  return await res.json();
}, token);
console.log('  balance:', JSON.stringify(balance));

await ctx.close();
await browser.close();
console.log('\n=== DONE ===');
console.log(`Screenshots: ${outDir}`);
