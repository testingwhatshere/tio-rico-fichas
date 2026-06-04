#!/usr/bin/env node
// Connect to a running Electron app via CDP and capture screenshots + page state.
// Usage: node screenshot-electron.mjs <CDP_PORT> <OUTPUT_PREFIX>

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '9223';
const prefix = process.argv[3] || 'validator';
const outDir = path.resolve('tests/fixtures/screenshots');
fs.mkdirSync(outDir, { recursive: true });

const url = `http://localhost:${port}`;
console.log(`Connecting to CDP ${url} ...`);

const browser = await chromium.connectOverCDP(url);
const ctx = browser.contexts()[0];
if (!ctx) {
  console.error('No context');
  process.exit(1);
}
const pages = ctx.pages();
console.log(`Found ${pages.length} pages`);
for (const [i, page] of pages.entries()) {
  const title = await page.title().catch(() => 'unknown');
  console.log(`  [${i}] ${title} :: ${page.url().substring(0, 80)}`);
  const out = path.join(outDir, `${prefix}-${i}-${title.replace(/\s+/g, '_').substring(0, 30)}.png`);
  try {
    await page.screenshot({ path: out, fullPage: true });
    console.log(`      saved ${out}`);
  } catch (e) {
    console.log(`      screenshot failed: ${e.message}`);
  }
  // Dump basic page text
  const summaryPath = path.join(outDir, `${prefix}-${i}-summary.txt`);
  const summary = await page.evaluate(() => {
    const txt = document.body?.innerText || '';
    return {
      title: document.title,
      bodyLen: txt.length,
      bodyHead: txt.substring(0, 2000),
      buttons: Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim()).filter(Boolean),
      hasOllamaUI: !!document.querySelector('[class*="ollama"], [id*="ollama"]'),
      hasBotUI: !!document.querySelector('[class*="bot-"], [id*="bot-"]'),
    };
  }).catch((e) => ({ error: e.message }));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`      summary -> ${summaryPath}`);
}

await browser.close().catch(() => {});
console.log('Done.');
