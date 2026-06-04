// API Client - Handles all communication with Backend API
// Updated to match actual backend endpoints

export class ApiClient {
  /**
   * Build standard headers including API key and panel ID
   */
  static getHeaders(config) {
    const headers = {
      'X-Bot-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    };
    if (config.panelId) {
      headers['X-Panel-Id'] = config.panelId;
    }
    return headers;
  }

  /**
   * Fetch with timeout using AbortController
   * @param {string} url - Request URL
   * @param {object} options - Fetch options
   * @param {number} timeoutMs - Timeout in milliseconds (default: 15000)
   */
  static async fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check for pending jobs (polling mode)
   * Maps to: GET /bot/jobs/pending
   */
  static async checkForJob(config) {
    const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/jobs/pending`, {
      method: 'GET',
      headers: ApiClient.getHeaders(config)
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No jobs available
      }
      // Classify error: auth errors (unrecoverable) vs transient errors (retryable)
      if (response.status === 401 || response.status === 403) {
        const err = new Error(`Authentication failed (${response.status}): API Key inválida o sin permisos`);
        err.isAuthError = true;
        throw err;
      }
      throw new Error(`Failed to check for jobs: ${response.status} ${response.statusText}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new Error(`Invalid JSON response from /bot/jobs/pending (status ${response.status}): ${parseError.message}`);
    }
    // Backend now returns { job: {...} | null } instead of { jobs: [...] }
    return data.job || null;
  }

  /**
   * Report job started to backend
   * Maps to: POST /bot/jobs/:jobId/started
   */
  static async reportJobStarted(config, jobId) {
    const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/jobs/${jobId}/started`, {
      method: 'POST',
      headers: ApiClient.getHeaders(config),
      body: JSON.stringify({ startedAt: new Date().toISOString() })
    });

    if (!response.ok) {
      console.error('[ApiClient] Failed to report job started:', response.statusText);
      return null;
    }

    return await response.json();
  }

  /**
   * Report job result to backend (completion or failure)
   * Maps to: POST /bot/jobs/:jobId/result
   */
  static async reportJobResult(config, jobId, result) {
    const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/jobs/${jobId}/result`, {
      method: 'POST',
      headers: ApiClient.getHeaders(config),
      body: JSON.stringify(result)
    });

    if (!response.ok) {
      throw new Error(`Failed to report job result: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Report job progress to backend
   * Maps to: POST /bot/jobs/:jobId/progress
   */
  static async reportJobProgress(config, jobId, progress) {
    const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/jobs/${jobId}/progress`, {
      method: 'POST',
      headers: ApiClient.getHeaders(config),
      body: JSON.stringify(progress)
    });

    if (!response.ok) {
      console.error('[ApiClient] Failed to report job progress:', response.statusText);
      return null;
    }

    return await response.json();
  }

  /**
   * Upload screenshot to backend
   * Maps to: POST /bot/screenshots
   */
  static async uploadScreenshot(config, jobId, screenshotDataUrl) {
    let blob;
    try {
      blob = await fetch(screenshotDataUrl).then(r => r.blob());
    } catch (blobError) {
      console.error('[ApiClient] Failed to convert screenshot data URL to blob:', blobError.message);
      return null;
    }

    const formData = new FormData();
    formData.append('screenshot', blob, `job-${jobId}-error.png`);
    formData.append('jobId', jobId);
    // Backend requires 'category' field
    formData.append('category', 'job_error');

    const uploadHeaders = { 'X-Bot-API-Key': config.apiKey };
    if (config.panelId) uploadHeaders['X-Panel-Id'] = config.panelId;

    const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/screenshots`, {
      method: 'POST',
      headers: uploadHeaders,
      body: formData
    }, 30000); // 30s timeout for uploads

    if (!response.ok) {
      console.error('[ApiClient] Failed to upload screenshot:', response.statusText);
      return null;
    }

    const result = await response.json();
    // Backend returns { success, screenshotId } — return the ID for reference
    return result.screenshotId || result.path || result.url;
  }

  /**
   * Send log entry to backend
   * Maps to: POST /bot/logs
   */
  static async sendLog(config, jobId, level, message, data = {}) {
    const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/logs`, {
      method: 'POST',
      headers: ApiClient.getHeaders(config),
      body: JSON.stringify({
        jobId,
        level,
        message,
        // Backend requires 'category' and 'action' fields
        category: data.category || 'BOT',
        action: data.action || message.substring(0, 50),
        metadata: data,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      console.error('[ApiClient] Failed to send log:', response.statusText);
    }
  }

  /**
   * Heartbeat - report extension is alive
   * Maps to: POST /bot/heartbeat
   */
  static async sendHeartbeat(config, state) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/heartbeat`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          version: '1.0.0-extension',
          type: 'automation',
          panelId: config.panelId || null,
          walletId: null,
          tabStatus: state.panelTabId ? 'active' : 'closed',
          currentUrl: state.lastKnownUrl || '',
          sessionValid: state.sessionValid !== false,
          pendingJobs: 0,
          uptimeMinutes: Math.round((Date.now() - (state.startTime || Date.now())) / 60000),
          lastJobAt: state.lastJobCompletedAt ? new Date(state.lastJobCompletedAt).toISOString() : null,
          consecutiveErrors: state.consecutiveJobErrors || 0,
        })
      }, 10000); // 10s timeout for heartbeat

      if (!response.ok) {
        console.warn('[ApiClient] Heartbeat response not OK:', response.status, response.statusText);
        return false;
      }

      return true;
    } catch (error) {
      // Only log if we have a configured backend (avoid spam when not configured)
      if (config?.backendUrl && config?.apiKey) {
        console.warn('[ApiClient] Heartbeat failed (backend may be offline):', error.message);
      }
      return false;
    }
  }

  /**
   * Report panel balance to backend for low-balance alerts
   * Maps to: POST /bot/panel-balance
   */
  static async reportPanelBalance(config, balance) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/panel-balance`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify({ balance, timestamp: new Date().toISOString() })
      }, 10000);
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check kill switch status
   * Maps to: GET /bot/kill-switch
   */
  static async checkKillSwitch(config) {
    const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/kill-switch`, {
      method: 'GET',
      headers: ApiClient.getHeaders(config)
    });

    if (!response.ok) {
      console.error('[ApiClient] Failed to check kill switch:', response.statusText);
      return { active: false };
    }

    return await response.json();
  }

  /**
   * Check activity window before executing jobs
   * Maps to: GET /bot/activity-window
   */
  static async checkActivityWindow(config) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/activity-window`, {
        method: 'GET',
        headers: ApiClient.getHeaders(config)
      });

