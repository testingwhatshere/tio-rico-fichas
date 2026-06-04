const fs = require('fs');
const path = require('path');
const logger = require('./logger');

let state = {
  userDataPath: null,
  configPath: null,
  offlineQueuePath: null,
  processedIdsPath: null,
  config: {
    backendUrl: '',
    apiKey: '',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5-vl',
    customPrompt: '',
  },
};

// Initialize paths from app.getPath('userData')
function initPaths(app) {
  state.userDataPath = app.getPath('userData');
  state.configPath = path.join(state.userDataPath, 'config.json');
  state.offlineQueuePath = path.join(state.userDataPath, 'offline-queue.json');
  state.processedIdsPath = path.join(state.userDataPath, 'processed-ids.json');
}

// Validate config has minimum required fields
function validateConfig(config) {
  const warnings = [];
  if (!config.ollamaUrl) warnings.push('ollamaUrl is empty');
  if (!config.ollamaModel) warnings.push('ollamaModel is empty');
  if (warnings.length > 0) {
    logger.warn('CONFIG', `Config warnings: ${warnings.join(', ')}`);
  }
  return warnings;
}

// Load config from file
function loadConfig() {
  try {
    if (fs.existsSync(state.configPath)) {
      const data = fs.readFileSync(state.configPath, 'utf8');
      const parsed = JSON.parse(data);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Config is not a valid object');
      }
      state.config = { ...state.config, ...parsed };
    }
    // Normalize URLs: strip trailing slashes to prevent double-slash in API paths
    if (state.config.ollamaUrl) {
      state.config.ollamaUrl = state.config.ollamaUrl.replace(/\/+$/, '');
    }
    if (state.config.backendUrl) {
      state.config.backendUrl = state.config.backendUrl.replace(/\/+$/, '');
    }
    validateConfig(state.config);
  } catch (error) {
    logger.error('CONFIG', `Error loading config: ${error.message}`);
    // Try to load from backup
    const bakPath = state.configPath + '.bak';
    if (fs.existsSync(bakPath)) {
      try {
        const bakData = fs.readFileSync(bakPath, 'utf8');
        state.config = { ...state.config, ...JSON.parse(bakData) };
        logger.warn('CONFIG', 'Loaded config from backup');
      } catch (bakErr) {
        logger.error('CONFIG', `Backup config also failed: ${bakErr.message}`);
      }
    }
  }
}

// Save config to file (atomic: write to .tmp then rename, with backup)
function saveConfig() {
  try {
    // Backup current config before overwriting
    if (fs.existsSync(state.configPath)) {
      try {
        fs.copyFileSync(state.configPath, state.configPath + '.bak');
      } catch (bakErr) {
        logger.warn('CONFIG', `Failed to backup config: ${bakErr.message}`);
      }
    }

    const tmpPath = state.configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(state.config, null, 2));
    fs.renameSync(tmpPath, state.configPath);
  } catch (error) {
    logger.error('CONFIG', `Error saving config: ${error.message}`);
  }
}

// Recently processed request tracking (prevents re-validation on backend retries)
const recentlyProcessedIds = new Set();
const MAX_RECENTLY_PROCESSED = 200;
let saveProcessedIdsTimer = null;

// Load processed IDs from disk (survives restarts — Fix 7)
function loadProcessedIds() {
  try {
    if (fs.existsSync(state.processedIdsPath)) {
      const data = fs.readFileSync(state.processedIdsPath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Only load the most recent MAX_RECENTLY_PROCESSED entries
        const toLoad = parsed.slice(-MAX_RECENTLY_PROCESSED);
        for (const id of toLoad) {
          recentlyProcessedIds.add(id);
        }
        logger.info('PROCESSED_IDS', `Loaded ${recentlyProcessedIds.size} processed IDs from disk`);
      }
    }
  } catch (error) {
    logger.error('PROCESSED_IDS', `Error loading processed IDs: ${error.message}`);
    // Non-fatal — worst case we re-validate some proofs
  }
}

// Save processed IDs to disk
function saveProcessedIds() {
  try {
    const ids = Array.from(recentlyProcessedIds);
    fs.writeFileSync(state.processedIdsPath, JSON.stringify(ids));
  } catch (error) {
    console.error('Error saving processed IDs:', error);
  }
}

// Debounced save for processed IDs — same pattern as offline queue
function scheduleSaveProcessedIds() {
  if (saveProcessedIdsTimer) return;
  saveProcessedIdsTimer = setTimeout(() => {
    saveProcessedIdsTimer = null;
    saveProcessedIds();
  }, 2000);
}

module.exports = {
  state,
  initPaths,
  loadConfig,
  saveConfig,
  recentlyProcessedIds,
  MAX_RECENTLY_PROCESSED,
  loadProcessedIds,
  saveProcessedIds,
  scheduleSaveProcessedIds,
};
