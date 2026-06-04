#!/usr/bin/env node
// Walk through the critical user flows end-to-end with Playwright + screenshots.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('tests/fixtures/screenshots/flows');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

const snapshot = async (page, name) => {
  const out = path.join(outDir, `${name}.png`);
  try {
    await page.screenshot({ path: out, fullPage: false });
    console.log(`  📸 ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
  }
};

// ============================================================================
// FLOW 1: CHAT-APP — user signup, tap Cargar Fichas, abrir chat, ver botones
// ============================================================================
console.log('\n=== Chat-app flow ===');
{
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Dismiss install prompt if present
    const dismiss = await page.locator('text=Ahora no').first();
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
      await page.waitForTimeout(500);
    }

    await snapshot(page, '01-chatapp-login');

    // Fill login form
    const userField = page.getByRole('textbox', { name: /juan_perez/i });
    const phoneField = page.getByRole('textbox', { name: /1155667788/i });
    if (await userField.isVisible().catch(() => false)) {
      await userField.fill('e2e_user');
      await phoneField.fill('1100000001');
      await snapshot(page, '02-chatapp-login-filled');
      const continuar = page.getByText('CONTINUAR', { exact: true });
      await continuar.click();
      await page.waitForTimeout(2500);
    }

    // Skip onboarding
    const skip = page.locator('text=Saltar').first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      await page.waitForTimeout(1500);
    }

    await snapshot(page, '03-chatapp-home');

    // Try clicking "Cargar Fichas"
    const cargar = page.locator('text=Cargar Fichas').first();
    if (await cargar.isVisible().catch(() => false)) {
      await cargar.click();
      await page.waitForTimeout(1500);
      await snapshot(page, '04-chatapp-chat');
    }

    // Try clicking WhatsApp (won't actually open external URL in test)
    const ws = page.locator('[accessibility-label="Hablar por WhatsApp"], [aria-label="Hablar por WhatsApp"]').first();
    if (await ws.isVisible().catch(() => false)) {
      await snapshot(page, '05-chatapp-chat-with-whatsapp-button');
    }

    // Check Cobrar Premio
    await page.goto('http://localhost:8081/home', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const cobrar = page.locator('text=Cobrar Premio').first();
    if (await cobrar.isVisible().catch(() => false)) {
      await cobrar.click();
      await page.waitForTimeout(1500);
      await snapshot(page, '06-chatapp-prize-claim');
    }

    console.log('  ✅ chat-app flow done');
  } catch (e) {
    console.log(`  ❌ chat-app flow: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

// ============================================================================
// FLOW 2: OPERATOR-MOBILE — login + nav
// ============================================================================
console.log('\n=== Operator-mobile flow ===');
{
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto('http://localhost:8082', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await snapshot(page, '10-operator-mobile-home');

    // Click "Fallos" tab in bottom nav
    const fallosTab = page.locator('text=Fallos').first();
    if (await fallosTab.isVisible().catch(() => false)) {
      await fallosTab.click();
      await page.waitForTimeout(1500);
      await snapshot(page, '11-operator-mobile-fallos');
    }

    const chatsTab = page.locator('text=Chats').first();
    if (await chatsTab.isVisible().catch(() => false)) {
      await chatsTab.click();
      await page.waitForTimeout(1500);
      await snapshot(page, '12-operator-mobile-chats');
    }

    const jobsTab = page.locator('text=Jobs').first();
    if (await jobsTab.isVisible().catch(() => false)) {
      await jobsTab.click();
      await page.waitForTimeout(1500);
      await snapshot(page, '13-operator-mobile-jobs');
    }

    const masTab = page.locator('text=Mas').first();
    if (await masTab.isVisible().catch(() => false)) {
      await masTab.click();
      await page.waitForTimeout(1500);
      await snapshot(page, '14-operator-mobile-mas');
    }

    console.log('  ✅ operator-mobile flow done');
  } catch (e) {
    console.log(`  ❌ operator-mobile flow: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

// ============================================================================
// FLOW 3: ONBOARDING-PORTAL — multi-step form
// ============================================================================
console.log('\n=== Onboarding portal ===');
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto('http://localhost:8092', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    await snapshot(page, '20-onboarding-step1');

    // Fill step 1
    const nombre = page.locator('input[placeholder*="Casino Royal"]').first();
    if (await nombre.isVisible().catch(() => false)) {
      await nombre.fill('Casino E2E');
      const corto = page.locator('input[placeholder*="CR"]').first();
      await corto.fill('E2E');
      await snapshot(page, '21-onboarding-step1-filled');
      const next = page.locator('text=Siguiente').first();
      if (await next.isVisible().catch(() => false)) {
        await next.click();
        await page.waitForTimeout(1000);
        await snapshot(page, '22-onboarding-step2');
      }
    }

    console.log('  ✅ onboarding flow done');
  } catch (e) {
    console.log(`  ❌ onboarding flow: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

// ============================================================================
// FLOW 4: OWNER-DASHBOARD login screen
// ============================================================================
console.log('\n=== Owner dashboard ===');
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto('http://localhost:3005/dashboard/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    await snapshot(page, '30-owner-dashboard-login');

    // Try login
    const backendInput = page.locator('input[placeholder*="backend"]').first();
    if (await backendInput.isVisible().catch(() => false)) {
      await backendInput.fill('http://localhost:3005');
      const emailInput = page.locator('input[type="email"], input[placeholder*="example"]').first();
      await emailInput.fill('op@e2e.local');
      const passInput = page.locator('input[type="password"]').first();
      await passInput.fill('test1234');
      await snapshot(page, '31-owner-dashboard-login-filled');
      await page.locator('text=Login').first().click();
      await page.waitForTimeout(2000);
      await snapshot(page, '32-owner-dashboard-after-login');
    }

    console.log('  ✅ owner-dashboard flow done');
  } catch (e) {
    console.log(`  ❌ owner-dashboard flow: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

await browser.close();
console.log('\n=== All flows done ===');
console.log(`Screenshots: ${outDir}`);
