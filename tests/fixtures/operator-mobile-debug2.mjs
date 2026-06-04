import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();

// Intercept socket.io handshake to see the actual apiKey
await page.route('**/socket.io/**', (route) => {
  const url = route.request().url();
  console.log('  [WS]', url);
  route.continue();
});

await page.goto('http://localhost:8082', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Read the embedded constants from the loaded bundle
const constants = await page.evaluate(() => {
  // Find any global with the URL/Key strings
  const scripts = Array.from(document.scripts).map((s) => s.src).filter(Boolean);
  return {
    scripts: scripts.length,
    bundle: scripts.find((s) => s.includes('entry')),
    // Search for the embedded api key in any inline string
    pageText: (window as any).__INITIAL_APP_CONFIG__,
  };
});
console.log('\nBundle info:', constants);

await ctx.close();
await browser.close();
