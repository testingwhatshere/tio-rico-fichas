#!/usr/bin/env node
// Capture screenshots of every URL in the E2E setup using playwright-core directly
// (independent of the MCP browser). Produces tests/fixtures/screenshots/e2e-*.png
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('tests/fixtures/screenshots');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'chat-app-login',         url: 'http://localhost:8081',                   wait: 'networkidle' },
  { name: 'operator-mobile-home',   url: 'http://localhost:8082',                   wait: 'networkidle' },
  { name: 'landing-page',           url: 'http://localhost:8090',                   wait: 'domcontentloaded' },
  { name: 'sales-page',             url: 'http://localhost:8091',                   wait: 'domcontentloaded' },
  { name: 'onboarding-portal',      url: 'http://localhost:8092',                   wait: 'domcontentloaded' },
  { name: 'owner-dashboard',        url: 'http://localhost:3005/dashboard/',        wait: 'domcontentloaded' },
];

// Also connect to existing Electron apps via CDP
const cdpTargets = [
  { name: 'operator-panel-dashboard', port: 9222 },
  { name: 'validator-app',            port: 9223 },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

const results = [];

for (const t of targets) {
  const page = await ctx.newPage();
  try {
    await page.goto(t.url, { waitUntil: t.wait, timeout: 30000 });
    await page.waitForTimeout(1500);
    const out = path.join(outDir, `e2e-${t.name}.png`);
    await page.screenshot({ path: out, fullPage: false });
    const title = await page.title();
    const bodyHead = await page.evaluate(() => (document.body?.innerText || '').substring(0, 400)).catch(() => '');
    results.push({ name: t.name, ok: true, title, bodyHead, file: out });
    console.log(`✅ ${t.name} → ${out}`);
  } catch (e) {
    results.push({ name: t.name, ok: false, error: e.message });
    console.log(`❌ ${t.name} → ${e.message}`);
  }
  await page.close();
}

for (const t of cdpTargets) {
  try {
    const cdp = await chromium.connectOverCDP(`http://localhost:${t.port}`);
    const c = cdp.contexts()[0];
    const p = c.pages()[0];
    if (!p) { console.log(`⚠ ${t.name}: no page`); continue; }
    const out = path.join(outDir, `e2e-${t.name}.png`);
    await p.screenshot({ path: out, fullPage: false });
    const title = await p.title().catch(() => '');
    const bodyHead = await p.evaluate(() => (document.body?.innerText || '').substring(0, 400)).catch(() => '');
    results.push({ name: t.name, ok: true, title, bodyHead, file: out });
    console.log(`✅ ${t.name} → ${out}`);
    await cdp.close();
  } catch (e) {
    results.push({ name: t.name, ok: false, error: e.message });
    console.log(`❌ ${t.name} → ${e.message}`);
  }
}

await browser.close();
fs.writeFileSync(path.join(outDir, 'e2e-summary.json'), JSON.stringify(results, null, 2));
console.log(`\nSummary: ${results.filter(r => r.ok).length}/${results.length} ok`);
console.log(`Wrote ${path.join(outDir, 'e2e-summary.json')}`);
