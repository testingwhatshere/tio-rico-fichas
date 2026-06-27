import { ApiClient } from './api-client.js';

// Job Processor - Orchestrates automation flow
export class JobProcessor {
  /**
   * Execute a credit loading job
   * Bot is already logged in and on the panel — go straight to automation.
   */
  static async execute(job, config) {
    console.log('[JobProcessor] Starting job execution:', job.id);
    console.log('[JobProcessor] Panel URL:', config.panelUrl);
    console.log('[JobProcessor] Target:', job.targetUsername, 'Amount:', job.amount);

    // Check activity window before executing
    const activityWindow = await ApiClient.checkActivityWindow(config);
    if (!activityWindow.allowed) {
      throw new Error(`Job skipped: outside activity window — ${activityWindow.reason || 'restricted hours'}`);
    }

    // Find the existing panel tab (bot is already logged in)
    let tab = await this.ensurePanelTab(config.panelUrl);
    await this.waitForTabLoad(tab.id);

    // Validate session (auto-login if needed)
    tab = await this.validateSession(tab, config);

    // Pre-check: verify panel has enough credits before loading
    const panelBalance = await this.readPanelBalance(tab.id, config);
    if (panelBalance != null) {
      console.log(`[JobProcessor] Panel balance: ${panelBalance}, job amount: ${job.amount}`);
      if (panelBalance < job.amount) {
        // Report low balance to backend (triggers operator alert)
        await ApiClient.reportPanelBalance(config, panelBalance).catch(() => {});
        throw new Error(`Fichas insuficientes en el panel: disponible $${panelBalance.toLocaleString('es-AR')}, necesario $${job.amount.toLocaleString('es-AR')}`);
      }
    }

    // Execute credit loading. If user not found on THIS panel, report to backend
    // so it can re-run discovery across other panels (the user might already exist elsewhere).
    // We must NOT auto-create here — that's what caused duplicate users across panels.
    console.log('[JobProcessor] Executing credit load...');
    try {
      const result = await this.executeLoadCredits(tab.id, job, config);
      console.log('[JobProcessor] Job completed successfully');
      return result;
    } catch (loadError) {
      const isUserNotFound = loadError.message &&
        (loadError.message.includes('not found in search results') ||
         loadError.message.includes('no encontrado'));

      if (!isUserNotFound) throw loadError;

      console.log(`[JobProcessor] User "${job.targetUsername}" not found on panel ${config.panelId} — reporting to backend for re-discovery`);
      await ApiClient.reportUserNotFoundOnPanel(config, job.id, job.targetUsername);

      // Throw so the service worker stops processing this job. Backend has already
      // marked it FAILED with the rediscovery marker; reportJobResult will be ignored
      // by the idempotency guard in bot.service handleJobResult.
      const err = new Error(`Usuario "${job.targetUsername}" no encontrado en este panel — backend reintentará en otros paneles`);
      err.isUserNotFoundOnPanel = true;
      throw err;
    }
  }

