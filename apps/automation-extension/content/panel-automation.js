// Panel Automation - DOM manipulation for gaming panel
// This file contains the actual automation logic for TioRico panel (Nuxt.js SPA)

// Guard against double-injection (chrome.scripting.executeScript can re-inject on same page)
if (window.panelAutomation) {
  console.log('[PanelAutomation] Already injected, skipping re-initialization');
} else {

// Default selectors for TioRico panel — DO NOT REMOVE
// Custom panel profiles override these via chrome.storage.local 'panelProfile' key
const DEFAULT_SELECTORS = {
  LOGIN_USERNAME_INPUT: 'input[type="text"][aria-label="Nombre de Usuario"], input[name="username"], input[name="user"], input[type="text"][placeholder*="suario"], input[type="text"][placeholder*="ombre"]',
  LOGIN_PASSWORD_INPUT: 'input[type="password"][aria-label="Contraseña"], input[name="password"], input[type="password"]',
  LOGIN_SUBMIT_BUTTON: 'button[type="submit"], input[type="submit"]',
  USER_MENU: 'li.user-toggle, .user-toggle.dropdown, span.own-username, .user-menu, [data-user], .profile, .navbar .dropdown, .navbar-nav .dropdown, .sidebar-header',
  LOGOUT_LINK: 'a[href*="logout"], a[href*="salir"], a[href*="cerrar"]',
  USERS_PAGE_LINK: 'a.mdbvue-sidenav__item[href*="/users"], a[href*="users.php"], a[href*="users"], a[href*="/users"]',
  USER_SEARCH_INPUT: '#filter-input, input[name="filter"], input[name="search"], input[name="q"], input[placeholder*="uscar"], input[placeholder*="iltrar"], input[type="search"]',
  ADD_CREDITS_BUTTON_ROW: 'a.action-plus',
  ADD_CREDITS_BUTTON_ICON: 'a .fas.fa-plus, a .fa.fa-plus, a .fa-plus, a i.fas.fa-plus, a i.fa.fa-plus',
  SUBTRACT_CREDITS_BUTTON_ROW: 'a.action-minus',
  DATATABLE_PROCESSING: '#DataTables_Table_0_processing, .dataTables_processing',
  MODAL: '.widthdraw.modal, .modal.show, .modal[style*="display: block"], [role="dialog"], .modal-dialog, .swal2-container',
  MODAL_AMOUNT_INPUT: '.modal-body input[inputmode="decimal"], input[inputmode="decimal"], input[type="number"], input[name="amount"], input[name="credits"], input[name="monto"]',
  MODAL_AMOUNT_INPUT_FALLBACK: '.modal-body input[aria-label="Username"]:not([disabled]), input[aria-label="Username"]:not([disabled]), input:not([type="hidden"]):not([type="password"]):not([type="search"]):not([type="email"]):not([disabled])',
  MODAL_SUBMIT: '.modal-body button[type="submit"], .modal button[type="submit"]',
  SUCCESS_MESSAGE: '.alert-success, .toast-success, .swal2-success, .swal2-popup.swal2-show .swal2-html-container, .swal-text, .alert.alert-success, #success-message, .notification.is-success',
  ERROR_MESSAGE: '.alert-danger, .alert-error, .toast-error, .swal2-error, .swal2-popup.swal2-show .swal2-html-container, .swal-text, .alert.alert-danger, #error-message, .notification.is-danger',
  OWN_BALANCE: 'span.own-balance',
  NEW_USER_BUTTON: 'button.btn.btn-danger',
  NEW_USER_BUTTON_ICON: 'i.fas.fa-user-plus',
  NEW_USER_MODAL: '.insert-mo.modal',
  NEW_USER_NICKNAME_INPUT: '.insert-mo input[type="text"][aria-label="Nickname"]',
  NEW_USER_PASSWORD_INPUT: '.insert-mo input[type="password"][aria-label="Contraseña"]',
  NEW_USER_SUBMIT: '.insert-mo button[type="submit"].btn.btn-cyan',
  NEW_USER_CANCEL: '.insert-mo button.btn.btn-outline-cyan',
  CHANGE_PASSWORD_BUTTON: 'a.action-password',
  PASSWORD_MODAL: '.insert-mo.modal',
  PASSWORD_INPUT: '.insert-mo input[type="password"][aria-label="Contraseña"], .modal-body input[type="password"]:first-of-type',
  PASSWORD_CONFIRM_INPUT: '.insert-mo input[type="password"][aria-label="Confirmación Contraseña"], .modal-body input[type="password"]:nth-of-type(2)',
  PASSWORD_SUBMIT: '.insert-mo button.btn.btn-cyan, .modal-body button[type="submit"]'
};

// Active selectors — merged from custom panel profile (if any) + defaults
// Custom profile only needs to override the keys that differ from TioRico
let SELECTORS = { ...DEFAULT_SELECTORS };

// Load custom panel profile from storage + optional remote URL (async, runs on injection)
(async () => {
  try {
    const stored = await chrome.storage.local.get(['panelProfile', 'config']);

    // 1. Try fetching remote profile if URL is configured (allows remote updates)
    const profileUrl = stored.config?.panelProfileUrl;
    if (profileUrl) {
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        const res = await fetch(profileUrl, { signal: controller.signal });
        if (res.ok) {
          const remote = await res.json();
          if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
            // Remove meta keys (start with _)
            const cleaned = Object.fromEntries(Object.entries(remote).filter(([k]) => !k.startsWith('_')));
            SELECTORS = { ...DEFAULT_SELECTORS, ...cleaned };
            // Cache locally so it works offline next time
            await chrome.storage.local.set({ panelProfile: cleaned });
            console.log('[PanelAutomation] Remote profile loaded from', profileUrl, '—', Object.keys(cleaned).length, 'overrides');
            return;
          }
        }
      } catch (e) {
        console.warn('[PanelAutomation] Remote profile fetch failed, using local:', e.message);
      }
    }

    // 2. Fallback to local storage profile
    if (stored.panelProfile && typeof stored.panelProfile === 'object') {
      SELECTORS = { ...DEFAULT_SELECTORS, ...stored.panelProfile };
      console.log('[PanelAutomation] Local panel profile loaded:', Object.keys(stored.panelProfile).length, 'overrides');
    }
  } catch (e) {
    // Content scripts may not have storage access in all contexts — use defaults
  }
})();

/**
 * Log page state for diagnostics
 */
function logPageState(label) {
  const state = {
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    hasTable: !!document.querySelector('table'),
    tableRows: document.querySelectorAll('table tbody tr').length,
    hasModal: !!document.querySelector('.modal, [role="dialog"], .swal2-container'),
    inputCount: document.querySelectorAll('input').length,
    buttonCount: document.querySelectorAll('button').length,
    hasLoginForm: !!document.querySelector('input[type="password"]'),
    hasLogout: !!document.querySelector('a[href*="logout"], a[href*="salir"]'),
    hasSidebar: !!document.querySelector('.sidebar, nav, .nav-sidebar'),
  };
  humanize.log(`[PageState:${label}]`, state);
  return state;
}

/**
 * Wait for SPA content to render (Nuxt.js/Vue hydration)
 * Unlike waitForNavigation which relies on page load events,
 * this polls for actual DOM content to appear.
 */
async function waitForSPAContent(selector, timeout = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) {
      return el;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return null;
}

/**
 * Helper to wrap steps with error context
 */
async function executeStep(stepName, stepFunction, context = {}) {
  try {
    humanize.log(`Step: ${stepName}`);
    logPageState(stepName);
    return await stepFunction();
  } catch (error) {
    // Enhance error with step context
    const contextStr = Object.entries(context)
      .map(([key, value]) => `${key}="${value}"`)
      .join(', ');

    const enhancedMessage = `Failed at ${stepName}${contextStr ? ` (${contextStr})` : ''}: ${error.message}`;
    // Log full page state on failure for debugging
    logPageState(`${stepName}_FAILED`);
    throw new Error(enhancedMessage);
  }
}

