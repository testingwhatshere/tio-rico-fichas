import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { RequestsService } from '../requests/requests.service';
import { UploadsService } from '../uploads/uploads.service';
import { SettingsService } from '../settings/settings.service';
import { ProofValidationService } from './proof-validation.service';
import { ValidationResultDto } from './dto';
import { VALIDATION_TIMEOUT_BUFFER_MS } from '../common/constants/timeouts';
import { AppEvent, ValidationCompletedEvent, PaymentProofUploadedEvent, MpVerificationNeededEvent } from '../common/events/app-events';
import { PushService } from '../notifications/push.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

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
   * Get validation threshold from settings (dynamic)
   */
  private async getValidationThreshold(): Promise<number> {
    const value = await this.settingsService.getSetting('VALIDATION_THRESHOLD');
    return parseFloat(value || '0.8');
  }

  /**
   * Get validation date window in days from settings (dynamic)
   */
  private async getValidationDateWindowDays(): Promise<number> {
    const value = await this.settingsService.getSetting('VALIDATION_DATE_WINDOW_DAYS');
    return parseInt(value || '7', 10);
  }

  /**
   * Validate a payment proof for a request
   * This is called after proof is uploaded
   */
  async validateProof(requestId: string): Promise<ValidationResultDto> {
    // Align with gateway timeout setting + 5s buffer so the gateway timeout fires first
    const gatewayTimeoutMs = parseInt(
      await this.settingsService.getSetting('VALIDATION_TIMEOUT_MS') || '60000',
      10,
    );
    const VALIDATION_TIMEOUT_MS = gatewayTimeoutMs + VALIDATION_TIMEOUT_BUFFER_MS;

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

    // Fix 17 + Fix 24: Wrap core validation with a 90s timeout and cancellation flag
    let cancelled = false;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        cancelled = true;
        reject(new Error('Validation timed out after 90 seconds'));
      }, VALIDATION_TIMEOUT_MS),
    );

    try {
      return await Promise.race([
        this.performValidationFlow(request, requestId, () => cancelled),
        timeoutPromise,
      ]);
    } catch (error: any) {
      this.logger.error(`Validation error for request ${requestId}: ${error.message}`);

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
        error: userFacingError,
        validationError: userFacingError,
        validatorUnavailable: isValidatorUnavailable,
        targetUsername: request.targetUsername,
        amount: request.amount?.toString(),
        proofUrl: request.proofUrl,
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
        .catch((err: any) => this.logger.warn(`Push (validation_error) failed: ${err.message}`));

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
      this.logger.warn(`Validation for ${requestId} completed after timeout, discarding result`);
      return validationResult;
    }

    // Step 2: Update request with validation result
    await this.requestsService.setValidationResult(requestId, validationResult);

    // Step 3: Emit validation result event
    if (validationResult.valid) {
      // Check per-wallet verification setting
      let mpVerificationEnabled = false;
      if (request.walletId) {
        const wallet = await this.prisma.paymentConfig.findUnique({
          where: { id: request.walletId },
          select: { requiresVerification: true },
        });
        mpVerificationEnabled = wallet?.requiresVerification ?? false;
      }

      this.eventsGateway.emitValidationCompleted(request.userId, {
        requestId,
        status: mpVerificationEnabled ? 'PENDING_MP_VERIFICATION' : 'APPROVED',
        score: validationResult.score,
      });

      if (isCancelled()) {
        this.logger.warn(`Validation for ${requestId} completed after timeout, discarding`);
        return validationResult;
      }

      if (mpVerificationEnabled) {
        // MP verification enabled: emit MP_VERIFICATION_NEEDED, job created after MP confirms
        this.logger.log(`Proof validated for request ${requestId}, emitting MP_VERIFICATION_NEEDED event`);
        this.eventEmitter.emit(AppEvent.MP_VERIFICATION_NEEDED, {
          requestId,
          walletId: request.walletId,
          amount: Number(request.amount),
          expectedSenderName: validationResult.details?.senderName,
        } as MpVerificationNeededEvent);
      } else {
        // MP verification disabled: go straight to job creation (original flow)
        this.logger.log(`Proof validated for request ${requestId}, emitting VALIDATION_COMPLETED event (MP verification disabled)`);
        this.eventEmitter.emit(AppEvent.VALIDATION_COMPLETED, {
          requestId,
          score: validationResult.score,
        } as ValidationCompletedEvent);
      }
    } else {
      this.eventsGateway.emitValidationFailed(request.userId, {
        id: requestId,
        requestId,
        status: 'VALIDATION_FAILED',
        error: validationResult.error,
        validationError: validationResult.error,
        targetUsername: request.targetUsername,
        amount: request.amount?.toString(),
        proofUrl: request.proofUrl,
        validationScore: validationResult.score,
      });
      // Push notification — covers the case where the automated validator rejects
      // the proof and the user is on home/closed-app and wouldn't see chat msgs.
      this.pushService
        .sendToUser(
          request.userId,
          'Comprobante en revisión',
          'No pudimos validar tu comprobante automáticamente. Un operador lo está revisando.',
          { requestId, type: 'validation_failed' },
        )
        .catch((err: any) => this.logger.warn(`Push (validation_failed) failed: ${err.message}`));
    }

    return validationResult;
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
      if (proofUrl.endsWith('.pdf') || proofUrl.includes('/raw/upload/')) mimeType = 'application/pdf';
      else if (proofUrl.endsWith('.png')) mimeType = 'image/png';
      else if (proofUrl.endsWith('.webp')) mimeType = 'image/webp';
      else if (proofUrl.endsWith('.heic')) mimeType = 'image/heic';

      // Fetch wallet info for cross-referencing in validation
      const wallet = request.walletId
        ? await this.prisma.paymentConfig.findUnique({ where: { id: request.walletId } })
        : await this.prisma.paymentConfig.findFirst({ where: { isActive: true, isSelected: true } });

      const walletInfo = wallet ? {
        holderName: wallet.holderName,
        holderLegalName: wallet.holderLegalName,
        holderDni: wallet.holderDni,
        type: wallet.type,
        alias: (wallet.details as any)?.alias,
        cbu: (wallet.details as any)?.cbu,
        cvu: (wallet.details as any)?.cvu,
        bank: (wallet.details as any)?.bank,
        requiresVerification: wallet.requiresVerification ?? false,
      } : null;

      // Send Cloudinary URL directly to validator — validator fetches the image itself
      // No more downloading file buffer on the backend
      const result = await this.proofValidationService.validateProof(
        proofUrl,
        mimeType,
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
          this.logger.error(`Transaction ID dedup check failed: ${error.message}`);
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
          this.logger.warn(`Very high failure rate for user ${request.userId}: ${failedCount} failures in 30 days`);
        } else if (failedCount >= 5) {
          flags.push('HIGH_FAILURE_RATE');
          this.logger.warn(`High failure rate for user ${request.userId}: ${failedCount} failures in 30 days`);
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
            this.logger.warn(`Multiple senders detected for user ${request.userId}: ${distinctSenders.size} distinct senders`);
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
        if (ac.has_proper_formatting === false && ac.has_bank_logo === false && !flags.includes('INVALID_FORMAT')) {
          flags.push('INVALID_FORMAT');
        }
      }
      if (result.transactionStatus) {
        const approvedVariants = ['aprobada', 'aprobado', 'approved', 'exitosa', 'exitoso', 'completada', 'completado', 'acreditada', 'acreditado'];
        const isStatusApproved = approvedVariants.some((v) =>
          result.transactionStatus!.toLowerCase().includes(v),
        );
        if (!isStatusApproved && !flags.includes('STATUS_NOT_APPROVED')) {
          flags.push('STATUS_NOT_APPROVED');
        }
      }

      // Recipient verification (server-side backup for AI cross-check)
      if (walletInfo && result.recipientName) {
        const nameMatches = this.fuzzyNameMatch(
          result.recipientName,
          walletInfo.holderName,
          walletInfo.holderLegalName || undefined,
        );
        if (!nameMatches && !flags.includes('RECIPIENT_MISMATCH')) {
          flags.push('RECIPIENT_MISMATCH');
          this.logger.warn(
            `Recipient name mismatch for request ${request.id}: extracted="${result.recipientName}" expected="${walletInfo.holderName}"${walletInfo.holderLegalName ? ` / "${walletInfo.holderLegalName}"` : ''}`,
          );
        }
      }

      if (walletInfo && result.recipientAccount) {
        const accountMatches = this.accountMatch(result.recipientAccount, walletInfo);
        if (!accountMatches && !flags.includes('RECIPIENT_ACCOUNT_MISMATCH')) {
          flags.push('RECIPIENT_ACCOUNT_MISMATCH');
          this.logger.warn(
            `Recipient account mismatch for request ${request.id}: extracted="${result.recipientAccount}"`,
          );
        }
      }

      // Amount mismatch detection: compare extracted amount vs requested amount
      if (result.extractedAmount && Number(request.amount) > 0) {
        const extracted = Number(result.extractedAmount);
        const requested = Number(request.amount);
        if (extracted > 0 && Math.abs(extracted - requested) > 1) {
          this.logger.warn(
            `Amount mismatch for request ${request.id}: extracted=${extracted}, requested=${requested}`,
          );
          flags.push('AMOUNT_MISMATCH');
        }
      }

      // Change 7a: Critical flags override isValid
      const criticalFlags = [
        'DUPLICATE_TRANSACTION_ID',
        'CROSS_USER_DUPLICATE',
        'LIKELY_EDITED',
        'STATUS_NOT_APPROVED',
        'CROSS_USER_SENDER',
        'VERY_HIGH_FAILURE_RATE',
        'AMOUNT_MISMATCH',
      ];
      const hasCriticalFlags = flags.some((f) => criticalFlags.includes(f));

      // Check against threshold
      const meetsThreshold = result.confidence >= validationThreshold;
      const isValid =
        result.isValid && meetsThreshold && dateValid && !hasCriticalFlags;

      const reasoning = !isValid
        ? this.buildRejectionReason(result, flags, dateValid, validationThreshold, dateWindowDays)
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
          reasoning: result.reasoning,
          transactionId: result.transactionId ?? null,
          referenceNumber: result.referenceNumber ?? null,
          senderName: result.senderName ?? null,
          senderDniCuit: result.senderDniCuit ?? null,
          recipientName: result.recipientName ?? null,
          recipientAccount: result.recipientAccount ?? null,
          recipientMatch: result.recipientMatch ?? null,
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
              'AMOUNT_MISMATCH',
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
        .trim();
    const extractedNorm = normalize(extracted);

    const candidates = [holderName, holderLegalName]
      .filter(Boolean)
      .map((n) => normalize(n!));

    return candidates.some((candidate) => {
      if (extractedNorm === candidate) return true;
      if (extractedNorm.includes(candidate) || candidate.includes(extractedNorm))
        return true;
      const extractedTokens = extractedNorm.split(/\s+/);
      const candidateTokens = candidate.split(/\s+/);
      const matches = extractedTokens.filter((t) => candidateTokens.includes(t));
      return (
        matches.length >= 2 ||
        (matches.length >= 1 && candidateTokens.length === 1)
      );
    });
  }

  /**
   * Match extracted account (alias/CBU/CVU) against expected wallet details
   */
  private accountMatch(
    extractedAccount: string,
    walletInfo: { alias?: string; cbu?: string; cvu?: string },
  ): boolean {
    const norm = (s?: string) =>
      s?.replace(/[\s.\-]/g, '').toLowerCase() || '';
    const extracted = norm(extractedAccount);
    if (!extracted) return true; // can't compare, assume ok
    return [walletInfo.alias, walletInfo.cbu, walletInfo.cvu]
      .filter(Boolean)
      .some(
        (expected) =>
          norm(expected).includes(extracted) ||
          extracted.includes(norm(expected)),
      );
  }

  /**
   * Build a user-friendly rejection reason
   */
  private buildRejectionReason(
    result: { isValid: boolean; reasoning: string; confidence: number },
    flags: string[],
    dateValid: boolean,
    validationThreshold: number,
    dateWindowDays: number,
  ): string {
    const reasons: string[] = [];

    if (flags.includes('DUPLICATE_PROOF')) {
      reasons.push('El comprobante ya fue utilizado');
    }
    if (flags.includes('DUPLICATE_TRANSACTION_ID')) {
      reasons.push('El numero de operacion ya fue usado en otra solicitud');
    }
    if (flags.includes('CROSS_USER_DUPLICATE')) {
      reasons.push('El comprobante corresponde a una transaccion de otro usuario');
    }
    if (flags.includes('AMOUNT_MISMATCH')) {
      reasons.push('El monto no coincide con el solicitado');
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
    if (flags.includes('VERY_HIGH_FAILURE_RATE') || flags.includes('HIGH_FAILURE_RATE')) {
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
    if (flags.includes('RECIPIENT_MISMATCH')) {
      reasons.push('El destinatario del pago no coincide con la billetera esperada');
    }
    if (flags.includes('RECIPIENT_ACCOUNT_MISMATCH')) {
      reasons.push('La cuenta destino (alias/CBU/CVU) no coincide con la billetera esperada');
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
  async getSelectedWallet() {
    const wallet = await this.prisma.paymentConfig.findFirst({
      where: {
        isActive: true,
        isSelected: true,
      },
    });

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
  }) {
    // If this is the first wallet, auto-select it
    const existingCount = await this.prisma.paymentConfig.count({
      where: { isActive: true },
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
        isSelected: existingCount === 0, // Auto-select if first wallet
        amountLimit: data.amountLimit ?? null,
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
      requiresVerification?: boolean;
    },
  ) {
    return this.prisma.paymentConfig.update({
      where: { id },
      data,
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

    // Transaction: deselect all, then select the chosen one
    await this.prisma.$transaction([
      this.prisma.paymentConfig.updateMany({
        where: { isSelected: true },
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
    const wallet = await this.prisma.paymentConfig.findUnique({ where: { id: walletId } });
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
        const allActive = await tx.paymentConfig.findMany({
          where: { isActive: true },
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
            where: { isSelected: true },
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
            where: { isSelected: true },
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
    this.logger.log(`[Event] payment.proof.uploaded — requestId=${event.requestId}`);
    try {
      await this.validateProof(event.requestId);
    } catch (error) {
      this.logger.error(`Async validation failed for request ${event.requestId}: ${error.message}`);
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
