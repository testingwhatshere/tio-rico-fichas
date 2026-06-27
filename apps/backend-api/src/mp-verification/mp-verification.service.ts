import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { OperatorGateway } from '../events/operator.gateway';
import { RequestsService } from '../requests/requests.service';
import { TelegramService } from '../notifications/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { MessagesService } from '../messages/messages.service';
import { LoggingService } from '../logging/logging.service';
import { AppEvent } from '../common/events/app-events';
import type {
  MpVerificationNeededEvent,
  ValidationCompletedEvent,
} from '../common/events/app-events';
import {
  MpVerificationConfirmDto,
  MpUnmatchedTransferDto,
  PendingVerificationResponseDto,
} from './dto/mp-verification.dto';
import { NotificationType } from '../notifications/dto';

// Timeout: requests stuck in PENDING_MP_VERIFICATION for more than this (ms)
const MP_VERIFICATION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Check every 5 minutes
const TIMEOUT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class MpVerificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MpVerificationService.name);
  private timeoutCheckInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
    @Inject(forwardRef(() => RequestsService))
    private readonly requestsService: RequestsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly messagesService: MessagesService,
    private readonly telegramService: TelegramService,
    private readonly notificationsService: NotificationsService,
    private readonly loggingService: LoggingService,
  ) {}

  private dailyReportTimeout: ReturnType<typeof setTimeout> | null = null;

  onModuleInit() {
    this.timeoutCheckInterval = setInterval(
      () => this.checkVerificationTimeouts(),
      TIMEOUT_CHECK_INTERVAL_MS,
    );

    // Feature 7: Schedule daily report at 23:59
    this.scheduleDailyReport();

    this.logger.log('MP verification timeout checker started (every 5min)');
  }

  onModuleDestroy() {
    if (this.timeoutCheckInterval) clearInterval(this.timeoutCheckInterval);
    if (this.dailyReportTimeout) clearTimeout(this.dailyReportTimeout);
  }

  private scheduleDailyReport() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(23, 59, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    const msUntil = target.getTime() - now.getTime();
    this.dailyReportTimeout = setTimeout(() => {
      this.sendDailyReport().catch((err) => {
        this.logger.error(`Daily report failed: ${err.message}`);
      });
      // Re-schedule for next day
      this.scheduleDailyReport();
    }, msUntil);

    this.logger.log(
      `Daily report scheduled in ${Math.round(msUntil / 60000)} minutes`,
    );
  }

  /**
   * Get requests pending MP verification for a specific wallet
   */
  async getPendingForWallet(
    walletId: string,
  ): Promise<PendingVerificationResponseDto[]> {
    const requests = await this.prisma.request.findMany({
      where: {
        status: 'PENDING_MP_VERIFICATION',
        walletId,
      },
      select: {
        id: true,
        amount: true,
        walletId: true,
        createdAt: true,
        validationDetails: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return requests.map((r) => {
      const details = r.validationDetails as any;
      return {
        requestId: r.id,
        amount: Number(r.amount),
        walletId: r.walletId!,
        createdAt: r.createdAt.toISOString(),
        expectedSenderName: details?.senderName || undefined,
        validationDetails: details
          ? {
              senderName: details.senderName,
              extractedAmount: details.extractedAmount,
              extractedDate: details.extractedDate,
              extractedTime: details.extractedTime,
            }
          : undefined,
      };
    });
  }

  /**
   * Confirm that a payment was found in MercadoPago for a specific request
   */
  async confirmVerification(dto: MpVerificationConfirmDto, walletId: string) {
    // 1. Validate operation number uniqueness
    const existing = await this.prisma.mpVerification.findUnique({
      where: { operationNumber: dto.operationNumber },
    });
    if (existing) {
      throw new BadRequestException(
        `N° de operación ${dto.operationNumber} ya fue utilizado para otra verificación`,
      );
    }

    // 2. Validate request exists and is in correct status
    const request = await this.prisma.request.findUnique({
      where: { id: dto.requestId },
    });
    if (!request) {
      throw new NotFoundException('Request no encontrado');
    }
    if (request.status !== 'PENDING_MP_VERIFICATION') {
      throw new BadRequestException(
        `Request está en estado ${request.status}, no se puede verificar`,
      );
    }
    if (request.walletId !== walletId) {
      throw new BadRequestException(
        'Este request no corresponde a la billetera asignada a esta extensión',
      );
    }

    // 3. Amount validation (round to avoid off-by-one from decimal precision)
    const requestAmount = Math.round(Number(request.amount));
    const transferAmount = Math.round(dto.amount);
    if (Math.abs(requestAmount - transferAmount) > 1) {
      throw new BadRequestException(
        `Monto no coincide: request=$${requestAmount}, transferencia=$${transferAmount}`,
      );
    }

    // 3b. Reconciliation check — block if AI-extracted data doesn't match real MP data
    if (dto.reconciliation) {
      const { amountMatch, flags: reconFlags } = dto.reconciliation;
      if (amountMatch === false) {
        this.logger.warn(
          `MP verification blocked for request ${dto.requestId}: amount mismatch between AI proof and real MP transfer`,
        );
        // Move request back to VALIDATION_FAILED for operator review
        await this.prisma.request.update({
          where: { id: dto.requestId },
          data: {
            status: 'VALIDATION_FAILED',
            validationError:
              'Discrepancia de monto: el monto real en MP no coincide con el comprobante subido.',
          },
        });
        this.operatorGateway.emitToAll('validation_failed', {
          id: dto.requestId,
          requestId: dto.requestId,
          status: 'VALIDATION_FAILED',
          reason: 'MP reconciliation amount mismatch',
          reconciliation: dto.reconciliation,
        });
        throw new BadRequestException(
          'Discrepancia de monto: el monto real en MP no coincide con el comprobante. Requiere revisión manual.',
        );
      }
      if (reconFlags?.includes('AMOUNT_MISMATCH')) {
        this.logger.warn(
          `MP verification blocked for request ${dto.requestId}: reconciliation flag AMOUNT_MISMATCH`,
        );
        throw new BadRequestException(
          'Discrepancia detectada en la transferencia. Requiere revisión manual.',
        );
      }
    }

    const now = new Date();

    // 4. Create MpVerification record + update request in a transaction
    const [mpVerification, updatedRequest] = await this.prisma.$transaction(
      async (tx) => {
        const verification = await tx.mpVerification.create({
          data: {
            walletId,
            operationNumber: dto.operationNumber,
            senderName: dto.senderName,
            senderBank: dto.senderBank,
            senderCbu: dto.senderCbu,
            senderCuit: dto.senderCuit,
            amount: dto.amount,
            transactionDate: new Date(dto.transactionDate),
            transactionTime: dto.transactionTime,
            identificationCode: dto.identificationCode,
            channel: dto.channel,
            mpActivityUrl: dto.mpActivityUrl,
            status: dto.status,
            requestId: dto.requestId,
            matchedAt: now,
          },
        });

        const updated = await tx.request.update({
          where: { id: dto.requestId },
          data: {
            status: 'APPROVED',
            mpVerified: true,
            mpOperationNumber: dto.operationNumber,
            mpVerifiedAt: now,
            mpVerifiedByWalletId: walletId,
            approvedAt: now,
          },
        });

        await tx.requestStatusHistory.create({
          data: {
            requestId: dto.requestId,
            status: 'APPROVED',
            changedBy: 'mp-verifier',
            metadata: {
              mpVerification: true,
              operationNumber: dto.operationNumber,
              senderName: dto.senderName,
              amount: dto.amount,
              walletId,
            },
          },
        });

        return [verification, updated];
      },
    );

    this.logger.log(
      `MP verification confirmed for request ${dto.requestId} — operation #${dto.operationNumber}`,
    );

    // 5. Post-commit: send system message, emit events
    this.sendRequestSystemMessage(dto.requestId, updatedRequest.userId);

    this.eventsGateway.emitRequestUpdated(updatedRequest.userId, {
      requestId: updatedRequest.id,
      status: 'APPROVED',
      mpVerified: true,
    });

    this.eventsGateway.emitDashboardUpdate();

    // 6. Wallet accumulation (was deferred from setValidationResult)
    this.paymentsService
      .accumulateAndCheckRotation(walletId, Number(updatedRequest.amount))
      .then((result) => {
        if (result?.rotated) {
          this.logger.log(
            `Wallet rotated after MP verification for request ${dto.requestId}`,
          );
        }
      })
      .catch((err) => {
        this.logger.error(
          `Wallet accumulation failed after MP verification: ${err.message}`,
        );
      });

    // 7. Feature 2: Check reconciliation flags and alert if mismatches
    const reconciliation = (dto as any).reconciliation;
    if (reconciliation?.flags?.length > 0) {
      this.logger.warn(
        `Reconciliation flags for request ${dto.requestId}: ${reconciliation.flags.join(', ')}`,
      );
      this.telegramService
        .alertReconciliationMismatch(
          dto.requestId,
          reconciliation.flags,
          reconciliation.aiExtracted,
          reconciliation.mpActual,
        )
        .catch(() => {});
    }

    // 8. Feature 3: Push notification to user
    this.notifyUserPaymentVerified(dto.requestId);

    // 9. Emit VALIDATION_COMPLETED to trigger job creation via JobsService
    this.eventEmitter.emit(AppEvent.VALIDATION_COMPLETED, {
      requestId: dto.requestId,
      score: updatedRequest.validationScore || 1,
    } as ValidationCompletedEvent);

    return { verified: true, mpVerification, request: updatedRequest };
  }

  /**
   * Report a scraped transfer that doesn't match any pending request
   */
  async reportUnmatched(dto: MpUnmatchedTransferDto, walletId: string) {
    // Check if already reported
    const existing = await this.prisma.mpVerification.findUnique({
      where: { operationNumber: dto.operationNumber },
    });
    if (existing) {
      return { alreadyReported: true };
    }

    const verification = await this.prisma.mpVerification.create({
      data: {
        walletId,
        operationNumber: dto.operationNumber,
        senderName: dto.senderName,
        senderBank: dto.senderBank,
        senderCbu: dto.senderCbu,
        senderCuit: dto.senderCuit,
        amount: dto.amount,
        transactionDate: new Date(dto.transactionDate),
        transactionTime: dto.transactionTime,
        identificationCode: dto.identificationCode,
        channel: dto.channel,
        mpActivityUrl: dto.mpActivityUrl,
        status: dto.status,
        // requestId intentionally null — no match
      },
    });

    return { reported: true, id: verification.id };
  }

  /**
   * Heartbeat from MP verification extension
   */
  async heartbeat(walletId: string) {
    this.logger.debug(`MP verifier heartbeat for wallet ${walletId}`);
    return { ok: true };
  }

  /**
   * Get stats for popup display
   */
  async getStats(walletId: string) {
    const [pendingCount, verifiedToday, unmatchedToday] = await Promise.all([
      this.prisma.request.count({
        where: { status: 'PENDING_MP_VERIFICATION', walletId },
      }),
      this.prisma.mpVerification.count({
        where: {
          walletId,
          requestId: { not: null },
          scrapedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      this.prisma.mpVerification.count({
        where: {
          walletId,
          requestId: null,
          scrapedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    // Feature 5: Performance stats
    const oldestPending = await this.prisma.request.findFirst({
      where: { status: 'PENDING_MP_VERIFICATION', walletId },
      orderBy: { updatedAt: 'asc' },
      select: { updatedAt: true },
    });

    // Average verification time (last 24h)
    const recentVerifications = await this.prisma.mpVerification.findMany({
      where: {
        walletId,
        requestId: { not: null },
        matchedAt: { not: null },
        scrapedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      select: { matchedAt: true, scrapedAt: true },
    });

    // Also get the request updatedAt for each to compute real wait time
    let avgVerificationMinutes: number | null = null;
    if (recentVerifications.length > 0) {
      // Simple average: time between scrapedAt (when we found it) and matchedAt (when confirmed)
      const totalMs = recentVerifications.reduce((sum, v) => {
        if (v.matchedAt && v.scrapedAt) {
          return sum + (v.matchedAt.getTime() - v.scrapedAt.getTime());
        }
        return sum;
      }, 0);
      avgVerificationMinutes = Math.round(
        totalMs / recentVerifications.length / 60000,
      );
    }

    const oldestPendingMinutes = oldestPending
      ? Math.round((Date.now() - oldestPending.updatedAt.getTime()) / 60000)
      : null;

    return {
      pendingCount,
      verifiedToday,
      unmatchedToday,
      avgVerificationMinutes,
      oldestPendingMinutes,
    };
  }

  /**
   * Event listener: when a request enters PENDING_MP_VERIFICATION
   */
  @OnEvent(AppEvent.MP_VERIFICATION_NEEDED)
  handleMpVerificationNeeded(event: MpVerificationNeededEvent) {
    this.logger.log(
      `MP verification needed for request ${event.requestId}, wallet ${event.walletId}`,
    );

    // Notify connected MP verifier extensions via the gateway
    // This is handled by MpVerificationGateway which listens for this event
  }

  /**
   * Periodic check for requests stuck in PENDING_MP_VERIFICATION
   * Called by setInterval every 5 minutes
   */
  async checkVerificationTimeouts() {
    const cutoff = new Date(Date.now() - MP_VERIFICATION_TIMEOUT_MS);

    const stuckRequests = await this.prisma.request.findMany({
      where: {
        status: 'PENDING_MP_VERIFICATION',
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        amount: true,
        targetUsername: true,
        walletId: true,
        userId: true,
        createdAt: true,
      },
    });

    if (stuckRequests.length === 0) return;

    this.logger.warn(
      `Found ${stuckRequests.length} requests stuck in PENDING_MP_VERIFICATION for >15min`,
    );

    for (const request of stuckRequests) {
      const minutesWaiting = Math.round(
        (Date.now() - request.createdAt.getTime()) / 60000,
      );

      // Alert operators
      this.operatorGateway.emitToAll('mp_verification_timeout', {
        requestId: request.id,
        amount: Number(request.amount),
        targetUsername: request.targetUsername,
        walletId: request.walletId,
        minutesWaiting,
      });

      // Auto-transition to VALIDATION_FAILED so operators can act on it
      try {
        // Re-check status to avoid race condition (request might have been verified during this loop)
        const current = await this.prisma.request.findUnique({
          where: { id: request.id },
          select: { status: true },
        });
        if (current?.status !== 'PENDING_MP_VERIFICATION') {
          this.logger.log(
            `Request ${request.id} already moved from PENDING_MP_VERIFICATION — skipping timeout`,
          );
          continue;
        }

        await this.prisma.request.update({
          where: { id: request.id },
          data: {
            status: 'VALIDATION_FAILED',
            validationError: `Verificación de pago no completada después de ${minutesWaiting} minutos. Requiere revisión manual.`,
          },
        });
        await this.prisma.requestStatusHistory.create({
          data: {
            requestId: request.id,
            status: 'VALIDATION_FAILED',
            changedBy: 'system-mp-timeout',
            metadata: { reason: 'mp_verification_timeout', minutesWaiting },
          },
        });
        // Emit to operators so it shows in the failure queue in real-time
        this.operatorGateway.emitValidationFailed({
          id: request.id,
          requestId: request.id,
          status: 'VALIDATION_FAILED',
          targetUsername: request.targetUsername,
          amount: Number(request.amount),
          validationError: `Verificación de pago no completada después de ${minutesWaiting} minutos.`,
          reason: 'mp_verification_timeout',
        });

        this.logger.log(
          `Request ${request.id} moved to VALIDATION_FAILED due to MP verification timeout (${minutesWaiting}min)`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to timeout request ${request.id}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Feature 2: Check for duplicate transfers (same sender + amount within short window)
   */
  async checkDuplicateTransfer(
    walletId: string,
    senderName: string,
    amount: number,
    date: string,
  ) {
    const windowMs = 30 * 60 * 1000; // 30 minute window
    const transferDate = new Date(date);
    const windowStart = new Date(transferDate.getTime() - windowMs);
    const windowEnd = new Date(transferDate.getTime() + windowMs);

    const duplicates = await this.prisma.mpVerification.findMany({
      where: {
        walletId,
        amount,
        senderName,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
    });

    if (duplicates.length > 0) {
      this.logger.warn(
        `Possible duplicate: ${senderName} $${amount} - ${duplicates.length} similar transfer(s) within 30min`,
      );
      this.telegramService
        .send(
          `🔄 <b>POSIBLE PAGO DUPLICADO</b>\n\n` +
            `Remitente: ${senderName}\n` +
            `Monto: <b>$${amount.toLocaleString('es-AR')}</b>\n` +
            `Se detectaron ${duplicates.length + 1} transferencias similares en los ultimos 30 minutos.\n\n` +
            `Verificar que no sea un doble cobro.`,
        )
        .catch(() => {});

      return { isDuplicate: true, count: duplicates.length + 1 };
    }

    return { isDuplicate: false };
  }

  /**
   * Feature 3: Send push notification to user when payment is verified
   */
  async notifyUserPaymentVerified(requestId: string) {
    try {
      const request = await this.prisma.request.findUnique({
        where: { id: requestId },
        select: { userId: true, amount: true, targetUsername: true },
      });
      if (!request) return;

      await this.notificationsService.sendToUser({
        userId: request.userId,
        title: 'Pago verificado',
        message: `Tu pago de $${Number(request.amount).toLocaleString('es-AR')} fue verificado. Estamos cargando tus fichas.`,
        type: NotificationType.REQUEST_APPROVED,
        data: { requestId, status: 'APPROVED' },
      });
    } catch (err: any) {
      this.logger.warn(
        `Push notification failed for request ${requestId}: ${err.message}`,
      );
    }
  }

  /**
   * Feature 5: Save verification screenshot to Cloudinary
   */
  async saveVerificationScreenshot(
    requestId: string,
    screenshotBuffer: Buffer,
  ): Promise<string | null> {
    try {
      const path = await this.loggingService.saveScreenshot({
        filename: `mp-verification-${requestId}.png`,
        buffer: screenshotBuffer,
        category: 'mp_verification',
      });
      this.logger.log(
        `Verification screenshot saved for request ${requestId}: ${path}`,
      );
      return path;
    } catch (err: any) {
      this.logger.warn(
        `Failed to save verification screenshot: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Feature 6: Check for unusual transfer amounts
   */
  checkUnusualAmount(amount: number): boolean {
    // Common amounts (configurable later)
    const commonAmounts = [
      500, 1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000,
      50000, 100000,
    ];
    const tolerance = 0.05; // 5% tolerance

    const isCommon = commonAmounts.some(
      (ca) => Math.abs(amount - ca) / ca <= tolerance,
    );
    return !isCommon;
  }

  /**
   * Feature 7: Daily summary report via Telegram
   * Called by setInterval at ~23:59
   */
  async sendDailyReport() {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

    const [verified, unmatched, pendingNow, wallets] = await Promise.all([
      this.prisma.mpVerification.count({
        where: { requestId: { not: null }, scrapedAt: { gte: todayStart } },
      }),
      this.prisma.mpVerification.count({
        where: { requestId: null, scrapedAt: { gte: todayStart } },
      }),
      this.prisma.request.count({
        where: { status: 'PENDING_MP_VERIFICATION' },
      }),
      this.prisma.paymentConfig.findMany({
        where: { isActive: true },
        select: { label: true, accumulatedAmount: true },
      }),
    ]);

    const walletSummary = wallets
      .map(
        (w) =>
          `  ${w.label}: $${Number(w.accumulatedAmount).toLocaleString('es-AR')}`,
      )
      .join('\n');

    await this.telegramService.send(
      `📊 <b>REPORTE DIARIO MP</b>\n\n` +
        `✅ Verificados hoy: <b>${verified}</b>\n` +
        `❓ Sin match: ${unmatched}\n` +
        `⏳ Pendientes ahora: ${pendingNow}\n\n` +
        `💰 Billeteras:\n${walletSummary || '  Sin billeteras configuradas'}`,
    );

    this.logger.log(
      `Daily report sent: ${verified} verified, ${unmatched} unmatched`,
    );
  }

  /**
   * Feature 1: Update wallet balance from MP scraping
   */
  async updateWalletBalance(walletId: string, balance: number) {
    this.logger.log(`Wallet ${walletId} MP balance: $${balance}`);

    // Emit to operators for live dashboard
    this.operatorGateway.emitToAll('mp_wallet_balance', {
      walletId,
      mpBalance: balance,
      timestamp: new Date().toISOString(),
    });

    return { updated: true };
  }

  /**
   * Feature 3: Report incoming transfers to operators in real-time
   */
  async reportIncomingTransfers(walletId: string, transfers: any[]) {
    if (!transfers || transfers.length === 0) return { reported: 0 };

    // Emit each new transfer to operators
    for (const t of transfers) {
      this.operatorGateway.emitToAll('mp_new_transfer', {
        walletId,
        senderName: t.senderName,
        amount: t.amount,
        date: t.date,
        time: t.time,
        description: t.description,
        timestamp: new Date().toISOString(),
      });

      // Feature 2: Check for duplicates
      if (t.senderName && t.amount && t.date) {
        this.checkDuplicateTransfer(
          walletId,
          t.senderName,
          t.amount,
          t.date,
        ).catch(() => {});
      }

      // Feature 6: Check for unusual amounts
      if (t.amount && this.checkUnusualAmount(t.amount)) {
        this.telegramService
          .send(
            `💡 <b>MONTO INUSUAL</b>\n\n` +
              `Remitente: ${t.senderName || 'Desconocido'}\n` +
              `Monto: <b>$${t.amount.toLocaleString('es-AR')}</b>\n` +
              `No coincide con los montos habituales. Verificar.`,
          )
          .catch(() => {});
      }
    }

    this.logger.log(
      `Reported ${transfers.length} new transfer(s) for wallet ${walletId}`,
    );
    return { reported: transfers.length };
  }

  /**
   * Feature 6: Auto-detect wallet by MP account name
   */
  async autoDetectWallet(accountName: string) {
    const wallets = await this.prisma.paymentConfig.findMany({
      where: { isActive: true },
      select: { id: true, label: true, holderName: true },
    });

    // Fuzzy match: normalize and compare tokens
    const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const nameNorm = normalize(accountName);

    for (const wallet of wallets) {
      const holderNorm = normalize(wallet.holderName);
      // Check if the MP account name is a substring of holder name or vice versa
      if (holderNorm.includes(nameNorm) || nameNorm.includes(holderNorm)) {
        this.logger.log(
          `Auto-detected wallet: "${accountName}" → ${wallet.label} (${wallet.id})`,
        );
        return { walletId: wallet.id, walletLabel: wallet.label };
      }

      // Token match: at least one significant word matches
      const nameTokens = nameNorm.split(' ').filter((t) => t.length > 2);
      const holderTokens = holderNorm.split(' ').filter((t) => t.length > 2);
      const hasMatch = nameTokens.some((nt) =>
        holderTokens.some((ht) => ht.includes(nt) || nt.includes(ht)),
      );
      if (hasMatch) {
        this.logger.log(
          `Auto-detected wallet (token match): "${accountName}" → ${wallet.label} (${wallet.id})`,
        );
        return { walletId: wallet.id, walletLabel: wallet.label };
      }
    }

    this.logger.warn(`No wallet matched for MP account name: "${accountName}"`);
    return { walletId: null, walletLabel: null };
  }

  /**
   * Handle MP session expired report from extension
   */
  async handleSessionExpired(walletId: string, walletLabel?: string) {
    this.logger.warn(
      `MP session expired for wallet ${walletId} (${walletLabel || 'unknown'})`,
    );

    // Alert operators via WebSocket
    this.operatorGateway.emitToAll('mp_session_expired', {
      walletId,
      walletLabel,
      timestamp: new Date().toISOString(),
    });

    // Alert via Telegram (with cooldown)
    this.telegramService.alertMpSessionExpired(walletLabel).catch((err) => {
      this.logger.error(`Telegram MP session alert failed: ${err.message}`);
    });

    return { alerted: true };
  }

  /**
   * Send a system message to the request's chat
   */
  private async sendRequestSystemMessage(requestId: string, userId: string) {
    try {
      const request = await this.prisma.request.findUnique({
        where: { id: requestId },
        include: { chat: { select: { id: true } } },
      });
      if (request?.chat?.id) {
        await this.messagesService.sendSystemMessage(
          request.chat.id,
          'Pago verificado en MercadoPago. Procesando carga de fichas...',
          requestId,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to send system message for request ${requestId}: ${err.message}`,
      );
    }
  }
}
