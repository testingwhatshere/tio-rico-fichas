import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { RequestsService } from '../requests/requests.service';
import { UploadsService } from '../uploads/uploads.service';
import { SettingsService } from '../settings/settings.service';
import { ProofValidationService } from './proof-validation.service';
import { ValidationResultDto } from './dto';
import {
  VALIDATION_TIMEOUT_BUFFER_MS,
  VALIDATOR_RECONNECT_WAIT_MS,
} from '../common/constants/timeouts';
import {
  AppEvent,
  ValidationCompletedEvent,
  PaymentProofUploadedEvent,
} from '../common/events/app-events';
import { PushService } from '../notifications/push.service';
import { toDeliverableProofUrlOrNull } from '../common/utils/proof-url';
import { attachProofTwins } from '../common/utils/proof-twins';

/** Billetera nuestra, con lo mínimo para comparar contra un comprobante. */
interface WalletTarget {
  id: string;
  label: string;
  holderName: string;
  holderLegalName: string | null;
  holderDni: string | null;
  alias?: string;
  cbu?: string;
  cvu?: string;
}

/**
 * Un request que sigue en VALIDATING pasado este tiempo desde que subió el
 * comprobante, y que no tiene una validación en curso en este proceso, quedó
 * huérfano (típicamente: el backend se reinició o se deployó en el medio).
 * Una validación normal tarda como mucho ~3 min (60 s esperando validador +
 * timeout + margen), así que 4 min deja margen.
 */
const STUCK_VALIDATION_AFTER_MS = 4 * 60 * 1000;
/** Cuántas veces el barrido relanza la validación de un mismo request. */
const STUCK_VALIDATION_MAX_RETRIES = 1;
/** Al arrancar, darle tiempo al validador a reconectarse antes del primer barrido. */
const STUCK_VALIDATION_BOOT_DELAY_MS = 90 * 1000;

