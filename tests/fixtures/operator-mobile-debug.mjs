#!/usr/bin/env node
// Inspect operator-mobile socket state at runtime.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'log' || m.type() === 'error') {
    console.log(`  [${m.type()}] ${m.text().substring(0, 200)}`);
  }
});

await page.goto('http://localhost:8082', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(8000);

// Inspect store state via window
const state = await page.evaluate(() => {
  // Zustand stores expose getState via window when in dev
  // Try several keys
  const keys = Object.keys(window).filter((k) => k.toLowerCase().includes('store') || k.toLowerCase().includes('zustand'));
  return {
    keys,
    location: window.location.href,
    apiUrl: window.EXPO_PUBLIC_DEFAULT_API_URL,
  };
});
console.log('\nWindow inspection:', state);

await ctx.close();
await browser.close();
