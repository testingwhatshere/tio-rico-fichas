const { validateWithOllamaWithFallback: validateWithOllama, checkAuthenticity } = require('./ollama');
const { parseOCRText } = require('../ocr/parser');
const logger = require('../logger');

// Date validation in ART (Argentina is UTC-3, no DST). Anchoring at midnight ART avoids
// the "23:55 today is in the future when read at 00:05 UTC" off-by-one bug.
const ART_OFFSET = '-03:00';
function parseReceiptDateArt(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const d = new Date(`${yyyyMmDd}T12:00:00${ART_OFFSET}`);
  return isNaN(d.getTime()) ? null : d;
}
function diffDaysArt(yyyyMmDd) {
  const d = parseReceiptDateArt(yyyyMmDd);
  if (!d) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function createPipeline(deps) {
  // deps = { config, sendToRenderer, convertPdfToImage, emitValidationResult }

  // ---- Validation Metrics ----
  // Counters used by the OCR-first cascade. The renderer reads these via the
  // `validator-stats` IPC event for the "Estadísticas hoy" panel.
  const metrics = {
    totalValidations: 0,
    ocrFastCount: 0,         // detected bank + parser_specific match exact
    ocrAggressiveCount: 0,   // any parser, exact amount+date match
    ollamaCount: 0,          // fell through to Ollama
    failedCount: 0,
    // Legacy fields preserved for the old getMetrics() consumers.
    ocrFastPath: 0, ollamaFull: 0, ocrPlusAuthenticity: 0,
    approved: 0, rejected: 0, errors: 0,
    totalOcrTimeMs: 0, totalOllamaTimeMs: 0,
    authenticityCalls: 0, authenticityRejections: 0, cacheHits: 0,
    // Daily counters reset at 00:00 ART.
    dayStartedAt: Date.now(),
  };

  function maybeRollMetricsDay() {
    // Reset daily counters at midnight ART so the UI panel shows "today's" rate, not lifetime.
    const nowArt = new Date(Date.now());
    const nowDay = nowArt.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    if (!metrics._lastDay) { metrics._lastDay = nowDay; return; }
    if (metrics._lastDay !== nowDay) {
      metrics.ocrFastCount = 0;
      metrics.ocrAggressiveCount = 0;
      metrics.ollamaCount = 0;
      metrics.failedCount = 0;
      metrics._lastDay = nowDay;
    }
  }

  function emitStats() {
    try {
      maybeRollMetricsDay();
      deps.sendToRenderer('validator-stats', {
        ocrFastCount: metrics.ocrFastCount,
        ocrAggressiveCount: metrics.ocrAggressiveCount,
        ollamaCount: metrics.ollamaCount,
        failedCount: metrics.failedCount,
      });
    } catch (_) {}
  }

  function getMetrics() {
    const avgOcr = metrics.ocrFastPath > 0 ? Math.round(metrics.totalOcrTimeMs / metrics.ocrFastPath) : 0;
    const avgOllama = metrics.ollamaFull > 0 ? Math.round(metrics.totalOllamaTimeMs / metrics.ollamaFull) : 0;
    return {
      ...metrics,
      avgOcrTimeMs: avgOcr, avgOllamaTimeMs: avgOllama,
      fastPathRate: metrics.totalValidations > 0 ? Math.round((metrics.ocrFastPath / metrics.totalValidations) * 100) : 0,
      approvalRate: metrics.totalValidations > 0 ? Math.round((metrics.approved / metrics.totalValidations) * 100) : 0,
    };
  }

  // ---- Result Cache (duplicate image detection) ----
  const CACHE_MAX_SIZE = 50;
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  const resultCache = new Map();

  function getImageHash(base64Data) {
    let hash = 0;
    const sample = base64Data.substring(0, 5000) + base64Data.substring(Math.max(0, base64Data.length - 5000));
    for (let i = 0; i < sample.length; i++) {
      hash = ((hash << 5) - hash) + sample.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  function getCachedResult(imageBase64) {
    const hash = getImageHash(imageBase64);
    const cached = resultCache.get(hash);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) { resultCache.delete(hash); return null; }
    return cached;
  }

  function setCachedResult(imageBase64, result, validationMethod) {
    const hash = getImageHash(imageBase64);
    if (resultCache.size >= CACHE_MAX_SIZE) {
      const oldestKey = resultCache.keys().next().value;
      resultCache.delete(oldestKey);
    }
    resultCache.set(hash, { result: { ...result }, validationMethod, timestamp: Date.now() });
  }

  let ocrWorker = null;
  let ocrInitializing = false;
  let ocrInitFailed = false;

  async function initOCRWorker() {
    if (ocrWorker) return ocrWorker;
    if (ocrInitializing || ocrInitFailed) return null;
    ocrInitializing = true;
    try {
      const Tesseract = require('tesseract.js');
      ocrWorker = await Tesseract.createWorker('spa', 1, {
        logger: () => {},
      });
      logger.success('OCR', 'Tesseract.js worker initialized (Spanish)');
      deps.sendToRenderer('log', { message: 'Lectura Inteligente inicializada', type: 'success' });
    } catch (err) {
      logger.warn('OCR', `Failed to init Tesseract: ${err.message}`);
      ocrWorker = null;
      ocrInitFailed = true;
      deps.sendToRenderer('log', { message: `Lectura Inteligente no disponible: ${err.message}`, type: 'warning' });
    }
    ocrInitializing = false;
    return ocrWorker;
  }

  /**
   * Build OCR result object from parsed fields.
   */
  function buildOCRResult(fields, request, statusFlags, isValid) {
    return {
      isValid,
      confidence: fields.confidence,
      extractedAmount: fields.extractedAmount,
      extractedDate: fields.extractedDate,
      extractedTime: fields.extractedTime,
      paymentMethod: fields.paymentMethod,
      transactionId: fields.transactionId,
      referenceNumber: null,
      senderName: fields.senderName,
      senderDniCuit: fields.senderDniCuit,
      recipientName: fields.recipientName,
      recipientAccount: fields.recipientAccount || null,
      recipientMatch: null,
      bankName: fields.bankName,
      transactionStatus: fields.transactionStatus,
      authenticityChecks: null,
      reasoning: isValid
        ? `Lectura Inteligente: comprobante valido ($${fields.extractedAmount}, ${fields.extractedDate})`
        : `Lectura Inteligente: ${statusFlags.filter(f => f !== 'OCR_FAST_PATH').join(', ') || 'datos insuficientes'}`,
      flags: statusFlags,
    };
  }

  // OCR confidence threshold (configurable). Below this we still try the aggressive path —
  // we only short-circuit to Ollama if BOTH paths produce no exact amount+date match.
  function getOcrThreshold() {
    const t = deps.config?.ocrConfidenceThreshold;
    return Number.isFinite(t) ? t : 0.7;
  }
  // Date window (days). Default ±1 day in ART — same-day or yesterday, nothing older.
  function getDateWindowDays() {
    const w = deps.config?.dateWindowDays;
    return Number.isFinite(w) && w > 0 ? w : 7;
  }

  /**
   * Run OCR + multi-pass + parser. Returns:
   *  { result, source: 'ocr_fast' | 'ocr_aggressive' | null, ocrText, fields }
   * `source` reflects how the result was built; null means OCR could not produce a result good enough
   * to short-circuit Ollama (caller should fall through).
   */
  async function validateWithOCR(request) {
    const { recognizeWithMultiPass } = require('../ocr/worker');
    const startTime = Date.now();
    try {
      let imageData = request.imageBase64;
      if (imageData && imageData.startsWith('data:')) {
        imageData = imageData.split(',')[1] || imageData;
      }
      const imageBuffer = Buffer.from(imageData, 'base64');

      const ocr = await recognizeWithMultiPass(imageBuffer, deps.sendToRenderer);
      if (!ocr) return { result: null, source: null, ocrText: '', fields: null };
      const text = ocr.text;
      if (!text || text.length < 20) {
        logger.info('OCR', 'Too little text extracted, falling back to Ollama');
        return { result: null, source: null, ocrText: text, fields: null };
      }

      const expected = request.expectedAmount > 0 ? request.expectedAmount : null;
      const fields = parseOCRText(text, expected || 0);
      const duration = Date.now() - startTime;
      logger.info('OCR', `Extracted in ${duration}ms: amount=${fields.extractedAmount}, date=${fields.extractedDate}, confidence=${fields.confidence.toFixed(2)}, bank=${fields.detectedPlatform}`);

      // Determine date validity in ART.
      const dateWindow = getDateWindowDays();
      let dateValid = true;
      const statusFlags = [];
      if (fields.extractedDate) {
        const dd = diffDaysArt(fields.extractedDate);
        if (dd !== null) {
          if (dd > dateWindow) { statusFlags.push('OLD_DATE'); dateValid = false; }
          if (dd < -1) { statusFlags.push('FUTURE_DATE'); dateValid = false; }
        }
      }

      // Status normalization.
      const approvedVariants = ['aprobada', 'aprobado', 'exitosa', 'exitoso', 'completada', 'completado', 'acreditada', 'approved', 'realizada', 'enviada'];
      let statusApproved = null; // null = unknown, true/false = decided.
      if (fields.transactionStatus) {
        statusApproved = approvedVariants.some(v => fields.transactionStatus.toLowerCase().includes(v));
        if (!statusApproved) statusFlags.push('STATUS_NOT_APPROVED');
      }

      // Amount match against expected. We *strongly* prefer exact match (within 1 cent) over
      // confidence — Tesseract's confidence is dragged down by UI chrome around the receipt.
      const amount = fields.extractedAmount;
      let amountMatchExact = false;
      let amountMatchTolerant = false;
      if (amount != null && expected != null) {
        amountMatchExact = Math.abs(amount - expected) < 0.01;
        amountMatchTolerant = Math.abs(amount - expected) <= expected * 0.1;
      }
      if (!amountMatchTolerant && expected != null && amount != null) {
        statusFlags.push('AMOUNT_MISMATCH');
      }
      if (!fields.senderName && !fields.senderDniCuit) statusFlags.push('MISSING_SENDER_INFO');
      if (!fields.transactionId) statusFlags.push('NO_TRANSACTION_ID');

      // -- Decision --
      // OCR fast: a known bank was detected + amount matches expected exactly + date valid + status approved (or absent).
      // OCR aggressive: bank not detected, but exact amount + date match.
      // Anything else → return null and let the cascade fall through to Ollama.
      const knownBank = fields.detectedPlatform && fields.detectedPlatform !== 'generic';
      const blockingFlags = statusFlags.filter(f => f !== 'NO_TRANSACTION_ID' && f !== 'MISSING_SENDER_INFO' && f !== 'OCR_FAST_PATH' && f !== 'OCR_AGGRESSIVE');

      if (amountMatchExact && dateValid && statusApproved !== false && knownBank) {
        statusFlags.push('OCR_FAST_PATH');
        const result = buildOCRResult(fields, request, statusFlags, blockingFlags.length === 0);
        return { result, source: 'ocr_fast', ocrText: text, fields };
      }
      if (amountMatchExact && dateValid && statusApproved !== false) {
        statusFlags.push('OCR_AGGRESSIVE');
        const result = buildOCRResult(fields, request, statusFlags, blockingFlags.length === 0);
        return { result, source: 'ocr_aggressive', ocrText: text, fields };
      }

      // OCR confidence is high enough to make a tolerant decision but not exact: still return a
      // result for the legacy path so the parallel-authenticity flow keeps working.
      if (fields.confidence >= getOcrThreshold() && amountMatchTolerant && dateValid && statusApproved !== false) {
        statusFlags.push('OCR_FAST_PATH');
        const result = buildOCRResult(fields, request, statusFlags, blockingFlags.length === 0);
        return { result, source: 'ocr_fast', ocrText: text, fields };
      }

      // No exact match. If we have a clear "amount mismatch" with a high-confidence read, that's a
      // *valid OCR rejection* — no need to consult Ollama, the user paid the wrong amount.
      if (fields.confidence >= getOcrThreshold() && amount != null && expected != null && !amountMatchTolerant) {
        statusFlags.push('OCR_FAST_PATH');
        const result = buildOCRResult(fields, request, statusFlags, false);
        return { result, source: 'ocr_fast', ocrText: text, fields };
      }

      logger.info('OCR', `No definitive OCR decision (confidence=${fields.confidence.toFixed(2)}, amountMatchExact=${amountMatchExact}, dateValid=${dateValid}, status=${statusApproved})`);
      return { result: null, source: null, ocrText: text, fields };
    } catch (err) {
      logger.warn('OCR', `OCR failed: ${err.message}`);
      return { result: null, source: null, ocrText: '', fields: null };
    }
  }

  // Process a single validation request
  async function processValidationRequest(request) {
    logger.logValidationRequest(request);
    deps.sendToRenderer('log', { message: `Motor de Validacion: procesando ${request.id.slice(0, 8)}...`, type: 'info' });
    deps.sendToRenderer('validating', { id: request.id });

    const startTime = Date.now();

    try {
      // Handle PDF conversion if needed
      let processedRequest = { ...request };

      if (request.mimeType === 'application/pdf') {
        deps.sendToRenderer('log', { message: 'Convirtiendo PDF a imagen...', type: 'info' });
        logger.info('PDF', 'Converting PDF to image for validation', { requestId: request.requestId });

        try {
          const imageBase64 = await deps.convertPdfToImage(request.imageBase64);
          processedRequest.imageBase64 = imageBase64;
          processedRequest.mimeType = 'image/png';
          deps.sendToRenderer('log', { message: 'PDF convertido exitosamente', type: 'success' });
        } catch (pdfError) {
          logger.error('PDF', 'PDF conversion failed', { error: pdfError.message });

          deps.emitValidationResult(request, {
            id: request.id,
            requestId: request.requestId,
            isValid: false,
            confidence: 0,
            extractedAmount: null, extractedDate: null, extractedTime: null,
            paymentMethod: null, transactionId: null, referenceNumber: null,
            senderName: null, senderDniCuit: null, recipientName: null,
            bankName: null, transactionStatus: null, authenticityChecks: null,
            reasoning: `PDF requiere revision manual: ${pdfError.message}`,
            flags: ['PDF_CONVERSION_FAILED', 'REQUIRES_MANUAL_REVIEW'],
          });

          deps.sendToRenderer('log', { message: 'PDF requiere revision manual', type: 'warning' });
          deps.sendToRenderer('validation-done', { id: request.id, error: 'PDF conversion failed' });
          return;
        }
      }

      // Check cache for duplicate images
      const cached = getCachedResult(processedRequest.imageBase64);
      if (cached) {
        metrics.cacheHits++;
        const cachedResult = { ...cached.result, flags: [...(cached.result.flags || []), 'CACHED_RESULT'] };
        cachedResult.reasoning = `[Deteccion Rapida] ${cachedResult.reasoning || ''}`;
        logger.info('CACHE', `Cache hit for request ${request.id}`);
        deps.sendToRenderer('log', { message: 'Deteccion Rapida: imagen ya validada previamente', type: 'info' });
        deps.emitValidationResult(request, { id: request.id, requestId: request.requestId, ...cachedResult });
        deps.sendToRenderer('validation-done', { id: request.id, result: cachedResult });
        return;
      }

      // Determine validation strategy based on wallet verification capability
      const walletHasVerification = processedRequest.expectedWallet?.requiresVerification === true;

      let result = null;
      let validationMethod = 'ollama';

      // OCR-first cascade: try the parser, if it has a definitive answer, use it.
      // Run authenticity in parallel ONLY when the wallet doesn't have a verification extension
      // (otherwise the inbound MP/Fiwind/etc verifier handles forensics for us).
      let ocrSource = null;
      let authenticityPromise = null;

      if (walletHasVerification) {
        deps.sendToRenderer('log', { message: 'Validacion Express: billetera con verificacion', type: 'info' });
        deps.sendToRenderer('validation-progress', { id: request.id, step: 'ocr', message: 'Lectura Inteligente: extrayendo datos...' });
        const ocr = await validateWithOCR(processedRequest);
        if (ocr.result) {
          result = ocr.result;
          ocrSource = ocr.source; // 'ocr_fast' or 'ocr_aggressive'
          validationMethod = ocrSource === 'ocr_aggressive' ? 'ocr+aggressive' : 'ocr';
          logger.success('OCR', `Cascade ${ocrSource}: ${result.isValid ? 'VALID' : 'INVALID'} (confidence: ${result.confidence.toFixed(2)})`);
        }
      } else {
        // Without an inbound verifier, also run Ollama's authenticity check in parallel.
        // We only consume it if OCR succeeded — if OCR fails we fall through to full Ollama anyway.
        deps.sendToRenderer('log', { message: 'Doble Verificacion: lectura + control de autenticidad', type: 'info' });
        deps.sendToRenderer('validation-progress', { id: request.id, step: 'ocr+auth', message: 'Doble Verificacion en proceso...' });

        const ollamaUp = !!deps.getOllamaAvailable && deps.getOllamaAvailable();
        const [ocr, authenticityResult] = await Promise.all([
          validateWithOCR(processedRequest),
          ollamaUp ? checkAuthenticity(processedRequest.imageBase64, deps.config) : Promise.resolve(null),
        ]);

        if (ocr.result) {
          result = ocr.result;
          ocrSource = ocr.source;
          validationMethod = ocrSource === 'ocr_aggressive' ? 'ocr+aggressive' : 'ocr+authenticity';
          if (authenticityResult) {
            result.authenticityChecks = {
              has_proper_formatting: authenticityResult.isAuthentic,
              has_consistent_fonts: authenticityResult.isAuthentic,
              has_bank_logo: null,
              has_transaction_id: !!result.transactionId,
              screenshot_quality: authenticityResult.editingSigns === 'none' ? 'good' : 'suspicious',
              editing_signs: authenticityResult.editingSigns,
            };
            if (!authenticityResult.isAuthentic) {
              result.isValid = false;
              result.flags = result.flags || [];
              if (authenticityResult.editingSigns === 'likely') result.flags.push('EDITED_IMAGE');
              else result.flags.push('SUSPICIOUS');
              result.reasoning = `Lectura Inteligente extrajo datos pero Control de Autenticidad detecta comprobante no autentico: ${authenticityResult.reasoning}`;
              metrics.authenticityRejections++;
            }
            metrics.authenticityCalls++;
            deps.sendToRenderer('log', {
              message: `Control de Autenticidad: ${authenticityResult.isAuthentic ? 'OK' : 'SOSPECHOSO'} (${(authenticityResult.confidence * 100).toFixed(0)}%)`,
              type: authenticityResult.isAuthentic ? 'success' : 'warning',
            });
          } else if (ollamaUp) {
            result.flags = result.flags || [];
            result.flags.push('AUTHENTICITY_CHECK_UNAVAILABLE');
          }
        }
      }

      // Cascade fallback: only invoke Ollama if OCR could not produce a definitive answer.
      if (!result) {
        const ollamaUp = !!deps.getOllamaAvailable && deps.getOllamaAvailable();
        if (!ollamaUp) {
          // OCR insufficient AND Ollama down → operator review.
          deps.sendToRenderer('log', { message: 'OCR insuficiente y motor IA no disponible — requiere revision manual', type: 'warning' });
          result = {
            isValid: false, confidence: 0,
            extractedAmount: null, extractedDate: null, extractedTime: null,
            paymentMethod: null, transactionId: null, referenceNumber: null,
            senderName: null, senderDniCuit: null, recipientName: null,
            recipientAccount: null, recipientMatch: null, bankName: null,
            transactionStatus: null, authenticityChecks: null,
            reasoning: 'OCR no pudo extraer datos confiables y el motor de IA no esta disponible. Requiere revision manual.',
            flags: ['OCR_INSUFFICIENT', 'OLLAMA_UNAVAILABLE', 'REQUIRES_MANUAL_REVIEW'],
          };
          validationMethod = 'failed';
        } else {
          deps.sendToRenderer('log', { message: 'Lectura insuficiente, activando Verificacion IA completa...', type: 'info' });
          deps.sendToRenderer('validation-progress', { id: request.id, step: 'ollama', message: 'Verificacion IA en proceso...' });
          result = await validateWithOllama(processedRequest, deps.config);
          validationMethod = 'ollama';
        }
      }

      const duration = Date.now() - startTime;

      // Track metrics for both legacy consumers and the new daily stats panel.
      metrics.totalValidations++;
      maybeRollMetricsDay();
      if (ocrSource === 'ocr_fast') { metrics.ocrFastCount++; metrics.ocrFastPath++; metrics.totalOcrTimeMs += duration; }
      else if (ocrSource === 'ocr_aggressive') { metrics.ocrAggressiveCount++; metrics.totalOcrTimeMs += duration; }
      else if (validationMethod === 'ollama') { metrics.ollamaCount++; metrics.ollamaFull++; metrics.totalOllamaTimeMs += duration; }
      else if (validationMethod === 'failed') { metrics.failedCount++; }
      if (validationMethod === 'ocr+authenticity') metrics.ocrPlusAuthenticity++;
      if (result.isValid) metrics.approved++; else metrics.rejected++;
      emitStats();

      // Cache result for duplicate detection
      setCachedResult(processedRequest.imageBase64, result, validationMethod);

      deps.sendToRenderer('validation-progress', { id: request.id, step: 'done', message: 'Motor de Validacion: completado' });

      logger.logValidationResult(request.id, { ...result, durationMs: duration, validationMethod });

      deps.emitValidationResult(request, {
        id: request.id,
        requestId: request.requestId,
        ...result,
      });

      const statusText = result.isValid ? 'APROBADO' : 'RECHAZADO';
      const logType = result.isValid ? 'success' : 'warning';
      const methodLabels = { ocr: ' (Lectura Inteligente)', ollama: ' (Verificacion IA)', 'ocr+authenticity': ' (Doble Verificacion)' };
      const methodLabel = methodLabels[validationMethod] || '';
      deps.sendToRenderer('log', { message: `Resultado: ${statusText}${methodLabel} (${(duration / 1000).toFixed(1)}s)`, type: logType });
      deps.sendToRenderer('validation-done', { id: request.id, result });
    } catch (error) {
      metrics.errors++;
      const duration = Date.now() - startTime;
      logger.logValidationError(request.id, { error: error.message, durationMs: duration });

      deps.emitValidationResult(request, {
        id: request.id,
        requestId: request.requestId,
        isValid: false,
        confidence: 0,
        extractedAmount: null, extractedDate: null, extractedTime: null,
        paymentMethod: null, transactionId: null, referenceNumber: null,
        senderName: null, senderDniCuit: null, recipientName: null,
        bankName: null, transactionStatus: null, authenticityChecks: null,
        reasoning: `Error: ${error.message}`,
        flags: ['VALIDATION_ERROR'],
      });

      deps.sendToRenderer('log', { message: `Error: ${error.message}`, type: 'error' });
      deps.sendToRenderer('validation-done', { id: request.id, error: error.message });
    }
  }

  return {
    processValidationRequest,
    validateWithOCR,
    initOCRWorker,
    parseOCRText,
    getMetrics,
  };
}

module.exports = { createPipeline };
