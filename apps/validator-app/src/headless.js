#!/usr/bin/env node
/**
 * Validador — modo servidor (sin Electron).
 *
 * Corre el MISMO pipeline que la app de escritorio (OCR + parser) como proceso
 * Node en Render. Se conecta al backend por el namespace /validator igual que
 * la PC: el protocolo no cambia.
 *
 * Diferencias con main.js:
 * - Configuración por variables de entorno (ver leerConfig).
 * - Sin cola offline en disco: lo que termina con el socket caído queda en
 *   memoria y se manda al reconectar; lo que no llegó a empezar lo reenvía el
 *   backend a la instancia que siga.
 * - Apagado ordenado con SIGTERM (deploys de Render): termina el comprobante en
 *   curso, manda el resultado y no se reconecta.
 * - Vigilante: si queda roto (sin conexión, OCR caído, memoria alta) sale con
 *   código 1 y Render lo levanta de cero. Antes el proceso quedaba vivo pero
 *   inútil hasta que alguien lo reiniciara a mano.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ==========================================
// CONFIGURACIÓN
// ==========================================

function numeroEnv(nombre, porDefecto) {
  const raw = process.env[nombre];
  if (raw === undefined || raw === '') return porDefecto;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${nombre} no es un número: "${raw}"`);
  return n;
}

function leerConfig() {
  const apiKey = (process.env.VALIDATOR_API_KEY || '').trim();
  if (!apiKey) throw new Error('Falta VALIDATOR_API_KEY');
  const backendUrl = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(backendUrl)) throw new Error('BACKEND_URL falta o no es una URL http(s)');

  return {
    backendUrl,
    apiKey,
    dataDir: process.env.DATA_DIR || '/tmp/validador',
    ocrConfidenceThreshold: numeroEnv('OCR_CONFIDENCE_THRESHOLD', undefined),
    dateWindowDays: numeroEnv('DATE_WINDOW_DAYS', undefined),
    // Vigilante
    maxDesconectadoMs: numeroEnv('WATCHDOG_MAX_DISCONNECTED_MS', 3 * 60_000),
    maxOcrCaidoMs: numeroEnv('WATCHDOG_MAX_OCR_DISABLED_MS', 10 * 60_000),
    maxRssMb: numeroEnv('WATCHDOG_MAX_RSS_MB', 450),
    // Entre comprobantes, si se pasa de esto se recicla el worker de OCR.
    reciclarOcrMb: numeroEnv('OCR_RECYCLE_RSS_MB', 300),
    // Render manda SIGKILL 30 s después de SIGTERM: se deja margen para cerrar.
    graciaApagadoMs: numeroEnv('SHUTDOWN_GRACE_MS', 25_000),
  };
}

let cfg;
try {
  cfg = leerConfig();
} catch (err) {
  console.error(`[validador] Configuración inválida: ${err.message}`);
  process.exit(1);
}

fs.mkdirSync(cfg.dataDir, { recursive: true });
logger.configure({
  jsonStdout: process.env.LOG_FORMAT !== 'pretty',
  writeFiles: false,
});

// Memoria acotada: sin cache de libvips y un solo hilo (el contenedor tiene 0,5 CPU).
try {
  const sharp = require('sharp');
  sharp.cache(false);
  sharp.concurrency(1);
} catch (_) { /* preprocess.js ya avisa si sharp no está */ }

const version = (() => {
  try { return require('../package.json').version; } catch (_) { return 'desconocida'; }
})();

// ==========================================
// MÓDULOS (mismo cableado que main.js)
// ==========================================

const configMod = require('./config');
configMod.initPathsFromDir(cfg.dataDir);
Object.assign(configMod.state.config, {
  backendUrl: cfg.backendUrl,
  apiKey: cfg.apiKey,
  ollamaEnabled: false,
  ...(cfg.ocrConfidenceThreshold !== undefined && { ocrConfidenceThreshold: cfg.ocrConfidenceThreshold }),
  ...(cfg.dateWindowDays !== undefined && { dateWindowDays: cfg.dateWindowDays }),
});

// Los mensajes para la ventana de escritorio no tienen destino acá; lo que
// importa ya pasa por el logger.
const sendToRenderer = () => {};

const { createPdfConverter } = require('./pdf');
const { convertPdfToImage } = createPdfConverter({
  getTempDir: () => cfg.dataDir,
  log: {
    info: (m) => logger.info('PDF', m),
    warn: (m) => logger.warn('PDF', m),
  },
});

let queueModule = null;
let connectionModule = null;

const { initOCRWorker, getOCRStatus, reciclarSiPasa } = require('./ocr/worker');

const { createPipeline } = require('./validation/pipeline');
const pipelineModule = createPipeline({
  config: configMod.state.config,
  sendToRenderer,
  convertPdfToImage,
  emitValidationResult: (...args) => queueModule.emitValidationResult(...args),
  getOllamaAvailable: () => false,
});

const { createQueueManager } = require('./socket/queue');
queueModule = createQueueManager({
  config: configMod.state,
  logger,
  sendToRenderer,
  headless: true,
  processValidationRequest: async (...args) => {
    try {
      return await pipelineModule.processValidationRequest(...args);
    } finally {
      await reciclarSiPasa(cfg.reciclarOcrMb);
    }
  },
  getSocket: () => (connectionModule ? connectionModule.getSocket() : null),
  isConnected: () => (connectionModule ? connectionModule.getIsConnected() : false),
});