// Parse Argentine-formatted number: "9.000,00" → 9000
function parseArgentineNumber(str) {
  if (!str) return null;
  const cleaned = str.trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Expose automation API to service worker
window.panelAutomation = {
  /**
   * Read the panel's own balance from span.own-balance
   * Returns numeric value or null if not found
   */
  getPanelBalance() {
    const el = document.querySelector(SELECTORS.OWN_BALANCE);
    if (!el) return null;
    return parseArgentineNumber(el.textContent);
  },

  /**
   * Login to panel
   */
  async login(credentials) {
    const context = {
      username: credentials.username
    };

    try {
      humanize.log('Starting login flow');

      // Log config for debugging
      const config = await humanize.loadConfig();
      await humanize.debug('Login flow using config', {
        minDelay: config.minDelay,
        maxDelay: config.maxDelay,
        debugMode: config.debugMode
      });

      // Step 1: Find login form (wait for SPA to render)
      const usernameInput = await executeStep('find_login_form', async () => {
        // Wait for any password input to appear (SPA render)
        const pwdInput = await waitForSPAContent('input[type="password"]', 10000);
        if (!pwdInput) {
          throw new Error('Login form not rendered (no password input found)');
        }

        // Find username input using multiple selectors
        const selectors = SELECTORS.LOGIN_USERNAME_INPUT.split(', ');
        let uInput = null;
        for (const sel of selectors) {
          uInput = document.querySelector(sel);
          if (uInput) break;
        }
        if (!uInput) {
          // Last resort: first text input on the page
          uInput = document.querySelector('input[type="text"]');
        }
        if (!uInput) {
          throw new Error('Username input not found');
        }
        return uInput;
      }, { ...context, selector: 'input[type="text"]' });

      // Step 2: Fill credentials
      await executeStep('fill_credentials', async () => {
        const passwordInput = document.querySelector('input[type="password"]');
        if (!passwordInput) {
          throw new Error('Password input not found');
        }

        // Fill username
        await humanize.randomDelay();
        await humanize.typeIntoElement(usernameInput, credentials.username);

        // Fill password
        await humanize.randomDelay();
        await humanize.typeIntoElement(passwordInput, credentials.password);
      }, context);

      // Step 3: Submit login
      await executeStep('submit_login', async () => {
        await humanize.randomDelay();
        let submitButton;
        try {
          submitButton = await humanize.waitForElementWithText('button', 'Ingresar', 3000);
        } catch (e) {
          try {
            submitButton = await humanize.waitForElementWithTextCI('button', 'login', 2000);
          } catch (e2) {
            try {
              submitButton = await humanize.waitForElementWithTextCI('button', 'entrar', 2000);
            } catch (e3) {
              submitButton = document.querySelector('button[type="submit"], input[type="submit"]');
            }
          }
        }
        if (!submitButton) {
          throw new Error('Submit button not found');
        }
        await humanize.clickElement(submitButton);
      }, context);

      // Step 4: Verify login success (SPA-aware: wait for content change, not page load)
      await executeStep('verify_login', async () => {
        // Wait for either: login error appears, or user menu/logout link appears, or URL changes
        const startTime = Date.now();
        const timeout = 15000;

        while (Date.now() - startTime < timeout) {
          // Check for error message
          const errorMsg = document.querySelector(SELECTORS.ERROR_MESSAGE);
          if (errorMsg && errorMsg.offsetParent !== null) {
            throw new Error(`Panel login error: ${errorMsg.textContent.trim()}`);
          }

          // Check for SweetAlert error
          const swalError = document.querySelector('.swal2-popup .swal2-icon.swal2-error');
          if (swalError) {
            const swalText = document.querySelector('.swal2-popup .swal2-html-container, .swal2-popup .swal2-content');
            throw new Error(`Panel login error: ${swalText?.textContent?.trim() || 'Error desconocido'}`);
          }

          // Check for successful login indicators
          const logoutLink = document.querySelector('a[href*="logout"], a[href*="salir"], a[href*="cerrar"]');
          const userMenu = document.querySelector(SELECTORS.USER_MENU);
          const noLoginForm = !document.querySelector('input[type="password"]');

          if ((logoutLink || userMenu) && noLoginForm) {
            humanize.log('Login verified: user menu or logout link found');
            return;
          }

          // Also check if URL changed away from login page
          if (!window.location.pathname.includes('login') && noLoginForm) {
            humanize.log('Login verified: redirected away from login page');
            return;
          }

          await new Promise(resolve => setTimeout(resolve, 300));
        }

        throw new Error('Login verification timed out — no user menu or logout link found');
      }, { ...context, selector: SELECTORS.USER_MENU });

      humanize.log('Login successful');
      return { success: true };

    } catch (error) {
      humanize.log('Login failed', error.message);

      // Classify error for upstream decision-making
      let errorType = 'UNKNOWN';
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('panel login error') || msg.includes('credenciales') || msg.includes('incorrecta') || msg.includes('invalid')) {
        errorType = 'BAD_CREDENTIALS';
      } else if (msg.includes('timeout') || msg.includes('timed out')) {
        errorType = 'PANEL_SLOW';
      } else if (msg.includes('no encontrado') || msg.includes('not found') || msg.includes('elemento no encontrado')) {
        errorType = 'SELECTOR_CHANGED';
      } else if (msg.includes('net::') || msg.includes('fetch') || msg.includes('network')) {
        errorType = 'PANEL_DOWN';
      }

      return {
        success: false,
        error: error.message,
        errorType,
      };
    }
  },

  /**
   * Load credits to target user (TioRico workflow)
   */
  async loadCredits(jobData) {
    const context = {
      targetUsername: jobData.targetUsername,
      amount: jobData.amount
    };

    try {
      humanize.log('Starting credit load for TioRico panel', jobData);

      // Log config for debugging
      const config = await humanize.loadConfig();
      await humanize.debug('Credit load using config', {
        minDelay: config.minDelay,
        maxDelay: config.maxDelay,
        debugMode: config.debugMode
      });

      // Step 1: Navigate to users page if not already there
      await executeStep('navigate_to_users_page', async () => {
        // Check if already on users page (check for 'users' anywhere in path)
        if (window.location.pathname.includes('users') || window.location.href.includes('users')) {
          humanize.log('Already on users page');
          return;
        }

        // Try to find and click the users link in the sidebar/nav
        const selectors = SELECTORS.USERS_PAGE_LINK.split(', ');
        let usersLink = null;
        for (const sel of selectors) {
          usersLink = document.querySelector(sel);
          if (usersLink && usersLink.offsetParent !== null) break;
          usersLink = null;
        }

        if (!usersLink) {
          // Fallback: look for any link with 'usuario' text
          const allLinks = Array.from(document.querySelectorAll('a'));
          usersLink = allLinks.find(a => {
            const text = a.textContent.toLowerCase();
            return text.includes('usuario') || text.includes('users') || text.includes('jugador');
          });
        }

        if (!usersLink) {
          throw new Error('Users page link not found in navigation');
        }

        humanize.log('Found users link:', { href: usersLink.getAttribute('href'), text: usersLink.textContent.trim() });
        await humanize.clickElement(usersLink);

        // SPA navigation: wait for the search input or table to appear (not page load)
        const searchOrTable = await waitForSPAContent('#filter-input, input[type="search"], input[placeholder*="uscar"], table', 10000);
        if (!searchOrTable) {
          // Wait additional time for Nuxt/Vue to render
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }, context);

      // Step 2: Type username into search input
      await executeStep('type_search_query', async () => {
        // Try multiple selectors for the search input
        const selectors = SELECTORS.USER_SEARCH_INPUT.split(', ');
        let searchInput = null;

        for (const sel of selectors) {
          try {
            searchInput = await humanize.waitForElementReady(sel.trim(), { timeout: 3000 });
            if (searchInput) break;
          } catch (e) {
            // Try next selector
          }
        }

        if (!searchInput) {
          // Ultimate fallback: find any visible text input on the page
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
          searchInput = inputs.find(inp => inp.offsetParent !== null && !inp.type.includes('hidden'));
          if (searchInput) {
            humanize.log('Using fallback search input:', { name: searchInput.name, placeholder: searchInput.placeholder, id: searchInput.id });
          }
        }

        if (!searchInput) {
          throw new Error('Search input not found on users page');
        }

        // Type username (typeIntoElement handles clearing via select+delete)
        await humanize.typeIntoElement(searchInput, jobData.targetUsername);

        // Human-like pause before clicking search
        await humanize.randomDelay(1000, 2000);
      }, { ...context, selector: SELECTORS.USER_SEARCH_INPUT });

      // Step 3: Click "BUSCAR" button to trigger search
      await executeStep('click_buscar_button', async () => {
        let buscarButton = null;

        // Try finding button by text (case-insensitive)
        try {
          buscarButton = await humanize.waitForElementWithTextCI('button', 'buscar', 3000);
        } catch (e) {
          // Try input[type="submit"] with value
          try {
            buscarButton = await humanize.waitForElementWithTextCI('input', 'buscar', 2000);
          } catch (e2) {
            // Try any submit button near the search input
            buscarButton = document.querySelector('button[type="submit"], input[type="submit"], form button');
          }
        }

        if (!buscarButton) {
          // Last resort: maybe search triggers on input change (SPA reactive)
          humanize.log('No search button found — search may be reactive (auto-filter)');
          // Press Enter in the search input to trigger search
          const searchInput = document.querySelector(SELECTORS.USER_SEARCH_INPUT);
          if (searchInput) {
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
          }
          return;
        }

        await humanize.clickElement(buscarButton);
      }, context);

      // Step 4: Wait for search results table to load with the user
      await executeStep('wait_for_search_results', async () => {
        const startTime = Date.now();
        const timeout = 15000;
        const targetLower = jobData.targetUsername.toLowerCase().trim();

        while (Date.now() - startTime < timeout) {
          // Wait for DataTables processing overlay to disappear (TioRico uses DataTables)
          const processing = document.querySelector(SELECTORS.DATATABLE_PROCESSING);
          if (processing && processing.offsetParent !== null && getComputedStyle(processing).display !== 'none') {
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }

          const rows = document.querySelectorAll('table tbody tr');
          if (rows.length > 0) {
            for (let i = 0; i < rows.length; i++) {
              // TioRico: username is in <span class="color"> with leading/trailing spaces
              const usernameSpan = rows[i].querySelector('span.color, td:first-child span, span.username, span.user-name');
              const rowText = usernameSpan
                ? usernameSpan.textContent.trim().toLowerCase()
                : rows[i].textContent.toLowerCase();

              if (rowText.includes(targetLower)) {
                humanize.log(`Search results loaded, user found in row ${i + 1}`);
                return;
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Log what we found for debugging
        const rows = document.querySelectorAll('table tbody tr');
        humanize.log('Search results timeout. Rows found:', rows.length);
        if (rows.length > 0) {
          const spans = rows[0].querySelectorAll('span.color');
          humanize.log('First row username span:', spans.length > 0 ? spans[0].textContent : 'no span.color');
          humanize.log('First row text:', rows[0].textContent.substring(0, 200));
        }

        throw new Error(`User "${jobData.targetUsername}" not found in search results after ${timeout}ms`);
      }, context);

      // Step 5: Get the "Add Credits" href from the <a> tag in the matching row
      const addCreditsHref = await executeStep('get_add_credits_href', async () => {
        // Find the row containing our target username
        const rows = document.querySelectorAll('table tbody tr');
        const targetLower = jobData.targetUsername.toLowerCase().trim();
        let targetRow = null;
        for (const row of rows) {
          // TioRico: username in <span class="color"> with leading/trailing spaces
          const usernameSpan = row.querySelector('span.color, td:first-child span, span.username, span.user-name');
          const rowText = usernameSpan
            ? usernameSpan.textContent.trim().toLowerCase()
            : row.textContent.toLowerCase();
          if (rowText.includes(targetLower)) {
            targetRow = row;
            break;
          }
        }

        if (!targetRow) {
          throw new Error('Target user row not found after search');
        }

        // TioRico: <a class="action-plus" data-username="..." data-balance="...">
        //   <i class="fas fa-plus"></i>
        // </a>  — NO href attribute (Vue.js click handler)
        let addButton = targetRow.querySelector(SELECTORS.ADD_CREDITS_BUTTON_ROW);

        // Fallback: look for icon-based match
        if (!addButton) {
          const iconSelectors = SELECTORS.ADD_CREDITS_BUTTON_ICON.split(', ');
          for (const sel of iconSelectors) {
            const icon = targetRow.querySelector(sel.trim());
            if (icon) {
              addButton = icon.closest('a') || icon.closest('button');
              if (addButton) break;
            }
          }
        }

        if (!addButton) {
          // Last resort: look for any action button with plus/add/credit text
          const allLinks = targetRow.querySelectorAll('a, button');
          for (const link of allLinks) {
            const text = link.textContent.toLowerCase();
            const title = (link.getAttribute('title') || '').toLowerCase();
            const hasPlus = link.querySelector('.fa-plus, .fa-plus-circle, .fas.fa-plus');
            if (hasPlus || text.includes('agregar') || text.includes('cargar') || text.includes('credit') || title.includes('agregar') || title.includes('credit')) {
              addButton = link;
              break;
            }
          }
        }

        if (!addButton) {
          // Log all links in the row for debugging
          const links = targetRow.querySelectorAll('a, button');
          humanize.log('Available actions in target row:', Array.from(links).map(l => ({
            tag: l.tagName,
            text: l.textContent.trim().substring(0, 50),
            href: l.getAttribute('href'),
            title: l.getAttribute('title'),
            classes: l.className,
            dataUsername: l.getAttribute('data-username')
          })));
          throw new Error('Add credits button not found in target row');
        }

        humanize.log('Found add credits button:', {
          tag: addButton.tagName,
          text: addButton.textContent.trim(),
          href: addButton.getAttribute('href'),
          classes: addButton.className,
          dataUsername: addButton.getAttribute('data-username'),
          dataBalance: addButton.getAttribute('data-balance')
        });

        const href = addButton.getAttribute('href');
        if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('#')) {
          // Not a navigation link — click it directly (opens modal on same page)
          // TioRico: <a class="action-plus"> has no href, Vue handles the click
          await humanize.clickElement(addButton);

          // Wait for modal to appear (SPA-aware polling)
          // TioRico modal uses opacity for visibility, not display:block or .show class
          const modalTimeout = 5000;
          const modalStart = Date.now();
          let modalFound = false;
          while (Date.now() - modalStart < modalTimeout) {
            const modals = document.querySelectorAll(SELECTORS.MODAL);
            for (const m of modals) {
              const style = getComputedStyle(m);
              const isVisible = (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                (
                  parseFloat(style.opacity) > 0 ||
                  m.offsetParent !== null ||
                  m.classList.contains('show') ||
                  style.display === 'block'
                )
              );
              if (isVisible) {
                humanize.log('Modal appeared after clicking add button', {
                  class: m.className,
                  opacity: style.opacity,
                  display: style.display
                });
                modalFound = true;
                break;
              }
            }
            if (modalFound) break;
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          if (modalFound) {
            return null; // Signal: no navigation needed, modal flow
          }

          // Check if URL changed (SPA navigation)
          humanize.log('No modal detected, checking if SPA navigation happened');
          return null;
        }

        // Resolve relative href to absolute URL
        const absoluteUrl = new URL(href, window.location.origin).href;
        humanize.log('Add credits href extracted', { href, absoluteUrl });
        return absoluteUrl;
      }, { ...context, selector: SELECTORS.ADD_CREDITS_BUTTON_ROW });

      // If href was returned, the job-processor will navigate and call fillAmountAndSubmit.
      if (addCreditsHref) {
        return {
          success: true,
          navigateTo: addCreditsHref,
          phase: 'NAVIGATE_TO_ADD_CREDITS'
        };
      }

      // Modal flow: return signal so job-processor calls fillAmountAndSubmit
      // in a separate executeScript (avoids execution context being lost on SPA re-render)
      return {
        success: true,
        phase: 'MODAL_OPEN',
      };

    } catch (error) {
      humanize.log('Credit load failed', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Phase 2: Fill amount and submit on the add-credits page (called by job-processor
   * after navigating to the href extracted in loadCredits phase 1).
   */
  async fillAmountAndSubmit(jobData) {
    const context = {
      targetUsername: jobData.targetUsername,
      amount: jobData.amount
    };

    try {
      humanize.log('Starting fillAmountAndSubmit (phase 2)', jobData);
      return await this._fillAmountAndSubmit(jobData, context);
    } catch (error) {
      humanize.log('fillAmountAndSubmit failed', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Internal: fill amount input and submit (shared by modal flow and navigation flow)
   */
  async _fillAmountAndSubmit(jobData, context) {
    // Step 6: Wait for the amount input to appear (modal or page form)
    await executeStep('wait_for_amount_input', async () => {
      // Wait for either a modal or an input to be ready (SPA-aware)
      const startTime = Date.now();
      const timeout = 8000;

      while (Date.now() - startTime < timeout) {
        // Check for any input that could be the amount field
        const selectors = SELECTORS.MODAL_AMOUNT_INPUT.split(', ');
        for (const sel of selectors) {
          const input = document.querySelector(sel.trim());
          if (input && input.offsetParent !== null) {
            humanize.log('Amount input found via selector:', sel.trim());
            return;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Try fallback
      const fallbackSelectors = SELECTORS.MODAL_AMOUNT_INPUT_FALLBACK.split(', ');
      for (const sel of fallbackSelectors) {
        const input = document.querySelector(sel.trim());
        if (input && input.offsetParent !== null) {
          humanize.log('Amount input found via fallback selector:', sel.trim());
          return;
        }
      }

      // Log all visible inputs for debugging
      const inputs = Array.from(document.querySelectorAll('input'));
      humanize.log('All visible inputs on page:', inputs.filter(i => i.offsetParent !== null).map(i => ({
        type: i.type, name: i.name, placeholder: i.placeholder,
        ariaLabel: i.getAttribute('aria-label'), id: i.id,
        inputmode: i.getAttribute('inputmode')
      })));

      throw new Error('Amount input not found after waiting');
    }, context);

    // Step 7: Fill amount input
    await executeStep('fill_amount', async () => {
      let amountInput = null;

      // Try primary selectors
      const selectors = SELECTORS.MODAL_AMOUNT_INPUT.split(', ');
      for (const sel of selectors) {
        const input = document.querySelector(sel.trim());
        if (input && input.offsetParent !== null) {
          amountInput = input;
          break;
        }
      }

      // Try fallback selectors
      if (!amountInput) {
        const fallbackSelectors = SELECTORS.MODAL_AMOUNT_INPUT_FALLBACK.split(', ');
        for (const sel of fallbackSelectors) {
          const input = document.querySelector(sel.trim());
          if (input && input.offsetParent !== null) {
            amountInput = input;
            break;
          }
        }
      }

      if (!amountInput) {
        throw new Error('Amount input not found');
      }

      humanize.log('Using amount input:', {
        type: amountInput.type, name: amountInput.name,
        ariaLabel: amountInput.getAttribute('aria-label'),
        placeholder: amountInput.placeholder
      });

      // Type amount — always integer, no decimals (fichas are whole numbers)
      const intAmount = Math.floor(parseFloat(jobData.amount) || 0);
      await humanize.typeIntoElement(amountInput, intAmount.toString());

      // No extra Vue tricks needed — the click step handles enabling the button

      // Human-like pause before submitting (review amount)
      await humanize.randomDelay(2000, 4000);
    }, { ...context, selector: SELECTORS.MODAL_AMOUNT_INPUT });

    // Final step: hand off to job-processor.js which clicks Aceptar in MAIN world via
    // chrome.scripting.executeScript({ world: 'MAIN' }) (the only way to bypass the panel's CSP).
    // job-processor also polls for SweetAlert success/error to decide the result, so this
    // function ends here — the legacy in-content-script click + result-polling block was removed.
    return {
      success: true,
      needsMainWorldClick: true,
      targetUsername: jobData.targetUsername,
      amount: jobData.amount,
      message: 'Amount filled, ready for MAIN world click'
    };
  },


  /**
   * Check current login status (SPA-aware)
   */
  async checkLoginStatus() {
    try {
      // Multiple detection strategies
      const hasPasswordInput = !!document.querySelector('input[type="password"]');

      // Check href-based logout links
      let hasLogoutLink = !!document.querySelector(SELECTORS.LOGOUT_LINK);

      // TioRico: logout is <a class="dropdown-item">Salir</a> with NO href
      // Must check by text content since href-based selectors miss it
      if (!hasLogoutLink) {
        const dropdownItems = document.querySelectorAll('.dropdown-item, .dropdown-menu a');
        for (const item of dropdownItems) {
          const text = item.textContent.trim().toLowerCase();
          if (text === 'salir' || text === 'logout' || text === 'cerrar sesión') {
            hasLogoutLink = true;
            break;
          }
        }
      }

      const userMenuSelectors = SELECTORS.USER_MENU.split(', ');
      let hasUserMenu = false;
      for (const sel of userMenuSelectors) {
        if (document.querySelector(sel.trim())) {
          hasUserMenu = true;
          break;
        }
      }

      // TioRico-specific: span.own-username means definitely logged in
      const hasOwnUsername = !!document.querySelector('span.own-username');

      // On login page = not logged in
      const onLoginPage = window.location.pathname.includes('login');

      const status = {
        isLoggedIn: (hasLogoutLink || hasUserMenu || hasOwnUsername) && !hasPasswordInput && !onLoginPage,
        hasUserMenu,
        hasLogoutLink,
        hasOwnUsername,
        hasPasswordInput,
        onLoginPage,
        currentUrl: window.location.href
      };

      await humanize.debug('Login status check', status);
      return status;
    } catch (error) {
      return { isLoggedIn: false, error: error.message };
    }
  },

  /**
   * Read a user's chip balance from the users table.
   * Navigates to users page, searches user, reads data-balance attribute.
   */
  async readUserChipBalance(targetUsername) {
    const context = { targetUsername };

    try {
      humanize.log('Reading chip balance for user', targetUsername);

      // Step 1: Navigate to users page
      await executeStep('navigate_to_users_page', async () => {
        if (window.location.pathname.includes('users') || window.location.href.includes('users')) {
          humanize.log('Already on users page');
          return;
        }
        const selectors = SELECTORS.USERS_PAGE_LINK.split(', ');
        let usersLink = null;
        for (const sel of selectors) {
          usersLink = document.querySelector(sel);
          if (usersLink && usersLink.offsetParent !== null) break;
          usersLink = null;
        }
        if (!usersLink) {
          const allLinks = Array.from(document.querySelectorAll('a'));
          usersLink = allLinks.find(a => {
            const text = a.textContent.toLowerCase();
            return text.includes('usuario') || text.includes('users');
          });
        }
        if (!usersLink) throw new Error('Users page link not found');
        await humanize.clickElement(usersLink);
        await waitForSPAContent('#filter-input, input[type="search"], table', 10000);
      }, context);

      // Step 2: Search for user
      await executeStep('type_search_query', async () => {
        const selectors = SELECTORS.USER_SEARCH_INPUT.split(', ');
        let searchInput = null;
        for (const sel of selectors) {
          try {
            searchInput = await humanize.waitForElementReady(sel.trim(), { timeout: 3000 });
            if (searchInput) break;
          } catch (e) {}
        }
        if (!searchInput) throw new Error('Search input not found');
        await humanize.typeIntoElement(searchInput, targetUsername);
        await humanize.randomDelay(1000, 2000);
      }, context);

      // Step 3: Click search
      await executeStep('click_buscar_button', async () => {
        let buscarButton = null;
        try {
          buscarButton = await humanize.waitForElementWithTextCI('button', 'buscar', 3000);
        } catch (e) {
          buscarButton = document.querySelector('button[type="submit"], input[type="submit"], form button');
        }
        if (buscarButton) {
          await humanize.clickElement(buscarButton);
        } else {
          const searchInput = document.querySelector(SELECTORS.USER_SEARCH_INPUT);
          if (searchInput) {
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          }
        }
      }, context);

      // Step 4: Wait for results and read balance
      return await executeStep('read_balance', async () => {
        const startTime = Date.now();
        const timeout = 15000;
        const targetLower = targetUsername.toLowerCase().trim();

        while (Date.now() - startTime < timeout) {
          const processing = document.querySelector(SELECTORS.DATATABLE_PROCESSING);
          if (processing && processing.offsetParent !== null) {
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }

          const rows = document.querySelectorAll('table tbody tr');
          for (const row of rows) {
            const usernameSpan = row.querySelector('span.color, td:first-child span, span.username, span.user-name');
            const rowText = usernameSpan
              ? usernameSpan.textContent.trim().toLowerCase()
              : row.textContent.toLowerCase();

            if (rowText.includes(targetLower)) {
              // Read data-balance from action buttons
              const actionBtn = row.querySelector('a.action-plus, a.action-minus');
              if (actionBtn) {
                const balance = parseInt(actionBtn.getAttribute('data-balance') || '0', 10);
                humanize.log(`User "${targetUsername}" found, balance: ${balance}`);
                return { success: true, balance };
              }
              // Fallback: read from td.sorting_1
              const balanceCell = row.querySelector('td.sorting_1');
              if (balanceCell) {
                const balance = parseArgentineNumber(balanceCell.textContent);
                humanize.log(`User "${targetUsername}" found (from cell), balance: ${balance}`);
                return { success: true, balance: balance || 0 };
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        return { success: false, error: `User "${targetUsername}" not found in search results` };
      }, context);

    } catch (error) {
      humanize.log('readUserChipBalance failed', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Withdraw chips from a user (click action-minus, fill amount, submit).
   * Same flow as loadCredits but uses the minus button instead of plus.
   */
  async withdrawChips(jobData) {
    const context = {
      targetUsername: jobData.targetUsername,
      amount: jobData.amount
    };

    try {
      humanize.log('Starting chip withdrawal for TioRico panel', jobData);

      // Step 1: Navigate to users page
      await executeStep('navigate_to_users_page', async () => {
        if (window.location.pathname.includes('users') || window.location.href.includes('users')) {
          humanize.log('Already on users page');
          return;
        }
        const selectors = SELECTORS.USERS_PAGE_LINK.split(', ');
        let usersLink = null;
        for (const sel of selectors) {
          usersLink = document.querySelector(sel);
          if (usersLink && usersLink.offsetParent !== null) break;
          usersLink = null;
        }
        if (!usersLink) {
          const allLinks = Array.from(document.querySelectorAll('a'));
          usersLink = allLinks.find(a => a.textContent.toLowerCase().includes('usuario'));
        }
        if (!usersLink) throw new Error('Users page link not found');
        await humanize.clickElement(usersLink);
        await waitForSPAContent('#filter-input, input[type="search"], table', 10000);
      }, context);

      // Step 2: Search for user
      await executeStep('type_search_query', async () => {
        const selectors = SELECTORS.USER_SEARCH_INPUT.split(', ');
        let searchInput = null;
        for (const sel of selectors) {
          try {
            searchInput = await humanize.waitForElementReady(sel.trim(), { timeout: 3000 });
            if (searchInput) break;
          } catch (e) {}
        }
        if (!searchInput) throw new Error('Search input not found');
        await humanize.typeIntoElement(searchInput, jobData.targetUsername);
        await humanize.randomDelay(1000, 2000);
      }, context);

      // Step 3: Click search button
      await executeStep('click_buscar_button', async () => {
        let buscarButton = null;
        try {
          buscarButton = await humanize.waitForElementWithTextCI('button', 'buscar', 3000);
        } catch (e) {
          buscarButton = document.querySelector('button[type="submit"], input[type="submit"], form button');
        }
        if (buscarButton) {
          await humanize.clickElement(buscarButton);
        } else {
          const searchInput = document.querySelector(SELECTORS.USER_SEARCH_INPUT);
          if (searchInput) {
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          }
        }
      }, context);

      // Step 4: Wait for results
      await executeStep('wait_for_search_results', async () => {
        const startTime = Date.now();
        const timeout = 15000;
        const targetLower = jobData.targetUsername.toLowerCase().trim();

        while (Date.now() - startTime < timeout) {
          const processing = document.querySelector(SELECTORS.DATATABLE_PROCESSING);
          if (processing && processing.offsetParent !== null) {
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }
          const rows = document.querySelectorAll('table tbody tr');
          for (const row of rows) {
            const usernameSpan = row.querySelector('span.color, td:first-child span, span.username, span.user-name');
            const rowText = usernameSpan
              ? usernameSpan.textContent.trim().toLowerCase()
              : row.textContent.toLowerCase();
            if (rowText.includes(targetLower)) return;
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        throw new Error(`User "${jobData.targetUsername}" not found in search results`);
      }, context);

      // Step 5: Click action-minus button on the user's row
      await executeStep('click_withdraw_button', async () => {
        const rows = document.querySelectorAll('table tbody tr');
        const targetLower = jobData.targetUsername.toLowerCase().trim();
        let targetRow = null;

        for (const row of rows) {
          const usernameSpan = row.querySelector('span.color, td:first-child span, span.username, span.user-name');
          const rowText = usernameSpan
            ? usernameSpan.textContent.trim().toLowerCase()
            : row.textContent.toLowerCase();
          if (rowText.includes(targetLower)) {
            targetRow = row;
            break;
          }
        }

        if (!targetRow) throw new Error('Target user row not found after search');

        const minusButton = targetRow.querySelector(SELECTORS.SUBTRACT_CREDITS_BUTTON_ROW);
        if (!minusButton) {
          // Fallback: look for fa-minus icon
          const minusIcon = targetRow.querySelector('.fas.fa-minus, .fa.fa-minus, .fa-minus');
          const btn = minusIcon?.closest('a') || minusIcon?.closest('button');
          if (!btn) throw new Error('Subtract credits button (action-minus) not found in user row');
          await humanize.clickElement(btn);
          return;
        }

        await humanize.clickElement(minusButton);
      }, context);

      // Step 6: Wait for modal to appear
      await executeStep('wait_for_withdraw_modal', async () => {
        const startTime = Date.now();
        const timeout = 10000;
        while (Date.now() - startTime < timeout) {
          const modal = document.querySelector(SELECTORS.MODAL);
          if (modal) {
            const style = getComputedStyle(modal);
            if (style.opacity !== '0' && style.display !== 'none') {
              humanize.log('Withdraw modal appeared');
              return;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('Withdraw modal did not appear');
      }, context);

      // Step 7: Fill amount and submit (same modal as add credits)
      return await this._fillAmountAndSubmit(jobData, context);

    } catch (error) {
      humanize.log('Chip withdrawal failed', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Change a user's password on the panel.
   * Navigates to users page, searches user, clicks key icon, fills modal, submits.
   */
  async changePassword(jobData) {
    const context = {
      targetUsername: jobData.targetUsername,
    };

    try {
      humanize.log('Starting password change for user', { targetUsername: jobData.targetUsername });

      // Step 1: Navigate to users page
      await executeStep('navigate_to_users_page', async () => {
        if (window.location.pathname.includes('users') || window.location.href.includes('users')) {
          humanize.log('Already on users page');
          return;
        }
        const selectors = SELECTORS.USERS_PAGE_LINK.split(', ');
        let usersLink = null;
        for (const sel of selectors) {
          usersLink = document.querySelector(sel);
          if (usersLink && usersLink.offsetParent !== null) break;
          usersLink = null;
        }
        if (!usersLink) {
          const allLinks = Array.from(document.querySelectorAll('a'));
          usersLink = allLinks.find(a => {
            const text = a.textContent.toLowerCase();
            return text.includes('usuario') || text.includes('users');
          });
        }
        if (!usersLink) throw new Error('Users page link not found');
        await humanize.clickElement(usersLink);
        await waitForSPAContent('#filter-input, input[type="search"], table', 10000);
      }, context);

      // Step 2: Search for user
      await executeStep('type_search_query', async () => {
        const selectors = SELECTORS.USER_SEARCH_INPUT.split(', ');
        let searchInput = null;
        for (const sel of selectors) {
          try {
            searchInput = await humanize.waitForElementReady(sel.trim(), { timeout: 3000 });
            if (searchInput) break;
          } catch (e) {}
        }
        if (!searchInput) throw new Error('Search input not found');
        await humanize.typeIntoElement(searchInput, jobData.targetUsername);
        await humanize.randomDelay(1000, 2000);
      }, context);

      // Step 3: Click BUSCAR (aligned with loadCredits' robust approach)
      await executeStep('click_buscar_button', async () => {
        let buscarButton = null;

        try {
          buscarButton = await humanize.waitForElementWithTextCI('button', 'buscar', 3000);
        } catch (e) {
          try {
            buscarButton = await humanize.waitForElementWithTextCI('input', 'buscar', 2000);
          } catch (e2) {
            buscarButton = document.querySelector('button[type="submit"], input[type="submit"], form button');
          }
        }

        if (!buscarButton) {
          humanize.log('No search button found — triggering Enter key');
          const searchInput = document.querySelector(SELECTORS.USER_SEARCH_INPUT);
          if (searchInput) {
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
          }
          return;
        }

        await humanize.clickElement(buscarButton);
      }, context);

      // Step 4: Wait for search results — poll until target user appears in table
      await executeStep('wait_for_search_results', async () => {
        const startTime = Date.now();
        const timeout = 15000;
        const targetLower = jobData.targetUsername.toLowerCase().trim();

        while (Date.now() - startTime < timeout) {
          // Wait for DataTables processing overlay to disappear
          const processing = document.querySelector(SELECTORS.DATATABLE_PROCESSING);
          if (processing && processing.offsetParent !== null && getComputedStyle(processing).display !== 'none') {
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }

          // Check if user appears in table rows
          const rows = document.querySelectorAll('table tbody tr');
          if (rows.length > 0) {
            for (const row of rows) {
              const usernameSpan = row.querySelector('span.color, td:first-child span, span.username, span.user-name');
              const rowText = usernameSpan
                ? usernameSpan.textContent.trim().toLowerCase()
                : row.textContent.toLowerCase();
              if (rowText.includes(targetLower)) {
                humanize.log('User found in search results for password change');
                return;
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Log for debugging
        const rows = document.querySelectorAll('table tbody tr');
        humanize.log('Search results timeout. Rows found:', rows.length);
        if (rows.length > 0) {
          const spans = rows[0].querySelectorAll('span.color');
          humanize.log('First row username span:', spans.length > 0 ? spans[0].textContent : 'no span.color');
        }

        throw new Error(`User "${jobData.targetUsername}" not found in search results after ${timeout}ms`);
      }, context);

      // Step 5: Find the password change button in target row (using span.color like loadCredits)
      await executeStep('find_and_click_password_button', async () => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const targetLower = jobData.targetUsername.toLowerCase().trim();
        let targetRow = null;
        for (const row of rows) {
          const usernameSpan = row.querySelector('span.color, td:first-child span, span.username, span.user-name');
          const rowText = usernameSpan
            ? usernameSpan.textContent.trim().toLowerCase()
            : row.textContent.toLowerCase();
          if (rowText.includes(targetLower)) {
            targetRow = row;
            break;
          }
        }
        if (!targetRow) throw new Error(`User row not found for "${jobData.targetUsername}"`);

        // Find the password change button (key icon) in this row
        let pwButton = targetRow.querySelector(SELECTORS.CHANGE_PASSWORD_BUTTON);
        if (!pwButton) {
          // Fallback: look for any link with fa-key icon
          const icons = targetRow.querySelectorAll('i.fas.fa-key, i.fa.fa-key');
          if (icons.length > 0) pwButton = icons[0].closest('a') || icons[0].parentElement;
        }
        if (!pwButton) throw new Error('Password change button (key icon) not found in user row');

        humanize.log('Found password button', { dataId: pwButton.getAttribute('data-id') });
        await humanize.clickElement(pwButton);
      }, context);

      // Step 6: Wait for password modal
      await executeStep('wait_for_password_modal', async () => {
        let modal = null;
        let attempts = 0;
        while (!modal && attempts < 30) {
          const modals = document.querySelectorAll(SELECTORS.PASSWORD_MODAL);
          for (const m of modals) {
            const style = window.getComputedStyle(m);
            if (style.opacity !== '0' && style.display !== 'none') {
              modal = m;
              break;
            }
          }
          if (!modal) {
            await new Promise(r => setTimeout(r, 300));
            attempts++;
          }
        }
        if (!modal) throw new Error('Password change modal did not appear');
        humanize.log('Password modal appeared');
        await humanize.randomDelay(500, 1000);
      }, context);

      // Step 7: Fill password fields
      await executeStep('fill_password_fields', async () => {
        // Find password inputs inside the modal
        const modal = document.querySelector(SELECTORS.PASSWORD_MODAL);
        if (!modal) throw new Error('Modal disappeared');

        const passwordInputs = modal.querySelectorAll('input[type="password"]');
        if (passwordInputs.length < 2) throw new Error(`Expected 2 password inputs, found ${passwordInputs.length}`);

        // First field: new password
        await humanize.typeIntoElement(passwordInputs[0], jobData.newPassword);
        await humanize.randomDelay(500, 1000);

        // Second field: confirm password
        await humanize.typeIntoElement(passwordInputs[1], jobData.newPassword);
        await humanize.randomDelay(500, 1000);
      }, context);

      // Step 8: Click Aceptar
      await executeStep('click_aceptar', async () => {
        const modal = document.querySelector(SELECTORS.PASSWORD_MODAL);
        if (!modal) throw new Error('Modal disappeared');

        let submitBtn = modal.querySelector(SELECTORS.PASSWORD_SUBMIT);
        if (!submitBtn) {
          // Fallback: find button with "Aceptar" text
          const buttons = Array.from(modal.querySelectorAll('button'));
          submitBtn = buttons.find(b => b.textContent.trim().toLowerCase().includes('aceptar'));
        }
        if (!submitBtn) throw new Error('Aceptar button not found in modal');

        await humanize.clickElement(submitBtn);
      }, context);

      // Step 9: Verify result
      await executeStep('verify_password_change', async () => {
        // Wait for modal to close or success/error to appear
        let attempts = 0;
        while (attempts < 30) {
          // Check for success message (SweetAlert or toast)
          const success = document.querySelector(SELECTORS.SUCCESS_MESSAGE);
          if (success && success.offsetParent !== null) {
            humanize.log('Password change success message detected');
            return;
          }

          // Check for error message
          const error = document.querySelector(SELECTORS.ERROR_MESSAGE);
          if (error && error.offsetParent !== null) {
            throw new Error(`Panel error: ${error.textContent.trim()}`);
          }

          // Check if modal closed (success)
          const modal = document.querySelector(SELECTORS.PASSWORD_MODAL);
          if (!modal || window.getComputedStyle(modal).opacity === '0' || window.getComputedStyle(modal).display === 'none') {
            humanize.log('Modal closed — password change likely succeeded');
            return;
          }

          await new Promise(r => setTimeout(r, 300));
          attempts++;
        }
        // If we get here, assume success (modal still open but no error)
        humanize.log('No error detected after timeout — assuming success');
      }, context);

      humanize.log('Password change completed successfully');
      return {
        success: true,
        targetUsername: jobData.targetUsername,
        message: 'Password changed successfully'
      };

    } catch (error) {
      humanize.log('Password change failed', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Create a new user on the panel.
   * Clicks "Nuevo usuario" button, fills nickname + password, submits.
   * Password is always "123casino".
   */
  async createUser(targetUsername) {
    const context = { targetUsername };
    const DEFAULT_PASSWORD = '123casino';

    try {
      humanize.log('Starting user creation on panel', { targetUsername });

      // Step 1: Navigate to users page (skip if already there)
      await executeStep('navigate_to_users_page', async () => {
        // Check if we're already on users page by URL or by visible elements
        const onUsersPage = window.location.pathname.includes('users')
          || window.location.href.includes('users')
          || document.querySelector('#filter-input, table.users, .btn .fa-user-plus');
        if (onUsersPage) {
          humanize.log('Already on users page (detected by URL or DOM elements)');
          return;
        }
        const selectors = SELECTORS.USERS_PAGE_LINK.split(', ');
        let usersLink = null;
        for (const sel of selectors) {
          usersLink = document.querySelector(sel);
          if (usersLink && usersLink.offsetParent !== null) break;
          usersLink = null;
        }
        if (!usersLink) {
          const allLinks = Array.from(document.querySelectorAll('a'));
          usersLink = allLinks.find(a => {
            const text = a.textContent.toLowerCase();
            return text.includes('usuario') || text.includes('users') || text.includes('jugador');
          });
        }
        if (!usersLink) {
          // Last resort: if filter-input or users table exists, we're probably on the page
          if (document.querySelector('#filter-input, table.users')) {
            humanize.log('Users page elements found despite URL mismatch — continuing');
            return;
          }
          throw new Error('Users page link not found in navigation');
        }
        await humanize.clickElement(usersLink);
        const searchOrTable = await waitForSPAContent('#filter-input, input[type="search"], table', 10000);
        if (!searchOrTable) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }, context);

      // Step 2: Click "Nuevo usuario" button
      await executeStep('click_new_user_button', async () => {
        let newUserBtn = null;

        // Find button.btn.btn-danger that contains the fa-user-plus icon
        const dangerButtons = document.querySelectorAll(SELECTORS.NEW_USER_BUTTON);
        for (const btn of dangerButtons) {
          const icon = btn.querySelector(SELECTORS.NEW_USER_BUTTON_ICON);
          if (icon) {
            newUserBtn = btn;
            break;
          }
        }

        // Fallback: find any button with text "Nuevo usuario"
        if (!newUserBtn) {
          const allButtons = Array.from(document.querySelectorAll('button'));
          newUserBtn = allButtons.find(b => b.textContent.toLowerCase().includes('nuevo usuario'));
        }

        if (!newUserBtn) throw new Error('Nuevo usuario button not found');

        humanize.log('Found Nuevo usuario button', {
          text: newUserBtn.textContent.trim(),
          classes: newUserBtn.className
        });

        await humanize.clickElement(newUserBtn);
      }, context);

      // Step 3: Wait for the new user modal (.insert-mo.modal) to appear
      await executeStep('wait_for_new_user_modal', async () => {
        const startTime = Date.now();
        const timeout = 8000;

        while (Date.now() - startTime < timeout) {
          const modal = document.querySelector(SELECTORS.NEW_USER_MODAL);
          if (modal) {
            const style = getComputedStyle(modal);
            const isVisible = (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              (parseFloat(style.opacity) > 0 || modal.offsetParent !== null)
            );
            if (isVisible) {
              humanize.log('New user modal appeared', {
                opacity: style.opacity,
                display: style.display
              });
              return;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('New user modal (.insert-mo.modal) did not appear');
      }, context);

      // Small pause to let the modal fully render
      await humanize.randomDelay(500, 1000);

      // Step 4: Fill nickname
      await executeStep('fill_nickname', async () => {
        let nicknameInput = document.querySelector(SELECTORS.NEW_USER_NICKNAME_INPUT);

        // Fallback: find text input inside .insert-mo modal
        if (!nicknameInput) {
          const modalInputs = document.querySelectorAll('.insert-mo input[type="text"]:not([disabled])');
          nicknameInput = Array.from(modalInputs).find(i => i.offsetParent !== null);
        }

        if (!nicknameInput) throw new Error('Nickname input not found in new user modal');

        humanize.log('Found nickname input', {
          ariaLabel: nicknameInput.getAttribute('aria-label'),
          placeholder: nicknameInput.placeholder
        });

        await humanize.typeIntoElement(nicknameInput, targetUsername);
        await humanize.randomDelay(800, 1500);
      }, { ...context, selector: SELECTORS.NEW_USER_NICKNAME_INPUT });

      // Step 5: Fill password
      await executeStep('fill_password', async () => {
        let passwordInput = document.querySelector(SELECTORS.NEW_USER_PASSWORD_INPUT);

        // Fallback: find password input inside .insert-mo modal
        if (!passwordInput) {
          const modalPasswords = document.querySelectorAll('.insert-mo input[type="password"]');
          passwordInput = Array.from(modalPasswords).find(i => i.offsetParent !== null);
        }

        if (!passwordInput) throw new Error('Password input not found in new user modal');

        humanize.log('Found password input', {
          ariaLabel: passwordInput.getAttribute('aria-label')
        });

        await humanize.typeIntoElement(passwordInput, DEFAULT_PASSWORD);
        await humanize.randomDelay(1000, 2000);
      }, { ...context, selector: SELECTORS.NEW_USER_PASSWORD_INPUT });

      // Step 6: Return — the click will be done by job-processor via MAIN world
      // (inline script injection is blocked by CSP on this panel)
      return {
        success: true,
        needsMainWorldClick: true,
        targetUsername,
        password: DEFAULT_PASSWORD,
        message: 'Nickname and password filled, ready for MAIN world click'
      };

      // LEGACY Step 6: Click Aceptar — inject into MAIN world for Vue compatibility
      // Must run in MAIN world so Vue's reactive system picks up the click
      await executeStep('click_create_submit', async () => {
        const script = document.createElement('script');
        script.textContent = `
          (function() {
            try {
              // Sync Vue v-model: force-set input values via Vue's __vue__ internals
              var modal = document.querySelector('.insert-mo.modal');
              if (modal) {
                var nicknameInput = modal.querySelector('input[type="text"][aria-label="Nickname"]')
                  || modal.querySelector('input[type="text"].form-control');
                var passwordInput = modal.querySelector('input[type="password"][aria-label="Contraseña"]')
                  || modal.querySelector('input[type="password"].form-control');

                // Force-set values via native setter + dispatch input events in MAIN world
                var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                if (nicknameInput) {
                  nativeSetter.call(nicknameInput, nicknameInput.value);
                  nicknameInput.dispatchEvent(new Event('input', { bubbles: true }));
                  nicknameInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (passwordInput) {
                  nativeSetter.call(passwordInput, passwordInput.value);
                  passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
                  passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }

              // Wait a tick for Vue reactivity then click
              setTimeout(function() {
                // Find and click the Aceptar button
                var btn = document.querySelector('.insert-mo button[type="submit"].btn.btn-cyan');
                if (!btn) {
                  btn = document.querySelector('.insert-mo button[type="submit"]');
                }
                if (!btn) {
                  var allBtns = document.querySelectorAll('.insert-mo button');
                  for (var i = 0; i < allBtns.length; i++) {
                    if (allBtns[i].textContent.trim().toLowerCase().includes('aceptar')) {
                      btn = allBtns[i]; break;
                    }
                  }
                }
                if (!btn) {
                  console.error('[Bot] Aceptar button not found in new user modal');
                  return;
                }
                console.log('[Bot] Found create user button:', btn.textContent.trim());
                btn.removeAttribute('aria-disabled');
                btn.disabled = false;
                btn.click();
                console.log('[Bot] Clicked Aceptar (create user)');

                // Fallback: also submit the form directly
                var form = document.querySelector('.insert-mo form.formSubmit, .insert-mo form');
                if (form) {
                  setTimeout(function() { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }, 200);
                }
              }, 100);
            } catch(e) {
              console.error('[Bot] Error in create user submit:', e);
            }
          })();
        `;
        document.documentElement.appendChild(script);
        script.remove();
        humanize.log('Injected main-world click script for create user Aceptar button');
        await humanize.randomDelay(1000, 2000);
      }, context);

      // Step 7: Wait for result (SweetAlert success/error or modal close)
      return await executeStep('wait_for_create_result', async () => {
        const startTime = Date.now();
        const timeout = 15000;

        while (Date.now() - startTime < timeout) {
          // Check for SweetAlert2 success
          const swalSuccess = document.querySelector('.swal2-popup .swal2-icon.swal2-success');
          if (swalSuccess) {
            const swalText = document.querySelector('.swal2-popup .swal2-html-container, .swal2-popup .swal2-content, .swal2-popup .swal2-title');
            const successText = swalText?.textContent?.trim() || 'User created (SweetAlert)';
            humanize.log('User creation successful (SweetAlert)!', { message: successText });
            return {
              success: true,
              targetUsername,
              password: DEFAULT_PASSWORD,
              message: successText
            };
          }

          // Check for SweetAlert2 error
          const swalError = document.querySelector('.swal2-popup .swal2-icon.swal2-error');
          if (swalError) {
            const swalText = document.querySelector('.swal2-popup .swal2-html-container, .swal2-popup .swal2-content, .swal2-popup .swal2-title');
            throw new Error(`Panel returned error: ${swalText?.textContent?.trim() || 'Error desconocido'}`);
          }

          // Check for standard error message
          const errorMsg = document.querySelector(SELECTORS.ERROR_MESSAGE);
          if (errorMsg && errorMsg.offsetParent !== null) {
            throw new Error(`Panel returned error: ${errorMsg.textContent.trim()}`);
          }

          // Check if modal closed (indicates success)
          const modalEl = document.querySelector(SELECTORS.NEW_USER_MODAL);
          if (modalEl) {
            const modalStyle = getComputedStyle(modalEl);
            const isHidden = (
              modalStyle.display === 'none' ||
              modalStyle.visibility === 'hidden' ||
              parseFloat(modalStyle.opacity) === 0 ||
              modalEl.offsetParent === null
            );
            if (isHidden) {
              humanize.log('New user modal closed - assuming success');
              return {
                success: true,
                targetUsername,
                password: DEFAULT_PASSWORD,
                message: 'User created successfully (modal closed)'
              };
            }
          } else {
            // Modal removed from DOM entirely = success
            humanize.log('New user modal no longer in DOM - assuming success');
            return {
              success: true,
              targetUsername,
              password: DEFAULT_PASSWORD,
              message: 'User created successfully (modal removed)'
            };
          }

          await new Promise(resolve => setTimeout(resolve, 200));
        }

        throw new Error('Timeout waiting for user creation result');
      }, context);

    } catch (error) {
      humanize.log('User creation failed', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Search-only: check if a user exists on the panel without loading credits.
   * Used by the discovery flow to find which panel a user belongs to.
   * Reuses the same search logic as loadCredits (steps 1-4) but stops after finding the user.
   */
  async searchOnly(targetUsername) {
    const context = { targetUsername };

    try {
      humanize.log('Starting search-only for user', { targetUsername });

      const config = await humanize.loadConfig();

      // Step 1: Navigate to users page if not already there
      await executeStep('navigate_to_users_page', async () => {
        if (window.location.pathname.includes('users') || window.location.href.includes('users')) {
          humanize.log('Already on users page');
          return;
        }

        const selectors = SELECTORS.USERS_PAGE_LINK.split(', ');
        let usersLink = null;
        for (const sel of selectors) {
          usersLink = document.querySelector(sel);
          if (usersLink && usersLink.offsetParent !== null) break;
          usersLink = null;
        }

        if (!usersLink) {
          const allLinks = Array.from(document.querySelectorAll('a'));
          usersLink = allLinks.find(a => {
            const text = a.textContent.toLowerCase();
            return text.includes('usuario') || text.includes('users') || text.includes('jugador');
          });
        }

        if (!usersLink) {
          throw new Error('Users page link not found in navigation');
        }

        await humanize.clickElement(usersLink);
        const searchOrTable = await waitForSPAContent('#filter-input, input[type="search"], input[placeholder*="uscar"], table', 10000);
        if (!searchOrTable) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }, context);

      // Step 2: Type username into search input
      await executeStep('type_search_query', async () => {
        const selectors = SELECTORS.USER_SEARCH_INPUT.split(', ');
        let searchInput = null;

        for (const sel of selectors) {
          try {
            searchInput = await humanize.waitForElementReady(sel.trim(), { timeout: 3000 });
            if (searchInput) break;
          } catch (e) {
            // Try next selector
          }
        }

        if (!searchInput) {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
          searchInput = inputs.find(inp => inp.offsetParent !== null && !inp.type.includes('hidden'));
        }

        if (!searchInput) {
          throw new Error('Search input not found on users page');
        }

        await humanize.typeIntoElement(searchInput, targetUsername);
        await humanize.randomDelay(1000, 2000);
      }, { ...context, selector: SELECTORS.USER_SEARCH_INPUT });

      // Step 3: Click "BUSCAR" button
      await executeStep('click_buscar_button', async () => {
        let buscarButton = null;

        try {
          buscarButton = await humanize.waitForElementWithTextCI('button', 'buscar', 3000);
        } catch (e) {
          try {
            buscarButton = await humanize.waitForElementWithTextCI('input', 'buscar', 2000);
          } catch (e2) {
            buscarButton = document.querySelector('button[type="submit"], input[type="submit"], form button');
          }
        }

        if (!buscarButton) {
          humanize.log('No search button found — search may be reactive (auto-filter)');
          const searchInput = document.querySelector(SELECTORS.USER_SEARCH_INPUT);
          if (searchInput) {
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
          }
          return;
        }

        await humanize.clickElement(buscarButton);
      }, context);

      // Step 4: Wait for search results and check if user exists
      const found = await executeStep('check_search_results', async () => {
        const startTime = Date.now();
        const timeout = 15000;
        const targetLower = targetUsername.toLowerCase().trim();

        while (Date.now() - startTime < timeout) {
          const processing = document.querySelector(SELECTORS.DATATABLE_PROCESSING);
          if (processing && processing.offsetParent !== null && getComputedStyle(processing).display !== 'none') {
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }

          // Early exit: DataTables "no data" message means user definitely not found
          const emptyCell = document.querySelector('table tbody .dataTables_empty, table tbody td[colspan]');
          if (emptyCell) {
            const emptyText = emptyCell.textContent.toLowerCase();
            if (emptyText.includes('no data') || emptyText.includes('no hay datos') || emptyText.includes('no matching') || emptyText.includes('no entries')) {
              humanize.log(`User "${targetUsername}" not found — table shows empty message: "${emptyCell.textContent.trim()}"`);
              return false;
            }
          }

          const rows = document.querySelectorAll('table tbody tr');
          if (rows.length > 0) {
            for (let i = 0; i < rows.length; i++) {
              const usernameSpan = rows[i].querySelector('span.color, td:first-child span, span.username, span.user-name');
              const rowText = usernameSpan
                ? usernameSpan.textContent.trim().toLowerCase()
                : rows[i].textContent.toLowerCase();

              if (rowText.includes(targetLower)) {
                humanize.log(`User "${targetUsername}" found in row ${i + 1}`);
                return true;
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Log what we found for debugging
        const rows = document.querySelectorAll('table tbody tr');
        humanize.log('Search-only timeout. Rows found:', rows.length);
        if (rows.length > 0) {
          const spans = rows[0].querySelectorAll('span.color');
          humanize.log('First row username span:', spans.length > 0 ? spans[0].textContent : 'no span.color');
          humanize.log('First row text:', rows[0].textContent.substring(0, 200));
        }

        return false;
      }, context);

      humanize.log(`Search-only result for "${targetUsername}": found=${found}`);
      return { success: true, found };

    } catch (error) {
      humanize.log('searchOnly failed', error.message);
      return { success: false, found: false, error: error.message };
    }
  }
};

// ==========================================
// SELECTOR HEALTH CHECK
// ==========================================

// Required selectors that must match for automation to work
const REQUIRED_SELECTOR_KEYS = [
  // Login
  'LOGIN_USERNAME_INPUT', 'LOGIN_PASSWORD_INPUT', 'LOGIN_SUBMIT_BUTTON',
  // Navigation & search
  'USERS_PAGE_LINK', 'USER_SEARCH_INPUT', 'USER_MENU',
  // Credit loading
  'ADD_CREDITS_BUTTON_ROW', 'MODAL', 'MODAL_AMOUNT_INPUT', 'MODAL_SUBMIT',
  // Feedback
  'SUCCESS_MESSAGE', 'ERROR_MESSAGE', 'OWN_BALANCE',
  // User creation
  'NEW_USER_BUTTON', 'NEW_USER_NICKNAME_INPUT', 'NEW_USER_PASSWORD_INPUT', 'NEW_USER_SUBMIT',
  // Password change
  'CHANGE_PASSWORD_BUTTON', 'PASSWORD_INPUT', 'PASSWORD_CONFIRM_INPUT', 'PASSWORD_SUBMIT',
  // Chip withdrawal
  'SUBTRACT_CREDITS_BUTTON_ROW',
];

/**
 * Validates that required selectors still match elements in the DOM.
 * Returns a report of which selectors matched and which failed.
 */
function validateSelectors() {
  const failed = [];
  let matched = 0;

  for (const key of REQUIRED_SELECTOR_KEYS) {
    const selectorStr = SELECTORS[key];
    if (!selectorStr) {
      failed.push(key);
      continue;
    }

    // Each selector can be comma-separated fallbacks — try each
    const alternatives = selectorStr.split(',').map(s => s.trim());
    let found = false;
    for (const sel of alternatives) {
      try {
        if (document.querySelector(sel)) {
          found = true;
          break;
        }
      } catch { /* invalid selector */ }
    }

    if (found) {
      matched++;
    } else {
      failed.push(key);
    }
  }

  return {
    total: REQUIRED_SELECTOR_KEYS.length,
    matched,
    failed,
    checkedAt: new Date().toISOString(),
  };
}

// Listen for health check requests from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_SELECTORS') {
    const result = validateSelectors();
    console.log(`[PanelAutomation] Selector check: ${result.matched}/${result.total} OK`, result.failed.length > 0 ? `Failed: ${result.failed.join(', ')}` : '');
    sendResponse(result);
    return true; // async response
  }
});

// Inicializar
console.log('[PanelAutomation] Script de contenido cargado (SPA-aware v2)');
humanize.log('Automatización del panel lista');

} // end of double-injection guard
