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
      // Structured flag ONLY — never substring-match the message. Matching on
      // 'no encontrado' used to swallow every generic selector timeout from
      // humanize.js ("Elemento no encontrado: X"), so a slow panel or a service
      // worker restart mid-search was reported to the backend as "this user does
      // not exist here". The backend trusts that verdict, wipes User.panelId and
      // sends the load into blind discovery — that's how nieva3 lost a $17.000
      // load on 2026-08-24 while sitting on the very panel that was searched.
      const isUserNotFound = loadError.userNotFoundInPanel === true;

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
   * Valida que la sesión del panel esté abierta antes de operar.
   *
   * Si está cerrada, hace UN solo re-login (con el candado compartido, ver
   * loginOnce). Si eso no alcanza, la carga falla y la revisa un operador:
   * reintentar logins es justo la señal que no queremos darle al panel.
   *
   * Antes esta función nunca re-logueaba: checkLoginStatus devolvía el objeto de
   * estado completo y `if (objeto)` siempre daba verdadero.
   */
  static async validateSession(tab, config) {
    // La pestaña puede haberse cerrado entre la carga anterior y esta.
    try {
      await chrome.tabs.get(tab.id);
    } catch {
      console.warn(`[JobProcessor] Tab ${tab.id} gone, re-creating...`);
      tab = await this.ensurePanelTab(config.panelUrl);
      await this.waitForTabLoad(tab.id);
    }

    const status = await this.getLoginStatus(tab.id, config);
    this.throwIfChallenge(status);
    if (status.isLoggedIn) {
      console.log('[JobProcessor] Session validated successfully');
      return tab;
    }

    if (!config.panelUsername || !config.panelPassword) {
      throw new Error('La sesión del panel está cerrada y la extensión no tiene usuario/contraseña del panel configurados');
    }

    console.log('[JobProcessor] Session expired, re-authenticating once...');
    await this.loginOnce(tab.id, config);
    await this.waitForTabLoad(tab.id).catch(() => {});

    const after = await this.getLoginStatus(tab.id, config);
    this.throwIfChallenge(after);
    if (after.isLoggedIn) {
      console.log('[JobProcessor] Re-authentication successful');
      return tab;
    }
    throw new Error('La sesión del panel está cerrada y el re-login no funcionó');
  }

  /**
   * Login con candado: si ya hay uno en curso (por ejemplo el auto-login que
   * dispara la carga de la página), se espera ese en vez de abrir otro. Dos
   * logins simultáneos contra el panel son una señal de bot.
   */
  static loginOnce(tabId, config) {
    if (!this._loginInFlight) {
      this._loginInFlight = this.performLogin(tabId, config).finally(() => {
        this._loginInFlight = null;
      });
    }
    return this._loginInFlight;
  }

  static isLoginInFlight() {
    return !!this._loginInFlight;
  }

  /**
   * Si el panel muestra un desafío de Cloudflare / captcha, corta con un error
   * marcado (`isPanelChallenge`) para que se avise al operador. Nunca se intenta
   * resolverlo.
   */
  static throwIfChallenge(status) {
    if (status?.challenge) {
      const err = new Error(`El panel muestra un desafío de verificación (${status.challenge}). Requiere que una persona lo resuelva en la PC del bot.`);
      err.isPanelChallenge = true;
      err.challenge = status.challenge;
      throw err;
    }
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
   * Estado de login del panel ({ isLoggedIn, challenge, ... }).
   * Delegates to panel-automation.js checkLoginStatus() for consistency.
   */
  static async getLoginStatus(tabId, config) {
    // Inject content scripts so we can use the canonical check
    await this.injectContentScripts(tabId, config);

    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        return await window.panelAutomation.checkLoginStatus();
      }
    });

    const status = result?.[0]?.result;
    if (!status || typeof status !== 'object') {
      throw new Error('Login status check failed: no result from content script');
    }
    return status;
  }

  /** true si la sesión del panel está abierta. */
  static async checkLoginStatus(tabId, config) {
    const status = await this.getLoginStatus(tabId, config);
    return status.isLoggedIn === true;
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
      // Carry the content script's structured verdict; processLoadCreditsJob uses this
      // (never the message text) to decide whether to invalidate the user's panel.
      if (phase1.userNotFound) error.userNotFoundInPanel = true;
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
    try {
      return await this.mainWorldClickAndWait(tabId, job, parseFloat(job.amount) || 0, {
        op: 'addCredit',
        userKingboxId: phase1?.userKingboxId ?? null,
        balanceBefore: phase1?.balanceBefore ?? null,
      });
    } catch (clickError) {
      // Sin señal después de Aceptar: la carga pudo haber entrado o no. En vez de dejar
      // la duda (reintentarla a ciegas puede cargar dos veces), se mira el saldo.
      if (!clickError.ambiguousAfterSubmit) throw clickError;
      return await this.verifyLoadByBalance(tabId, job, config, phase1?.balanceBefore ?? null, clickError);
    }
  }

  /**
   * Carga sin confirmación visible: decide por el saldo del usuario.
   *
   * - Subió exactamente el monto → la carga entró (éxito).
   * - No cambió → la carga NO entró: falla con ese motivo (el operador puede reintentar).
   * - Cualquier otra cosa (el usuario jugó en el medio, no se pudo leer) → queda como
   *   estaba: falla para revisión manual, ahora con los dos saldos a la vista.
   *
   * Nunca reintenta la carga: sólo lee.
   *
   * `direction` = -1 para retiros: ahí el saldo tiene que BAJAR en el monto.
   */
  static async verifyLoadByBalance(tabId, job, config, balanceBefore, originalError, direction = 1) {
    const amount = Math.round(Number(job.amount) || 0);
    const what = direction < 0 ? 'Retiro' : 'Carga';
    const fmt = (n) => `$${Number(n).toLocaleString('es-AR')}`;
    if (balanceBefore == null || !amount) {
      originalError.message += ' (sin saldo previo para verificar: revisar a mano antes de reintentar)';
      throw originalError;
    }

    let balanceAfter = null;
    try {
      // La página quedó en un estado desconocido (modal abierto, alerta, nada): se recarga
      // y se da un momento al panel para registrar la carga antes de leer.
      await chrome.tabs.reload(tabId);
      await this.waitForTabLoad(tabId);
      await new Promise((r) => setTimeout(r, 3000));
      const reading = await this.verifyChips(job.targetUsername, config);
      if (reading?.success && Number.isFinite(Number(reading.balance))) balanceAfter = Number(reading.balance);
    } catch (e) {
      console.warn('[JobProcessor] Verificación por saldo: no se pudo leer:', e.message);
    }

    const detalle = `saldo antes ${fmt(balanceBefore)}, después ${balanceAfter == null ? '?' : fmt(balanceAfter)}`;
    if (balanceAfter === balanceBefore + direction * amount) {
      console.log(`[JobProcessor] ${what} confirmada por saldo (${detalle})`);
      return {
        success: true,
        targetUsername: job.targetUsername,
        amount: job.amount,
        message: `${what} confirmad${direction < 0 ? 'o' : 'a'} por saldo (${detalle})`,
        verifiedByBalance: true,
      };
    }

    const error = balanceAfter === balanceBefore
      ? new Error(`${what} NO realizad${direction < 0 ? 'o' : 'a'}: el saldo del usuario no cambió (${detalle}). Se puede reintentar.`)
      : new Error(`${originalError.message} — ${detalle}: revisar a mano antes de reintentar`);
    error.screenshot = originalError.screenshot;
    if (balanceAfter === balanceBefore) error.loadNotApplied = true;
    console.warn(`[JobProcessor] Verificación por saldo: ${error.message}`);
    throw error;
  }

  /**
   * Instala (una vez por página) el guardia de red en el MAIN world y lo arma para
   * esta operación. Envuelve fetch y XMLHttpRequest — axios de Nuxt usa XHR — y sólo
   * mira `/api/admin/user/addCredit|addDebit`:
   *
   * - Desarmado (nadie del bot operando) deja pasar todo: el operador puede usar la
   *   misma pestaña a mano.
   * - Armado deja salir UNA sola request, y sólo si es la operación, el monto y el
   *   usuario (`userKingboxId`) del job. Cualquier otra se corta antes de salir: así
   *   no hay carga a otro usuario, ni por otro monto, ni doble por doble click.
   * - Guarda la respuesta del panel (status HTTP + `header` + saldo nuevo + id de
   *   transacción): es la verdad sobre si la carga entró, mucho más que el toast.
   */
  static async armNetworkGuard(tabId, guard) {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (g) => {
        const W = window;
        if (!W.__trBot) {
          const bot = { guard: null, events: [] };
          W.__trBot = bot;
          const opOf = (url) => {
            const m = /\/api\/admin\/user\/(addCredit|addDebit)(?:[/?#]|$)/.exec(String(url || ''));
            return m ? m[1] : null;
          };
          const parseBody = (body) => {
            try { return typeof body === 'string' ? JSON.parse(body) : null; } catch { return null; }
          };
          // null = dejar salir; string = motivo del bloqueo
          const decide = (op, body) => {
            const gd = bot.guard;
            if (!gd) return null;
            if (gd.sent >= 1) return 'segundo envío durante la misma operación (posible doble click)';
            if (op !== gd.op) return `operación ${op} cuando se esperaba ${gd.op}`;
            const data = parseBody(body);
            if (!data) return 'no se pudo leer el cuerpo del envío';
            const sentAmount = Math.round(Number(data.amount) * 100);
            if (!Number.isFinite(sentAmount) || sentAmount !== Math.round(gd.amount * 100)) {
              return `monto enviado ${data.amount} distinto del pedido ${gd.amount}`;
            }
            if (gd.userId != null && String(data.userKingboxId) !== String(gd.userId)) {
              return `usuario enviado ${data.userKingboxId} distinto del esperado ${gd.userId}`;
            }
            return null;
          };
          // Copia en sessionStorage: si el panel responde 401 y Nuxt manda al login, la
          // página navega y `window.__trBot` se pierde; sessionStorage sobrevive en la pestaña.
          const persist = () => { try { sessionStorage.setItem('__trBotEvents', JSON.stringify(bot.events)); } catch { /* lleno o bloqueado */ } };
          bot.persist = persist;
          const record = (ev) => { bot.events.push(ev); if (bot.events.length > 20) bot.events.shift(); persist(); return ev; };
          const finish = (ev, status, json) => {
            ev.status = status;
            ev.header = json?.header || null;
            ev.balance = json?.content?.walletUser?.balance ?? null;
            ev.transaction = json?.content?.transaction ?? null;
            ev.message = json?.message || json?.header?.description || null;
            ev.done = true;
            persist();
          };

          const origFetch = W.fetch;
          W.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input?.url;
            const op = opOf(url);
            if (!op) return origFetch.apply(this, arguments);
            const body = init?.body;
            const reason = decide(op, body);
            const ev = record({ op, at: Date.now(), via: 'fetch', body: typeof body === 'string' ? body.slice(0, 200) : null });
            if (reason) { ev.blocked = true; ev.reason = reason; ev.done = true; persist(); return Promise.reject(new TypeError('Bloqueado por la extensión: ' + reason)); }
            if (bot.guard) bot.guard.sent++;
            return origFetch.apply(this, arguments).then((r) => {
              r.clone().json().catch(() => null).then((j) => finish(ev, r.status, j));
              return r;
            }, (e) => { ev.status = 0; ev.networkError = String(e?.message || e); ev.done = true; persist(); throw e; });
          };

          const XHR = W.XMLHttpRequest.prototype;
          const origOpen = XHR.open;
          const origSend = XHR.send;
          XHR.open = function (method, url) {
            this.__trOp = opOf(url);
            return origOpen.apply(this, arguments);
          };
          XHR.send = function (body) {
            const op = this.__trOp;
            if (!op) return origSend.apply(this, arguments);
            const reason = decide(op, body);
            const ev = record({ op, at: Date.now(), via: 'xhr', body: typeof body === 'string' ? body.slice(0, 200) : null });
            if (reason) {
              ev.blocked = true; ev.reason = reason; ev.done = true; persist();
              // Nunca sale: se le avisa a la página como error de red.
              setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 0);
              return;
            }
            if (bot.guard) bot.guard.sent++;
            this.addEventListener('loadend', () => {
              let json = null;
              try {
                json = this.responseType === 'json' ? this.response
                  : (this.responseType === '' || this.responseType === 'text') ? JSON.parse(this.responseText) : null;
              } catch { /* respuesta no-JSON */ }
              finish(ev, this.status, json);
            });
            return origSend.apply(this, arguments);
          };
        }
        W.__trBot.guard = { ...g, sent: 0, armedAt: Date.now() };
        W.__trBot.events = [];
        W.__trBot.persist();
        return { armed: true, armedAt: W.__trBot.guard.armedAt };
      },
      args: [guard],
    });
    return res?.result || null;
  }

  static async disarmNetworkGuard(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => { if (window.__trBot) window.__trBot.guard = null; },
      });
    } catch { /* la pestaña pudo haber navegado: el guardia murió con ella */ }
  }

  /**
   * Click Aceptar in MAIN world and poll for success/error result.
   * Reusable for LOAD_CREDITS, WITHDRAW_CHIPS, and any modal with submit button.
   *
   * El resultado lo decide sólo la respuesta del panel a addCredit/addDebit (guardia
   * de red); la pantalla no se mira. Si no llega respuesta, o el panel dio 5xx / se
   * cortó la red, queda "en duda" (`ambiguousAfterSubmit`) y se verifica por saldo.
   * Al terminar se recarga la página.
   */
  static async mainWorldClickAndWait(tabId, job, amountNum, opts = {}) {
    console.log('[JobProcessor] Executing MAIN world click for Aceptar...');
    const op = opts.op || 'addCredit';

    // Sin guardia no se toca Aceptar: es la única protección contra monto/usuario
    // equivocado y doble envío, y la que dice con certeza si la carga entró.
    let armed;
    try {
      armed = await this.armNetworkGuard(tabId, {
        op,
        amount: amountNum,
        userId: opts.userKingboxId ?? null,
        jobId: job.id,
      });
    } catch (e) {
      armed = null;
      console.warn('[JobProcessor] No se pudo armar el guardia de red:', e.message);
    }
    if (!armed?.armed) {
      const error = new Error('No se pudo preparar la verificación de la carga; NO se tocó Aceptar (la carga no se hizo)');
      error.screenshot = await this.captureScreenshotSafe();
      error.loadNotApplied = true;
      throw error;
    }
    if (opts.userKingboxId == null) {
      console.warn('[JobProcessor] Sin data-id del usuario: el guardia controla monto y doble envío, no el usuario');
    }

    try {
      return await this._clickAndPoll(tabId, job, amountNum, op, armed.armedAt, opts);
    } finally {
      await this.disarmNetworkGuard(tabId);
      // Lo que haya quedado en pantalla (modal, toast, alerta) no importa: se recarga
      // y la página queda limpia para la próxima operación.
      await this.reloadAfterSubmit(tabId);
    }
  }

  static async reloadAfterSubmit(tabId) {
    try {
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
      await chrome.tabs.reload(tabId);
      await this.waitForTabLoad(tabId);
    } catch (e) {
      console.warn('[JobProcessor] No se pudo recargar después de Aceptar:', e.message);
    }
  }

  static async _clickAndPoll(tabId, job, amountNum, op, armedAt, opts) {
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
      let resultCheck;
      try {
        resultCheck = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (since, expectedOp) => {
            // 1. Lo que respondió el panel a addCredit/addDebit (guardia de red)
            let all = window.__trBot?.events;
            if (!all) { try { all = JSON.parse(sessionStorage.getItem('__trBotEvents') || '[]'); } catch { all = []; } }
            const events = all.filter((e) => e.at >= since && e.op === expectedOp);
            const real = events.find((e) => !e.blocked);
            if (real) {
              if (!real.done) return { pending: true };
              const desc = real.message || real.header?.description || '';
              if (real.status === 200 && real.header?.status === 200) {
                return {
                  success: true,
                  source: 'api',
                  message: `Confirmado por el panel (${expectedOp} OK${real.transaction != null ? `, transacción ${real.transaction}` : ''})`,
                  balanceAfter: real.balance,
                  transaction: real.transaction,
                };
              }
              if (real.status === 401 || real.status === 419) {
                return { success: false, source: 'api', notApplied: true, sessionExpired: true,
                  error: `El panel rechazó la carga: sesión vencida (HTTP ${real.status}). La carga NO se hizo` };
              }
              if (real.status === 429) {
                return { success: false, source: 'api', notApplied: true,
                  error: 'El panel rechazó la carga por exceso de pedidos (HTTP 429). La carga NO se hizo' };
              }
              if (real.status >= 400 && real.status < 500) {
                return { success: false, source: 'api', notApplied: true,
                  error: `El panel rechazó la carga (HTTP ${real.status}${desc ? `: ${desc}` : ''}). La carga NO se hizo` };
              }
              if (real.status === 200) {
                // HTTP 200 pero el panel dice que no (header.status ≠ 200)
                return { success: false, source: 'api', notApplied: true,
                  error: `El panel respondió error${desc ? `: ${desc}` : ''} (código ${real.header?.status ?? '?'}). La carga NO se hizo` };
              }
              // 5xx o corte de red: el panel pudo haberla aplicado o no
              return { ambiguous: true, detail: real.networkError ? `corte de red (${real.networkError})` : `HTTP ${real.status}` };
            }
            const blocked = events.find((e) => e.blocked);
            if (blocked) {
              return { success: false, source: 'guard', notApplied: true, guardBlocked: true,
                error: `La extensión bloqueó el envío antes de que saliera: ${blocked.reason}. La carga NO se hizo` };
            }
            // La pantalla no se mira: sin respuesta de addCredit/addDebit no hay veredicto.
            return null;
          },
          args: [armedAt, op]
        });
      } catch (e) {
        // La página navegó (p. ej. el panel mandó al login): seguir mirando hasta agotar el tiempo.
        console.warn('[JobProcessor] Poll falló (¿navegó la página?):', e.message);
        continue;
      }

      const r = resultCheck?.[0]?.result;
      if (!r || r.pending) continue;
      finalResult = r;
      break;
    }

    if (finalResult?.success) {
      let message = finalResult.message;
      // Saldo nuevo vs. el leído antes: si no cierra, la carga entró igual (lo dijo el
      // panel) pero queda anotado — puede ser que el usuario jugó en el medio.
      if (finalResult.source === 'api' && opts.balanceBefore != null && finalResult.balanceAfter != null) {
        const delta = Number(finalResult.balanceAfter) - Number(opts.balanceBefore);
        const expected = op === 'addDebit' ? -Math.round(amountNum) : Math.round(amountNum);
        if (Math.round(delta) !== expected) {
          message += ` — ojo: saldo ${opts.balanceBefore} → ${finalResult.balanceAfter} (esperado ${expected >= 0 ? '+' : ''}${expected})`;
        }
      }
      console.log('[JobProcessor] Operation confirmed:', message);
      return {
        success: true,
        targetUsername: job.targetUsername,
        amount: job.amount,
        message,
        panelTransaction: finalResult.transaction ?? undefined,
      };
    }

    if (finalResult && finalResult.success === false) {
      const error = new Error(`Operation failed: ${finalResult.error}`);
      error.screenshot = await this.captureScreenshotSafe();
      if (finalResult.notApplied) error.loadNotApplied = true;
      if (finalResult.sessionExpired) error.panelSessionExpired = true;
      if (finalResult.guardBlocked) error.guardBlocked = true;
      throw error;
    }

    // Sin respuesta de addCredit/addDebit en 15s, o el panel dio 5xx / cortó la red
    const detail = finalResult?.ambiguous ? ` (${finalResult.detail})` : '';
    const error = new Error(`Operation failed: No success/error response detected after clicking Aceptar${detail}`);
    error.screenshot = await this.captureScreenshotSafe();
    // Ya se tocó Aceptar y no hubo señal: el resultado real es desconocido.
    error.ambiguousAfterSubmit = true;
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
      try {
        return await this.mainWorldClickAndWait(tab.id, job, parseFloat(job.amount) || 0, {
          op: 'addDebit',
          userKingboxId: withdrawResult.userKingboxId ?? null,
          balanceBefore: withdrawResult.balanceBefore ?? null,
        });
      } catch (clickError) {
        // Mismo criterio que la carga: en duda se decide por saldo, nunca se repite.
        if (!clickError.ambiguousAfterSubmit) throw clickError;
        return await this.verifyLoadByBalance(tab.id, job, config, withdrawResult.balanceBefore ?? null, clickError, -1);
      }
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
