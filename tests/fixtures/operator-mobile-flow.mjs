#!/usr/bin/env node
// Drive operator-mobile (Expo web) through every tab and the failure-approve flow.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('tests/fixtures/screenshots/operator-mobile-flow');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();

let step = 0;
const snap = async (name) => {
  step += 1;
  const out = path.join(outDir, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  📸 ${name}`);
};

page.on('pageerror', (e) => console.log(`  [crash] ${e.message}`));

console.log('=== Operator-mobile flow ===');
await page.goto('http://localhost:8082', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
await snap('dashboard');

// Click each bottom-tab and snapshot
const tabs = ['Fallos', 'Chats', 'Jobs', 'Mas'];
for (const t of tabs) {
  const el = page.getByText(t, { exact: true }).first();
  if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
    await el.click({ force: true });
    await page.waitForTimeout(2000);
    await snap(`tab-${t.toLowerCase()}`);
  } else {
    console.log(`  ! tab ${t} not visible`);
  }
}

// Back to Fallos to interact with a failure
const fallosTab = page.getByText('Fallos', { exact: true }).first();
if (await fallosTab.isVisible().catch(() => false)) {
  await fallosTab.click({ force: true });
  await page.waitForTimeout(2000);
}

// Click the first failure card
const failureCard = page.locator('text=/e2e_user/').first();
if (await failureCard.isVisible({ timeout: 4000 }).catch(() => false)) {
  await failureCard.click({ force: true });
  await page.waitForTimeout(2500);
  await snap('failure-detail');

  // Look for approve button (label can be "APROBAR", "Aprobar", etc.)
  const approve = page.getByText(/aprobar/i, { exact: false }).first();
  if (await approve.isVisible({ timeout: 2000 }).catch(() => false)) {
    await snap('failure-detail-approve-visible');
    await approve.click({ force: true });
    await page.waitForTimeout(2000);
    await snap('after-approve-tap');
    // Confirm in modal if there is one
    const confirm = page.getByText(/confirmar|APROBAR/i).last();
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirm.click({ force: true });
      await page.waitForTimeout(3000);
      await snap('after-approve-confirmed');
    }
  } else {
    console.log('  ! approve button not found on failure detail');
  }
} else {
  console.log('  ! no failure cards visible');
}

// Try Mas → settings / extensions / wallets
const masTab = page.getByText('Mas', { exact: true }).first();
if (await masTab.isVisible().catch(() => false)) {
  await masTab.click({ force: true });
  await page.waitForTimeout(2000);
  await snap('mas-menu');
}

// Visit dashboard tab again to see if stats updated
const dashTab = page.getByText('Inicio', { exact: true }).first();
if (await dashTab.isVisible().catch(() => false)) {
  await dashTab.click({ force: true });
  await page.waitForTimeout(2000);
  await snap('dashboard-final');
}

await ctx.close();
await browser.close();
console.log('=== Done ===');