      if (!response.ok) {
        console.warn('[ApiClient] Failed to check activity window:', response.statusText);
        return { allowed: true }; // Default to allowed if endpoint unavailable
      }

      return await response.json();
    } catch (error) {
      console.warn('[ApiClient] Activity window check failed:', error.message);
      return { allowed: true }; // Default to allowed on error
    }
  }

  /**
   * Report bot status to backend
   * Maps to: POST /bot/status
   */
  static async reportStatus(config, status) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/status`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify({
          status,
          timestamp: new Date().toISOString(),
        })
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn('[ApiClient] Failed to report status:', response.status, response.statusText, body);
      }
    } catch (error) {
      console.warn('[ApiClient] Status report failed:', error.message);
    }
  }

  /**
   * Send session log entry to backend
   * Maps to: POST /bot/session-log
   */
  static async sendSessionLog(config, logEntry) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/session-log`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify(logEntry)
      });

      if (!response.ok) {
        console.warn('[ApiClient] Failed to send session log:', response.statusText);
      }
    } catch (error) {
      // Silently fail - session logs are best-effort
    }
  }

  /**
   * Send batch of session logs to backend
   * Maps to: POST /bot/session-logs (batch) with fallback to per-entry
   */
  static async sendSessionLogBatch(config, entries) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/session-logs`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify({ entries }),
      });
      if (response.ok) return;
    } catch (_batchError) {
      // Batch endpoint not available — fall back to individual sends
    }
    for (const entry of entries) {
      await ApiClient.sendSessionLog(config, entry);
    }
  }

  /**
   * Report discovery result (whether target username was found on this panel)
   * Maps to: POST /bot/discovery/:taskId/result
   */
  static async reportDiscoveryResult(config, taskId, result) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/discovery/${taskId}/result`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify(result)
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error('[ApiClient] Failed to report discovery result:', response.status, response.statusText, body);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('[ApiClient] Discovery result report failed:', error.message);
      return null;
    }
  }

  /**
   * Report user creation result
   * Maps to: POST /bot/create-user/:taskId/result
   */
  static async reportCreateUserResult(config, taskId, result) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/create-user/${taskId}/result`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify(result)
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error('[ApiClient] Failed to report create user result:', response.status, response.statusText, body);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('[ApiClient] Create user result report failed:', error.message);
      return null;
    }
  }

  /**
   * Report chip verification result
   * Maps to: POST /bot/verify-chips/result
   */
  static async reportVerifyChipsResult(config, taskId, result) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/verify-chips/result`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify({ taskId, ...result })
      });

      if (!response.ok) {
        console.error('[ApiClient] Failed to report verify chips result:', response.statusText);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('[ApiClient] Verify chips result report failed:', error.message);
      return null;
    }
  }

  /**
   * Report selector health check result to backend.
   */
  static async postSelectorCheck(config, result) {
    try {
      const response = await ApiClient.fetchWithTimeout(`${config.backendUrl}/api/bot/selector-check`, {
        method: 'POST',
        headers: ApiClient.getHeaders(config),
        body: JSON.stringify(result),
      }, 10000);

      if (!response.ok) {
        console.warn('[ApiClient] Selector check report not OK:', response.status);
        return false;
      }
      return true;
    } catch (error) {
      console.warn('[ApiClient] Selector check report failed:', error.message);
      return false;
    }
  }
}
