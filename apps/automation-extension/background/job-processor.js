import { ApiClient } from './api-client.js';
import { JobLedger, VERIFICACION_MAX_MS } from './job-ledger.js';

const fmtPesos = (n) => `$${Number(n).toLocaleString('es-AR')}`;
const horaAR = () => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Lo que ve el operador son tres cosas: se cargó, no se cargó, o error. Nada de
// "en duda": si la extensión no lo pudo confirmar sola, es un error con una sola
// indicación (mirar el saldo en el panel). El detalle técnico va a los logs.
const esRetiro = (op) => op === 'addDebit' || op === 'WITHDRAW_CHIPS' || op === -1;
export const textoNoSe = (op, razon) => `No se ${esRetiro(op) ? 'descargó' : 'cargó'}: ${razon}`;
export const textoError = (op, username) => `Error: no se pudo confirmar si ${esRetiro(op) ? 'se descargó' : 'se cargó'}. Revisá el saldo de ${username || 'el usuario'} en el panel antes de volver a ${esRetiro(op) ? 'descargar' : 'cargar'}`;

// Historial del panel: "1.100,00" → 1100, "-5.092,00" → -5092
export const parseImporte = (s) => {
  const n = parseFloat(String(s || '').replace(/[^\d,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
};
// "28/08/26 06:47 PM" (hora local de la PC del bot) → ms
export const parseFechaHistorial = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(String(s || '').trim());
  if (!m) return null;
  let [, dd, mm, yy, hh, mi, ap] = m;
  let h = Number(hh);
  if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; }
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return new Date(year, Number(mm) - 1, Number(dd), h, Number(mi)).getTime();
};

// Job Processor - Orchestrates automation flow
export class JobProcessor {
  /**
   * Monto entero o error antes de tocar nada. Se tipea entero y el guardia compara
   * contra este mismo valor: con decimales el guardia bloquearía y frenaría el bot.
   */
  static montoEntero(job) {
    const n = Number(job.amount);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      const error = new Error(textoNoSe(job.type, `el monto ${job.amount} no es válido (tiene que ser un número entero)`));
      error.loadNotApplied = true;
      throw error;
    }
    return n;
  }

  /**
   * ¿Se puede rehacer esta carga después de un re-login? Sólo si es SEGURO que la
   * primera no se aplicó: el panel la rechazó por sesión vencida, o no salió ningún
   * envío y la sesión efectivamente estaba cerrada. Una sola vez por job.
   */
  static async _rehacerTrasRelogin(tab, job, config, error) {
    let motivo = null;
    if (error?.panelSessionExpired) {
      motivo = 'el panel rechazó la carga por sesión vencida';
    } else if (error?.nothingSent) {
      const logueado = await this.checkLoginStatus(tab.id, config).catch(() => null);
      if (logueado === false) motivo = 'la sesión se cerró antes de que saliera la carga';
    }
    if (!motivo) return null;
    if (!(await JobLedger.reabrirPorSesion(job.id))) return null;
    console.warn(`[JobProcessor] ${motivo}: re-login y se rehace la carga UNA vez (la primera NO se aplicó)`);
    const t = await this.validateSession(tab, config);
    await JobLedger.avanzar(job.id, 'SESION_OK');
    return t;
  }

  /**
   * Execute a credit loading job
   * Bot is already logged in and on the panel — go straight to automation.
   */
  static async execute(job, config) {
    console.log('[JobProcessor] Starting job execution:', job.id);
    console.log('[JobProcessor] Panel URL:', config.panelUrl);
    console.log('[JobProcessor] Target:', job.targetUsername, 'Amount:', job.amount);
    this.montoEntero(job);

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
    await this.asegurarListaDeUsuarios(tab.id);
    await JobLedger.avanzar(job.id, 'SESION_OK');

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
      let result;
      try {
        result = await this.executeLoadCredits(tab.id, job, config);
      } catch (firstError) {
        const relogged = await this._rehacerTrasRelogin(tab, job, config, firstError);
        if (!relogged) throw firstError;
        result = await this.executeLoadCredits(relogged.id, job, config);
      }
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
  /** Error de Chrome porque la página navegó/recargó mientras corría un script. */
  static esNavegacion(e) {
    return /Frame with ID \d+ was removed|No frame with id|frame was removed|execution context was destroyed|The frame was removed|Cannot access contents of url "about:blank"/i.test(String(e?.message || e));
  }

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
      // El saldo del encabezado se completa un momento después de cargar la página
      // (lo trae getBalance): recién cargada dice 0. Se espera hasta ver un saldo
      // mayor a cero, como mucho 8 s; si sigue en 0, es que es 0 de verdad.
      let ultimo = null;
      for (let i = 0; i < 16; i++) {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.panelAutomation?.getPanelBalance() ?? null,
        });
        ultimo = result?.result ?? null;
        if (ultimo != null && ultimo > 0) return ultimo;
        await esperar(500);
      }
      return ultimo;
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

    let result;
    try {
      result = await chrome.scripting.executeScript({
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
    } catch (e) {
      // Si el login entra, el panel navega (p. ej. a /dashboard.php) y el script que
      // esperaba la respuesta muere con la página ("Frame with ID 0 was removed").
      // Eso no es un error: se espera la página nueva y se mira si quedó logueado.
      if (!this.esNavegacion(e)) throw e;
      console.log('[JobProcessor] La página navegó durante el login; verificando sesión...');
      await esperar(1500);
      await this.waitForTabLoad(tabId).catch(() => {});
      await esperar(1500);
      if (await this.checkLoginStatus(tabId, config).catch(() => false)) {
        console.log('[JobProcessor] Login successful (la página navegó)');
        return;
      }
      throw new Error('Login failed: la página navegó y la sesión no quedó abierta');
    }

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

    await JobLedger.avanzar(job.id, 'USUARIO_ENCONTRADO', {
      balanceBefore: phase1?.balanceBefore ?? null,
      userKingboxId: phase1?.userKingboxId ?? null,
    });

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

    // El resultado de una carga lo decide sólo la respuesta del panel, que se lee al
    // clickear desde acá. Un "éxito" del content script sin ese clic, o un error
    // explícito al tipear el monto, no habilitan a seguir: la carga no se hizo.
    if (fillPhase?.success === false || (fillPhase?.success && !fillPhase?.needsMainWorldClick)) {
      const error = new Error(textoNoSe('addCredit', `no se pudo poner el monto en el panel${fillPhase?.error ? ` (${fillPhase.error})` : ''}`));
      error.screenshot = await this.captureScreenshotSafe();
      error.loadNotApplied = true;
      throw error;
    }

    // Amount is filled. Click Aceptar via MAIN world (bypasses CSP) + poll for result.
    await JobLedger.avanzar(job.id, 'MONTO_LISTO');
    try {
      return await this.mainWorldClickAndWait(tabId, job, this.montoEntero(job), {
        op: 'addCredit',
        userKingboxId: phase1?.userKingboxId ?? null,
        balanceBefore: phase1?.balanceBefore ?? null,
        config,
      });
    } catch (clickError) {
      // Sin señal después de Aceptar: la carga pudo haber entrado o no. En vez de dejar
      // la duda (reintentarla a ciegas puede cargar dos veces), se mira el saldo.
      if (!clickError.ambiguousAfterSubmit) throw clickError;
      return await this.verifyLoadByBalance(job, config, phase1?.balanceBefore ?? null, clickError);
    }
  }

  /**
   * Busca la operación en el historial del panel (/widthdraw, "Detalle de Cargas"),
   * como haría un operador: entra a la página, mira las filas de arriba (las más
   * nuevas) y, si no la ve, escribe el usuario y aprieta BUSCAR.
   *
   * Coincide una fila con: Destino = usuario, Importe = +monto (carga) o −monto
   * (descarga), y hora desde un poco antes del clic. Una misma fila no sirve para
   * dos operaciones (se lleva la cuenta con `filaHistorial` en la libreta).
   *
   * Devuelve { encontrada: true, fila, clave } | { encontrada: false } |
   * null si la página no se pudo leer (no se sabe).
   */
  static async buscarEnHistorial(tabId, consulta) {
    try {
      return await this._buscarEnHistorial(tabId, consulta);
    } finally {
      // Del historial siempre se vuelve a usuarios: es donde arranca todo lo demás.
      await this.volverALaListaDeUsuarios(tabId);
    }
  }

  static async _buscarEnHistorial(tabId, { jobId, username, amount, direction = 1, desdeMs }) {
    const importe = direction * Math.round(Number(amount));
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = new URL('/widthdraw', tab.url).href;
      await chrome.tabs.update(tabId, { url });
      await esperar(600);
      await this.waitForTabLoad(tabId);
    } catch (e) {
      console.warn('[JobProcessor] Historial: no se pudo abrir la página:', e.message);
      return null;
    }

    // Claves de filas que ya usó otra operación (dos cargas iguales en el mismo minuto).
    const usadas = (await JobLedger.todas())
      .filter((f) => f.jobId !== jobId && f.filaHistorial)
      .map((f) => f.filaHistorial);

    for (let intento = 0; intento < 2; intento++) {
      let res;
      try {
        [res] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: async (q) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const filas = () => [...document.querySelectorAll('#DataTables_Table_0 tbody tr')]
              .filter((tr) => tr.cells.length >= 4)
              .map((tr) => [...tr.cells].map((td) => (td.innerText ?? td.textContent ?? '').trim()));
            const lista = () => {
              const t = document.querySelector('#DataTables_Table_0');
              const proc = document.querySelector('#DataTables_Table_0_processing');
              const procesando = proc && getComputedStyle(proc).display !== 'none';
              return t && !procesando;
            };
            // Esperar la tabla (hasta 10 s)
            for (let i = 0; i < 50 && !lista(); i++) await sleep(200);
            if (!lista()) return { ok: false, motivo: 'la tabla del historial no apareció' };

            // Las filas del día llegan solas un momento después de cargar la página.
            // Primera vuelta: esperar hasta 8 s a que aparezcan; si no, apretar BUSCAR.
            // Segunda vuelta: buscar con el usuario escrito.
            const esperarFilas = async (ms) => {
              for (let i = 0; i < ms / 200; i++) {
                if (lista() && filas().length > 0) return true;
                await sleep(200);
              }
              return lista() && filas().length > 0;
            };
            const buscar = async (usuario) => {
              const input = document.querySelector('.md-form.mb-3 input') || document.querySelector('input[aria-label="Username"]');
              const btn = [...document.querySelectorAll('button.btn-cyan')].find((b) => (b.innerText ?? b.textContent ?? '').trim().toUpperCase() === 'BUSCAR');
              if (!btn) return false;
              if (input) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, usuario);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
              await sleep(300 + Math.random() * 500);
              btn.click();
              return true;
            };
            let busco = false;
            if (!q.buscarUsuario) {
              if (!(await esperarFilas(8000))) {
                busco = await buscar('');
                await esperarFilas(10000);
              }
            } else {
              busco = await buscar(q.username);
              if (!busco) return { ok: false, motivo: 'no se encontró el botón BUSCAR del historial' };
              await sleep(800);
              await esperarFilas(10000);
            }
            const vacia = (document.querySelector('#DataTables_Table_0 .dataTables_empty')?.innerText || '').trim();
            return { ok: true, filas: filas().slice(0, 50), url: window.location?.href, vacia, busco };
          },
          args: [{ username, buscarUsuario: intento === 1 }],
        });
      } catch (e) {
        console.warn('[JobProcessor] Historial: no se pudo leer:', e.message);
        return null;
      }
      const r = res?.result;
      if (!r?.ok) {
        this.log('WARN', `Historial: ${r?.motivo || 'sin resultado'}`);
        return null;
      }
      this.log('INFO', `Historial (${intento === 0 ? 'sin buscar' : `buscando ${username}`}): ${r.filas.length} fila(s)`, { primeras: r.filas.slice(0, 3), url: r.url, vacia: r.vacia });

      const ahora = Date.now();
      const candidatas = [];
      for (const [fecha, , destino, importeTxt] of r.filas) {
        if ((destino || '').toLowerCase() !== String(username).toLowerCase()) continue;
        if (parseImporte(importeTxt) !== importe) continue;
        const t = parseFechaHistorial(fecha);
        if (t == null || t < desdeMs - 3 * 60000 || t > ahora + 3 * 60000) continue;
        candidatas.push(`${fecha}|${destino}|${importe}`);
      }
      for (const clave of candidatas) {
        const iguales = candidatas.filter((c) => c === clave).length;
        const yaUsadas = usadas.filter((c) => c === clave).length;
        if (iguales > yaUsadas) {
          this.log('INFO', `Historial: encontrada ${clave}`);
          return { encontrada: true, clave };
        }
      }
      if (intento === 0) await esperar(500 + Math.random() * 700);
    }
    this.log('WARN', `Historial: no figura ${username} ${importe} desde ${new Date(desdeMs - 180000).toLocaleTimeString('es-AR')}`);
    return { encontrada: false };
  }

  /**
   * Vuelve a la lista de usuarios como lo haría una persona: entra por el link del
   * menú (o recarga si no lo encuentra). Deja la pestaña limpia (sin modal, toast
   * ni alerta) para lo que sigue. Nunca tira error: si no puede, el paso siguiente
   * (que valida sesión y busca al usuario) se arregla solo.
   */
  static async volverALaListaDeUsuarios(tabId) {
    try {
      await esperar(800 + Math.random() * 1700);
      let usersUrl = null;
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.querySelector('a.mdbvue-sidenav__item[href*="/users"], a[href*="/users"]')?.href || null,
        });
        usersUrl = res?.result || null;
      } catch { /* página en blanco o navegando */ }
      if (!usersUrl) {
        const tab = await chrome.tabs.get(tabId);
        try { usersUrl = new URL('/users', tab.url).href; } catch { usersUrl = null; }
      }
      if (usersUrl) await chrome.tabs.update(tabId, { url: usersUrl });
      else await chrome.tabs.reload(tabId);
      // Que la navegación arranque antes de esperar el "complete" (si no, el estado
      // viejo de la pestaña ya dice "complete" y se sigue antes de tiempo).
      await esperar(600);
      await this.waitForTabLoad(tabId);
      await this.esperarListaDeUsuariosVisible(tabId);
    } catch (e) {
      console.warn('[JobProcessor] No se pudo volver a la lista de usuarios:', e.message);
    }
  }

  /**
   * Como una persona: no hace nada hasta ver la lista de usuarios armada (buscador
   * y tabla visibles, sin el "procesando" de DataTables). Hasta 10 s.
   */
  static async esperarListaDeUsuariosVisible(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const visible = (el) => !!el && el.offsetParent !== null;
          for (let i = 0; i < 50; i++) {
            const buscador = document.querySelector('#filter-input');
            const tabla = document.querySelector('#DataTables_Table_0');
            const proc = document.querySelector('#DataTables_Table_0_processing');
            const procesando = proc && getComputedStyle(proc).display !== 'none';
            if (visible(buscador) && tabla && !procesando) return true;
            if (document.querySelector('input[type="password"]')) return false; // sesión cerrada
            await sleep(200);
          }
          return false;
        },
      });
    } catch { /* la página navegó: el paso siguiente valida la sesión */ }
  }

  /** Log que además viaja al backend (lo ven los operadores en vivo). */
  static log(level, msg, data) {
    (level === 'WARN' ? console.warn : console.log)(`[JobProcessor] ${msg}`, data ?? '');
    try { this.onLog?.(level, msg, data); } catch { /* opcional */ }
  }

  /** Antes de operar: la pestaña tiene que estar en la lista de usuarios. */
  static async asegurarListaDeUsuarios(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (new URL(tab.url).pathname.replace(/\/+$/, '') === '/users') return;
    } catch { /* si no se puede leer la URL, se navega igual */ }
    await this.volverALaListaDeUsuarios(tabId);
  }

  /**
   * Lee el saldo de un usuario como una persona: va a la lista, valida la sesión
   * (re-login una vez si hace falta) y lo busca. null si no se pudo leer.
   */
  static async leerSaldoDelUsuario(username, config) {
    try {
      const tab = await this.ensurePanelTab(config.panelUrl);
      await this.volverALaListaDeUsuarios(tab.id);
      const reading = await this.verifyChips(username, config);
      if (reading?.success && Number.isFinite(Number(reading.balance))) return Number(reading.balance);
    } catch (e) {
      console.warn('[JobProcessor] Lectura de saldo falló:', e.message);
    }
    return null;
  }

  /**
   * Carga que salió al panel y no tuvo respuesta clara: la extensión lo resuelve
   * sola, como haría un operador. Mira el historial de cargas del panel (la fuente
   * más confiable: no depende de que el usuario esté jugando) y el saldo del
   * usuario como respaldo. Repite a los 0 s, 15 s y 30 s. Nunca reintenta: sólo lee.
   *
   * - Aparece en el historial, o el saldo subió exactamente el monto → se cargó.
   * - El historial se leyó al menos dos veces y no aparece → no se cargó.
   * - Sin historial legible: saldo quieto en todas las lecturas → no se cargó;
   *   saldo movido por otro monto → error (mirar el saldo en el panel).
   * - No se pudo leer nada → error ahora; la ficha queda abierta y el barrido la
   *   sigue verificando sola (si entró, el backend avisa).
   *
   * `direction` = -1 para retiros (en el historial figuran con importe negativo).
   */
  static async verifyLoadByBalance(job, config, balanceBefore, originalError, direction = 1) {
    const ficha = await JobLedger.get(job.id);
    const amount = Math.round(Number(job.amount ?? ficha?.amount) || 0);
    const username = job.targetUsername ?? ficha?.username;
    const what = direction < 0 ? 'Retiro' : 'Carga';
    const o = direction < 0 ? 'o' : 'a';
    const motivoOriginal = originalError?.message || 'sin respuesta del panel';
    const op = direction < 0 ? 'addDebit' : 'addCredit';
    const desdeMs = Date.parse(ficha?.aceptarAt || ficha?.creada || new Date().toISOString());
    // Para el operador es un error con una sola indicación; el detalle va a los logs.
    const enDuda = async (detalle) => {
      console.warn(`[JobProcessor] Sin confirmar (${username}): ${detalle}`);
      const msg = textoError(op, username);
      await JobLedger.veredicto(job.id, 'EN_DUDA', { motivo: msg, detalle });
      const error = new Error(msg);
      error.screenshot = originalError?.screenshot;
      error.uncertain = true;
      throw error;
    };
    const confirmada = async (message, datos) => {
      await JobLedger.veredicto(job.id, 'OK', { motivo: message, ...datos });
      console.log(`[JobProcessor] ${message}`);
      return { success: true, targetUsername: username, amount: job.amount ?? amount, message, verifiedByBalance: true };
    };
    const noSeHizo = async (razon, detalle) => {
      const motivo = textoNoSe(op, razon);
      console.warn(`[JobProcessor] ${motivo} — ${detalle} (${motivoOriginal})`);
      await JobLedger.veredicto(job.id, 'NO_APLICADA', { motivo, certeza: 'verificacion', detalle });
      const error = new Error(motivo);
      error.screenshot = originalError?.screenshot;
      error.loadNotApplied = true;
      throw error;
    };

    if (!amount || !username) {
      return enDuda(`sin respuesta clara del panel (${motivoOriginal}) y sin datos de la operación`);
    }

    const esperado = balanceBefore != null ? balanceBefore + direction * amount : null;
    const ESPERAS_MS = [0, 15000, 15000];
    let historialSinFila = 0;
    const saldos = [];
    for (let i = 0; i < ESPERAS_MS.length; i++) {
      if (ESPERAS_MS[i]) await esperar(ESPERAS_MS[i]);
      if ((await JobLedger.get(job.id))?.cancelada && !originalError?.recovery) break;

      const tab = await this.ensurePanelTab(config.panelUrl).catch(() => null);
      const h = tab ? await this.buscarEnHistorial(tab.id, { jobId: job.id, username, amount, direction, desdeMs }) : null;
      if (h?.encontrada) {
        return confirmada(`${what} confirmad${o} en el historial del panel`, { certeza: 'historial', filaHistorial: h.clave });
      }
      if (h) historialSinFila++;

      // Saldo: en la primera vuelta siempre (control cruzado del historial) y
      // después sólo si el historial no se pudo leer.
      if (esperado != null && (i === 0 || !h)) {
        const saldo = await this.leerSaldoDelUsuario(username, config);
        saldos.push(saldo);
        if (saldo === esperado) {
          return confirmada(`${what} confirmad${o} por saldo (antes ${fmtPesos(balanceBefore)}, después ${fmtPesos(saldo)})`, {
            certeza: 'saldo', respuestaPanel: { balance: saldo },
          });
        }
      }
    }

    if (historialSinFila >= 2) {
      return noSeHizo('el panel no la aplicó (no figura en el historial)', `historial leído ${historialSinFila} veces sin la fila`);
    }
    const leidos = saldos.filter((x) => x != null);
    if (leidos.length >= 2 && leidos.every((x) => x === balanceBefore)) {
      return noSeHizo('el panel no la aplicó (el saldo no se movió)', `${leidos.length} lecturas en ${fmtPesos(balanceBefore)}, ${horaAR()}`);
    }
    if (leidos.length && leidos[leidos.length - 1] !== balanceBefore) {
      return enDuda(`saldo antes ${fmtPesos(balanceBefore)}, ahora ${fmtPesos(leidos[leidos.length - 1])}, esperado ${fmtPesos(esperado)}; historial sin leer`);
    }
    // No se pudo leer casi nada: la ficha queda abierta y el barrido la sigue verificando.
    if (Date.now() - desdeMs < VERIFICACION_MAX_MS) {
      console.warn(`[JobProcessor] No se pudo verificar ${username} todavía; se sigue verificando solo (${motivoOriginal})`);
      const error = new Error(textoError(op, username));
      error.screenshot = originalError?.screenshot;
      error.uncertain = true;
      error.pendingVerification = true;
      throw error;
    }
    return enDuda(`en 30 min no se pudo leer ni el historial ni el saldo de ${username} (${motivoOriginal})`);
  }

  /**
   * Verificación de una ficha que quedó en duda (Chrome se cerró, timeout, o no se
   * pudo leer el saldo antes). La usa el service worker al arrancar/reconectar.
   * Sólo lee: nunca toca Aceptar.
   */
  static async verificarFicha(ficha, config) {
    const job = { id: ficha.jobId, type: ficha.type, targetUsername: ficha.username, amount: ficha.amount };
    const direction = ficha.type === 'WITHDRAW_CHIPS' ? -1 : 1;
    const original = new Error(ficha.motivo || 'la extensión se cortó después de tocar Aceptar');
    original.recovery = true;
    return this.verifyLoadByBalance(job, config, ficha.balanceBefore, original, direction);
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
   * Toca Aceptar (MAIN world) y decide el resultado SÓLO por la respuesta del panel
   * a addCredit/addDebit, que lee el guardia de red. La pantalla no se mira.
   *
   * Antes del clic se anota ACEPTAR_TOCADO en la libreta (si no se puede anotar, no
   * se clickea). Apenas hay veredicto se anota, y recién después se vuelve a la
   * lista de usuarios. Casos:
   *   - Panel dijo OK → éxito.
   *   - Panel rechazó (4xx, header≠200) o el guardia bloqueó → NO se hizo (seguro).
   *   - No salió ningún envío → se confirma mirando el saldo (por si el guardia no
   *     vio el envío) y se marca NO se hizo.
   *   - Salió y no hubo respuesta (60 s), 5xx o corte → `ambiguousAfterSubmit`: el
   *     llamador lo decide por saldo (verifyLoadByBalance).
   *
   * opts: { op, userKingboxId, balanceBefore, config }
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
      const error = new Error(textoNoSe(op, 'la extensión no pudo prepararse para controlar el envío'));
      error.screenshot = await this.captureScreenshotSafe();
      error.loadNotApplied = true;
      throw error;
    }
    if (opts.userKingboxId == null) {
      console.warn('[JobProcessor] Sin data-id del usuario: el guardia controla monto y doble envío, no el usuario');
    }

    // Anotar ANTES de clickear. Si la libreta lo niega (cancelada por timeout, ya
    // tocado, ya resuelta) o no se puede guardar, no se clickea.
    try {
      await JobLedger.avanzar(job.id, 'ACEPTAR_TOCADO', {
        op,
        balanceBefore: opts.balanceBefore ?? null,
        userKingboxId: opts.userKingboxId ?? null,
      });
    } catch (e) {
      await this.disarmNetworkGuard(tabId);
      console.warn('[JobProcessor] Libreta negó o no pudo anotar ACEPTAR_TOCADO:', e.message);
      const error = new Error(textoNoSe(op, e.message.includes('NO se toca') ? 'la operación ya se había procesado o se canceló' : 'la extensión no pudo guardar su progreso'));
      error.loadNotApplied = true;
      throw error;
    }
    try { this.onProgress?.(job.id, 'ACEPTAR_TOCADO'); } catch { /* aviso opcional */ }

    let outcome;
    try {
      outcome = await this._clickAndPoll(tabId, amountNum, op, armed.armedAt);
    } finally {
      await this.disarmNetworkGuard(tabId);
    }

    const what = op === 'addDebit' ? 'El retiro' : 'La carga';

    if (outcome.success) {
      let message = outcome.message;
      // Saldo nuevo vs. el leído antes: si no cierra, entró igual (lo dijo el panel)
      // pero queda anotado — puede ser que el usuario jugó en el medio.
      if (opts.balanceBefore != null && outcome.balanceAfter != null) {
        const delta = Number(outcome.balanceAfter) - Number(opts.balanceBefore);
        const expected = op === 'addDebit' ? -Math.round(amountNum) : Math.round(amountNum);
        if (Math.round(delta) !== expected) {
          message += ` — ojo: saldo ${opts.balanceBefore} → ${outcome.balanceAfter} (esperado ${expected >= 0 ? '+' : ''}${expected})`;
        }
      }
      await JobLedger.veredicto(job.id, 'OK', {
        motivo: message, certeza: 'panel',
        respuestaPanel: { status: 200, transaction: outcome.transaction ?? null, balance: outcome.balanceAfter ?? null },
      }).catch((e) => console.error('[JobProcessor] Libreta: no se pudo anotar el OK:', e.message));
      // Como un operador: ir al historial y ver la operación arriba de la tabla.
      // La respuesta del panel ya es la verdad; el historial la confirma y deja la
      // fila anotada (para que no sirva para otra carga igual).
      const h = await this.buscarEnHistorial(tabId, {
        jobId: job.id, username: job.targetUsername, amount: amountNum,
        direction: op === 'addDebit' ? -1 : 1, desdeMs: Date.now() - 60000,
      });
      if (h?.encontrada) {
        message += ' · visto en el historial';
        await JobLedger.avanzar(job.id, 'VEREDICTO', { filaHistorial: h.clave }).catch(() => {});
      } else {
        console.warn(`[JobProcessor] El panel confirmó pero la operación no apareció en el historial (${h ? 'no figura' : 'historial ilegible'})`);
      }
      console.log('[JobProcessor] Operation confirmed:', message);
      return {
        success: true,
        targetUsername: job.targetUsername,
        amount: job.amount,
        message,
        panelTransaction: outcome.transaction ?? undefined,
      };
    }

    if (outcome.notApplied) {
      const error = new Error(textoNoSe(op, outcome.error));
      error.screenshot = await this.captureScreenshotSafe();
      error.loadNotApplied = true;
      if (outcome.sessionExpired) error.panelSessionExpired = true;
      if (outcome.guardBlocked) error.guardBlocked = true;
      await JobLedger.veredicto(job.id, 'NO_APLICADA', {
        motivo: outcome.error, certeza: outcome.guardBlocked ? 'guardia' : 'panel',
        respuestaPanel: { status: outcome.status ?? null },
      }).catch((e) => console.error('[JobProcessor] Libreta: no se pudo anotar el rechazo:', e.message));
      await this.volverALaListaDeUsuarios(tabId);
      throw error;
    }

    if (outcome.nothingSent) {
      return this._confirmarQueNoSalio(tabId, job, amountNum, op, opts);
    }

    // Salió y no hubo respuesta clara: lo decide el saldo (el llamador).
    const error = new Error(`Operation failed: No success/error response detected after clicking Aceptar${outcome.detail ? ` (${outcome.detail})` : ''}`);
    error.screenshot = await this.captureScreenshotSafe();
    error.ambiguousAfterSubmit = true;
    throw error;
  }

  /**
   * El guardia no vio salir ningún envío. Casi seguro que no se hizo, pero como el
   * guardia podría no ver un envío (cambio en el panel), se confirma mirando el
   * saldo una vez antes de decir "no se hizo".
   */
  static async _confirmarQueNoSalio(tabId, job, amountNum, op, opts) {
    const what = op === 'addDebit' ? 'El retiro' : 'La carga';
    const direction = op === 'addDebit' ? -1 : 1;
    const screenshot = await this.captureScreenshotSafe();
    const sesionAbierta = opts.config
      ? await this.checkLoginStatus(tabId, opts.config).catch(() => null)
      : null;

    // Por si el guardia no vio el envío: ¿figura en el historial?
    const h = await this.buscarEnHistorial(tabId, {
      jobId: job.id, username: job.targetUsername, amount: amountNum, direction, desdeMs: Date.now() - 90000,
    });
    if (h?.encontrada) {
      const message = `${what} confirmad${op === 'addDebit' ? 'o' : 'a'} en el historial del panel`;
      console.error('[JobProcessor] El guardia no vio el envío pero figura en el historial: revisar la extensión');
      await JobLedger.veredicto(job.id, 'OK', { motivo: message, certeza: 'historial', filaHistorial: h.clave });
      return { success: true, targetUsername: job.targetUsername, amount: job.amount, message, verifiedByBalance: true };
    }

    let saldo = null;
    if (!h && opts.config && opts.balanceBefore != null) {
      saldo = await this.leerSaldoDelUsuario(job.targetUsername, opts.config);
    }
    if (saldo != null && opts.balanceBefore != null && saldo === opts.balanceBefore + direction * Math.round(amountNum)) {
      // El saldo dice que entró aunque el guardia no vio el envío: vale el saldo.
      const message = `${what} confirmad${op === 'addDebit' ? 'o' : 'a'} por saldo`;
      console.error('[JobProcessor] El guardia no vio el envío pero el saldo dice que entró: revisar la extensión');
      console.error(`[JobProcessor] ${message}`);
      await JobLedger.veredicto(job.id, 'OK', { motivo: message, certeza: 'saldo', respuestaPanel: { balance: saldo } });
      return { success: true, targetUsername: job.targetUsername, amount: job.amount, message, verifiedByBalance: true };
    }
    if (saldo != null && opts.balanceBefore != null && saldo !== opts.balanceBefore) {
      const detalle = `no se vio salir el envío pero el saldo cambió (${fmtPesos(opts.balanceBefore)} → ${fmtPesos(saldo)})`;
      console.warn(`[JobProcessor] ${detalle}`);
      const msg = textoError(op, job.targetUsername);
      await JobLedger.veredicto(job.id, 'EN_DUDA', { motivo: msg, detalle });
      const error = new Error(msg);
      error.screenshot = screenshot;
      error.uncertain = true;
      throw error;
    }

    const msg = textoNoSe(op, sesionAbierta === false ? 'la sesión del panel estaba cerrada' : 'el panel no recibió el pedido');
    await JobLedger.veredicto(job.id, 'NO_APLICADA', { motivo: msg, certeza: 'guardia' });
    const error = new Error(msg);
    error.screenshot = screenshot;
    error.loadNotApplied = true;
    error.nothingSent = true;
    if (sesionAbierta === false) error.panelSessionExpired = true;
    throw error;
  }

  /**
   * Clickea Aceptar y espera la respuesta del panel (vía guardia de red).
   * Devuelve { success, message, balanceAfter, transaction } | { notApplied, error, ... }
   *        | { nothingSent } | { ambiguous, detail }. No tira errores.
   */
  static async _clickAndPoll(tabId, amountNum, op, armedAt) {
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

    // Sin envío en 15 s → no salió nada. Con el envío en vuelo se espera hasta 45 s:
    // cortarlo antes (recargar, navegar) deja la carga en duda.
    const NADA_SALIO_MS = 15000;
    const EN_VUELO_MAX_MS = 45000;
    const t0 = Date.now();
    let pudoLeer = false;
    let enVuelo = false;
    console.log('[JobProcessor] Esperando la respuesta del panel...');
    while (Date.now() - t0 < EN_VUELO_MAX_MS) {
      await esperar(500);
      let r;
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (since, expectedOp) => {
            // window.__trBot se pierde si la página navegó (p. ej. al login); la copia
            // en sessionStorage sobrevive en la pestaña.
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
                  message: `Confirmado por el panel (${expectedOp} OK${real.transaction != null ? `, transacción ${real.transaction}` : ''})`,
                  balanceAfter: real.balance,
                  transaction: real.transaction,
                };
              }
              if (real.status === 401 || real.status === 419) {
                return { notApplied: true, sessionExpired: true, status: real.status,
                  error: `la sesión del panel estaba vencida (HTTP ${real.status})` };
              }
              if (real.status === 429) {
                return { notApplied: true, status: 429,
                  error: 'el panel rechazó por exceso de pedidos (HTTP 429)' };
              }
              if (real.status >= 400 && real.status < 500) {
                return { notApplied: true, status: real.status,
                  error: `el panel la rechazó (HTTP ${real.status}${desc ? `: ${desc}` : ''})` };
              }
              if (real.status === 200) {
                // HTTP 200 pero el panel dice que no (header.status ≠ 200)
                return { notApplied: true, status: 200,
                  error: `el panel respondió error${desc ? `: ${desc}` : ''} (código ${real.header?.status ?? '?'})` };
              }
              // 5xx o corte de red: el panel pudo haberla aplicado o no
              return { ambiguous: true, detail: real.networkError ? `corte de red (${real.networkError})` : `HTTP ${real.status}` };
            }
            const blocked = events.find((e) => e.blocked);
            if (blocked) {
              return { notApplied: true, guardBlocked: true,
                error: `la extensión frenó el envío (${blocked.reason})` };
            }
            return { none: true };
          },
          args: [armedAt, op]
        });
        r = res?.result;
      } catch (e) {
        // La página está navegando: seguir mirando.
        continue;
      }
      if (!r) continue;
      pudoLeer = true;
      if (r.pending) { enVuelo = true; continue; }
      if (r.none) {
        if (Date.now() - t0 >= NADA_SALIO_MS) return { nothingSent: true };
        continue;
      }
      return r;
    }
    if (enVuelo) return { ambiguous: true, detail: 'el panel no respondió en 45 s' };
    if (!pudoLeer) return { ambiguous: true, detail: 'no se pudo leer la pestaña del panel' };
    return { nothingSent: true };
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
    this.montoEntero(job);

    const activityWindow = await ApiClient.checkActivityWindow(config);
    if (!activityWindow.allowed) {
      throw new Error(`Job skipped: outside activity window — ${activityWindow.reason || 'restricted hours'}`);
    }

    let tab = await this.ensurePanelTab(config.panelUrl);
    await this.waitForTabLoad(tab.id);
    tab = await this.validateSession(tab, config);
    await this.asegurarListaDeUsuarios(tab.id);
    await JobLedger.avanzar(job.id, 'SESION_OK');

    try {
      return await this._withdrawOnce(tab.id, job, config);
    } catch (firstError) {
      const relogged = await this._rehacerTrasRelogin(tab, job, config, firstError);
      if (!relogged) throw firstError;
      return await this._withdrawOnce(relogged.id, job, config);
    }
  }

  static async _withdrawOnce(tabId, job, config) {
    await this.injectContentScripts(tabId, config);

    console.log('[JobProcessor] Executing chip withdrawal...');
    const correr = () => chrome.scripting.executeScript({
      target: { tabId },
      func: async (jobData) => {
        return await window.panelAutomation.withdrawChips(jobData);
      },
      args: [{
        targetUsername: job.targetUsername,
        amount: job.amount
      }]
    });
    let result;
    try {
      result = await correr();
    } catch (e) {
      // La página navegó en el medio (todavía no se tocó Aceptar: no se envió nada).
      // Se espera que cargue y se arranca de nuevo desde la lista de usuarios.
      if (!this.esNavegacion(e)) throw e;
      console.warn('[JobProcessor] La página navegó durante la descarga (antes de Aceptar); se reintenta desde usuarios');
      await this.waitForTabLoad(tabId).catch(() => {});
      await this.asegurarListaDeUsuarios(tabId);
      await this.injectContentScripts(tabId, config);
      result = await correr();
    }

    if (!result?.[0]?.result) {
      const error = new Error('Chip withdrawal failed: no result from content script');
      error.screenshot = await this.captureScreenshotSafe();
      throw error;
    }

    const withdrawResult = result[0].result;

    // Sólo se sigue si el content script dejó el monto listo para el clic que se
    // hace (y se verifica) desde acá. Cualquier otra cosa: el retiro NO se hizo.
    if (!withdrawResult?.success || !withdrawResult?.needsMainWorldClick) {
      const error = new Error(textoNoSe('addDebit', withdrawResult?.error || 'el panel no quedó listo para descargar'));
      error.screenshot = await this.captureScreenshotSafe();
      error.loadNotApplied = true;
      if (withdrawResult?.userNotFound) error.userNotFoundInPanel = true;
      throw error;
    }

    await JobLedger.avanzar(job.id, 'USUARIO_ENCONTRADO', {
      balanceBefore: withdrawResult.balanceBefore ?? null,
      userKingboxId: withdrawResult.userKingboxId ?? null,
    });
    await JobLedger.avanzar(job.id, 'MONTO_LISTO');

    console.log('[JobProcessor] Withdraw amount filled, executing MAIN world click...');
    try {
      return await this.mainWorldClickAndWait(tabId, job, this.montoEntero(job), {
        op: 'addDebit',
        userKingboxId: withdrawResult.userKingboxId ?? null,
        balanceBefore: withdrawResult.balanceBefore ?? null,
        config,
      });
    } catch (clickError) {
      // Mismo criterio que la carga: en duda se decide por saldo, nunca se repite.
      if (!clickError.ambiguousAfterSubmit) throw clickError;
      return await this.verifyLoadByBalance(job, config, withdrawResult.balanceBefore ?? null, clickError, -1);
    }
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
