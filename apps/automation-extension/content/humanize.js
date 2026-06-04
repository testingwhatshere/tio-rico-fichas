// Humanization utilities - Make automation look human

window.humanize = {
  // Config cache (loaded from chrome.storage.local)
  _config: null,

  /**
   * Load config from storage or use injected config
   */
  // Safe defaults used when config hasn't been injected yet
  _safeDefaults: { minDelay: 3000, maxDelay: 8000, typingDelay: 80, typingVariance: 70 },
  _configReady: false,

  async loadConfig() {
    if (!this._configReady) {
      try {
        const stored = await chrome.storage.local.get(['config']);
        if (stored.config && Object.keys(stored.config).length > 0) {
          this._config = stored.config;
          this._configReady = true;
        } else {
          // Config not yet injected — use safe defaults (slower = more human)
          this._config = this._safeDefaults;
        }
      } catch (error) {
        console.warn('[Humanize] Failed to load config, using safe defaults:', error);
        this._config = this._safeDefaults;
      }
    }
    return this._config;
  },

  /**
   * Set config (injected by job processor)
   */
  setConfig(config) {
    this._config = config;
    this._configReady = true;
  },

  /**
   * Send session log entry to service worker for batching
   */
  logAction(action, details = {}) {
    try {
      // Redact sensitive values when selector hints at password field
      let value = details.value || null;
      if (value && details.selector && /password|passwd|pwd/i.test(details.selector)) {
        value = '***REDACTED***';
      }

      chrome.runtime.sendMessage({
        type: 'SESSION_LOG',
        data: {
          action,
          url: window.location.href,
          selector: details.selector || null,
          value,
          success: details.success !== false,
          error: details.error || null,
          step: details.step || null,
          startedAt: details.startedAt || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          duration: details.duration || null,
        },
      });
    } catch (e) {
      // Silently fail - session logs are best-effort
    }
  },

  /**
   * Get delay range from config or use defaults
   */
  async getDelayRange() {
    if (!this._config) await this.loadConfig();
    return {
      min: this._config.minDelay ?? 2000,
      max: this._config.maxDelay ?? 7000
    };
  },

  /**
   * Random delay between min and max milliseconds (from config)
   */
  async randomDelay(min = null, max = null) {
    // If no arguments provided, use config values
    if (min === null || max === null) {
      const range = await this.getDelayRange();
      // Use nullish coalescing to preserve explicit 0 values (0 is falsy but valid)
      min = min ?? range.min;
      max = max ?? range.max;
    }

    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    if (this._config?.debugMode) {
      console.log(`[Humanize] Esperando ${delay}ms... (config: ${min}-${max}ms)`);
    }
    return new Promise(resolve => setTimeout(resolve, delay));
  },

  /**
   * Short delay for typing with gaussian-like distribution and character-type variance.
   * More human-like than uniform random — special chars and uppercase take longer.
   */
  async typingDelay(char = null) {
    // Box-Muller transform for gaussian distribution (center 100ms, stddev 30ms)
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
    let delay = Math.round(100 + gaussian * 30);

    // Character-type variance
    if (char) {
      if (char === ' ') delay += Math.random() * 40; // Slight pause on spaces
      if ('@#$%^&*()_+-=[]{}|;:,.<>?/~`'.includes(char)) delay += 50 + Math.random() * 80; // Special chars slower
      if (char >= 'A' && char <= 'Z') delay += 20; // Shift key adds time
    }

    delay = Math.max(30, Math.min(250, Math.round(delay))); // Clamp 30-250ms
    return new Promise(resolve => setTimeout(resolve, delay));
  },

  /**
   * Get proper keyboard code for a character
   */
  getKeyCode(char) {
    const charCode = char.charCodeAt(0);

    // Numbers
    if (char >= '0' && char <= '9') {
      return `Digit${char}`;
    }

    // Letters
    if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')) {
      return `Key${char.toUpperCase()}`;
    }

    // Special characters (common ones)
    const specialKeys = {
      ' ': 'Space',
      '-': 'Minus',
      '=': 'Equal',
      '[': 'BracketLeft',
      ']': 'BracketRight',
      '\\': 'Backslash',
      ';': 'Semicolon',
      "'": 'Quote',
      ',': 'Comma',
      '.': 'Period',
      '/': 'Slash',
      '`': 'Backquote',
      '@': 'At',
      '#': 'NumpadHash',
      '$': 'Dollar',
      '%': 'Percent',
      '^': 'Caret',
      '&': 'Ampersand',
      '*': 'Asterisk',
      '(': 'ParenLeft',
      ')': 'ParenRight',
      '_': 'Underscore',
      '+': 'Plus'
    };

    return specialKeys[char] || `Key${char.toUpperCase()}`;
  },

  /**
   * Type text character by character with human-like delays
   */
  async typeIntoElement(element, text) {
    if (this._config?.debugMode) {
      console.log(`[Humanize] Typing into element:`, {
        textLength: text.length,
        elementType: element.type,
        elementTag: element.tagName
      });
    }

    // Focus element
    element.focus();
    await this.randomDelay(300, 800);

    // Clear existing value — select all + delete (works with framework-controlled inputs)
    element.select();
    document.execCommand('delete', false);
    await this.typingDelay();

    // Type character by character using execCommand('insertText')
    // This simulates real user typing and works with React/Vue/Angular controlled inputs
    // (direct element.value assignment gets overwritten by frameworks)
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const keyCode = this.getKeyCode(char);

      // Dispatch keydown for humanization
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: char,
        code: keyCode,
        bubbles: true,
        cancelable: true
      }));

      // Insert the character via execCommand (triggers framework state updates)
      document.execCommand('insertText', false, char);

      // Dispatch keyup for humanization
      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: char,
        code: keyCode,
        bubbles: true,
        cancelable: true
      }));

      // Human-like typing delay (pass char for variance)
      await this.typingDelay(char);
    }

    // Trigger input + change events (Vue.js v-model listens on 'input', not 'change')
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    await this.randomDelay(200, 500);

    // Allow framework state sync (React/Vue controlled inputs may batch updates)
    await new Promise(r => setTimeout(r, 50));

    // Verify typed value (compare numerically for formatted inputs like "1,000" vs "1000")
    const actualValue = element.value;
    if (actualValue !== text) {
      const numExpected = parseFloat(text.replace(/[^0-9.-]/g, ''));
      const numActual = parseFloat(actualValue.replace(/[^0-9.-]/g, ''));
      if (isNaN(numExpected) || isNaN(numActual) || numExpected !== numActual) {
        throw new Error(`Input verification failed: expected "${text}" but got "${actualValue}"`);
      }
      // Values match numerically (panel auto-formatted with thousand separators)
    }

    // Redact sensitive fields (password inputs) from session logs
    const isPassword = element.type === 'password' || /password|passwd|pwd/i.test(element.name || element.id || '');
    const logValue = isPassword ? '***REDACTED***' : (text.length > 20 ? text.substring(0, 20) + '...' : text);
    this.logAction('TYPE', { selector: element.id || element.tagName, value: logValue });

    if (this._config?.debugMode) {
      console.log(`[Humanize] Typing complete. Final value length:`, element.value.length);
    }
  },

  /**
   * Simulate mouse approach to element (no visual artifacts)
   */
  async moveMouseToElement(element) {
    // Scroll into view with slight delay to simulate mouse movement
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.randomDelay(300, 700);
  },

  /**
   * Click element with human-like behavior and randomized click position
   */
  async clickElement(element) {
    console.log(`[Humanize] Clickeando elemento:`, element);

    // Scroll to element
    await this.moveMouseToElement(element);

    // Randomize click position within element bounds (center +/- 30%)
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width * (0.35 + Math.random() * 0.3);
    const y = rect.top + rect.height * (0.35 + Math.random() * 0.3);

    // Dispatch realistic mouse event sequence
    const eventOpts = {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      view: window,
    };
    element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    element.dispatchEvent(new MouseEvent('click', eventOpts));

    this.logAction('CLICK', { selector: element.id || element.className || element.tagName });
    await this.randomDelay(1000, 2000);
  },

  /**
   * Wait for element to appear
   */
  async waitForElement(selector, timeout = 10000) {
    console.log(`[Humanize] Esperando elemento: ${selector}`);

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element && element.offsetParent !== null) {
        console.log(`[Humanize] Elemento encontrado: ${selector}`);
        return element;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Elemento no encontrado: ${selector} (timeout después de ${timeout}ms)`);
  },

  /**
   * Find element by text content
   */
  findElementByText(tagName, text) {
    const elements = Array.from(document.querySelectorAll(tagName));
    return elements.find(el => el.textContent.trim() === text || el.textContent.includes(text));
  },

  /**
   * Wait for element with specific text
   */
  async waitForElementWithText(tagName, text, timeout = 10000) {
    console.log(`[Humanize] Esperando ${tagName} con texto: "${text}"`);

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = this.findElementByText(tagName, text);
      if (element && element.offsetParent !== null) {
        console.log(`[Humanize] Elemento encontrado con texto: "${text}"`);
        return element;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Elemento con texto "${text}" no encontrado (timeout después de ${timeout}ms)`);
  },

  /**
   * Find element by text content (case-insensitive)
   */
  findElementByTextCI(tagName, text) {
    const lowerText = text.toLowerCase();
    const elements = Array.from(document.querySelectorAll(tagName));
    return elements.find(el => {
      const elText = el.textContent.trim().toLowerCase();
      return elText === lowerText || elText.includes(lowerText);
    });
  },

  /**
   * Wait for element with specific text (case-insensitive)
   */
  async waitForElementWithTextCI(tagName, text, timeout = 10000) {
    console.log(`[Humanize] Esperando ${tagName} con texto (CI): "${text}"`);

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = this.findElementByTextCI(tagName, text);
      if (element && element.offsetParent !== null) {
        console.log(`[Humanize] Elemento encontrado con texto: "${text}"`);
        return element;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Elemento con texto "${text}" no encontrado (timeout después de ${timeout}ms)`);
  },

  /**
   * Wait for navigation to complete (Fix 15: timeout to prevent infinite hang)
   */
  async waitForNavigation(timeout = 15000) {
    console.log('[Humanize] Esperando navegación...');

    return new Promise((resolve, reject) => {
      if (document.readyState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        window.removeEventListener('load', onLoad);
        reject(new Error(`Navigation timed out after ${timeout / 1000}s`));
      }, timeout);
      function onLoad() {
        clearTimeout(timer);
        resolve();
      }
      window.addEventListener('load', onLoad, { once: true });
    });
  },

  /**
   * Wait for element to be ready and DOM to stabilize
   * More reliable than waitForElement - ensures element is truly interactive
   */
  async waitForElementReady(selector, options = {}) {
    const {
      timeout = 10000,
      stabilityDelay = 100, // Wait for DOM stability
      visible = true,       // Check if element is visible
    } = options;

    console.log(`[Humanize] Esperando elemento listo: ${selector}`);

    const startTime = Date.now();

    // First, wait for element to appear
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);

      if (element) {
        // Check visibility if required
        if (visible && element.offsetParent === null) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Check if element is enabled (for inputs/buttons)
        if (element.disabled) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Wait for DOM stability
        await new Promise(resolve => setTimeout(resolve, stabilityDelay));

        // Verify element still exists after stability wait
        const verifiedElement = document.querySelector(selector);
        if (verifiedElement) {
          console.log(`[Humanize] Elemento listo: ${selector}`);
          return verifiedElement;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Elemento no listo: ${selector} (timeout después de ${timeout}ms)`);
  },

  /**
   * Take screenshot of current page (Fix 14: error handling for dead service worker)
   */
  async captureScreenshot() {
    try {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'CAPTURE_SCREENSHOT' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[Humanize] Screenshot request failed:', chrome.runtime.lastError.message);
              resolve(null);
              return;
            }
            resolve(response?.dataUrl || null);
          }
        );
      });
    } catch (error) {
      console.warn('[Humanize] Screenshot request error:', error.message);
      return null;
    }
  },

  /**
   * Log message to service worker (Fix 14: crash protection)
   */
  log(message, data = null) {
    try {
      chrome.runtime.sendMessage({ type: 'LOG', message, data });
    } catch (error) {
      console.warn('[Humanize] Log send failed:', message, data);
    }
  },

  /**
   * Debug log (only when debug mode enabled)
   */
  async debug(message, data = null) {
    if (this._config?.debugMode) {
      console.log(`[Humanize DEBUG] ${message}`, data || '');
      this.log(message, data);
    }
  }
};
