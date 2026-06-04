const { app, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function registerHandlers(deps) {
  const {
    config,
    saveConfig,
    loadConfig,
    connection,
    queueManager,
    pipeline,
    logger,
    sendToRenderer,
    getMainWindow,
    updateTray,
    checkOllama,
    installOllama,
    startOllama,
    pullModel,
    DEFAULT_PROMPT,
    initOCRWorker,
    parseOCRText,
    convertPdfToImage,
    checkForUpdate,
    downloadUpdate,
    getOcrExamplesPath,
    loadOcrExamples,
    saveOcrExamples,
    getUserDataPath,
  } = deps;

  // ---- Auto-Update ----
  ipcMain.handle('check-update', async () => {
    const currentVersion = app.getVersion();
    if (!config.backendUrl) return null;
    return await checkForUpdate(config.backendUrl, currentVersion, 'validator');
  });

  ipcMain.handle('download-update', async (event, downloadUrl) => {
    const tempDir = app.getPath('temp');
    const ext = process.platform === 'darwin' ? '.dmg' : '.exe';
    const destPath = path.join(tempDir, `validator-update${ext}`);
    try { fs.unlinkSync(destPath); } catch {}

    try {
      await downloadUpdate(downloadUrl, destPath, (percent) => {
        sendToRenderer('update-progress', { percent });
      });
      return { success: true, filePath: destPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('install-update', async (event, filePath) => {
    try {
      shell.openPath(filePath);
      setTimeout(() => {
        app.isQuitting = true;
        app.quit();
      }, 1500);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  // Concurrency guards for heavy operations
  let ocrInProgress = false;
  let ollamaInProgress = false;

  // Safe wrapper for ipcMain.on handlers
  function safeOn(channel, handler) {
    ipcMain.on(channel, (event, ...args) => {
      try {
        handler(event, ...args);
      } catch (err) {
        logger.error('IPC', `Handler '${channel}' failed: ${err.message}`, { stack: err.stack });
        sendToRenderer('log', { message: `Error interno: ${err.message}`, type: 'error' });
      }
    });
  }

  // ---- Connection ----
  safeOn('connect', () => connection.connectToBackend());

  safeOn('disconnect', () => {
    connection.disconnect();
  });

  // ---- Config ----
  ipcMain.on('save-config', (event, newConfig) => {
    // Validate before saving
    const validationErrors = [];
    if (newConfig.backendUrl && !/^https?:\/\/.+/.test(newConfig.backendUrl)) {
      validationErrors.push('URL del backend invalida');
    }
    if (newConfig.ollamaUrl && !/^https?:\/\/.+/.test(newConfig.ollamaUrl)) {
      validationErrors.push('URL de Ollama invalida');
    }
    if (validationErrors.length > 0) {
      for (const err of validationErrors) {
        sendToRenderer('log', { message: `Config: ${err}`, type: 'error' });
      }
      logger.warn('CONFIG', 'Config validation failed', { errors: validationErrors });
      return;
    }

    const cfg = config.state ? config.state.config : config;
    const urlChanged = cfg.backendUrl !== newConfig.backendUrl;
    const keyChanged = cfg.apiKey !== newConfig.apiKey;

    Object.assign(cfg, newConfig);
    // Normalize URLs on save
    if (cfg.ollamaUrl) cfg.ollamaUrl = cfg.ollamaUrl.replace(/\/+$/, '');
    if (cfg.backendUrl) cfg.backendUrl = cfg.backendUrl.replace(/\/+$/, '');
    saveConfig();

    // Auto-reconnect if connection settings changed and currently connected
    if ((urlChanged || keyChanged) && connection.getIsConnected()) {
      logger.logAppEvent('Connection settings changed, reconnecting...', { urlChanged, keyChanged });
      sendToRenderer('log', { message: 'Configuracion cambiada, reconectando...', type: 'info' });
      connection.connectToBackend();
    }

    sendToRenderer('config-saved', config);
  });

  ipcMain.on('get-config', () => {
    const cfg = config.state ? config.state.config : config;
    sendToRenderer('config', cfg);
  });

  // ---- Ollama ----
  ipcMain.on('check-ollama', () => {
    checkOllama().catch(err => {
      console.error('[check-ollama IPC] Error:', err);
      sendToRenderer('ollama-status', {
        installed: false,
        running: false,
        hasVisionModel: false,
        error: err.message,
      });
      sendToRenderer('log', { message: `Error: ${err.message}`, type: 'error' });
    });
  });

  safeOn('install-ollama', () => installOllama());

  safeOn('start-ollama', () => startOllama());

  safeOn('pull-model', (event, modelName) => pullModel(modelName || 'llama3.2-vision'));

  ipcMain.on('get-default-prompt', () => {
    sendToRenderer('default-prompt', DEFAULT_PROMPT);
  });

  safeOn('select-model', (event, modelName) => {
    if (modelName && typeof modelName === 'string') {
      config.ollamaModel = modelName;
      saveConfig();
      logger.logAppEvent('Model selected', { model: modelName });
      sendToRenderer('log', { message: `Modelo seleccionado: ${modelName}`, type: 'success' });
      sendToRenderer('model-selected', { model: modelName });
    }
  });

  ipcMain.on('open-ollama-site', () => shell.openExternal('https://ollama.com/download'));

  // ---- Logs & Queue ----
  ipcMain.on('get-logs-path', () => {
    sendToRenderer('logs-path', { path: logger.getLogsPath() });
  });

  ipcMain.on('open-logs-folder', () => {
    shell.openPath(logger.getLogsPath());
  });

  ipcMain.on('get-recent-logs', () => {
    const logs = logger.getRecentLogs(100);
    sendToRenderer('recent-logs', logs);
  });

  ipcMain.on('get-queue-status', () => {
    sendToRenderer('queue-status', { count: queueManager.getOfflineQueue().length });
  });

  safeOn('clear-queue', () => {
    const count = queueManager.clearOfflineQueue();
    logger.info('QUEUE', `Queue cleared, ${count} requests removed`);
    sendToRenderer('queue-status', { count: 0 });
    sendToRenderer('log', { message: `Cola limpiada (${count} solicitudes)`, type: 'info' });
  });

  ipcMain.handle('confirm-clear-queue', async () => {
    const mainWindow = getMainWindow();
    const offlineQueue = queueManager.getOfflineQueue();
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Limpiar cola',
      message: 'Estas seguro?',
      detail: `Se eliminaran ${offlineQueue.length} solicitudes pendientes. Esta accion no se puede deshacer.`,
      buttons: ['Cancelar', 'Limpiar cola'],
      defaultId: 0,
      cancelId: 0,
    });
    // result.response === 1 means "Limpiar cola" was clicked
    return result.response === 1;
  });

  // ---- OCR Sandbox ----
  ipcMain.handle('ocr-analyze', async (event, imageBase64) => {
    if (ocrInProgress) return { error: 'OCR analysis already in progress' };
    ocrInProgress = true;
    try {
    const { recognizeWithMultiPass } = require('../ocr/worker');

    let imageData = imageBase64;
    if (imageData && imageData.startsWith('data:')) {
      if (imageData.startsWith('data:application/pdf')) {
        const pdfBase64 = imageData.split(',')[1];
        try {
          imageData = await convertPdfToImage(pdfBase64);
        } catch (err) {
          throw new Error(`PDF conversion failed: ${err.message}`);
        }
      } else {
        imageData = imageData.split(',')[1] || imageData;
      }
    }

    const imageBuffer = Buffer.from(imageData, 'base64');

    // Multi-pass OCR with preprocessing
    const result = await recognizeWithMultiPass(imageBuffer, sendToRenderer);
    if (!result) throw new Error('OCR worker not available');

    const rawText = result.text;
    const ocrConfidence = result.confidence;
    const fields = parseOCRText(rawText, 0);

    return { rawText, ocrConfidence, fields, method: result.method };
    } catch (err) {
      logger.error('IPC', `ocr-analyze failed: ${err.message}`, { stack: err.stack });
      throw err;
    } finally {
      ocrInProgress = false;
    }
  });

  ipcMain.handle('ocr-save-example', async (event, { source, fields }) => {
    const data = loadOcrExamples();
    const example = {
      id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      source,
      fields,
      corrected: true,
      createdAt: new Date().toISOString(),
    };
    data.examples.push(example);
    data.stats.totalExamples = data.examples.length;

    // Rebuild bySource
    data.stats.bySource = {};
    data.examples.forEach(ex => {
      data.stats.bySource[ex.source] = (data.stats.bySource[ex.source] || 0) + 1;
    });

    saveOcrExamples(data);
    logger.info('OCR', `Example saved: ${source} (total: ${data.examples.length})`);
    return { success: true, total: data.examples.length };
  });

  ipcMain.handle('ocr-get-examples', async () => {
    return loadOcrExamples();
  });

  ipcMain.handle('ocr-export-examples', async () => {
    const mainWindow = getMainWindow();
    const data = loadOcrExamples();
    if (data.examples.length === 0) {
      dialog.showMessageBox(mainWindow, { type: 'info', message: 'No hay ejemplos para exportar' });
      return;
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar ejemplos OCR',
      defaultPath: `ocr-examples-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return;
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    logger.info('OCR', `Examples exported to ${result.filePath}`);
  });

  ipcMain.handle('ocr-import-examples', async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar ejemplos OCR',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;

    try {
      const imported = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
      if (!imported.examples || !Array.isArray(imported.examples)) {
        throw new Error('Invalid format');
      }
      const existing = loadOcrExamples();
      const existingIds = new Set(existing.examples.map(e => e.id));
      const newExamples = imported.examples.filter(e => !existingIds.has(e.id));
      existing.examples.push(...newExamples);
      existing.stats.totalExamples = existing.examples.length;
      existing.stats.bySource = {};
      existing.examples.forEach(ex => {
        existing.stats.bySource[ex.source] = (existing.stats.bySource[ex.source] || 0) + 1;
      });
      saveOcrExamples(existing);
      logger.info('OCR', `Imported ${newExamples.length} new examples (total: ${existing.examples.length})`);
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: `Importados ${newExamples.length} ejemplos nuevos (total: ${existing.examples.length})`,
      });
    } catch (err) {
      dialog.showMessageBox(mainWindow, { type: 'error', message: `Error al importar: ${err.message}` });
    }
  });

  // ---- Ollama Sandbox Analyze ----
  ipcMain.handle('ollama-analyze', async (event, imageBase64) => {
    if (ollamaInProgress) return { error: 'Ollama analysis already in progress' };
    ollamaInProgress = true;
    try {
    const { validateWithOllama } = require('../validation/ollama');

    let imageData = imageBase64;
    if (imageData && imageData.startsWith('data:')) {
      if (imageData.startsWith('data:application/pdf')) {
        if (convertPdfToImage) {
          imageData = await convertPdfToImage(imageData.split(',')[1]);
        } else {
          throw new Error('PDF conversion not available');
        }
      } else {
        imageData = imageData.split(',')[1] || imageData;
      }
    }

    const configObj = config.state ? config.state.config : config;
    const result = await validateWithOllama({ imageBase64: imageData, expectedAmount: 0 }, configObj);
    return result;
    } catch (err) {
      logger.error('IPC', `ollama-analyze failed: ${err.message}`, { stack: err.stack });
      throw err;
    } finally {
      ollamaInProgress = false;
    }
  });
}

module.exports = { registerHandlers };