const { createConnection } = require('./socket/connection');
connectionModule = createConnection({
  config: configMod.state.config,
  logger,
  sendToRenderer,
  queueManager: queueModule,
  updateTray: () => {},
});


// ==========================================
// APAGADO
// ==========================================

let apagando = false;

async function apagar(motivo, codigo) {
  if (apagando) return;
  apagando = true;
  logger.warn('SHUTDOWN', `Apagando (${motivo})`, {
    procesando: queueModule.isProcessing(),
    resultadosPendientes: queueModule.getPendingResultsCount(),
  });

  // 1. No tomar nada nuevo y dejar terminar lo que está en curso.
  queueModule.setShuttingDown(true);
  const terminoATiempo = await queueModule.waitUntilIdle(cfg.graciaApagadoMs);
  if (!terminoATiempo) {
    logger.warn('SHUTDOWN', 'La validación en curso no terminó a tiempo; el backend la reenviará');
  }

  // 2. Mandar lo que haya quedado pendiente, si todavía hay conexión.
  try { queueModule.flushPendingResults(); } catch (_) {}

  // 3. Cortar sin reconexión y vaciar los logs.
  try { connectionModule.disconnect({ permanent: true }); } catch (_) {}
  try { await logger.flushLogs(); } catch (_) {}
  try { logger.stopFlushTimer(); } catch (_) {}

  process.exit(codigo);
}

process.on('SIGTERM', () => { apagar('SIGTERM', 0); });
process.on('SIGINT', () => { apagar('SIGINT', 0); });

process.on('uncaughtException', (error) => {
  // EPIPE del subproceso de Tesseract.js: recuperable, el worker se recrea.
  if (error?.code === 'EPIPE' || error?.message?.includes('EPIPE')) {
    logger.warn('CRASH', `EPIPE suprimido: ${error.message}`);
    return;
  }
  // Cualquier otra cosa deja el proceso en estado desconocido: mejor reiniciar
  // limpio que seguir vivo y roto.
  logger.error('CRASH', `Uncaught exception: ${error.message}`, { stack: error.stack });
  apagar('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('CRASH', `Unhandled rejection: ${msg}`, { stack });
});

// ==========================================
// VIGILANTE
// ==========================================

const INTERVALO_VIGILANTE_MS = 30_000;
const INTERVALO_ESTADO_MS = 5 * 60_000;
let ultimoEstado = 0;

function vigilar() {
  if (apagando) return;
  const ahora = Date.now();
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);

  const desconectadoDesde = connectionModule.getDisconnectedSince();
  if (desconectadoDesde && ahora - desconectadoDesde > cfg.maxDesconectadoMs) {
    logger.error('APP', `Sin conexión al backend hace ${Math.round((ahora - desconectadoDesde) / 1000)}s: reinicio`);
    return apagar('vigilante: sin conexión', 1);
  }

  const ocr = getOCRStatus();
  if (ocr.disabled && ocr.disabledAt && ahora - ocr.disabledAt > cfg.maxOcrCaidoMs) {
    logger.error('APP', `OCR deshabilitado hace ${Math.round((ahora - ocr.disabledAt) / 1000)}s: reinicio`);
    return apagar('vigilante: OCR caído', 1);
  }

  // Memoria alta: se reinicia recién cuando no hay nada en curso, así no se
  // corta un comprobante a la mitad.
  if (rssMb > cfg.maxRssMb && !queueModule.isProcessing()) {
    logger.error('APP', `Memoria ${rssMb} MB > ${cfg.maxRssMb} MB: reinicio`);
    return apagar('vigilante: memoria', 1);
  }

  if (ahora - ultimoEstado >= INTERVALO_ESTADO_MS) {
    ultimoEstado = ahora;
    const m = pipelineModule.getMetrics();
    logger.info('APP', 'Estado', {
      conectado: connectionModule.getIsConnected(),
      procesando: queueModule.isProcessing(),
      enCola: queueModule.getValidationQueue().length,
      resultadosPendientes: queueModule.getPendingResultsCount(),
      ocrDeshabilitado: ocr.disabled,
      validaciones: m.totalValidations,
      aprobadas: m.approved,
      rechazadas: m.rejected,
      errores: m.errors,
      rssMb,
    });
  }
}

// ==========================================
// ARRANQUE
// ==========================================

(async () => {
  logger.info('APP', 'Validador (modo servidor) arrancando', {
    version,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    backendUrl: cfg.backendUrl,
  });

  // El worker de OCR se prepara antes de conectarse: si no levanta, este
  // proceso no sirve y es mejor que Render lo reinicie.
  const worker = await initOCRWorker();
  if (!worker) {
    logger.error('APP', 'No se pudo inicializar el OCR');
    return apagar('OCR no inicializa', 1);
  }

  connectionModule.connectToBackend();
  setInterval(vigilar, INTERVALO_VIGILANTE_MS).unref();
  logger.info('APP', 'Validador listo', { rssMb: Math.round(process.memoryUsage().rss / 1048576) });
})().catch((err) => {
  logger.error('CRASH', `Fallo al arrancar: ${err.message}`, { stack: err.stack });
  apagar('fallo al arrancar', 1);
});

// El socket mantiene vivo el proceso; esto lo asegura incluso entre reconexiones.
setInterval(() => {}, 1 << 30);

module.exports = { leerConfig };