@Injectable()
export class PaymentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentsService.name);
  /** requestIds con una validateProof corriendo en este proceso. */
  private readonly validationsInFlight = new Set<string>();
  private sweepRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => RequestsService))
    private readonly requestsService: RequestsService,
    private readonly uploadsService: UploadsService,
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
    private readonly proofValidationService: ProofValidationService,
    private readonly pushService: PushService,
  ) {}

  /**
   * Las otras cargas que comparten este comprobante, para que el aviso en vivo
   * de "no se valido" ya le diga al operador si es el mismo de antes. El
   * snapshot REST lo calcula igual; sin esto el dato aparecia recien al
   * refrescar.
   */
  private async proofTwinsOf(request: {
    id: string;
    userId: string;
    proofHash: string | null;
    extractedTransactionId: string | null;
  }) {
    try {
      const [withTwins] = await attachProofTwins(this.prisma, [request]);
      return withTwins.proofTwins;
    } catch (error: any) {
      // Un aviso sin el dato de repetido sigue sirviendo; romperlo por esto no.
      this.logger.warn(`No se pudieron resolver repetidos: ${error.message}`);
      return [];
    }
  }

  /**
   * Get validation threshold from settings (dynamic)
   */
  private async getValidationThreshold(): Promise<number> {
    const value = await this.settingsService.getSetting('VALIDATION_THRESHOLD');
    return parseFloat(value || '0.8');
  }

  /**
   * El monto leido, aparece de verdad en el texto del comprobante?
   *
   * Es la unica forma barata de distinguir "el usuario transfirio 53.000" de
   * "el OCR leyo mal 5.300". Se prueban las formas en que un comprobante
   * argentino escribe una cifra. Si no hay texto (validador viejo) no se puede
   * corroborar y devuelve null: ahi decide el ratio, como antes.
   */
  private amountAppearsInText(
    amount: number,
    ocrText?: string | null,
  ): boolean | null {
    if (!ocrText || ocrText.trim().length === 0) return null;

    const entero = Math.floor(amount);
    const plano = String(entero);
    const conPuntos = entero.toLocaleString('es-AR');
    // Sin separadores: asi el texto se compara igual venga "1.035" o "1 035".
    const normalizado = ocrText.replace(/[.\s,]/g, '');

    return (
      ocrText.includes(conPuntos) ||
      ocrText.includes(plano) ||
      normalizado.includes(plano)
    );
  }

  /** Tope por solicitud. Mismo default que `SettingsService.getSystemSettings`. */
  private async getMaxRequestAmount(): Promise<number> {
    const value = await this.settingsService.getSetting('MAX_REQUEST_AMOUNT');
    return parseInt(value || '50000', 10);
  }

  /**
   * Get validation date window in days from settings (dynamic)
   */
  private async getValidationDateWindowDays(): Promise<number> {
    const value = await this.settingsService.getSetting(
      'VALIDATION_DATE_WINDOW_DAYS',
    );
    return parseInt(value || '7', 10);
  }

  /**
   * Validate a payment proof for a request
   * This is called after proof is uploaded
   */
  async validateProof(requestId: string): Promise<ValidationResultDto> {
    this.validationsInFlight.add(requestId);
    try {
      return await this.runValidateProof(requestId);
    } finally {
      this.validationsInFlight.delete(requestId);
    }
  }

  private async runValidateProof(
    requestId: string,
  ): Promise<ValidationResultDto> {
    // Align with gateway timeout setting + 5s buffer so the gateway timeout fires first
    const gatewayTimeoutMs = parseInt(
      (await this.settingsService.getSetting('VALIDATION_TIMEOUT_MS')) ||
        '60000',
      10,
    );
    const VALIDATION_TIMEOUT_MS =
      gatewayTimeoutMs + VALIDATION_TIMEOUT_BUFFER_MS;

    this.logger.log(`Validating proof for request ${requestId}`);

    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
    });

    // Fix 17: If no request or no proof, update status instead of silently returning
    if (!request || !request.proofUrl) {
      if (request) {
        await this.requestsService.setValidationResult(requestId, {
          valid: false,
          score: 0,
          error: 'No se encontró comprobante adjunto',
        });
      }
      return {
        valid: false,
        score: 0,
        error: 'No proof found',
      };
    }

    // Emit validation started event
    this.eventsGateway.emitValidationStarted(request.userId, {
      requestId,
      status: 'VALIDATING',
    });

    // Si el validador se esta reconectando (deploy, corte corto), esperarlo
    // antes de largar el reloj de la validacion. Sin validador al final, sigue
    // el camino de siempre: revision manual.
    await this.proofValidationService.waitForValidator(
      VALIDATOR_RECONNECT_WAIT_MS,
    );

    // Fix 17 + Fix 24: Wrap core validation with a timeout and cancellation flag
    let cancelled = false;
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancelled = true;
        reject(
          new Error(
            `Validation timed out after ${Math.round(VALIDATION_TIMEOUT_MS / 1000)} seconds`,
          ),
        );
      }, VALIDATION_TIMEOUT_MS);
    });

    try {
      return await Promise.race([
        this.performValidationFlow(request, requestId, () => cancelled),
        timeoutPromise,
      ]);
    } catch (error: any) {
      return this.failValidation(request, requestId, error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Camino de falla de una validación: avisa al jugador y al operador y deja el
   * request en VALIDATION_FAILED (revisión manual).
   */
  private async failValidation(
    request: {
      id: string;
      userId: string;
      proofHash: string | null;
      extractedTransactionId: string | null;
      targetUsername: string | null;
      amount: any;
      proofUrl: string | null;
    },
    requestId: string,
    error: { message?: string },
  ): Promise<ValidationResultDto> {
    this.logger.error(
      `Validation error for request ${requestId}: ${error.message}`,
    );

    // Detect validator unavailability for clearer error messages
    const isValidatorUnavailable =
      error.message?.includes('No validator connected') ||
      error.message?.includes('Validator disconnected') ||
      error.message?.includes('timed out');

    const userFacingError = isValidatorUnavailable
      ? 'El servicio de validación no está disponible. Un operador revisará tu comprobante manualmente.'
      : `Error de validación: ${error.message}`;

    // Emit validation failed event
    this.eventsGateway.emitValidationFailed(request.userId, {
      id: requestId,
      requestId,
      status: 'VALIDATION_FAILED',
      proofTwins: await this.proofTwinsOf(request),
      error: userFacingError,
      validationError: userFacingError,
      validatorUnavailable: isValidatorUnavailable,
      targetUsername: request.targetUsername,
      amount: request.amount?.toString(),
      proofUrl: toDeliverableProofUrlOrNull(request.proofUrl),
    });

    // Push notification — even if validator was unavailable, the user should know.
    this.pushService
      .sendToUser(
        request.userId,
        'Comprobante en revisión',
        isValidatorUnavailable
          ? 'El servicio automático no está disponible. Un operador lo revisará en breve.'
          : 'No pudimos validar tu comprobante automáticamente. Un operador lo revisará.',
        { requestId, type: 'validation_error' },
      )
      .catch((err: any) =>
        this.logger.warn(`Push (validation_error) failed: ${err.message}`),
      );

    await this.requestsService.setValidationResult(requestId, {
      valid: false,
      score: 0,
      error: userFacingError,
    });

    return {
      valid: false,
      score: 0,
      error: error.message,
    };
  }

  // ==========================================
  // VALIDACIONES HUÉRFANAS
  // ==========================================

  onApplicationBootstrap() {
    // Lo que quedó en VALIDATING cuando el proceso anterior se apagó no tiene a
    // nadie esperándolo. Se barre un rato después de arrancar, cuando el
    // validador ya tuvo tiempo de reconectarse.
    setTimeout(() => {
      this.sweepStuckValidations().catch((err: Error) =>
        this.logger.error(
          `Barrido inicial de validaciones fallo: ${err.message}`,
        ),
      );
    }, STUCK_VALIDATION_BOOT_DELAY_MS).unref();

    void this.ensureSenderDniCuitIndex();
  }

  /**
   * Índice para el chequeo "mismo DNI/CUIT en otro usuario" (Change 5), que filtra
   * por "validationDetails"->>'senderDniCuit': sin índice recorría toda la tabla
   * (~400 ms por comprobante). Prisma no puede declarar índices sobre JSON, y
   * `prisma db push` (corre en cada deploy) los deja en paz, así que se crea acá.
   * CONCURRENTLY: no frena las escrituras. Si ya existe, no hace nada.
   */
  private async ensureSenderDniCuitIndex() {
    try {
      const existe = await this.prisma.$queryRaw<{ n: number }[]>`
        SELECT 1 AS n FROM pg_indexes WHERE indexname = 'Request_senderDniCuit_expr_idx'
      `;
      if (existe.length > 0) return;
      // Por el pooler en modo transacción CONCURRENTLY puede fallar: en ese caso
      // queda el aviso y se crea a mano por la DIRECT_URL (modo sesión).
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Request_senderDniCuit_expr_idx" ON "Request" (("validationDetails"->>'senderDniCuit'))`,
      );
    } catch (err: any) {
      this.logger.warn(
        `No se pudo asegurar el índice de senderDniCuit: ${err?.message || err?.code || JSON.stringify(err?.meta ?? err)}`,
      );
    }
  }

  /**
   * Requests en VALIDATING sin ninguna validación en curso: se les relanza la
   * validación una vez. Si vuelve a quedar huérfano, va a revisión manual por el
   * camino de siempre. Excluye la pregunta de "transferiste de más", que espera
   * al jugador a propósito en VALIDATING.
   */
  @Cron('*/2 * * * *')
  async sweepStuckValidations(): Promise<void> {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      const cutoff = new Date(Date.now() - STUCK_VALIDATION_AFTER_MS);
      const candidates = await this.prisma.request.findMany({
        where: {
          status: 'VALIDATING',
          proofUrl: { not: null },
          proofUploadedAt: { lt: cutoff },
        },
        select: {
          id: true,
          userId: true,
          proofHash: true,
          extractedTransactionId: true,
          targetUsername: true,
          amount: true,
          proofUrl: true,
          validationDetails: true,
        },
        orderBy: { proofUploadedAt: 'asc' },
        take: 20,
      });

      for (const c of candidates) {
        if (this.validationsInFlight.has(c.id)) continue;
        const details =
          (c.validationDetails as {
            overpaidOffer?: { status?: string };
            stuckValidationRetries?: number;
          } | null) ?? {};
        if (details.overpaidOffer?.status === 'PENDING') continue;

        const retries = Number(details.stuckValidationRetries) || 0;
        if (retries >= STUCK_VALIDATION_MAX_RETRIES) {
          this.logger.warn(
            `Request ${c.id} sigue en VALIDATING tras ${retries} relanzamiento(s): va a revisión manual`,
          );
          this.validationsInFlight.add(c.id);
          this.failValidation(c, c.id, {
            message: 'Validation timed out (sin respuesta del validador)',
          })
            .catch((err: Error) =>
              this.logger.error(`No se pudo cerrar ${c.id}: ${err.message}`),
            )
            .finally(() => this.validationsInFlight.delete(c.id));
          continue;
        }

        // Se marca el intento antes de relanzar, condicionado a que siga en
        // VALIDATING: si justo terminó por otro lado, no se toca.
        const { count } = await this.prisma.request.updateMany({
          where: { id: c.id, status: 'VALIDATING' },
          data: {
            validationDetails: {
              ...details,
              stuckValidationRetries: retries + 1,
              stuckValidationRetriedAt: new Date().toISOString(),
            },
          },
        });
        if (count === 0) continue;

        this.logger.warn(
          `Request ${c.id} quedó en VALIDATING sin validación en curso: se relanza (intento ${retries + 1})`,
        );
        // validateProof registra el request en validationsInFlight al entrar,
        // así el próximo barrido no lo vuelve a tomar.
        this.validateProof(c.id).catch((err: Error) =>
          this.logger.error(`Relanzamiento de ${c.id} fallo: ${err.message}`),
        );
      }
    } catch (error) {
      this.logger.error(
        `Barrido de validaciones huérfanas fallo: ${(error as Error).message}`,
      );
    } finally {
      this.sweepRunning = false;
    }
  }

  /**
   * Core validation flow extracted for timeout wrapping (Fix 17)
   */
  private async performValidationFlow(
    request: any,
    requestId: string,
    isCancelled: () => boolean = () => false,
  ): Promise<ValidationResultDto> {
    // Note: Duplicate detection is already performed in requests.service.ts at upload time
    // No need to check again here to avoid redundant database queries

    // Step 1: Perform AI/OCR validation
    const validationResult = await this.performValidation(request);

    // Fix 24: Check cancellation before updating status
    if (isCancelled()) {
      this.logger.warn(
        `Validation for ${requestId} completed after timeout, discarding result`,
      );
      return validationResult;
    }

    // Step 2: Update request with validation result
    const updatedRequest = await this.requestsService.setValidationResult(
      requestId,
      validationResult,
    );

    // Step 3: Emit validation result event
    if (validationResult.valid) {
      // La verificación de acreditación estilo MP no existe más: no hay extensión que la
      // alimente y la tabla MpVerification nunca registró una sola fila. Un comprobante
      // validado va derecho a APPROVED y de ahí al job. Nada puede volver a mandar un
      // request a PENDING_MP_VERIFICATION.
      this.eventsGateway.emitValidationCompleted(request.userId, {
        requestId,
        status: 'APPROVED',
        score: validationResult.score,
      });

      if (isCancelled()) {
        this.logger.warn(
          `Validation for ${requestId} completed after timeout, discarding`,
        );
        return validationResult;
      }

      this.logger.log(
        `Proof validated for request ${requestId}, emitting VALIDATION_COMPLETED event`,
      );
      this.eventEmitter.emit(AppEvent.VALIDATION_COMPLETED, {
        requestId,
        score: validationResult.score,
      });
    } else if (
      (updatedRequest as { status?: string } | undefined)?.status ===
      'VALIDATING'
    ) {
      // Transfirio de mas y se le pregunto al jugador: todavia no hay nada
      // que avisarle al operador. Si rechaza o no contesta, lo avisa
      // RequestsService con notifyValidationFailed.
      this.logger.log(
        `Request ${requestId}: transfirio de mas, esperando que el jugador decida`,
      );
    } else {
      await this.notifyValidationFailed(request, validationResult);
    }

    return validationResult;
  }

  /**
   * Avisa que un comprobante no paso la validacion automatica: al jugador
   * ("un operador lo revisa"), al panel de operadores (Bandeja) y por push.
   */
  async notifyValidationFailed(
    request: {
      id: string;
      userId: string;
      targetUsername: string | null;
      amount: unknown;
      proofUrl: string | null;
      proofHash: string | null;
      extractedTransactionId: string | null;
    },
    validationResult: ValidationResultDto,
  ) {
    this.eventsGateway.emitValidationFailed(request.userId, {
      id: request.id,
      requestId: request.id,
      status: 'VALIDATION_FAILED',
      proofTwins: await this.proofTwinsOf(request),
      error: validationResult.error,
      validationError: validationResult.error,
      targetUsername: request.targetUsername,
      amount: request.amount?.toString(),
      proofUrl: toDeliverableProofUrlOrNull(request.proofUrl),
      validationScore: validationResult.score,
      // Lo que el OCR leyo del comprobante. Sin esto el panel no puede ofrecer
      // "aceptar y cargar lo que transfirio": leia un campo que nunca llegaba y
      // el monto a mano quedaba topeado en lo pedido (caso real: pidio 3000,
      // transfirio 3300, no habia forma de acreditarselo).
      extractedAmount: validationResult.details?.extractedAmount ?? null,
      fraudFlags: validationResult.details?.fraudFlags ?? [],
      recipientVerifiedBy:
        validationResult.details?.recipientVerifiedBy ?? null,
    });
    // Push notification — covers the case where the automated validator rejects
    // the proof and the user is on home/closed-app and wouldn't see chat msgs.
    this.pushService
      .sendToUser(
        request.userId,
        'Comprobante en revisión',
        'No pudimos validar tu comprobante automáticamente. Un operador lo está revisando.',
        { requestId: request.id, type: 'validation_failed' },
      )
      .catch((err: any) =>
        this.logger.warn(`Push (validation_failed) failed: ${err.message}`),
      );
  }

  /**
   * Perform the actual validation using Ollama Vision AI
   */
  private async performValidation(request: any): Promise<ValidationResultDto> {
    const proofUrl = request.proofUrl;

    if (!proofUrl) {
      return {
        valid: false,
        score: 0,
        error: 'No se encontro archivo de comprobante',
      };
    }

    try {
      // Determine MIME type from URL extension or Cloudinary resource type
      let mimeType = 'image/jpeg'; // default
      if (proofUrl.endsWith('.pdf') || proofUrl.includes('/raw/upload/'))
        mimeType = 'application/pdf';
      else if (proofUrl.endsWith('.png')) mimeType = 'image/png';
      else if (proofUrl.endsWith('.webp')) mimeType = 'image/webp';
      else if (proofUrl.endsWith('.heic')) mimeType = 'image/heic';

      // Fetch wallet info for cross-referencing in validation
      const wallet = request.walletId
        ? await this.prisma.paymentConfig.findUnique({
            where: { id: request.walletId },
          })
        : await this.prisma.paymentConfig.findFirst({
            where: { isActive: true, isSelected: true },
          });

      const walletInfo = wallet
        ? {
            holderName: wallet.holderName,
            holderLegalName: wallet.holderLegalName,
            holderDni: wallet.holderDni,
            type: wallet.type,
            alias: (wallet.details as any)?.alias,
            cbu: (wallet.details as any)?.cbu,
            cvu: (wallet.details as any)?.cvu,
            bank: (wallet.details as any)?.bank,
            // Siempre false: el validador usaba esto para SALTEAR el control de
            // autenticidad ("Validacion Express"), asumiendo que una extensión de
            // verificación cubría la forense. Esa extensión no existe, así que nunca
            // hay que saltear nada. No se lee de la DB para que una fila vieja con
            // requiresVerification=true no debilite la validación.
            requiresVerification: false,
          }
        : null;

      // Todas nuestras billeteras activas. El comprobante tiene que apuntar a alguna de
      // ellas, no necesariamente a la que se le mostró al usuario: la billetera rota
      // (isSelected / amountLimit) mientras el usuario está pagando, y un pago a otra
      // cuenta nuestra es igual de válido.
      const ourWallets = await this.getActiveWalletTargets();

      // Normalize the URL so PDFs land at /image/upload/f_jpg,pg_1/ — Cloudinary's
      // "Restricted media types" setting blocks raw PDF delivery (401), but transformation
      // results are always served. No-op for image URLs.
      const deliverableUrl = this.uploadsService.toDeliverableUrl(
        proofUrl,
        mimeType,
      );

      // After transformation, PDFs are delivered as JPEG (Cloudinary f_jpg,pg_1 conversion).
      // Update mimeType so validator-app doesn't try to parse a JPG as a PDF.
      const isPdf =
        mimeType === 'application/pdf' ||
        proofUrl.toLowerCase().endsWith('.pdf') ||
        proofUrl.includes('/raw/upload/');
      const validationMimeType =
        isPdf && deliverableUrl.includes('/f_jpg,pg_1/')
          ? 'image/jpeg'
          : mimeType;

      // Send Cloudinary URL directly to validator — validator fetches the image itself
      // No more downloading file buffer on the backend
      const result = await this.proofValidationService.validateProof(
        deliverableUrl,
        validationMimeType,
        Number(request.amount),
        request.id,
        walletInfo,
      );

      this.logger.log(
        `Validation result for request ${request.id}: valid=${result.isValid}, confidence=${result.confidence}`,
      );

      // Get validation settings dynamically from database
      const validationThreshold = await this.getValidationThreshold();
      const dateWindowDays = await this.getValidationDateWindowDays();

      // Additional validation: check if date is too old
      const flags = [...(result.flags || [])];
      let dateValid = true;

      // El monto contra lo pedido lo compara el backend (más abajo: de menos →
      // AMOUNT_MISMATCH, de más → AMOUNT_OVERPAID, los dos bloqueantes). Si lo
      // ÚNICO que objeta el validador es el monto, su "inválido" se reemplaza por
      // esa comparación:
      //  - con cache, el validador repite el veredicto de OTRA carga (2026-10-08,
      //    nieva3: pidió $15.000 con un comprobante de $10.000, rechazo correcto;
      //    volvió a pedir $10.000 con el mismo comprobante y el cache repitió "monto
      //    no coincide");
      //  - sin cache, es lo que permite preguntarle al jugador si carga el monto del
      //    comprobante (2026-10-14). Antes, el "inválido" del validador dejaba esa
      //    pregunta imposible: nunca se llegó a hacer.
      // La carga sigue frenada por el flag del backend; esto no aprueba nada solo.
      // Ante cualquier otro flag del validador que no sea inofensivo, sigue rechazado.
      if (flags.includes('AMOUNT_MISMATCH')) {
        const HARMLESS = [
          'CACHED_RESULT',
          'AMOUNT_MISMATCH',
          'OCR_FAST_PATH',
          'OCR_AGGRESSIVE',
          'NO_TRANSACTION_ID',
          'MISSING_SENDER_INFO',
          'NO_DATE',
          'AUTHENTICITY_CHECK_UNAVAILABLE',
        ];
        const soloMontoViejo = flags.every((f) => HARMLESS.includes(f));
        flags.splice(flags.indexOf('AMOUNT_MISMATCH'), 1);
        if (!result.isValid && soloMontoViejo) {
          this.logger.log(
            `Request ${request.id}: el validador sólo objeta el monto; ` +
              `se compara contra $${request.amount}`,
          );
          result.isValid = true;
        }
      }

      if (result.extractedDate) {
        const proofDate = new Date(result.extractedDate);
        const now = new Date();
        const daysDiff = Math.floor(
          (now.getTime() - proofDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysDiff > dateWindowDays) {
          this.logger.warn(
            `Proof date is ${daysDiff} days old for request ${request.id} (max: ${dateWindowDays})`,
          );
          flags.push('OLD_DATE');
          dateValid = false;
        } else if (daysDiff < 0) {
          // Future date - suspicious
          this.logger.warn(`Proof has future date for request ${request.id}`);
          flags.push('FUTURE_DATE', 'SUSPICIOUS');
          dateValid = false;
        }
      }

      // === FRAUD DETECTION ===

      // Change 4: Transaction ID duplicate detection
      if (result.transactionId) {
        try {
          const txDup = await this.prisma.request.findFirst({
            where: {
              extractedTransactionId: result.transactionId,
              id: { not: request.id },
            },
            select: { id: true, userId: true, status: true },
          });
          if (txDup) {
            flags.push('DUPLICATE_TRANSACTION_ID');
            this.logger.warn(
              `Duplicate transaction ID detected for request ${request.id}: matches request ${txDup.id}`,
            );
            if (txDup.userId !== request.userId) {
              flags.push('CROSS_USER_DUPLICATE');
              this.logger.warn(
                `Cross-user duplicate: request ${request.id} (user ${request.userId}) matches request ${txDup.id} (user ${txDup.userId})`,
              );
            }
          }
        } catch (error: any) {
          this.logger.error(
            `Transaction ID dedup check failed: ${error.message}`,
          );
          flags.push('FRAUD_CHECK_ERROR');
        }
      }

      // Change 5: Sender identity cross-user flagging
      if (result.senderDniCuit) {
        try {
          const crossUser: any[] = await this.prisma.$queryRaw`
            SELECT id, "userId" FROM "Request"
            WHERE "userId" != ${request.userId}
              AND "validationDetails"->>'senderDniCuit' = ${result.senderDniCuit}
              AND status NOT IN ('CANCELLED', 'REJECTED', 'FAILED')
            LIMIT 1
          `;
          if (crossUser?.length > 0) {
            flags.push('CROSS_USER_SENDER');
            this.logger.warn(
              `Cross-user sender detected for request ${request.id}: DNI/CUIT ${result.senderDniCuit} used by user ${crossUser[0].userId}`,
            );
          }
        } catch (error: any) {
          this.logger.error(`Cross-user sender check failed: ${error.message}`);
          flags.push('FRAUD_CHECK_ERROR');
        }
      }

      // Change 6a: Failed validation count (per-user fraud heuristic)
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const failedCount = await this.prisma.request.count({
          where: {
            userId: request.userId,
            status: 'VALIDATION_FAILED',
            createdAt: { gte: thirtyDaysAgo },
          },
        });
        if (failedCount >= 10) {
          flags.push('VERY_HIGH_FAILURE_RATE');
          this.logger.warn(
            `Very high failure rate for user ${request.userId}: ${failedCount} failures in 30 days`,
          );
        } else if (failedCount >= 5) {
          flags.push('HIGH_FAILURE_RATE');
          this.logger.warn(
            `High failure rate for user ${request.userId}: ${failedCount} failures in 30 days`,
          );
        }
      } catch (error: any) {
        this.logger.error(`Failure rate check failed: ${error.message}`);
        flags.push('FRAUD_CHECK_ERROR');
      }

      // Change 6b: Multiple sender detection
      if (result.senderName) {
        try {
          const recentRequests: any[] = await this.prisma.$queryRaw`
            SELECT DISTINCT "validationDetails"->>'senderName' as sender_name
            FROM "Request"
            WHERE "userId" = ${request.userId}
              AND "validationDetails"->>'senderName' IS NOT NULL
              AND "validationDetails"->>'senderName' != ''
              AND status IN ('APPROVED', 'PROCESSING', 'COMPLETED', 'VALIDATION_FAILED')
            ORDER BY sender_name
            LIMIT 20
          `;
          const distinctSenders = new Set(
            recentRequests
              .map((r) => r.sender_name?.toLowerCase().trim())
              .filter(Boolean),
          );
          // Add current sender
          distinctSenders.add(result.senderName.toLowerCase().trim());
          if (distinctSenders.size >= 3) {
            flags.push('MULTIPLE_SENDERS');
            this.logger.warn(
              `Multiple senders detected for user ${request.userId}: ${distinctSenders.size} distinct senders`,
            );
          }
        } catch (error: any) {
          this.logger.error(`Multiple sender check failed: ${error.message}`);
          flags.push('FRAUD_CHECK_ERROR');
        }
      }

      // Change 6c: Authenticity flag promotion
      if (result.authenticityChecks) {
        const ac = result.authenticityChecks;
        if (ac.editing_signs === 'likely' && !flags.includes('LIKELY_EDITED')) {
          flags.push('LIKELY_EDITED');
        }
        if (
          ac.has_proper_formatting === false &&
          ac.has_bank_logo === false &&
          !flags.includes('INVALID_FORMAT')
        ) {
          flags.push('INVALID_FORMAT');
        }
      }
      if (result.transactionStatus) {
        const approvedVariants = [
          'aprobada',
          'aprobado',
          'approved',
          'exitosa',
          'exitoso',
          'completada',
          'completado',
          'acreditada',
          'acreditado',
        ];
        const isStatusApproved = approvedVariants.some((v) =>
          result.transactionStatus!.toLowerCase().includes(v),
        );
        if (!isStatusApproved && !flags.includes('STATUS_NOT_APPROVED')) {
          flags.push('STATUS_NOT_APPROVED');
        }
      }

      // Verificación de destinatario: probar que la plata fue a una cuenta NUESTRA.
      // Es bloqueante (los tres flags están en criticalFlags), así que lo que no se
      // puede probar cae a revisión del operador en vez de acreditarse solo.
      const recipientCheck = this.verifyRecipient(
        result.recipientName ?? null,
        result.recipientAccount ?? null,
        result.ocrText ?? null,
        ourWallets,
        request.id,
      );
      if (recipientCheck.flag && !flags.includes(recipientCheck.flag)) {
        flags.push(recipientCheck.flag);
      }

      // Comparacion de montos: pagar de menos y pagar de mas NO son lo mismo.
      //
      // Antes la comparacion era simetrica y cualquier diferencia frenaba la
      // carga. Eso rechazaba al que transfiere de mas, que es un caso comun y
      // sin ningun riesgo: la plata ya entro. En 60 dias fueron 13 casos; 9 se
      // perdieron (el usuario pago y quedo cancelado) y los otros 4 los aprobo
      // un operador a mano con el monto real. Esto automatiza lo que el
      // operador ya hacia.
      //
      // Pagar de MENOS sigue bloqueando: ahi falta plata de verdad.
      if (result.extractedAmount && Number(request.amount) > 0) {
        const extracted = Number(result.extractedAmount);
        const requested = Number(request.amount);
        const maxAmount = await this.getMaxRequestAmount();

        if (extracted > 0 && requested - extracted > 1) {
          this.logger.warn(
            `Transfirio de menos en ${request.id}: comprobante=${extracted}, pidio=${requested}`,
          );
          flags.push('AMOUNT_MISMATCH');
        } else if (extracted > 0 && extracted - requested > 1) {
          // Transfirio de mas: NO se acredita solo. Va a la Bandeja con un boton
          // para que un operador lo acepte con un toque.
          //
          // Se probo automatizarlo y se dio marcha atras: acreditar de mas sin
          // que nadie mire es acreditar plata que quiza nadie transfirio si el
          // OCR leyo mal. Es una decision del dueño, no una limitacion tecnica.
          this.logger.log(
            `Transfirio de mas en ${request.id}: comprobante=${extracted}, pidio=${requested}. ` +
              `Va a revision para que un operador lo acepte.`,
          );
          flags.push('AMOUNT_OVERPAID');

          // El monto leido no aparece en el texto: es la señal de que el OCR
          // pudo haber leido mal. El operador tiene que verlo antes de aceptar.
          if (this.amountAppearsInText(extracted, result.ocrText) === false) {
            flags.push('AMOUNT_TEXT_UNCONFIRMED');
          }
          if (extracted > maxAmount) {
            flags.push('AMOUNT_OVER_LIMIT');
          }
        }
      } else if (Number(request.amount) > 0) {
        // Sin monto leído no hay NADA que comparar: el chequeo de arriba simplemente no
        // corre, así que el comprobante podría acreditarse solo sin que nadie verifique
        // cuánto se pagó. Es raro (1 de 1184 en los últimos 30 días) pero es plata, y
        // el resto de los campos alcanza para superar el umbral por sí solo.
        this.logger.warn(
          `No se pudo leer el monto del comprobante del request ${request.id} ` +
            `(esperado $${request.amount}): va a revisión manual`,
        );
        flags.push('AMOUNT_UNREADABLE');
      }

      // Change 7a: Critical flags override isValid
      // Nota: CROSS_USER_SENDER NO es critical — en AR es comun que un familiar (madre,
      // pareja, etc.) pague desde su cuenta por el usuario. Sigue como flag visible para
      // el operador en validationDetails, pero no bloquea automaticamente.
      const criticalFlags = [
        'DUPLICATE_TRANSACTION_ID',
        'CROSS_USER_DUPLICATE',
        'LIKELY_EDITED',
        'STATUS_NOT_APPROVED',
        'VERY_HIGH_FAILURE_RATE',
        'AMOUNT_MISMATCH',
        // Acreditar sin haber podido leer el monto es acreditar a ciegas.
        'AMOUNT_UNREADABLE',
        // Transferir de mas tampoco se acredita solo: lo acepta un operador.
        'AMOUNT_OVERPAID',
        // El validador no pudo decidir cuánto dice el comprobante: el primer dígito del
        // monto podía ser el símbolo de peso mal leído ($10.000 leído como $510.000) y
        // las distintas lecturas de la imagen no coincidieron. Acreditar sobre un monto
        // dudoso es como acreditar sin leerlo — es la variante del incidente del
        // 30/08/2026, donde dos comprobantes de $1.000 se leyeron como $51.000.
        'AMOUNT_AMBIGUOUS',
      ];
      // Los flags de destinatario bloquean SÓLO cuando el veredicto es confiable,
      // o sea cuando pudimos barrer el texto completo del comprobante. Con el
      // validador viejo (sin ocrText) quedan como aviso al operador: la extracción
      // del destinatario confunde remitente con destinatario y frenaría cargas
      // legítimas en masa.
      if (recipientCheck.blocking) {
        criticalFlags.push(
          'RECIPIENT_ACCOUNT_MISMATCH',
          'RECIPIENT_MISMATCH',
          'RECIPIENT_UNVERIFIABLE',
        );
      }
      const hasCriticalFlags = flags.some((f) => criticalFlags.includes(f));

      // Check against threshold
      const meetsThreshold = result.confidence >= validationThreshold;
      const isValid =
        result.isValid && meetsThreshold && dateValid && !hasCriticalFlags;

      // Lo único que frena la carga es que el monto del comprobante no es el
      // pedido. Si ese monto está bien leído, se le pregunta al jugador si carga
      // lo que transfirió en vez de mandarlo al operador (si su cliente sabe
      // mostrarlo: ver setValidationResult). "Bien leído" (regla del dueño):
      //  - aparece tal cual en el texto del comprobante, y
      //  - TODAS las lecturas de la imagen vieron ese mismo monto (amountConsensus,
      //    validador ≥ 1.1.2; sin ese dato, no se pregunta).
      // De menos: alcanza con eso — si el OCR leyó de menos, el jugador rechaza.
      // De más, además: sin pasarse del tope y hasta 3 veces lo pedido; un
      // comprobante trucho o mal leído no puede cargar de más solo porque el
      // jugador dijo que sí.
      // Cualquier otra cosa → operador, como siempre.
      const blockingFlags = flags.filter((f) => criticalFlags.includes(f));
      const extractedNum = Number(result.extractedAmount);
      const requestedNum = Number(request.amount);
      const consensus = (result as any).amountConsensus as
        { unanimous?: boolean } | undefined;
      const montoFirme =
        consensus?.unanimous === true &&
        this.amountAppearsInText(extractedNum, result.ocrText) === true;
      const soloMonto =
        !isValid &&
        result.isValid &&
        meetsThreshold &&
        dateValid &&
        blockingFlags.length === 1 &&
        montoFirme;
      const underpaidOfferable =
        soloMonto && blockingFlags[0] === 'AMOUNT_MISMATCH' && extractedNum > 0;
      const overpaidOfferable =
        soloMonto &&
        blockingFlags[0] === 'AMOUNT_OVERPAID' &&
        !flags.includes('AMOUNT_TEXT_UNCONFIRMED') &&
        !flags.includes('AMOUNT_OVER_LIMIT') &&
        requestedNum > 0 &&
        extractedNum <= requestedNum * 3;
      const amountOfferable = underpaidOfferable || overpaidOfferable;

      const reasoning = !isValid
        ? this.buildRejectionReason(
            result,
            flags,
            dateValid,
            validationThreshold,
            dateWindowDays,
            Number(request.amount),
          )
        : undefined;

      return {
        valid: isValid,
        score: result.confidence,
        error: reasoning,
        details: {
          extractedAmount: result.extractedAmount,
          extractedDate: result.extractedDate,
          extractedTime: result.extractedTime ?? null,
          paymentMethod: result.paymentMethod,
          confidence: result.confidence,
          flags,
          // Nombre histórico: vale para de más y de menos (ver amountOfferable).
          overpaidOfferable: amountOfferable,
          amountConsensus: consensus ?? null,
          reasoning: result.reasoning,
          transactionId: result.transactionId ?? null,
          referenceNumber: result.referenceNumber ?? null,
          senderName: result.senderName ?? null,
          senderDniCuit: result.senderDniCuit ?? null,
          recipientName: result.recipientName ?? null,
          recipientAccount: result.recipientAccount ?? null,
          recipientMatch: recipientCheck.flag === null,
          // Qué dato nuestro apareció en el comprobante y en qué billetera, para que
          // el operador vea por qué se dio por verificado (ej. "cbu:MP Lautaro Neyen").
          recipientVerifiedBy: recipientCheck.verifiedBy,
          bankName: result.bankName ?? null,
          transactionStatus: result.transactionStatus ?? null,
          authenticityChecks: result.authenticityChecks ?? null,
          fraudFlags: flags.filter((f) =>
            [
              'DUPLICATE_TRANSACTION_ID',
              'CROSS_USER_DUPLICATE',
              'CROSS_USER_SENDER',
              'HIGH_FAILURE_RATE',
              'VERY_HIGH_FAILURE_RATE',
              'MULTIPLE_SENDERS',
              'LIKELY_EDITED',
              'INVALID_FORMAT',
              'STATUS_NOT_APPROVED',
              'RECIPIENT_MISMATCH',
              'RECIPIENT_ACCOUNT_MISMATCH',
              'RECIPIENT_UNVERIFIABLE',
              'AMOUNT_MISMATCH',
              'AMOUNT_UNREADABLE',
              'AMOUNT_OVERPAID',
              'AMOUNT_TEXT_UNCONFIRMED',
              'AMOUNT_OVER_LIMIT',
            ].includes(f),
          ),
        },
      };
    } catch (error: any) {
      this.logger.error(`Validation error: ${error.message}`);
      return {
        valid: false,
        score: 0,
        error: `Error de validacion: ${error.message}`,
        details: {
          flags: ['VALIDATION_ERROR'],
        },
      };
    }
  }

  /**
   * Todas nuestras billeteras activas, con los datos que sirven para comparar contra
   * un comprobante. Un pago a cualquiera de ellas es v\u00e1lido, no s\u00f3lo a la que se le
   * mostr\u00f3 al usuario (la billetera rota mientras el usuario paga).
   */
  private async getActiveWalletTargets(): Promise<WalletTarget[]> {
    const wallets = await this.prisma.paymentConfig.findMany({
      where: { isActive: true },
      select: {
        id: true,
        label: true,
        holderName: true,
        holderLegalName: true,
        holderDni: true,
        details: true,
      },
    });
    return wallets.map((w) => {
      const details = (w.details ?? {}) as {
        alias?: string;
        cbu?: string;
        cvu?: string;
      };
      return {
        id: w.id,
        label: w.label,
        holderName: w.holderName,
        holderLegalName: w.holderLegalName,
        holderDni: w.holderDni,
        alias: details.alias,
        cbu: details.cbu,
        cvu: details.cvu,
      };
    });
  }

  /**
   * Decide si el comprobante prueba que el dinero lleg\u00f3 a una cuenta nuestra.
   * Devuelve el flag a levantar, o null si qued\u00f3 verificado.
   *
   * Criterio: **alcanza con que aparezca CUALQUIER dato nuestro** \u2014 el nombre del
   * titular, el nombre legal, el CBU, el CVU, el alias o el DNI de CUALQUIERA de
   * nuestras billeteras activas. No hace falta que sea la billetera que se le mostr\u00f3
   * al usuario (la billetera rota mientras el usuario paga) ni que el parser haya
   * acertado el campo "Para": se busca en TODO el texto del comprobante.
   *
   * `blocking` dice si el resultado es confiable como para frenar la carga.
   *
   * S\u00f3lo el barrido sobre el texto completo bloquea. El camino de campos parseados
   * NO bloquea, porque la extracci\u00f3n del destinatario no es confiable: en los
   * comprobantes de Mercado Pago con bloque "Origen y destino", el parser toma el
   * CVU del REMITENTE como cuenta destino y marca mismatch en cargas perfectamente
   * leg\u00edtimas (caso darian88, 2026-08-20). Ah\u00ed el flag queda como aviso para el
   * operador, igual que antes, y la carga sigue su curso.
   */
  private verifyRecipient(
    recipientName: string | null,
    recipientAccount: string | null,
    ocrText: string | null,
    ourWallets: WalletTarget[],
    requestId: string,
  ): { flag: string | null; verifiedBy: string | null; blocking: boolean } {
    // Sin billeteras con identificadores usables no hay contra qu\u00e9 comparar. Es una
    // mala configuraci\u00f3n, no un comprobante sospechoso: se avisa fuerte y se deja
    // pasar al circuito normal en vez de frenar todas las cargas.
    const usable = ourWallets.filter(
      (w) => this.walletIdentifiers(w).length > 0,
    );
    if (usable.length === 0) {
      this.logger.error(
        `No hay billeteras activas con identificadores (nombre/CBU/CVU/alias/DNI) para ` +
          `verificar el request ${requestId}. Revisar la configuraci\u00f3n de billeteras.`,
      );
      return { flag: null, verifiedBy: null, blocking: false };
    }

    // 1) Barrido sobre el comprobante completo: cualquier dato nuestro sirve.
    if (ocrText && ocrText.trim()) {
      const hit = this.findWalletInText(ocrText, usable);
      if (hit) {
        const verifiedBy = `${hit.field}:${hit.wallet.label}`;
        this.logger.log(
          `Request ${requestId}: destinatario verificado por ${hit.field} de la billetera "${hit.wallet.label}"`,
        );
        return { flag: null, verifiedBy, blocking: true };
      }
      this.logger.warn(
        `Request ${requestId}: no se encontr\u00f3 ning\u00fan dato nuestro en el comprobante ` +
          `(${usable.length} billeteras activas). recipientName="${recipientName ?? '-'}" ` +
          `recipientAccount="${recipientAccount ?? '-'}"`,
      );
      return {
        flag:
          recipientAccount || recipientName
            ? 'RECIPIENT_ACCOUNT_MISMATCH'
            : 'RECIPIENT_UNVERIFIABLE',
        verifiedBy: null,
        blocking: true,
      };
    }

    // 2) Sin texto crudo (validador viejo): chequeo sobre los campos parseados.
    // NUNCA bloquea \u2014 la extracci\u00f3n del destinatario confunde remitente con
    // destinatario en el formato "Origen y destino" de Mercado Pago. Sirve como
    // aviso para el operador, no como veredicto.
    if (recipientAccount) {
      const matched = usable.find((w) =>
        this.accountMatch(recipientAccount, w),
      );
      if (matched) {
        return {
          flag: null,
          verifiedBy: `cuenta:${matched.label}`,
          blocking: false,
        };
      }
      this.logger.warn(
        `Request ${requestId}: cuenta destino "${recipientAccount}" no coincide con ninguna de las ${usable.length} billeteras activas (aviso, sin texto OCR no bloquea)`,
      );
      return {
        flag: 'RECIPIENT_ACCOUNT_MISMATCH',
        verifiedBy: null,
        blocking: false,
      };
    }

    if (recipientName) {
      const matched = usable.find((w) =>
        this.fuzzyNameMatch(
          recipientName,
          w.holderName,
          w.holderLegalName || undefined,
        ),
      );
      if (matched) {
        return {
          flag: null,
          verifiedBy: `nombre:${matched.label}`,
          blocking: false,
        };
      }
      this.logger.warn(
        `Request ${requestId}: destinatario "${recipientName}" no coincide con ninguna de las ${usable.length} billeteras activas (aviso, sin texto OCR no bloquea)`,
      );
      return { flag: 'RECIPIENT_MISMATCH', verifiedBy: null, blocking: false };
    }

    this.logger.warn(
      `Request ${requestId}: el comprobante no expone ni nombre ni cuenta destino y no hay texto OCR (aviso, no bloquea)`,
    );
    return {
      flag: 'RECIPIENT_UNVERIFIABLE',
      verifiedBy: null,
      blocking: false,
    };
  }

  /**
   * Identificadores buscables de una billetera: n\u00fameros de cuenta (CBU/CVU/alias
   * num\u00e9rico), alias alfanum\u00e9rico, DNI/CUIT y nombres del titular.
   */
  private walletIdentifiers(
    wallet: WalletTarget,
  ): { field: string; value: string }[] {
    const out: { field: string; value: string }[] = [];
    const push = (field: string, value?: string | null) => {
      const v = (value ?? '').trim();
      if (v) out.push({ field, value: v });
    };
    push('cbu', wallet.cbu);
    push('cvu', wallet.cvu);
    push('alias', wallet.alias);
    push('dni', wallet.holderDni);
    push('holderName', wallet.holderName);
    push('holderLegalName', wallet.holderLegalName);
    return out;
  }

  /**
   * Busca cualquier identificador nuestro dentro del texto del comprobante.
   *
   * Los n\u00fameros se comparan sobre la secuencia de d\u00edgitos del texto (el OCR mete
   * espacios y puntos en los CBU); los nombres, sobre el texto normalizado, exigiendo
   * al menos nombre + apellido para no matchear por un "Maria" suelto.
   */
  private findWalletInText(
    ocrText: string,
    wallets: WalletTarget[],
  ): { wallet: WalletTarget; field: string } | null {
    const digitsOnly = ocrText.replace(/\D/g, '');
    const textNorm = ocrText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

    for (const wallet of wallets) {
      for (const { field, value } of this.walletIdentifiers(wallet)) {
        const numeric = value.replace(/\D/g, '');
        // Identificador num\u00e9rico (CBU, CVU, alias num\u00e9rico, DNI/CUIT): comparar
        // contra los d\u00edgitos del comprobante. M\u00ednimo 8 d\u00edgitos para que un n\u00famero
        // corto no matchee por casualidad.
        const compact = value.replace(/[\s.-]/g, '');
        if (numeric.length >= 8 && numeric.length === compact.length) {
          if (digitsOnly.includes(numeric)) return { wallet, field };
          continue;
        }
        const valueNorm = value
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!valueNorm) continue;
        if (field === 'alias') {
          // Alias tipo "tiorico.fichas": literal, sin fuzzy.
          if (valueNorm.length >= 4 && textNorm.includes(valueNorm)) {
            return { wallet, field };
          }
          continue;
        }
        // Nombres: el nombre completo tal cual, o nombre + apellido en cualquier
        // orden (los comprobantes invierten "Apellido, Nombre" seguido).
        if (textNorm.includes(valueNorm)) return { wallet, field };
        const tokens = valueNorm.split(' ').filter((t) => t.length >= 3);
        if (tokens.length >= 2) {
          const present = tokens.filter((t) =>
            new RegExp(
              `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            ).test(textNorm),
          );
          if (present.length >= 2) return { wallet, field };
        }
      }
    }
    return null;
  }

  /**
   * Fuzzy match extracted recipient name against expected wallet holder names
   */
  private fuzzyNameMatch(
    extracted: string,
    holderName: string,
    holderLegalName?: string,
  ): boolean {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const extractedNorm = normalize(extracted);

    // Fragmentos cortos son basura de OCR ("Zo", "Ea", "Cup\u00f3n"): no alcanzan para
    // afirmar un match. Se tratan como "no verificado", no como match.
    if (extractedNorm.length < 4) return false;

    const candidates = [holderName, holderLegalName]
      .filter(Boolean)
      .map((n) => normalize(n!));

    return candidates.some((candidate) => {
      if (extractedNorm === candidate) return true;
      if (
        extractedNorm.includes(candidate) ||
        candidate.includes(extractedNorm)
      )
        return true;
      const extractedTokens = extractedNorm.split(/\s+/);
      const candidateTokens = candidate.split(/\s+/);
      const matches = extractedTokens.filter((t) =>
        candidateTokens.includes(t),
      );
      // Dos tokens compartidos (nombre + apellido). La vieja regla de "un token
      // alcanza si el titular es una sola palabra" hac\u00eda pasar cualquier cosa.
      return matches.length >= 2;
    });
  }

  /**
   * Match extracted account (alias/CBU/CVU) against expected wallet details
   */
  private accountMatch(
    extractedAccount: string,
    walletInfo: { alias?: string; cbu?: string; cvu?: string },
  ): boolean {
    const norm = (s?: string) => s?.replace(/[\s.\-]/g, '').toLowerCase() || '';
    const extracted = norm(extractedAccount);
    // Antes esto devolv\u00eda true ("no puedo comparar, asumo que est\u00e1 bien"), que es
    // exactamente el default peligroso: sin dato no hay verificaci\u00f3n.
    if (!extracted) return false;
    return [walletInfo.alias, walletInfo.cbu, walletInfo.cvu]
      .filter(Boolean)
      .some((expected) => {
        const exp = norm(expected);
        if (!exp) return false;
        if (exp === extracted) return true;
        // Match parcial s\u00f3lo con suficiente material: un CBU recortado por el OCR
        // sigue identificando la cuenta, pero 4 d\u00edgitos matchean cualquier cosa.
        const overlap = Math.min(exp.length, extracted.length);
        if (overlap < 8) return false;
        return exp.includes(extracted) || extracted.includes(exp);
      });
  }

  /**
   * Build a user-friendly rejection reason
   */
  private buildRejectionReason(
    result: {
      isValid: boolean;
      reasoning: string;
      confidence: number;
      extractedAmount?: number | null;
    },
    flags: string[],
    dateValid: boolean,
    validationThreshold: number,
    dateWindowDays: number,
    /** Lo que el usuario habia pedido cargar, para poder contrastar montos. */
    requestedAmount?: number,
  ): string {
    const reasons: string[] = [];

    if (flags.includes('DUPLICATE_PROOF')) {
      reasons.push('El comprobante ya fue utilizado');
    }
    if (flags.includes('DUPLICATE_TRANSACTION_ID')) {
      reasons.push('El numero de operacion ya fue usado en otra solicitud');
    }
    if (flags.includes('CROSS_USER_DUPLICATE')) {
      reasons.push(
        'El comprobante corresponde a una transaccion de otro usuario',
      );
    }
    const money = (n: number) => `$${n.toLocaleString('es-AR')}`;
    const leido = result.extractedAmount ?? null;

    if (flags.includes('AMOUNT_MISMATCH')) {
      reasons.push(
        leido !== null && requestedAmount
          ? `El comprobante es por ${money(leido)} y pidio cargar ${money(requestedAmount)}`
          : 'El monto del comprobante no coincide con el solicitado',
      );
    }
    if (
      flags.includes('AMOUNT_OVERPAID') &&
      leido !== null &&
      requestedAmount
    ) {
      // El operador decide sin abrir nada: si esta bien, un toque y se carga
      // el monto transferido.
      reasons.push(
        `Transfirio ${money(leido)} y habia pedido ${money(requestedAmount)}`,
      );
    }
    if (flags.includes('AMOUNT_TEXT_UNCONFIRMED')) {
      reasons.push(
        'Ojo: ese monto no aparece en el texto del comprobante, puede estar mal leido',
      );
    }
    if (flags.includes('AMOUNT_UNREADABLE')) {
      reasons.push('No se pudo leer el monto del comprobante');
    }
    if (flags.includes('OLD_DATE')) {
      reasons.push(`El comprobante tiene mas de ${dateWindowDays} dias`);
    }
    if (flags.includes('FUTURE_DATE')) {
      reasons.push('La fecha del comprobante es invalida');
    }
    if (flags.includes('STATUS_NOT_APPROVED')) {
      reasons.push("El estado de la transaccion no es 'Aprobada'");
    }
    if (flags.includes('LIKELY_EDITED')) {
      reasons.push('El comprobante parece haber sido editado');
    }
    if (flags.includes('INVALID_FORMAT')) {
      reasons.push('El comprobante no tiene el formato esperado');
    }
    if (flags.includes('CROSS_USER_SENDER')) {
      reasons.push('El remitente del pago aparece asociado a otra cuenta');
    }
    if (
      flags.includes('VERY_HIGH_FAILURE_RATE') ||
      flags.includes('HIGH_FAILURE_RATE')
    ) {
      reasons.push('Se detectaron multiples intentos fallidos');
    }
    if (flags.includes('MULTIPLE_SENDERS')) {
      reasons.push('Se detectaron multiples remitentes diferentes');
    }
    if (flags.includes('INCONSISTENT_FORMATTING')) {
      reasons.push('El formato del comprobante presenta inconsistencias');
    }
    if (flags.includes('SUSPICIOUS')) {
      reasons.push('El comprobante parece sospechoso');
    }
    if (flags.includes('LOW_QUALITY')) {
      reasons.push('La imagen es de baja calidad');
    }
    // Copy deliberadamente neutro: no afirmamos que la plata no llegó, sólo que no
    // pudimos verificarlo automáticamente. El operador decide con el comprobante.
    if (
      flags.includes('RECIPIENT_MISMATCH') ||
      flags.includes('RECIPIENT_ACCOUNT_MISMATCH') ||
      flags.includes('RECIPIENT_UNVERIFIABLE')
    ) {
      reasons.push(
        'No pudimos verificar que el comprobante corresponda a una de nuestras cuentas',
      );
    }
    if (!result.isValid && reasons.length === 0) {
      reasons.push(result.reasoning || 'No se pudo validar el comprobante');
    }
    if (result.confidence < validationThreshold && reasons.length === 0) {
      reasons.push('Baja confianza en la validacion');
    }

    return reasons.length > 0
      ? reasons.join('. ')
      : 'Validacion fallida - requiere revision manual';
  }

  // ============================================
  // WALLET MANAGEMENT
  // ============================================

  /**
   * Get the currently selected wallet for clients
   * Returns the active, selected wallet to display to users
   */
  /**
   * Que billetera le toca a un panel.
   *
   * Un panel con billetera propia **nunca** cae a la compartida. Si la suya
   * quedo apagada, devolver la comun haria que el usuario pague a la caja
   * equivocada mientras las fichas se cargan en su panel: plata de un lado,
   * consumo del otro. Es preferible que la carga se frene y el operador lo vea.
   *
   * Los paneles sin billetera propia (y los usuarios sin panel) usan la
   * compartida, que es exactamente el comportamiento que existia antes de que
   * las billeteras tuvieran panel.
   */
  private async resolveWalletFor(panelId?: string | null) {
    if (panelId) {
      const own = await this.prisma.paymentConfig.findFirst({
        where: { panelId, isActive: true, isSelected: true },
      });
      if (own) return own;

      const hasOwnWallets = await this.prisma.paymentConfig.count({
        where: { panelId, isActive: true },
      });
      if (hasOwnWallets > 0) {
        this.logger.error(
          `El panel ${panelId} tiene billeteras propias pero ninguna elegida y activa. ` +
            `No se cae a la compartida a proposito: hay que elegir una.`,
        );
        return null;
      }
    }

    return this.prisma.paymentConfig.findFirst({
      where: { panelId: null, isActive: true, isSelected: true },
    });
  }

  /** El grupo al que pertenece una billetera: su panel, o la bolsa compartida. */
  private scopeOf(wallet: { panelId: string | null }) {
    return { panelId: wallet.panelId };
  }

  async getSelectedWallet(panelId?: string | null) {
    const wallet = await this.resolveWalletFor(panelId);

    if (!wallet) {
      return null;
    }

    return {
      id: wallet.id,
      type: wallet.type,
      label: wallet.label,
      holderName: wallet.holderName,
      holderDni: wallet.holderDni,
      holderLegalName: wallet.holderLegalName,
      details: wallet.details,
    };
  }

  /**
   * Get all wallets for operator panel
   */
  async getAllWallets() {
    return this.prisma.paymentConfig.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { panel: { select: { id: true, name: true } } },
    });
  }

  /**
   * Create a new wallet
   */
  async createWallet(data: {
    type: 'MERCADOPAGO' | 'CBU' | 'CVU';
    label: string;
    holderName: string;
    holderDni?: string;
    holderLegalName?: string;
    details: Record<string, string>;
    amountLimit?: number;
    /** Panel duenio de la billetera. Sin esto, es compartida. */
    panelId?: string | null;
  }) {
    const panelId = data.panelId || null;
    // Auto-elegir si es la primera de SU grupo: la primera billetera de un panel
    // nuevo tiene que quedar elegida aunque ya existan las compartidas.
    const existingCount = await this.prisma.paymentConfig.count({
      where: { isActive: true, panelId },
    });

    return this.prisma.paymentConfig.create({
      data: {
        type: data.type,
        label: data.label,
        holderName: data.holderName,
        holderDni: data.holderDni || null,
        holderLegalName: data.holderLegalName || null,
        details: data.details,
        isActive: true,
        isSelected: existingCount === 0, // Auto-select if first wallet of its group
        amountLimit: data.amountLimit ?? null,
        panelId,
      },
    });
  }

  /**
   * Update a wallet
   */
  async updateWallet(
    id: string,
    data: {
      label?: string;
      holderName?: string;
      holderDni?: string;
      holderLegalName?: string;
      details?: Record<string, string>;
      amountLimit?: number | null;
      /** @deprecated Se ignora: la verificación de acreditación estilo MP no existe más. */
      requiresVerification?: boolean;
    },
  ) {
    // requiresVerification se descarta acá a propósito. Poner una billetera en true
    // colgaba todas sus cargas en PENDING_MP_VERIFICATION para siempre (incidente
    // 2026-08-20). El campo sigue en el schema pero ya no se escribe desde la app.
    const { requiresVerification, ...persistable } = data;
    if (requiresVerification === true) {
      this.logger.warn(
        `updateWallet(${id}): se ignoró requiresVerification=true — la verificación MP no está en uso`,
      );
    }
    return this.prisma.paymentConfig.update({
      where: { id },
      data: persistable,
    });
  }

  /**
   * Select a wallet (deselects all others)
   * This is the main action operators use to "rotate" wallets
   */
  async selectWallet(id: string) {
    // Verify wallet exists and is active
    const wallet = await this.prisma.paymentConfig.findUnique({
      where: { id },
    });

    if (!wallet || !wallet.isActive) {
      throw new Error('Wallet not found or inactive');
    }

    // Se deselecciona solo dentro del mismo grupo: elegir la billetera de un
    // panel no puede dejar sin billetera a los demas.
    await this.prisma.$transaction([
      this.prisma.paymentConfig.updateMany({
        where: { isSelected: true, ...this.scopeOf(wallet) },
        data: { isSelected: false },
      }),
      this.prisma.paymentConfig.update({
        where: { id },
        data: { isSelected: true },
      }),
    ]);

    // Return the updated wallet
    return this.prisma.paymentConfig.findUnique({
      where: { id },
    });
  }

  /**
   * Soft delete a wallet (sets isActive to false)
   */
  async deleteWallet(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.paymentConfig.findUnique({
        where: { id },
      });

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // If deleting the selected wallet, select another one
      if (wallet.isSelected) {
        const anotherWallet = await tx.paymentConfig.findFirst({
          where: {
            id: { not: id },
            isActive: true,
          },
        });

        if (anotherWallet) {
          await tx.paymentConfig.update({
            where: { id: anotherWallet.id },
            data: { isSelected: true },
          });
        }
      }

      await tx.paymentConfig.update({
        where: { id },
        data: {
          isActive: false,
          isSelected: false,
        },
      });
    });

    return { success: true };
  }

  // ============================================
  // WALLET LIMITS & AUTO-ROTATION
  // ============================================

  /**
   * Get a wallet by ID
   */
  async getWalletById(id: string) {
    return this.prisma.paymentConfig.findUnique({ where: { id } });
  }

  /**
   * Decrement wallet accumulated amount (e.g., when a previously approved request is rejected).
   * Ensures accumulated never goes below 0.
   */
  async decrementWalletAmount(walletId: string, amount: number) {
    if (amount <= 0) return; // Guard against negative/zero amounts
    const wallet = await this.prisma.paymentConfig.findUnique({
      where: { id: walletId },
    });
    if (!wallet) return;

    const newAmount = Math.max(0, Number(wallet.accumulatedAmount) - amount);
    await this.prisma.paymentConfig.update({
      where: { id: walletId },
      data: { accumulatedAmount: newAmount },
    });
  }

  /**
   * Mark a wallet as empty (operator withdrew funds)
   * Resets accumulatedAmount to 0
   */
  async markWalletAsEmpty(id: string) {
    return this.prisma.paymentConfig.update({
      where: { id },
      data: {
        accumulatedAmount: 0,
        lastEmptiedAt: new Date(),
      },
    });
  }

  /**
   * Accumulate amount on a wallet and check if rotation is needed.
   * Called when a request is APPROVED (payment validated).
   * Uses Serializable isolation to prevent concurrent race conditions.
   *
   * Returns:
   * - rotated: whether the active wallet was changed
   * - newWallet: the newly selected wallet (if rotated)
   * - allFull: whether ALL wallets have exceeded their limits
   */
  async accumulateAndCheckRotation(
    walletId: string,
    amount: number,
  ): Promise<{ rotated: boolean; newWallet?: any; allFull: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1. Atomically increment accumulatedAmount
        const wallet = await tx.paymentConfig.update({
          where: { id: walletId },
          data: {
            accumulatedAmount: { increment: amount },
          },
        });

        // 2. Check if limit is set and exceeded
        const limit = wallet.amountLimit ? Number(wallet.amountLimit) : null;
        const accumulated = Number(wallet.accumulatedAmount);

        if (limit === null || accumulated < limit) {
          return { rotated: false, allFull: false };
        }

        // 3. Wallet is full — find next available wallet (sequential by createdAt)
        // Solo del mismo grupo: la billetera de un panel rota entre las de ese
        // panel, y que se llenen las compartidas no dice nada sobre el.
        const allActive = await tx.paymentConfig.findMany({
          where: { isActive: true, panelId: wallet.panelId },
          orderBy: { createdAt: 'asc' },
        });

        const available = allActive.filter((w) => {
          if (w.id === walletId) return false;
          if (!w.amountLimit) return true; // no limit = always available
          return Number(w.accumulatedAmount) < Number(w.amountLimit);
        });

        if (available.length > 0) {
          // 4a. Rotate to first available wallet
          await tx.paymentConfig.updateMany({
            where: { isSelected: true, panelId: wallet.panelId },
            data: { isSelected: false },
          });
          const selected = await tx.paymentConfig.update({
            where: { id: available[0].id },
            data: { isSelected: true },
          });
          return { rotated: true, newWallet: selected, allFull: false };
        }

        // 4b. ALL wallets full — fallback to least-full
        const leastFull = allActive
          .filter((w) => w.id !== walletId)
          .sort((a, b) => {
            const ratioA = a.amountLimit
              ? Number(a.accumulatedAmount) / (Number(a.amountLimit) || 1)
              : 0;
            const ratioB = b.amountLimit
              ? Number(b.accumulatedAmount) / (Number(b.amountLimit) || 1)
              : 0;
            return ratioA - ratioB;
          })[0];

        if (leastFull) {
          await tx.paymentConfig.updateMany({
            where: { isSelected: true, panelId: wallet.panelId },
            data: { isSelected: false },
          });
          const selected = await tx.paymentConfig.update({
            where: { id: leastFull.id },
            data: { isSelected: true },
          });
          return { rotated: true, newWallet: selected, allFull: true };
        }

        // Only one wallet and it's full
        return { rotated: false, allFull: true };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // Legacy methods for backwards compatibility
  async getPaymentConfig() {
    return this.getSelectedWallet();
  }

  async createPaymentConfig(data: {
    provider: string;
    alias: string;
    name: string;
  }) {
    return this.createWallet({
      type: 'MERCADOPAGO',
      label: data.name,
      holderName: data.name,
      details: { alias: data.alias },
    });
  }

  async updatePaymentConfig(
    id: string,
    data: { alias?: string; name?: string; isActive?: boolean },
  ) {
    const updateData: Record<string, unknown> = {};
    if (data.name) {
      updateData.label = data.name;
      updateData.holderName = data.name;
    }
    if (data.alias) {
      updateData.details = { alias: data.alias };
    }
    if (typeof data.isActive === 'boolean') {
      updateData.isActive = data.isActive;
    }
    return this.prisma.paymentConfig.update({
      where: { id },
      data: updateData,
    });
  }

  async deletePaymentConfig(id: string) {
    return this.deleteWallet(id);
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================

  @OnEvent(AppEvent.PAYMENT_PROOF_UPLOADED)
  async onPaymentProofUploaded(event: { requestId: string }) {
    this.logger.log(
      `[Event] payment.proof.uploaded — requestId=${event.requestId}`,
    );
    try {
      await this.validateProof(event.requestId);
    } catch (error) {
      this.logger.error(
        `Async validation failed for request ${event.requestId}: ${error.message}`,
      );
      // Only revert to VALIDATION_FAILED if still in VALIDATING state
      try {
        const current = await this.prisma.request.findUnique({
          where: { id: event.requestId },
          select: { status: true },
        });
        if (current?.status === 'VALIDATING') {
          await this.requestsService.updateRequestStatus(
            event.requestId,
            'VALIDATION_FAILED',
            'system-safety-net',
            { error: error.message, reason: 'validation_crashed' },
          );
        } else {
          this.logger.warn(
            `Request ${event.requestId} already moved to ${current?.status}, not reverting to VALIDATION_FAILED`,
          );
        }
      } catch (updateError) {
        this.logger.error(
          `CRITICAL: Could not update stuck request ${event.requestId}: ${updateError.message}`,
        );
      }
    }
  }
}