  /**
   * Validate session and ensure user is logged in
   * Retries login up to 3 times if session is invalid
   */
  static async validateSession(tab, config, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Re-verify tab exists before each attempt
        try {
          await chrome.tabs.get(tab.id);
        } catch {
          console.warn(`[JobProcessor] Tab ${tab.id} gone, re-creating (attempt ${attempt})...`);
          tab = await this.ensurePanelTab(config.panelUrl);
          await this.waitForTabLoad(tab.id);
        }

        const isLoggedIn = await this.checkLoginStatus(tab.id, config);

        if (isLoggedIn) {
          console.log('[JobProcessor] Session validated successfully');
          return tab;
        }

        console.log(`[JobProcessor] Session expired (attempt ${attempt}/${maxAttempts}), re-authenticating...`);
        await this.performLogin(tab.id, config);

        // Verify login succeeded
        const loginSuccess = await this.checkLoginStatus(tab.id, config);
        if (loginSuccess) {
          console.log('[JobProcessor] Re-authentication successful');
          return tab;
        }

        if (attempt < maxAttempts) {
          const backoffMs = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
          console.warn(`[JobProcessor] Login verification failed, retrying in ${backoffMs / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      } catch (error) {
        console.error(`[JobProcessor] Session validation error (attempt ${attempt}/${maxAttempts}):`, error);
        // If tab-related error, re-create tab and retry
        if (error.message?.includes('No tab with id') || error.message?.includes('Tab not found')) {
          console.warn('[JobProcessor] Tab error detected, re-creating tab...');
          tab = await this.ensurePanelTab(config.panelUrl);
          await this.waitForTabLoad(tab.id);
          continue;
        }
        if (attempt === maxAttempts) {
          throw new Error(`Session validation failed after ${maxAttempts} attempts: ${error.message}`);
        }
      }
    }

    throw new Error(`Failed to establish valid session after ${maxAttempts} attempts`);
  }

  /**
   * Read the panel's own credit balance via content script.
   * Delegates to panel-automation.js getPanelBalance() for consistency.
   */
  static async readPanelBalance(tabId, config) {
    try {
      if (config) {
        await this.injectContentScripts(tabId, config);
      }
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return window.panelAutomation?.getPanelBalance() ?? null;
        }
      });
      return result?.result ?? null;
    } catch (e) {
      console.warn('[JobProcessor] Could not read panel balance:', e.message);
      return null;
    }
  }

  /**
   * Ensure panel tab exists and is focused
   */
  static async ensurePanelTab(panelUrl) {
    // Match on hostname to handle panelUrl with or without path
    let hostname;
    try {
      hostname = new URL(panelUrl).hostname;
    } catch {
      // If panelUrl doesn't have protocol, add it
      hostname = new URL('https://' + panelUrl).hostname;
    }

    // Check if panel tab already exists (match by hostname, not full URL)
    const tabs = await chrome.tabs.query({ url: `*://${hostname}/*` });

    if (tabs.length > 0) {
      // Tab exists, focus it
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      console.log('[JobProcessor] Using existing panel tab:', tab.id, tab.url);
      return tab;
    }

    // Create new tab
    const tab = await chrome.tabs.create({
      url: panelUrl,
      active: true
    });
    console.log('[JobProcessor] Created new panel tab:', tab.id);
    return tab;
  }

  /**
   * Wait for tab to finish loading (Fix 11: timeout + race condition fix)
   * Adds listener FIRST, then checks current status to prevent race condition
   */
  static async waitForTabLoad(tabId) {
    const TIMEOUT_MS = 15000;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(`Tab load timed out after ${TIMEOUT_MS / 1000}s`));
      }, TIMEOUT_MS);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      // Add listener FIRST to prevent race condition
      chrome.tabs.onUpdated.addListener(listener);

