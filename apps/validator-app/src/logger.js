const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    this.logsDir = path.join(app.getPath('userData'), 'logs');
    this.ensureLogsDir();
    this.currentLogFile = this.getLogFileName();
    this.backendUrl = null;
    this.apiKey = null;

    // Batch logging configuration
    this.logBuffer = [];
    this.maxBufferSize = 200;
    this.defaultFlushIntervalMs = 5000;
    this.flushIntervalMs = 5000;
    this.maxFlushIntervalMs = 60000;
    this.flushTimer = null;
    this.isFlushing = false;
    this.consecutiveFlushFailures = 0;

    // Start flush timer
    this.startFlushTimer();
  }

  startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => this.flushLogs(), this.flushIntervalMs);
  }

  stopFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  ensureLogsDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  getLogFileName() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logsDir, `validator-${date}.log`);
  }

  setBackendConfig(url, apiKey) {
    this.backendUrl = url;
    this.apiKey = apiKey;
  }

  formatLogEntry(level, category, message, data = null) {
    return {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };
  }

  writeToFile(entry) {
    try {
      // Check if we need a new log file (new day)
      const expectedFile = this.getLogFileName();
      if (expectedFile !== this.currentLogFile) {
        this.currentLogFile = expectedFile;
      }

      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.currentLogFile, line);
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  addToBuffer(entry) {
    if (!this.backendUrl || !this.apiKey) return;

    this.logBuffer.push(entry);

    // Cap buffer at maxBufferSize, drop oldest entries when exceeded
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
    }

    // Flush if buffer is full
    if (this.logBuffer.length >= this.maxBufferSize) {
      this.flushLogs();
    }
  }

  async flushLogs() {
    if (!this.backendUrl || !this.apiKey) return;
    if (this.logBuffer.length === 0) return;
    if (this.isFlushing) return;

    this.isFlushing = true;
    const logsToSend = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await fetch(`${this.backendUrl}/api/validator/logs/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Validator-API-Key': this.apiKey,
        },
        body: JSON.stringify({ logs: logsToSend }),
      });

      // On success, reset backoff
      if (this.consecutiveFlushFailures > 0) {
        this.consecutiveFlushFailures = 0;
        this.flushIntervalMs = this.defaultFlushIntervalMs;
        this.startFlushTimer();
      }
    } catch (error) {
      // Re-add logs to buffer on failure (at the beginning)
      this.logBuffer = [...logsToSend, ...this.logBuffer];

      // Cap buffer at maxBufferSize, drop oldest when exceeded
      if (this.logBuffer.length > this.maxBufferSize) {
        this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
      }

      // Apply exponential backoff on consecutive failures
      this.consecutiveFlushFailures++;
      const newInterval = Math.min(
        this.defaultFlushIntervalMs * Math.pow(2, this.consecutiveFlushFailures),
        this.maxFlushIntervalMs
      );
      if (newInterval !== this.flushIntervalMs) {
        this.flushIntervalMs = newInterval;
        this.startFlushTimer();
      }

      console.error(`Failed to send batch logs to backend (attempt ${this.consecutiveFlushFailures}, next flush in ${this.flushIntervalMs}ms):`, error.message);
    } finally {
      this.isFlushing = false;
    }
  }

  // Legacy single log send (kept for compatibility)
  async sendToBackend(entry) {
    this.addToBuffer(entry);
  }

  log(level, category, message, data = null) {
    const entry = this.formatLogEntry(level, category, message, data);

    // Always write to file
    this.writeToFile(entry);

    // Send to backend (non-blocking)
    this.sendToBackend(entry);

    // Console output
    const color = {
      INFO: '\x1b[36m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      SUCCESS: '\x1b[32m',
    }[level] || '\x1b[0m';

    console.log(`${color}[${level}]\x1b[0m [${category}] ${message}`, data || '');

    return entry;
  }

  // Convenience methods
  info(category, message, data) {
    return this.log('INFO', category, message, data);
  }

  warn(category, message, data) {
    return this.log('WARN', category, message, data);
  }

  error(category, message, data) {
    return this.log('ERROR', category, message, data);
  }

  success(category, message, data) {
    return this.log('SUCCESS', category, message, data);
  }

  // Specific logging methods
  logConnection(status, details = {}) {
    const level = status === 'connected' ? 'SUCCESS' : 'WARN';
    return this.log(level, 'CONNECTION', `Backend ${status}`, details);
  }

  logOllama(status, details = {}) {
    const level = status === 'running' ? 'SUCCESS' : 'WARN';
    return this.log(level, 'OLLAMA', `Ollama ${status}`, details);
  }

  logValidationRequest(request) {
    return this.log('INFO', 'VALIDATION', 'Validation request received', {
      id: request.id,
      requestId: request.requestId,
      expectedAmount: request.expectedAmount,
      // Don't log the full image, just metadata
      imageSize: request.imageBase64?.length || 0,
      mimeType: request.mimeType,
    });
  }

  logValidationResult(id, result) {
    const level = result.isValid ? 'SUCCESS' : 'WARN';
    return this.log(level, 'VALIDATION', `Validation completed: ${result.isValid ? 'APPROVED' : 'REJECTED'}`, {
      id,
      isValid: result.isValid,
      confidence: result.confidence,
      extractedAmount: result.extractedAmount,
      extractedDate: result.extractedDate,
      paymentMethod: result.paymentMethod,
      reasoning: result.reasoning,
      flags: result.flags,
    });
  }

  logValidationError(id, error) {
    return this.log('ERROR', 'VALIDATION', `Validation failed: ${error}`, { id, error });
  }

  logModelPull(status, details = {}) {
    return this.log('INFO', 'MODEL', `Model pull: ${status}`, details);
  }

  logAppEvent(event, details = {}) {
    return this.log('INFO', 'APP', event, details);
  }

  // Get logs for display
  getRecentLogs(count = 100) {
    try {
      if (!fs.existsSync(this.currentLogFile)) {
        return [];
      }

      const content = fs.readFileSync(this.currentLogFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const logs = lines.slice(-count).map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      return logs;
    } catch (error) {
      console.error('Failed to read logs:', error);
      return [];
    }
  }

  // Get logs directory path (for user to find)
  getLogsPath() {
    return this.logsDir;
  }

  // Purge log files older than maxDays
  purgeOldLogs(maxDays = 30) {
    try {
      const files = fs.readdirSync(this.logsDir);
      const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
      const logPattern = /^validator-(\d{4}-\d{2}-\d{2})\.log$/;
      let deleted = 0;

      for (const file of files) {
        const match = file.match(logPattern);
        if (!match) continue;

        const fileDate = new Date(match[1]);
        if (isNaN(fileDate.getTime())) continue;

        if (fileDate.getTime() < cutoff) {
          try {
            fs.unlinkSync(path.join(this.logsDir, file));
            deleted++;
          } catch (e) {
            // Skip files that can't be deleted
          }
        }
      }

      if (deleted > 0) {
        this.info('CLEANUP', `Purged ${deleted} log file(s) older than ${maxDays} days`);
      }
    } catch (error) {
      console.error('Failed to purge old logs:', error.message);
    }
  }
}

module.exports = new Logger();
