#!/usr/bin/env node
// Click the first failure card in operator-panel and screenshot the detail/modal.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '9222';
const outDir = path.resolve('tests/fixtures/screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const page = browser.contexts()[0].pages()[0];

// First click sidebar "Fallos"
await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('button, li, div, a'));
  for (const el of els) {
    if (el.textContent?.trim() === 'Fallos' && el.offsetParent !== null) {
      el.click();
      return true;
    }
  }
  return false;
});
await page.waitForTimeout(500);

// Click the first failure card
const clicked = await page.evaluate(() => {
  const cards = document.querySelectorAll('[class*="failure"], [class*="card"]');
  for (const c of cards) {
    const txt = c.textContent || '';
    if (txt.includes('Baja confianza') || txt.includes('OCR no pudo')) {
      c.click();
      return txt.substring(0, 80);
    }
  }
  return null;
});
console.log(`clicked failure: ${clicked || 'NONE'}`);
await page.waitForTimeout(1000);

const out = path.join(outDir, 'operator-failure-detail.png');
await page.screenshot({ path: out, fullPage: true });
console.log(`saved ${out}`);

const summary = await page.evaluate(() => ({
  title: document.title,
  bodyHead: (document.body?.innerText || '').substring(0, 2500),
  modalOpen: !!document.querySelector('[class*="modal"][class*="open"], [class*="dialog"][open], .modal-overlay:not([hidden])'),
}));
fs.writeFileSync(out.replace('.png', '-summary.txt'), JSON.stringify(summary, null, 2));

await browser.close().catch(() => {});
console.log('Done.');
