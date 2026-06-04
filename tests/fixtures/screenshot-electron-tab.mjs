#!/usr/bin/env node
// Connect to Electron CDP, click a sidebar item by text, screenshot.
// Usage: node screenshot-electron-tab.mjs <port> <prefix> <tabName>

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '9222';
const prefix = process.argv[3] || 'operator';
const tab = process.argv[4] || 'Fallos';
const outDir = path.resolve('tests/fixtures/screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const page = browser.contexts()[0].pages()[0];

const clicked = await page.evaluate((tabName) => {
  // Look for sidebar elements with matching text
  const els = Array.from(document.querySelectorAll('button, [class*="sidebar"] *, [class*="menu"] *, [class*="nav"] *, a, li, div'));
  for (const el of els) {
    if (el.textContent?.trim() === tabName && el.offsetParent !== null) {
      el.click();
      return true;
    }
  }
  return false;
}, tab);

console.log(`clicked "${tab}": ${clicked}`);
await page.waitForTimeout(800);

const safe = tab.replace(/[^a-zA-Z0-9]/g, '_');
const out = path.join(outDir, `${prefix}-tab-${safe}.png`);
await page.screenshot({ path: out, fullPage: true });
console.log(`saved ${out}`);

const summary = await page.evaluate(() => {
  return {
    title: document.title,
    bodyHead: (document.body?.innerText || '').substring(0, 1500),
    visibleButtons: Array.from(document.querySelectorAll('button'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => b.textContent?.trim())
      .filter(Boolean)
      .slice(0, 40),
  };
});
fs.writeFileSync(out.replace('.png', '-summary.txt'), JSON.stringify(summary, null, 2));

await browser.close().catch(() => {});
console.log('Done.');
