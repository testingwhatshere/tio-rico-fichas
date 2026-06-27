/**
 * Validator App — Main Process (Lifecycle Coordinator)
 *
 * This file only handles:
 * - App lifecycle (ready, quit, window management)
 * - Module initialization and dependency wiring
 * - Global error handlers
 * - Tray icon
 *
 * All business logic is in dedicated modules:
 * - config.js          — Config/path management
 * - ocr/               — OCR worker, parser, examples
 * - validation/         — Ollama + OCR pipeline
 * - socket/             — Backend connection + queues
 * - ollama/             — Ollama install/management
 * - ipc/               — IPC handler registration
 */

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { checkForUpdate, downloadUpdate } = require('./updater');

// ==========================================
// GLOBAL ERROR HANDLERS
// ==========================================

process.on('uncaughtException', (error) => {
  // EPIPE errors from Tesseract.js worker subprocess are recoverable
  if (error?.code === 'EPIPE' || error?.message?.includes('EPIPE')) {
    console.warn('[EPIPE] Suppressed pipe error:', error.message);
    return;
  }
  try {
    logger.error('CRASH', `Uncaught exception: ${error.message}`, { stack: error.stack });
  } catch (_) {
    console.error('UNCAUGHT EXCEPTION:', error);
  }
  try {
    sendToRenderer('log', { message: `Error critico: ${error.message}`, type: 'error' });
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  try { logger.error('CRASH', `Unhandled rejection: ${msg}`, { stack }); } catch (_) {}
});

// ==========================================
// PDF CONVERSION (stays here — uses temp paths)
// ==========================================

// pdfjs-based renderer (cross-platform, pure JS via @napi-rs/canvas).
// Primary path on Windows: pdf-poppler 0.51 (2016) renderiza mal PDFs MP modernos
// con fuentes Unicode/SVG y produce comprobantes "inválidos" aguas abajo.
let pdfToPng = null;
try { ({ pdfToPng } = require('pdf-to-png-converter')); } catch (_) {}

// Legacy poppler binary path — sigue siendo primario en macOS (donde renderiza bien
// con 0.66) y queda como fallback en Windows si pdfjs no cargara por algún motivo.
let pdfPoppler = null;
try { pdfPoppler = require('pdf-poppler'); } catch (_) {}

async function renderWithPdfJs(pdfBuffer) {
  if (!pdfToPng) throw new Error('pdf-to-png-converter not available');
  const t0 = Date.now();
  // viewportScale 2.0 → A4 (595×842pt) renderiza a ~1190×1684px, mucho mejor para OCR
  // que el scale=1024 de poppler. Comprobantes MP móviles típicos quedan en ~900-1200px.
  const pages = await pdfToPng(pdfBuffer, {
    pagesToProcess: [1],
    viewportScale: 2.0,
    disableFontFace: true,
    useSystemFonts: false,
    verbosityLevel: 0,
  });
  if (!pages || !pages[0] || !pages[0].content) {
    throw new Error('pdf-to-png-converter returned no page content');
  }
  const base64 = pages[0].content.toString('base64');
  const elapsed = Date.now() - t0;
  console.log(`[validator] PDF→PNG via pdfjs in ${elapsed}ms (${pages[0].width}×${pages[0].height}, ${base64.length} chars)`);
  return base64;
}

async function renderWithPoppler(pdfBuffer) {
  if (!pdfPoppler) throw new Error('pdf-poppler not available');
  const configMod = require('./config');
  const tempDir = path.join(configMod.state.userDataPath || app.getPath('userData'), 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const timestamp = Date.now();
  const tempPdfPath = path.join(tempDir, `proof_${timestamp}.pdf`);

  const t0 = Date.now();
  try {
    fs.writeFileSync(tempPdfPath, pdfBuffer);

    await pdfPoppler.convert(tempPdfPath, {
      format: 'png',
      out_dir: tempDir,
      out_prefix: `proof_${timestamp}`,
      page: 1,
      // 2048 producía PNGs de 30-60s en comprobantes MP normales; 1024 sigue siendo
      // más que suficiente para OCR/Ollama y baja el tiempo de conversión 3-4x.
      scale: 1024,
    });

    const pngFiles = fs.readdirSync(tempDir).filter(f =>
      f.startsWith(`proof_${timestamp}`) && f.endsWith('.png')
    );
    if (pngFiles.length === 0) throw new Error('No PNG output from pdf-poppler');

    const pngPath = path.join(tempDir, pngFiles[0]);
    const imageBase64 = fs.readFileSync(pngPath).toString('base64');

    try { fs.unlinkSync(tempPdfPath); } catch (_) {}
    try { fs.unlinkSync(pngPath); } catch (_) {}

    const elapsed = Date.now() - t0;
    console.log(`[validator] PDF→PNG via poppler in ${elapsed}ms (${imageBase64.length} chars)`);
    return imageBase64;
  } catch (error) {
    try { fs.unlinkSync(tempPdfPath); } catch (_) {}
    throw error;
  }
}

async function convertPdfToImage(base64Pdf) {
  const pdfBuffer = Buffer.from(base64Pdf, 'base64');

  // En Windows el pdftocairo 0.51 empaquetado por pdf-poppler (binario de 2016)
  // renderiza mal PDFs MP modernos → el OCR/Ollama no encuentra datos y marca el
  // comprobante como inválido. Por eso priorizamos pdfjs ahí. En macOS (poppler 0.66)
  // dejamos poppler primario para no cambiar el comportamiento que viene andando.
  const tryPdfJsFirst = process.platform === 'win32';
  const primary = tryPdfJsFirst ? renderWithPdfJs : renderWithPoppler;
  const fallback = tryPdfJsFirst ? renderWithPoppler : renderWithPdfJs;

  try {
    return await primary(pdfBuffer);
  } catch (primaryErr) {
    console.warn(`[validator] primary PDF renderer failed (${primaryErr.message}), trying fallback`);
    try {
      return await fallback(pdfBuffer);
    } catch (fallbackErr) {
      throw new Error(`PDF render failed — primary: ${primaryErr.message}; fallback: ${fallbackErr.message}`);
    }
  }
}

// ==========================================
// WINDOW & TRAY
// ==========================================

let mainWindow = null;
let tray = null;

function sendToRenderer(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  } catch (err) {
    console.warn(`[sendToRenderer] Failed to send ${channel}: ${err.message}`);
  }
  if (channel !== 'log') {
    console.log(`[sendToRenderer] ${channel}:`, JSON.stringify(data).substring(0, 200));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 700,
    minWidth: 400,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: 'Validador de Comprobantes',
    backgroundColor: '#1a1a2e',
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Close → minimize to tray. Real exit only via tray menu "Salir" or app.quit().
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // Block any window.open / external nav in the renderer — defense in depth alongside CSP.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (navUrl !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    if (!fs.existsSync(iconPath)) return;
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('Validador de Comprobantes');
    updateTray();
  } catch (err) {
    console.error('Tray creation failed:', err.message);
  }
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const conn = connectionModule ? connectionModule.getIsConnected() : false;
  const ollamaUp = ollamaManager ? ollamaManager.isAvailable() : false;
  const menu = Menu.buildFromTemplate([
    { label: conn ? 'Backend: conectado' : 'Backend: desconectado', enabled: false },
    { label: ollamaUp ? 'Ollama: listo' : 'Ollama: no disponible', enabled: false },
    { type: 'separator' },
    { label: 'Mostrar', click: () => mainWindow?.show() },
    {
      label: 'Cambiar configuracion',
      click: () => {
        mainWindow?.show();
        sendToRenderer('open-wizard', {});
      },
    },
    {
      label: 'Reconectar',
      click: () => {
        if (connectionModule) {
          connectionModule.disconnect();
          setTimeout(() => connectionModule.connectToBackend(), 500);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.removeAllListeners('click');
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide(); else mainWindow.show();
  });
}

// ==========================================
// MODULE REFERENCES (wired in app.whenReady)
// ==========================================

let connectionModule = null;
let queueModule = null;
let ollamaManager = null;
let pipelineModule = null;

// ==========================================
// APP LIFECYCLE
// ==========================================

app.whenReady().then(async () => {
  // 1. Initialize paths & config
  const configMod = require('./config');
  configMod.initPaths(app);
  configMod.loadConfig();
  configMod.loadProcessedIds();

  // 2. Create window & tray
  createWindow();
  createTray();

  // 3. Wire up modules with dependencies
  const { createOllamaManager } = require('./ollama/manager');
  ollamaManager = createOllamaManager({
    config: configMod.state.config,
    sendToRenderer,
    getMainWindow: () => mainWindow,
  });

  const { createPipeline } = require('./validation/pipeline');
  pipelineModule = createPipeline({
    config: configMod.state.config,
    sendToRenderer,
    convertPdfToImage,
    emitValidationResult: (...args) => queueModule.emitValidationResult(...args),
  });

  const { createQueueManager } = require('./socket/queue');
  queueModule = createQueueManager({
    config: configMod.state,
    logger,
    sendToRenderer,
    processValidationRequest: (...args) => pipelineModule.processValidationRequest(...args),
    getSocket: () => connectionModule ? connectionModule.getSocket() : null,
    isConnected: () => connectionModule ? connectionModule.getIsConnected() : false,
  });
  queueModule.setPaths(configMod.state);
  queueModule.loadOfflineQueue();

  const { createConnection } = require('./socket/connection');
  connectionModule = createConnection({
    config: configMod.state.config,
    logger,
    sendToRenderer,
    queueManager: queueModule,
    updateTray,
    ollamaManager,
    // Pipeline / handlers ask "is ollama up?" via this — no direct dependency on ollamaManager.
    getOllamaAvailable: () => ollamaManager.isAvailable(),
  });

  // 4. Register IPC handlers
  const { registerHandlers } = require('./ipc/handlers');
  const { initOCRWorker } = require('./ocr/worker');
  const { parseOCRText } = require('./ocr/parser');
  const { loadOcrExamples, saveOcrExamples, getOcrExamplesPath } = require('./ocr/examples');
  const { DEFAULT_PROMPT } = require('./validation/ollama');
  const { checkForUpdate: checkForUpdateFn, downloadUpdate: downloadUpdateFn } = require('./updater');

  registerHandlers({
    config: configMod,
    saveConfig: () => configMod.saveConfig(),
    loadConfig: () => configMod.loadConfig(),
    connection: connectionModule,
    queueManager: queueModule,
    pipeline: pipelineModule,
    logger,
    sendToRenderer,
    getMainWindow: () => mainWindow,
    convertPdfToImage,
    updateTray,
    // Ollama manager methods
    checkOllama: (...args) => ollamaManager.checkOllama(...args),
    installOllama: (...args) => ollamaManager.installOllama(...args),
    startOllama: (...args) => ollamaManager.startOllama(...args),
    pullModel: (...args) => ollamaManager.pullModel(...args),
    DEFAULT_PROMPT,
    // OCR
    initOCRWorker: (sr) => initOCRWorker(sr || sendToRenderer),
    parseOCRText,
    // OCR Examples
    loadOcrExamples: () => loadOcrExamples(() => configMod.state.userDataPath),
    saveOcrExamples: (data) => saveOcrExamples(() => configMod.state.userDataPath, data),
    getOcrExamplesPath: () => getOcrExamplesPath(() => configMod.state.userDataPath),
    getUserDataPath: () => configMod.state.userDataPath,
    // Updater
    checkForUpdate: checkForUpdateFn,
    downloadUpdate: downloadUpdateFn,
  });

  // 5. Start Ollama check (delayed for renderer to be ready)
  setTimeout(() => {
    ollamaManager.checkOllama().then(() => {
      updateTray();
    }).catch(err => {
      console.error('[checkOllama] Error:', err);
      sendToRenderer('ollama-status', {
        installed: false, running: false, hasVisionModel: false,
        error: err.message,
      });
    });
  }, 2000);

  // 5b. Pre-warm OCR worker (so first validation doesn't wait for init)
  setTimeout(() => {
    const { initOCRWorker } = require('./ocr/worker');
    initOCRWorker(sendToRenderer).catch(err => {
      console.warn('[PreWarm] OCR worker init failed:', err.message);
    });
  }, 4000);

  // 6. Connect to backend
  if (configMod.state.config.backendUrl && configMod.state.config.apiKey) {
    connectionModule.connectToBackend();
  }

  // 7. Start monitoring
  ollamaManager.startHealthCheck();
  ollamaManager.startMemoryMonitoring();

  // 8. Send initial state to renderer
  sendToRenderer('config', configMod.state.config);
  sendToRenderer('queue-status', { count: queueModule.getOfflineQueue().length });

  logger.info('APP', 'App started', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    queuedRequests: queueModule.getOfflineQueue().length,
  });

  // Cleanup orphaned temp files
  try {
    const tempDir = path.join(configMod.state.userDataPath, 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try { fs.unlinkSync(path.join(tempDir, file)); } catch (_) {}
      }
    }
  } catch (_) {}

  // Purge old log files (>30 days) — keeps disk usage bounded over months of operation.
  try { logger.purgeOldLogs(30); } catch (_) {}
});

// ==========================================
// SHUTDOWN
// ==========================================

app.on('before-quit', () => {
  app.isQuitting = true;
  if (queueModule) {
    queueModule.setShuttingDown(true);
    queueModule.flushOnShutdown();
  }
  if (ollamaManager) {
    ollamaManager.stopHealthCheck();
    ollamaManager.stopMemoryMonitoring();
  }
  // Cancel any running Ollama inference to prevent hang on shutdown.
  try {
    const configMod = require('./config');
    const url = configMod.state.config.ollamaUrl;
    if (url) {
      fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: '', prompt: '', stream: false, keep_alive: 0 }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
  } catch (_) {}
  // Tear down ollama subprocess if WE spawned it (avoids orphan after app quits).
  try { if (ollamaManager?.killSpawnedOllama) ollamaManager.killSpawnedOllama(); } catch (_) {}
  if (connectionModule) {
    connectionModule.disconnect();
  }
  // Stop the log flush timer + persist processed ids.
  try { logger.stopFlushTimer(); } catch (_) {}
  try {
    const configMod = require('./config');
    configMod.saveProcessedIds();
  } catch (_) {}
});

// On Windows the user closes the window with the X — we minimize to tray. window-all-closed
// fires when ALL windows are gone, which only happens via app.quit() now.
app.on('window-all-closed', () => {
  // Don't auto-quit on any platform: the tray keeps the app alive until the user picks "Salir".
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