      // THEN check current status
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error(`Tab not found: ${chrome.runtime.lastError.message}`));
          return;
        }
        if (tab.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

  /**
   * Check if user is logged in.
   * Delegates to panel-automation.js checkLoginStatus() for consistency.
   */
  static async checkLoginStatus(tabId, config) {
    // Inject content scripts so we can use the canonical check
    await this.injectContentScripts(tabId, config);

    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        return await window.panelAutomation.checkLoginStatus();
      }
    });

    if (!result?.[0]?.result && result?.[0]?.result !== false) {
      throw new Error('Login status check failed: no result from content script');
    }
    return result[0].result;
  }

  /**
   * Inject content scripts with config (Fix 12: verification + retry)
   * Verifies globals exist after injection. Retries once on failure.
   * Note: This is infrastructure retry (like validateSession), NOT automation retry.
   */
  static async injectContentScripts(tabId, config) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Inject humanize.js first
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/humanize.js']
        });

        // Inject config into humanize
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (cfg) => {
            if (window.humanize) {
              window.humanize.setConfig(cfg);
            }
          },
          args: [config]
        });

        // Then inject panel-automation.js
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/panel-automation.js']
        });

        // Verify globals exist
        const check = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            hasHumanize: typeof window.humanize !== 'undefined',
            hasPanelAutomation: typeof window.panelAutomation !== 'undefined'
          })
        });
        const result = check[0]?.result;
        if (result?.hasHumanize && result?.hasPanelAutomation) {
          console.log('[JobProcessor] Content scripts injected and verified');
          return;
        }

        console.warn(`[JobProcessor] Injection verification failed (attempt ${attempt}):`, result);
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        if (attempt === 2) throw new Error(`Script injection failed: ${error.message}`);
        console.warn(`[JobProcessor] Injection error (attempt ${attempt}):`, error.message);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    throw new Error('Content script injection failed: globals not available after 2 attempts');
  }

  /**
   * Perform login flow
   */
  static async performLogin(tabId, config) {
    await this.injectContentScripts(tabId, config);

    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (credentials) => {
        // This will be handled by content script
        return await window.panelAutomation.login(credentials);
      },
      args: [{
        username: config.panelUsername,
        password: config.panelPassword
      }]
    });

    if (!result?.[0]?.result) {
      throw new Error('Login failed: no result from content script');
    }
    if (!result[0].result.success) {
      throw new Error(`Login failed: ${result[0].result.error}`);
    }

    console.log('[JobProcessor] Login successful');
  }

  /**
   * Execute credit loading (two-phase: search+getHref → navigate → fillAmount+submit)
   */
  static async executeLoadCredits(tabId, job, config) {
    // Inject scripts if not already injected (with config)
    await this.injectContentScripts(tabId, config);

    // Phase 1: Search for user and open the add-credits modal/page
    console.log('[JobProcessor] Phase 1: Search user and open add-credits...');
    let phase1;
    try {
      const phase1Result = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (jobData) => {
          return await window.panelAutomation.loadCredits(jobData);
        },
        args: [{
          targetUsername: job.targetUsername,
          amount: job.amount
        }]
      });
      phase1 = phase1Result?.[0]?.result;
    } catch (e) {
      // Execution context may be destroyed if SPA re-renders after clicking action-plus
      console.warn('[JobProcessor] Phase 1 execution context lost (SPA re-render):', e.message);
      phase1 = null;
    }

    // Check for explicit failure
    if (phase1 && !phase1.success) {
      const error = new Error(`Credit load failed: ${phase1.error}`);
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    // If phase 1 returned a navigateTo URL, navigate and run phase 2
    if (phase1?.phase === 'NAVIGATE_TO_ADD_CREDITS' && phase1.navigateTo) {
      console.log('[JobProcessor] Phase 1 complete. Navigating to:', phase1.navigateTo);

      await chrome.tabs.update(tabId, { url: phase1.navigateTo });
      // Verify tab still exists after navigation (could be killed by browser)
      try {
        await chrome.tabs.get(tabId);
      } catch {
        throw new Error(`Tab ${tabId} was closed during navigation to add-credits page`);
      }
      await this.waitForTabLoad(tabId);

      // Wait for SPA hydration
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            const start = Date.now();
            while (Date.now() - start < 10000) {
              const el = document.querySelector('input:not([type="hidden"]), select, button[type="submit"], form');
              if (el && !el.disabled && el.offsetParent !== null) return true;
              await new Promise(r => setTimeout(r, 200));
            }
            throw new Error('SPA hydration timeout');
          },
        });
      } catch (hydrationError) {
        const error = new Error(`SPA hydration failed: ${hydrationError.message}`);
        error.screenshot = await this.captureScreenshotSafe();
        throw error;
      }

      await this.injectContentScripts(tabId, config);
    }

    // Phase 2: Wait for modal to be visible, then fill amount + click Aceptar
    // This handles both MODAL_OPEN and lost-context scenarios
    console.log('[JobProcessor] Phase 2: Waiting for modal, then fill + submit...');
    await new Promise(r => setTimeout(r, 2000)); // Let modal fully render

    // Re-inject scripts in case SPA re-render wiped them
    await this.injectContentScripts(tabId, config);

    // Fill amount via content script (isolated world — DOM manipulation works fine)
    const fillResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (jobData) => {
        return await window.panelAutomation.fillAmountAndSubmit(jobData);
      },
      args: [{
        targetUsername: job.targetUsername,
        amount: job.amount
      }]
    });

    const fillPhase = fillResult?.[0]?.result;

    // If content script reported full success (no MAIN world click needed), we're done.
    if (fillPhase?.success && !fillPhase?.needsMainWorldClick) {
      console.log('[JobProcessor] fillAmountAndSubmit fully succeeded:', fillPhase.message);
      return {
        success: true,
        targetUsername: job.targetUsername,
        amount: job.amount,
        message: fillPhase.message || 'Credits loaded'
      };
    }

    // Amount is filled. Click Aceptar via MAIN world (bypasses CSP) + poll for result.
    return await this.mainWorldClickAndWait(tabId, job, parseFloat(job.amount) || 0);
  }

  /**
   * Click Aceptar in MAIN world and poll for success/error result.
   * Reusable for LOAD_CREDITS, WITHDRAW_CHIPS, and any modal with submit button.
   */
  static async mainWorldClickAndWait(tabId, job, amountNum) {
    console.log('[JobProcessor] Executing MAIN world click for Aceptar...');

    // Record modal state BEFORE click (to detect close)
    const preClickState = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const modal = document.querySelector('.widthdraw.modal, .insert-mo.modal');
        if (!modal) return { modalVisible: false };
        const style = getComputedStyle(modal);
        return {
          modalVisible: parseFloat(style.opacity) > 0 && style.display !== 'none',
          modalSelector: modal.classList.contains('widthdraw') ? '.widthdraw.modal' : '.insert-mo.modal',
        };
      }
    });
    const wasModalVisible = preClickState?.[0]?.result?.modalVisible;

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (amount) => {
          try {
            // 1. Sync input value via native setter (for Vue v-model)
            const modal = document.querySelector('.widthdraw.modal, .insert-mo.modal');
            const input = (modal || document).querySelector('input[inputmode="decimal"], input[placeholder="0,00"]');
            if (input && amount) {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeSetter.call(input, amount.toString());
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // 2. Click Aceptar after a Vue tick
            setTimeout(() => {
              const btn = (modal || document).querySelector('button[type="submit"].btn.btn-cyan');
              if (!btn) {
                console.error('[Bot-MAIN] Aceptar button not found');
                return;
              }
              console.log('[Bot-MAIN] Aceptar aria-disabled:', btn.getAttribute('aria-disabled'));
              btn.removeAttribute('aria-disabled');
              btn.disabled = false;
              btn.click();
              console.log('[Bot-MAIN] Clicked Aceptar');
            }, 150);
          } catch(e) {
            console.error('[Bot-MAIN] Error:', e);
          }
        },
        args: [amountNum]
      });
    } catch (mainWorldError) {
      console.warn('[JobProcessor] MAIN world script failed:', mainWorldError.message);
    }

    // Wait for click + panel processing
    await new Promise(r => setTimeout(r, 2000));

    // Poll for result — up to 15 seconds
    console.log('[JobProcessor] Polling for result...');
    let finalResult = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      const resultCheck = await chrome.scripting.executeScript({
        target: { tabId },
        func: (modalWasVisible) => {
          // 1. SweetAlert v2
          const swal2Success = document.querySelector('.swal2-popup .swal2-icon.swal2-success');
          if (swal2Success) {
            const text = document.querySelector('.swal2-popup .swal2-html-container, .swal2-popup .swal2-title');
            return { success: true, message: text?.textContent?.trim() || 'Success (SweetAlert2)' };
          }
          const swal2Error = document.querySelector('.swal2-popup .swal2-icon.swal2-error');
          if (swal2Error) {
            const text = document.querySelector('.swal2-popup .swal2-html-container, .swal2-popup .swal2-title');
            return { success: false, error: text?.textContent?.trim() || 'Error (SweetAlert2)' };
          }

          // 2. SweetAlert v1
          const swal1Success = document.querySelector('.sweet-alert .sa-icon.sa-success');
          if (swal1Success) return { success: true, message: 'Success (SweetAlert1)' };
          const swal1Error = document.querySelector('.sweet-alert .sa-icon.sa-error');
          if (swal1Error) return { success: false, error: 'Error (SweetAlert1)' };

          // 3. Toast notifications (MDBootstrap / custom)
          const toastSuccess = document.querySelector('#toast-container .toast-success, .toast-success, .md-toast-success');
          if (toastSuccess) return { success: true, message: toastSuccess.textContent?.trim() || 'Success (toast)' };
          const toastError = document.querySelector('#toast-container .toast-error, .toast-error, .md-toast-error');
          if (toastError) return { success: false, error: toastError.textContent?.trim() || 'Error (toast)' };

          // 4. Bootstrap alerts
          const alertSuccess = document.querySelector('.alert-success:not([style*="display: none"])');
          if (alertSuccess && alertSuccess.offsetParent) return { success: true, message: alertSuccess.textContent?.trim() || 'Success (alert)' };
          const alertDanger = document.querySelector('.alert-danger:not([style*="display: none"])');
          if (alertDanger && alertDanger.offsetParent) return { success: false, error: alertDanger.textContent?.trim() || 'Error (alert)' };

          // 5. Modal closed (if it was visible before click, and now it's not — success)
          if (modalWasVisible) {
            const modal = document.querySelector('.widthdraw.modal, .insert-mo.modal');
            if (modal) {
              const style = getComputedStyle(modal);
              const isHidden = style.display === 'none' || parseFloat(style.opacity) === 0;
              if (isHidden) return { success: true, message: 'Success (modal closed)' };
            } else {
              // Modal removed from DOM
              return { success: true, message: 'Success (modal removed)' };
            }
          }

          // Still waiting
          return null;
        },
        args: [wasModalVisible]
      });

      finalResult = resultCheck?.[0]?.result;
      if (finalResult) break;
    }

    if (finalResult?.success) {
      console.log('[JobProcessor] Operation confirmed:', finalResult.message);
      return {
        success: true,
        targetUsername: job.targetUsername,
        amount: job.amount,
        message: finalResult.message
      };
    }

    if (finalResult && !finalResult.success) {
      const error = new Error(`Operation failed: ${finalResult.error}`);
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    // No response after 15s
    const error = new Error('Operation failed: No success/error response detected after clicking Aceptar');
    error.screenshot = await this.captureScreenshotSafe();
    throw error;
  }

  /**
   * Search for a username on the panel (read-only discovery).
   * Navigates to users page, searches, checks if username appears in results.
   * Does NOT modify anything — safe to run anytime the bot is idle.
   */
  static async searchUser(targetUsername, config) {
    console.log(`[JobProcessor] Discovery: searching for "${targetUsername}" on panel`);

    // Ensure panel tab exists and is loaded
    let tab = await this.ensurePanelTab(config.panelUrl);
    await this.waitForTabLoad(tab.id);

    // Validate session (auto-login if needed)
    tab = await this.validateSession(tab, config);

    // Inject content scripts (includes humanize.js + panel-automation.js)
    await this.injectContentScripts(tab.id, config);

    // Use the same battle-tested search logic from panel-automation.js
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (username) => {
        return await window.panelAutomation.searchOnly(username);
      },
      args: [targetUsername]
    });

    if (!result?.[0]?.result) {
      console.warn('[JobProcessor] Discovery: no result from content script');
      return { found: false };
    }

    const searchResult = result[0].result;
    console.log(`[JobProcessor] Discovery result: found=${searchResult.found}${searchResult.error ? ` error=${searchResult.error}` : ''}`);
    return searchResult;
  }

  /**
   * Verify a user's chip balance on the panel.
   * Used for prize claim verification — read-only, does NOT modify anything.
   */
  static async verifyChips(targetUsername, config) {
    console.log(`[JobProcessor] Verifying chips for "${targetUsername}"`);

    let tab = await this.ensurePanelTab(config.panelUrl);
    await this.waitForTabLoad(tab.id);
    tab = await this.validateSession(tab, config);
    await this.injectContentScripts(tab.id, config);

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (username) => {
        return await window.panelAutomation.readUserChipBalance(username);
      },
      args: [targetUsername]
    });

    if (!result?.[0]?.result) {
      console.warn('[JobProcessor] verifyChips: no result from content script');
      return { success: false, error: 'No result from content script' };
    }

    const verifyResult = result[0].result;
    console.log(`[JobProcessor] Verify chips result: success=${verifyResult.success}, balance=${verifyResult.balance}`);
    return verifyResult;
  }

  /**
   * Execute chip withdrawal (WITHDRAW_CHIPS job type).
   * Same setup as credit loading but uses withdrawChips instead of loadCredits.
   */
  static async executeWithdrawChips(job, config) {
    console.log('[JobProcessor] Starting chip withdrawal:', job.id);
    console.log('[JobProcessor] Target:', job.targetUsername, 'Amount:', job.amount);

    const activityWindow = await ApiClient.checkActivityWindow(config);
    if (!activityWindow.allowed) {
      throw new Error(`Job skipped: outside activity window — ${activityWindow.reason || 'restricted hours'}`);
    }

    let tab = await this.ensurePanelTab(config.panelUrl);
    await this.waitForTabLoad(tab.id);
    tab = await this.validateSession(tab, config);
    await this.injectContentScripts(tab.id, config);

    console.log('[JobProcessor] Executing chip withdrawal...');
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (jobData) => {
        return await window.panelAutomation.withdrawChips(jobData);
      },
      args: [{
        targetUsername: job.targetUsername,
        amount: job.amount
      }]
    });

    if (!result?.[0]?.result) {
      const error = new Error('Chip withdrawal failed: no result from content script');
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    const withdrawResult = result[0].result;

    // If content script returned needsMainWorldClick (CSP blocked inline script)
    if (withdrawResult?.success && withdrawResult?.needsMainWorldClick) {
      console.log('[JobProcessor] Withdraw amount filled, executing MAIN world click...');
      return await this.mainWorldClickAndWait(tab.id, job, parseFloat(job.amount) || 0);
    }

    if (!withdrawResult.success) {
      const error = new Error(`Chip withdrawal failed: ${withdrawResult.error}`);
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    console.log('[JobProcessor] Chip withdrawal completed successfully');
    return withdrawResult;
  }

  /**
   * Execute password change (CHANGE_PASSWORD job type).
   * Navigates to users page, finds user, opens password modal, fills & submits.
   */
  static async executePasswordChange(job, config) {
    console.log('[JobProcessor] Starting password change:', job.id);
    console.log('[JobProcessor] Target:', job.targetUsername);

    const activityWindow = await ApiClient.checkActivityWindow(config);
    if (!activityWindow.allowed) {
      throw new Error(`Job skipped: outside activity window — ${activityWindow.reason || 'restricted hours'}`);
    }

    let tab = await this.ensurePanelTab(config.panelUrl);
    await this.waitForTabLoad(tab.id);
    tab = await this.validateSession(tab, config);
    await this.injectContentScripts(tab.id, config);

    console.log('[JobProcessor] Executing password change...');
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (jobData) => {
        return await window.panelAutomation.changePassword(jobData);
      },
      args: [{
        targetUsername: job.targetUsername,
        newPassword: job.newPassword,
      }]
    });

    if (!result?.[0]?.result) {
      const error = new Error('Password change failed: no result from content script');
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    const changeResult = result[0].result;

    // Content script filled both password inputs and is asking us to click in MAIN world.
    // Same pattern as createUser — Vue ignores synthetic clicks from isolated world.
    if (changeResult?.success && changeResult?.needsMainWorldClick) {
      console.log('[JobProcessor] Password fields filled, executing MAIN world click...');

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            try {
              const modal = document.querySelector('.insert-mo.modal');
              if (!modal) { console.error('[Bot-MAIN] password modal not found'); return; }

              // Force Vue v-model sync for the two password inputs
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              modal.querySelectorAll('input:not([disabled])').forEach(input => {
                nativeSetter.call(input, input.value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              });

              setTimeout(() => {
                let btn = modal.querySelector('button.btn.btn-cyan');
                if (!btn) {
                  for (const b of modal.querySelectorAll('button')) {
                    if (b.textContent.trim().toLowerCase().includes('aceptar')) { btn = b; break; }
                  }
                }
                if (!btn) { console.error('[Bot-MAIN] Aceptar button not found (password)'); return; }
                btn.removeAttribute('aria-disabled');
                btn.disabled = false;
                btn.click();
                console.log('[Bot-MAIN] Clicked Aceptar (change password)');
              }, 150);
            } catch(e) {
              console.error('[Bot-MAIN] changePassword error:', e);
            }
          }
        });
      } catch (mainWorldError) {
        console.warn('[JobProcessor] MAIN world changePassword click failed:', mainWorldError.message);
      }

      // Poll for result (toast or modal closed). Same shape as createUser.
      await new Promise(r => setTimeout(r, 2500));
      let finalResult = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        const check = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const ERROR_TOAST_SEL = '#toast-container .toast-error, .toast-error, .md-toast-error, .b-toast-danger, [class*="md-toast-error"], [class*="toast-danger"]';
            const SUCCESS_TOAST_SEL = '#toast-container .toast-success, .toast-success, .md-toast-success, .b-toast-success, [class*="md-toast-success"]';

            const toastErr = document.querySelector(ERROR_TOAST_SEL);
            if (toastErr && toastErr.offsetParent !== null) {
              return { success: false, error: toastErr.textContent?.trim() || 'Error (toast)' };
            }
            const swal2e = document.querySelector('.swal2-popup .swal2-icon.swal2-error');
            if (swal2e) return { success: false, error: 'Error (SweetAlert)' };

            const toast = document.querySelector(SUCCESS_TOAST_SEL);
            if (toast) return { success: true, message: toast.textContent?.trim() || 'Password changed (toast)' };
            const swal2 = document.querySelector('.swal2-popup .swal2-icon.swal2-success');
            if (swal2) return { success: true, message: 'Password changed (SweetAlert)' };

            const modal = document.querySelector('.insert-mo.modal');
            if (modal) {
              const s = getComputedStyle(modal);
              if (s.display === 'none' || parseFloat(s.opacity) === 0) return { modalGone: true };
              return null;
            }
            return { modalGone: true };
          }
        });
        const r = check?.[0]?.result;
        if (!r) continue;

        if (r.success === false || (r.success === true && !r.modalGone)) {
          finalResult = r;
          break;
        }

        if (r.modalGone) {
          await new Promise(r2 => setTimeout(r2, 600));
          const reCheck = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const ERROR_TOAST_SEL = '#toast-container .toast-error, .toast-error, .md-toast-error, .b-toast-danger, [class*="md-toast-error"], [class*="toast-danger"]';
              const toastErr = document.querySelector(ERROR_TOAST_SEL);
              if (toastErr && toastErr.offsetParent !== null) {
                return { success: false, error: toastErr.textContent?.trim() || 'Error (toast)' };
              }
              return { success: true, message: 'Password changed (modal closed, grace clean)' };
            }
          });
          finalResult = reCheck?.[0]?.result || { success: true, message: 'Password changed (modal closed)' };
          break;
        }
      }

      if (finalResult?.success) {
        console.log('[JobProcessor] Password change completed:', finalResult.message);
        return { success: true, targetUsername: changeResult.targetUsername, message: finalResult.message };
      }
      if (finalResult && !finalResult.success) {
        const error = new Error(`Password change failed: ${finalResult.error}`);
        error.screenshot = await this.captureScreenshotSafe();
        throw error;
      }
      const error = new Error('Password change failed: No response after clicking Aceptar');
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    if (!changeResult.success) {
      const error = new Error(`Password change failed: ${changeResult.error}`);
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    console.log('[JobProcessor] Password change completed successfully');
    return changeResult;
  }

  /**
   * Create a new user on the panel.
   * Used when discovery finds that the user doesn't exist on any panel.
   */
  static async createUser(targetUsername, config) {
    console.log(`[JobProcessor] Creating user "${targetUsername}" on panel`);

    let tab = await this.ensurePanelTab(config.panelUrl);
    await this.waitForTabLoad(tab.id);
    tab = await this.validateSession(tab, config);
    await this.injectContentScripts(tab.id, config);

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (username) => {
        return await window.panelAutomation.createUser(username);
      },
      args: [targetUsername]
    });

    if (!result?.[0]?.result) {
      const error = new Error('User creation failed: no result from content script');
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    const createResult = result[0].result;

    // Content script filled nickname+password and returned needsMainWorldClick
    if (createResult?.success && createResult?.needsMainWorldClick) {
      console.log('[JobProcessor] createUser: fields filled, executing MAIN world click...');

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            try {
              const modal = document.querySelector('.insert-mo.modal');
              if (!modal) { console.error('[Bot-MAIN] insert-mo modal not found'); return; }

              // Force Vue v-model sync for all inputs
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              modal.querySelectorAll('input:not([disabled])').forEach(input => {
                nativeSetter.call(input, input.value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              });

              setTimeout(() => {
                // Button is type="button" (not submit), find by text
                let btn = modal.querySelector('button.btn.btn-cyan');
                if (!btn) {
                  for (const b of modal.querySelectorAll('button')) {
                    if (b.textContent.trim().toLowerCase().includes('aceptar')) { btn = b; break; }
                  }
                }
                if (!btn) { console.error('[Bot-MAIN] Aceptar button not found'); return; }
                btn.removeAttribute('aria-disabled');
                btn.disabled = false;
                btn.click();
                console.log('[Bot-MAIN] Clicked Aceptar (create user)');
              }, 150);
            } catch(e) {
              console.error('[Bot-MAIN] createUser error:', e);
            }
          }
        });
      } catch (mainWorldError) {
        console.warn('[JobProcessor] MAIN world createUser click failed:', mainWorldError.message);
      }

      // Poll for result (toast/modal closed). Wider initial delay (2500ms) gives the
      // panel time to render the toast before we start checking — without it we'd
      // miss the duplicate-user error toast in the first iterations.
      await new Promise(r => setTimeout(r, 2500));
      let finalResult = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        const check = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Toast selector list covers Bootstrap, mdBootstrap (md-toast-*) and
            // bootstrap-vue (b-toast-*). Order matters — ERROR is checked before
            // any "modal closed = success" inference to avoid false positives.
            const ERROR_TOAST_SEL = '#toast-container .toast-error, .toast-error, .md-toast-error, .b-toast-danger, [class*="md-toast-error"], [class*="toast-danger"]';
            const SUCCESS_TOAST_SEL = '#toast-container .toast-success, .toast-success, .md-toast-success, .b-toast-success, [class*="md-toast-success"]';

            // 1) ERROR has priority over modal-close inference.
            const toastErr = document.querySelector(ERROR_TOAST_SEL);
            if (toastErr && toastErr.offsetParent !== null) {
              return { success: false, error: toastErr.textContent?.trim() || 'Error (toast)' };
            }
            const swal2e = document.querySelector('.swal2-popup .swal2-icon.swal2-error');
            if (swal2e) return { success: false, error: 'Error (SweetAlert)' };

            // 2) Explicit success
            const toast = document.querySelector(SUCCESS_TOAST_SEL);
            if (toast) return { success: true, message: toast.textContent?.trim() || 'User created (toast)' };
            const swal2 = document.querySelector('.swal2-popup .swal2-icon.swal2-success');
            if (swal2) return { success: true, message: 'User created (SweetAlert)' };

            // 3) Modal state — used only as last signal when no toast was found.
            //    The CALLER applies a grace window before accepting this as success.
            const modal = document.querySelector('.insert-mo.modal');
            if (modal) {
              const s = getComputedStyle(modal);
              if (s.display === 'none' || parseFloat(s.opacity) === 0) return { modalGone: true };
              return null;
            }
            return { modalGone: true };
          }
        });
        const r = check?.[0]?.result;
        if (!r) continue;

        // Definitive result (explicit error or explicit success): stop polling.
        if (r.success === false || (r.success === true && !r.modalGone)) {
          finalResult = r;
          break;
        }

        // Modal gone — wait one more cycle and re-check for late-rendering error toasts.
        if (r.modalGone) {
          await new Promise(r2 => setTimeout(r2, 600));
          const reCheck = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const ERROR_TOAST_SEL = '#toast-container .toast-error, .toast-error, .md-toast-error, .b-toast-danger, [class*="md-toast-error"], [class*="toast-danger"]';
              const toastErr = document.querySelector(ERROR_TOAST_SEL);
              if (toastErr && toastErr.offsetParent !== null) {
                return { success: false, error: toastErr.textContent?.trim() || 'Error (toast)' };
              }
              return { success: true, message: 'User created (modal closed, grace clean)' };
            }
          });
          finalResult = reCheck?.[0]?.result || { success: true, message: 'User created (modal closed)' };
          break;
        }
      }

      if (finalResult?.success) {
        console.log(`[JobProcessor] User "${targetUsername}" created:`, finalResult.message);
        return { success: true, targetUsername, password: '123casino', message: finalResult.message };
      }
      if (finalResult && !finalResult.success) {
        const error = new Error(`User creation failed: ${finalResult.error}`);
        error.screenshot = await this.captureScreenshotSafe();
        throw error;
      }
      const error = new Error('User creation failed: No response after clicking Aceptar');
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    if (!createResult.success) {
      const error = new Error(`User creation failed: ${createResult.error}`);
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    console.log(`[JobProcessor] User "${targetUsername}" created successfully`);
    return createResult;
  }

  /**
   * Capture screenshot safely (returns null on failure)
   */
  static async captureScreenshotSafe() {
    try {
      return await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    } catch (screenshotError) {
      console.warn('[JobProcessor] Screenshot capture failed:', screenshotError.message);
      return null;
    }
  }
}
