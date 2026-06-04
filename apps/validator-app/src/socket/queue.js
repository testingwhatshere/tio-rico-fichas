const fs = require('fs');

const MAX_OFFLINE_QUEUE_SIZE = 50;
const MAX_RECENTLY_PROCESSED = 200;
const QUEUE_ITEM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseQueuedAt(item) {
  if (!item || !item.queuedAt) return 0;
  const t = new Date(item.queuedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

function createQueueManager(deps) {
  const { config, logger, sendToRenderer, processValidationRequest, getSocket, isConnected } = deps;

  let offlineQueue = [];
  let validationQueue = [];
  let isProcessingValidation = false;
  const recentlyProcessedIds = new Set();
  const processingIds = new Set();
  let saveOfflineQueueTimer = null;
  let saveProcessedIdsTimer = null;
  let offlineQueuePath = null;
  let processedIdsPath = null;
  let isShuttingDown = false;

  // ---- Processed IDs persistence ----

  function loadProcessedIds() {
    try {
      if (fs.existsSync(processedIdsPath)) {
        const data = fs.readFileSync(processedIdsPath, 'utf8');
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

  function saveProcessedIds() {
    try {
      const ids = Array.from(recentlyProcessedIds);
      fs.writeFileSync(processedIdsPath, JSON.stringify(ids));
    } catch (error) {
      console.error('Error saving processed IDs:', error);
    }
  }

  function scheduleSaveProcessedIds() {
    if (saveProcessedIdsTimer) return;
    saveProcessedIdsTimer = setTimeout(() => {
      saveProcessedIdsTimer = null;
      saveProcessedIds();
    }, 2000);
  }

  // ---- Offline queue ----

  function loadOfflineQueue() {
    try {
      if (fs.existsSync(offlineQueuePath)) {
        const data = fs.readFileSync(offlineQueuePath, 'utf8');
        const parsed = JSON.parse(data);

        // Validate that parsed data is actually an array
        if (!Array.isArray(parsed)) {
          throw new Error(`Expected array, got ${typeof parsed}`);
        }

        // TTL: drop items queued more than QUEUE_ITEM_TTL_MS ago — they're stale and likely already
        // resolved manually by an operator, or the user gave up. Re-emitting an old result is worse
        // than dropping it.
        const cutoff = Date.now() - QUEUE_ITEM_TTL_MS;
        const beforeCount = parsed.length;
        offlineQueue = parsed.filter(item => {
          const queuedAt = parseQueuedAt(item);
          // Keep items without a queuedAt timestamp (legacy entries) — they'll be tagged on next push.
          return queuedAt === 0 || queuedAt >= cutoff;
        });
        const expiredCount = beforeCount - offlineQueue.length;
        logger.info('QUEUE', `Loaded ${offlineQueue.length} queued requests from disk` + (expiredCount ? ` (dropped ${expiredCount} expired)` : ''));

        // Enforce size limit on load (disk file may have grown beyond limit).
        if (offlineQueue.length > MAX_OFFLINE_QUEUE_SIZE) {
          logger.warn('OFFLINE_QUEUE', `Queue file had ${offlineQueue.length} entries, trimming to ${MAX_OFFLINE_QUEUE_SIZE}`);
          offlineQueue = offlineQueue.slice(-MAX_OFFLINE_QUEUE_SIZE); // Keep most recent
        }
        if (expiredCount > 0 || offlineQueue.length !== beforeCount) {
          saveOfflineQueueSync(); // Persist trimmed version atomically.
        }
      }
    } catch (error) {
      logger.error('QUEUE', `Error loading offline queue: ${error.message}`, { error: error.message });

      // Backup corrupted file before resetting
      try {
        if (fs.existsSync(offlineQueuePath)) {
          const backupPath = offlineQueuePath + '.bak';
          fs.copyFileSync(offlineQueuePath, backupPath);
          logger.warn('QUEUE', `Corrupted queue backed up to ${backupPath}`);
        }
      } catch (backupError) {
        logger.error('QUEUE', `Failed to backup corrupted queue: ${backupError.message}`);
      }

      offlineQueue = [];
    }
  }

  // Save offline queue to file (async, atomic via tmp+rename to survive mid-write crash).
  async function saveOfflineQueue() {
    if (!offlineQueuePath) return;
    const tmpPath = offlineQueuePath + '.tmp';
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(offlineQueue, null, 2));
      await fs.promises.rename(tmpPath, offlineQueuePath);
    } catch (error) {
      console.error('Error saving offline queue:', error);
      try { await fs.promises.unlink(tmpPath); } catch (_) {}
    }
  }

  // Synchronous save for shutdown (before-quit must be synchronous), also atomic.
  function saveOfflineQueueSync() {
    if (!offlineQueuePath) return;
    const tmpPath = offlineQueuePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(offlineQueue, null, 2));
      fs.renameSync(tmpPath, offlineQueuePath);
    } catch (error) {
      console.error('Error saving offline queue (sync):', error);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  // Debounced save — coalesces rapid writes into a single disk write
  function scheduleSaveOfflineQueue() {
    if (saveOfflineQueueTimer) return;
    saveOfflineQueueTimer = setTimeout(() => {
      saveOfflineQueueTimer = null;
      saveOfflineQueue();
    }, 500);
  }

  // Add request to offline queue (returns false if queue is full)
  function addToOfflineQueue(request) {
    if (offlineQueue.length >= MAX_OFFLINE_QUEUE_SIZE) {
      logger.warn('QUEUE', `Offline queue full (${MAX_OFFLINE_QUEUE_SIZE}), rejecting request: ${request.id}`);
      sendToRenderer('log', { message: `Cola offline llena (${MAX_OFFLINE_QUEUE_SIZE}). Solicitud requiere revision manual.`, type: 'warning' });

      // Emit rejection so backend routes to operator review
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('validation_result', {
          id: request.id,
          requestId: request.requestId,
          isValid: false,
          confidence: 0,
          extractedAmount: null,
          extractedDate: null,
          extractedTime: null,
          paymentMethod: null,
          transactionId: null,
          referenceNumber: null,
          senderName: null,
          senderDniCuit: null,
          recipientName: null,
          bankName: null,
          transactionStatus: null,
          authenticityChecks: null,
          reasoning: 'Cola de validacion llena, requiere revision manual',
          flags: ['QUEUE_FULL', 'REQUIRES_MANUAL_REVIEW'],
        });
      }
      return false;
    }

    // Deduplicate: skip if same id or requestId already in offline queue
    const isDuplicate = offlineQueue.some(
      (item) => item.id === request.id || (request.requestId && item.requestId === request.requestId)
    );
    if (isDuplicate) {
      logger.warn('QUEUE', `Duplicate offline queue request ignored: ${request.id}`, { requestId: request.requestId });
      return true; // Not an error, just already queued
    }

    offlineQueue.push({
      ...request,
      queuedAt: new Date().toISOString(),
    });
    scheduleSaveOfflineQueue();
    sendToRenderer('queue-status', { count: offlineQueue.length });
    logger.info('QUEUE', `Request queued offline: ${request.id}`, { queueLength: offlineQueue.length });
    return true;
  }

  // Process offline queue when reconnected
  async function processOfflineQueue() {
    if (offlineQueue.length === 0) return;

    logger.info('QUEUE', `Processing ${offlineQueue.length} queued requests`);
    sendToRenderer('log', { message: `Procesando ${offlineQueue.length} solicitudes en cola...`, type: 'info' });

    const { validateWithOllama, convertPdfToImage } = deps;

    // Process queue one at a time
    while (offlineQueue.length > 0 && isConnected() && getSocket()?.connected) {
      const request = offlineQueue[0];

      // Skip already-processed or in-flight requests (prevents double-processing on reconnect)
      if (recentlyProcessedIds.has(request.id) ||
          (request.requestId && recentlyProcessedIds.has(request.requestId)) ||
          processingIds.has(request.id) ||
          (request.requestId && processingIds.has(request.requestId))) {
        logger.info('QUEUE', `Skipping already-processed/in-flight offline request: ${request.id}`);
        offlineQueue.shift();
        scheduleSaveOfflineQueue();
        sendToRenderer('queue-status', { count: offlineQueue.length });
        continue;
      }

      try {
        sendToRenderer('log', { message: `Procesando solicitud en cola: ${request.id}`, type: 'info' });
        sendToRenderer('validating', { id: request.id });

        // If this request has a precomputed result (saved during disconnect), emit it directly
        if (request._precomputedResult) {
          logger.info('QUEUE', `Emitting precomputed result for: ${request.id}`);
          emitValidationResult(request, {
            ...request._precomputedResult,
            flags: [...(request._precomputedResult.flags || []), 'FROM_OFFLINE_QUEUE'],
          });
          const statusText = request._precomputedResult.isValid ? 'APROBADO' : 'RECHAZADO';
          sendToRenderer('log', { message: `Cola (pre-calculado): ${statusText} - ${request.id}`, type: request._precomputedResult.isValid ? 'success' : 'warning' });
          sendToRenderer('validation-done', { id: request.id, result: request._precomputedResult });

          // Remove from queue and continue
          offlineQueue.shift();
          scheduleSaveOfflineQueue();
          sendToRenderer('queue-status', { count: offlineQueue.length });
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        const startTime = Date.now();

        // Handle PDF conversion if needed
        let processedRequest = { ...request };
        if (request.mimeType === 'application/pdf') {
          try {
            const imageBase64 = await convertPdfToImage(request.imageBase64);
            processedRequest.imageBase64 = imageBase64;
            processedRequest.mimeType = 'image/png';
          } catch (pdfError) {
            emitValidationResult(request, {
              id: request.id,
              requestId: request.requestId,
              isValid: false,
              confidence: 0,
              extractedAmount: null,
              extractedDate: null,
              extractedTime: null,
              paymentMethod: null,
              transactionId: null,
              referenceNumber: null,
              senderName: null,
              senderDniCuit: null,
              recipientName: null,
              bankName: null,
              transactionStatus: null,
              authenticityChecks: null,
              reasoning: `PDF requiere revision manual: ${pdfError.message}`,
              flags: ['PDF_CONVERSION_FAILED', 'REQUIRES_MANUAL_REVIEW', 'FROM_OFFLINE_QUEUE'],
            });

            // Remove from queue and continue
            offlineQueue.shift();
            scheduleSaveOfflineQueue();
            sendToRenderer('queue-status', { count: offlineQueue.length });
            sendToRenderer('validation-done', { id: request.id, error: 'PDF conversion failed' });
            continue;
          }
        }

        const result = await validateWithOllama(processedRequest);
        const duration = Date.now() - startTime;

        logger.logValidationResult(request.id, { ...result, durationMs: duration, fromQueue: true });

        emitValidationResult(request, {
          id: request.id,
          requestId: request.requestId,
          ...result,
          flags: [...(result.flags || []), 'FROM_OFFLINE_QUEUE'],
        });

        const statusText = result.isValid ? 'APROBADO' : 'RECHAZADO';
        sendToRenderer('log', { message: `Cola: ${statusText} - ${request.id}`, type: result.isValid ? 'success' : 'warning' });
        sendToRenderer('validation-done', { id: request.id, result });

      } catch (error) {
        logger.error('QUEUE', `Error processing queued request ${request.id}`, { error: error.message });

        emitValidationResult(request, {
          id: request.id,
          requestId: request.requestId,
          isValid: false,
          confidence: 0,
          extractedAmount: null,
          extractedDate: null,
          extractedTime: null,
          paymentMethod: null,
          transactionId: null,
          referenceNumber: null,
          senderName: null,
          senderDniCuit: null,
          recipientName: null,
          bankName: null,
          transactionStatus: null,
          authenticityChecks: null,
          reasoning: `Error: ${error.message}`,
          flags: ['VALIDATION_ERROR', 'FROM_OFFLINE_QUEUE'],
        });

        sendToRenderer('validation-done', { id: request.id, error: error.message });
      }

      // Remove processed request from queue
      offlineQueue.shift();
      scheduleSaveOfflineQueue();
      sendToRenderer('queue-status', { count: offlineQueue.length });

      // Small delay between queued requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (offlineQueue.length === 0) {
      logger.success('QUEUE', 'Offline queue processed successfully');
      sendToRenderer('log', { message: 'Cola offline procesada!', type: 'success' });
    }
  }

  // Trim recently-processed set to prevent unbounded growth
  function trimRecentlyProcessed() {
    if (recentlyProcessedIds.size > MAX_RECENTLY_PROCESSED) {
      const iterator = recentlyProcessedIds.values();
      const excess = recentlyProcessedIds.size - MAX_RECENTLY_PROCESSED;
      for (let i = 0; i < excess; i++) {
        recentlyProcessedIds.delete(iterator.next().value);
      }
    }
    // Persist to disk after any modification
    scheduleSaveProcessedIds();
  }

  // Add validation request to queue
  function addToValidationQueue(request) {
    // Check recently-processed set first (prevents re-validation on backend retries)
    if (recentlyProcessedIds.has(request.id) || (request.requestId && recentlyProcessedIds.has(request.requestId))) {
      logger.warn('QUEUE', `Already processed validation request ignored: ${request.id}`, { requestId: request.requestId });
      return;
    }

    // Check in-flight guard (prevents dual-queue race between offline and live queues)
    if (processingIds.has(request.id) || (request.requestId && processingIds.has(request.requestId))) {
      logger.warn('QUEUE', `Request currently being processed, ignoring duplicate: ${request.id}`);
      return;
    }

    // Deduplicate: skip if same id or requestId already in queue
    const isDuplicate = validationQueue.some(
      (item) => item.id === request.id || (request.requestId && item.requestId === request.requestId)
    );
    if (isDuplicate) {
      logger.warn('QUEUE', `Duplicate validation request ignored: ${request.id}`, { requestId: request.requestId });
      return;
    }

    validationQueue.push(request);
    sendToRenderer('validation-queue-status', {
      count: validationQueue.length,
      processing: isProcessingValidation,
    });
    logger.info('QUEUE', `Validation request queued: ${request.id}`, { queueLength: validationQueue.length });

    // Start processing if not already
    if (!isProcessingValidation) {
      processValidationQueue();
    }
  }

  // Process validation queue one at a time
  async function processValidationQueue() {
    if (isProcessingValidation || validationQueue.length === 0) return;

    isProcessingValidation = true;
    sendToRenderer('validation-queue-status', {
      count: validationQueue.length,
      processing: true,
    });

    try {
      while (validationQueue.length > 0 && !isShuttingDown && isConnected() && getSocket()?.connected) {
        const request = validationQueue[0];
        request.isProcessing = true;

        // Mark as in-flight to prevent dual-queue race
        processingIds.add(request.id);
        if (request.requestId) processingIds.add(request.requestId);

        sendToRenderer('validation-queue-status', {
          count: validationQueue.length,
          processing: true,
          currentId: request.id,
        });

        try {
          await processValidationRequest(request);
        } catch (error) {
          logger.error('QUEUE', `Unhandled error processing validation request ${request.id}, skipping`, { error: error.message, stack: error.stack });
          sendToRenderer('log', { message: `Error inesperado procesando ${request.id}: ${error.message}`, type: 'error' });
        }

        // Remove from in-flight guard
        processingIds.delete(request.id);
        if (request.requestId) processingIds.delete(request.requestId);

        validationQueue.shift();

        // Track as recently processed
        recentlyProcessedIds.add(request.id);
        if (request.requestId) {
          recentlyProcessedIds.add(request.requestId);
        }
        trimRecentlyProcessed();

        // Small delay between validations
        if (validationQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // If disconnected/shutting down and items remain, move them to offline queue
      if (validationQueue.length > 0 && (isShuttingDown || !isConnected() || !getSocket()?.connected)) {
        logger.warn('QUEUE', `${isShuttingDown ? 'Shutting down' : 'Disconnected'} with ${validationQueue.length} items in validation queue, moving to offline queue`);
        sendToRenderer('log', { message: `Moviendo ${validationQueue.length} solicitudes a cola offline...`, type: 'warning' });

        while (validationQueue.length > 0) {
          const remaining = validationQueue.shift();
          addToOfflineQueue(remaining);
        }
      }
    } finally {
      isProcessingValidation = false;
      sendToRenderer('validation-queue-status', {
        count: validationQueue.length,
        processing: false,
      });
    }
  }

  // Emit validation result safely, saving to offline queue if disconnected
  function emitValidationResult(request, resultPayload) {
    const socket = getSocket();
    // Guard: check socket exists and is connected before attempting emit
    if (!socket || !socket.connected) {
      logger.warn('QUEUE', `Socket not connected before emit, saving result to offline queue: ${request.id}`, { socketExists: !!socket, connected: socket?.connected });
      addToOfflineQueue({
        ...request,
        _precomputedResult: resultPayload,
      });
      return;
    }

    try {
      socket.emit('validation_result', resultPayload);
    } catch (error) {
      // Race condition: socket disconnected between the check and the emit
      logger.warn('QUEUE', `Socket emit failed (race condition), saving result to offline queue: ${request.id}`, { error: error.message });
      addToOfflineQueue({
        ...request,
        _precomputedResult: resultPayload,
      });
    }
  }

  // ---- Lifecycle helpers ----

  function setPaths(stateOrPath, processedIdsP) {
    // Accept either (state object) or (offlineQueuePath, processedIdsPath)
    if (typeof stateOrPath === 'object' && stateOrPath !== null) {
      offlineQueuePath = stateOrPath.offlineQueuePath;
      processedIdsPath = stateOrPath.processedIdsPath;
    } else {
      offlineQueuePath = stateOrPath;
      processedIdsPath = processedIdsP;
    }
  }

  function setShuttingDown(value) {
    isShuttingDown = value;
  }

  function getOfflineQueue() {
    return offlineQueue;
  }

  function getValidationQueue() {
    return validationQueue;
  }

  function clearOfflineQueue() {
    const count = offlineQueue.length;
    offlineQueue = [];
    saveOfflineQueue();
    return count;
  }

  function flushOnShutdown() {
    // Move in-flight validation queue items to offline queue (skip currently processing)
    if (validationQueue.length > 0) {
      const saveable = validationQueue.filter(item => !item.isProcessing);
      logger.info('SHUTDOWN', `Saving ${saveable.length} of ${validationQueue.length} in-flight validation requests to offline queue (skipping ${validationQueue.length - saveable.length} processing)`);
      for (const item of saveable) {
        offlineQueue.push({
          ...item,
          queuedAt: new Date().toISOString(),
        });
      }
      validationQueue.length = 0;
    }

    // Clear debounce timers and save queues directly (sync for shutdown)
    if (saveOfflineQueueTimer) {
      clearTimeout(saveOfflineQueueTimer);
      saveOfflineQueueTimer = null;
    }
    saveOfflineQueueSync();

    if (saveProcessedIdsTimer) {
      clearTimeout(saveProcessedIdsTimer);
      saveProcessedIdsTimer = null;
    }
    saveProcessedIds();
  }

  return {
    setPaths,
    loadOfflineQueue,
    saveOfflineQueue,
    saveOfflineQueueSync,
    scheduleSaveOfflineQueue,
    addToOfflineQueue,
    processOfflineQueue,
    loadProcessedIds,
    saveProcessedIds,
    trimRecentlyProcessed,
    addToValidationQueue,
    processValidationQueue,
    emitValidationResult,
    setShuttingDown,
    getOfflineQueue,
    getValidationQueue,
    clearOfflineQueue,
    flushOnShutdown,
  };
}

module.exports = { createQueueManager };
