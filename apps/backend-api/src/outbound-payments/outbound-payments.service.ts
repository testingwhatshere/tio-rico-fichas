import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AppEvent } from '../common/events/app-events';
import type {
  CreateOutboundPaymentDto,
  PaymentResultDto,
  BuyCryptoDto,
} from './dto';

@Injectable()
export class OutboundPaymentsService {
  private readonly logger = new Logger(OutboundPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ==========================================
  // CREATE OUTBOUND PAYMENT
  // ==========================================

  /**
   * Create an outbound payment from a prize claim (after CHIPS_WITHDRAWN).
   * Auto-confirms if settings allow.
   */
  async createFromPrizeClaim(claimId: string): Promise<any> {
    const settings = await this.settingsService.getSystemSettings();
    if (!settings.autoPaymentEnabled) {
      this.logger.log(`Auto-payment disabled, skipping outbound payment for prize ${claimId}`);
      return null;
    }

    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new NotFoundException('Prize claim not found');
    if (claim.status !== 'CHIPS_WITHDRAWN') {
      throw new BadRequestException('Prize must be in CHIPS_WITHDRAWN status');
    }
    if (!claim.paymentDetails || !claim.paymentMethod) {
      throw new BadRequestException('Prize claim has no payment details');
    }

    const amount = Number(claim.amount);
    if (amount > settings.autoPaymentMaxAmount) {
      this.logger.warn(
        `Prize ${claimId} amount $${amount} exceeds auto-payment max $${settings.autoPaymentMaxAmount}`,
      );
      this.eventEmitter.emit(AppEvent.OPERATOR_ALERT, {
        type: 'payment_over_limit',
        message: `Premio $${amount} supera el límite de auto-pago ($${settings.autoPaymentMaxAmount}). Requiere pago manual.`,
        prizeClaimId: claimId,
      });
      return null;
    }

    // Select wallet for payment
    const wallet = await this.selectWalletForPayment(amount);
    if (!wallet) {
      this.logger.warn(`No wallet available for outbound payment of $${amount}`);
      this.eventEmitter.emit(AppEvent.OPERATOR_ALERT, {
        type: 'no_wallet_available',
        message: `No hay billetera disponible para pagar premio de $${amount}. Pagar manualmente.`,
        prizeClaimId: claimId,
      });
      return null;
    }

    // Check for duplicate
    const existing = await this.prisma.outboundPayment.findUnique({
      where: { prizeClaimId: claimId },
    });
    if (existing) {
      this.logger.warn(`OutboundPayment already exists for prize ${claimId}`);
      return existing;
    }

    const requiresConfirm = settings.autoPaymentRequiresConfirm;

    const payment = await this.prisma.outboundPayment.create({
      data: {
        type: 'PRIZE_PAYOUT',
        status: requiresConfirm ? 'PENDING' : 'CONFIRMED',
        prizeClaimId: claimId,
        userId: claim.userId,
        amount: claim.amount,
        paymentMethod: claim.paymentMethod!,
        paymentDetails: claim.paymentDetails as any,
        walletId: wallet.id,
        walletType: wallet.type,
        requiresConfirm,
        confirmedAt: requiresConfirm ? undefined : new Date(),
      },
    });

    this.logger.log(
      `OutboundPayment ${payment.id} created for prize ${claimId} ` +
      `(wallet: ${wallet.label}, amount: $${amount}, confirm: ${requiresConfirm})`,
    );

    // Emit to operators
    this.eventEmitter.emit('outbound_payment.created', payment);

    // If auto-confirmed, create job immediately
    if (!requiresConfirm) {
      await this.createJobForPayment(payment.id);
    }

    return payment;
  }

  /**
   * Create an outbound payment from a withdrawal (after APPROVED).
   */
  async createFromWithdrawal(withdrawalId: string): Promise<any> {
    const settings = await this.settingsService.getSystemSettings();
    if (!settings.autoPaymentEnabled) return null;

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== 'APPROVED') {
      throw new BadRequestException('Withdrawal must be in APPROVED status');
    }

    const amount = Number(withdrawal.amount);
    if (amount > settings.autoPaymentMaxAmount) {
      this.eventEmitter.emit(AppEvent.OPERATOR_ALERT, {
        type: 'payment_over_limit',
        message: `Retiro $${amount} supera el límite de auto-pago. Requiere pago manual.`,
        withdrawalId,
      });
      return null;
    }

    const wallet = await this.selectWalletForPayment(amount);
    if (!wallet) {
      this.eventEmitter.emit(AppEvent.OPERATOR_ALERT, {
        type: 'no_wallet_available',
        message: `No hay billetera disponible para pagar retiro de $${amount}.`,
        withdrawalId,
      });
      return null;
    }

    const existing = await this.prisma.outboundPayment.findUnique({
      where: { withdrawalId },
    });
    if (existing) return existing;

    const requiresConfirm = settings.autoPaymentRequiresConfirm;

    const payment = await this.prisma.outboundPayment.create({
      data: {
        type: 'WITHDRAWAL_PAYOUT',
        status: requiresConfirm ? 'PENDING' : 'CONFIRMED',
        withdrawalId,
        userId: withdrawal.userId,
        amount: withdrawal.amount,
        paymentMethod: withdrawal.paymentMethod,
        paymentDetails: withdrawal.paymentDetails as any,
        walletId: wallet.id,
        walletType: wallet.type,
        requiresConfirm,
        confirmedAt: requiresConfirm ? undefined : new Date(),
      },
    });

    this.logger.log(`OutboundPayment ${payment.id} created for withdrawal ${withdrawalId}`);
    this.eventEmitter.emit('outbound_payment.created', payment);

    if (!requiresConfirm) {
      await this.createJobForPayment(payment.id);
    }

    return payment;
  }

  // ==========================================
  // OPERATOR ACTIONS
  // ==========================================

  async confirm(paymentId: string, operatorId: string): Promise<any> {
    const payment = await this.prisma.outboundPayment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'PENDING') {
      throw new BadRequestException(`Payment cannot be confirmed in status ${payment.status}`);
    }

    const updated = await this.prisma.outboundPayment.update({
      where: { id: paymentId },
      data: {
        status: 'CONFIRMED',
        confirmedBy: operatorId,
        confirmedAt: new Date(),
      },
    });

    this.logger.log(`OutboundPayment ${paymentId} confirmed by operator ${operatorId}`);
    this.eventEmitter.emit('outbound_payment.confirmed', updated);

    // Create job for the payment extension
    await this.createJobForPayment(paymentId);

    return updated;
  }

  async cancel(paymentId: string, operatorId: string, reason: string): Promise<any> {
    const payment = await this.prisma.outboundPayment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (['COMPLETED', 'PROCESSING'].includes(payment.status)) {
      throw new BadRequestException(`Cannot cancel payment in ${payment.status} status`);
    }

    const updated = await this.prisma.outboundPayment.update({
      where: { id: paymentId },
      data: {
        status: 'CANCELLED',
        error: `Cancelled by operator: ${reason}`,
      },
    });

    this.logger.log(`OutboundPayment ${paymentId} cancelled by ${operatorId}: ${reason}`);
    this.eventEmitter.emit('outbound_payment.cancelled', updated);

    return updated;
  }

  async retry(paymentId: string, operatorId: string): Promise<any> {
    const payment = await this.prisma.outboundPayment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'FAILED') {
      throw new BadRequestException('Only failed payments can be retried');
    }

    // Verify wallet still has balance
    const wallet = await this.prisma.paymentConfig.findUnique({
      where: { id: payment.walletId },
    });
    if (!wallet?.outboundEnabled) {
      throw new BadRequestException('Wallet is no longer enabled for outbound payments');
    }

    const updated = await this.prisma.outboundPayment.update({
      where: { id: paymentId },
      data: {
        status: 'CONFIRMED',
        error: null,
        confirmedBy: operatorId,
        confirmedAt: new Date(),
      },
    });

    this.logger.log(`OutboundPayment ${paymentId} retried by operator ${operatorId}`);
    await this.createJobForPayment(paymentId);

    return updated;
  }

  // ==========================================
  // PAYMENT RESULT HANDLING
  // ==========================================

  async handlePaymentResult(jobId: string, dto: PaymentResultDto): Promise<any> {
    const payment = await this.prisma.outboundPayment.findUnique({
      where: { jobId },
      include: { prizeClaim: true, withdrawal: true },
    });

    if (!payment) {
      this.logger.warn(`No outbound payment found for job ${jobId}`);
      return { success: false, error: 'Payment not found' };
    }

    if (payment.status === 'COMPLETED') {
      return { success: true, message: 'Already completed (idempotent)' };
    }

    if (dto.success) {
      await this.prisma.$transaction(async (tx) => {
        // Mark payment completed
        await tx.outboundPayment.update({
          where: { id: payment.id },
          data: {
            status: 'COMPLETED',
            operationNumber: dto.operationNumber,
            screenshotUrl: dto.screenshotUrl,
            completedAt: new Date(),
            attempts: payment.attempts + 1,
          },
        });

        // Mark source as completed
        if (payment.prizeClaimId) {
          await tx.prizeClaim.update({
            where: { id: payment.prizeClaimId },
            data: { status: 'COMPLETED', completedBy: 'system-auto-payment' },
          });
        }
        if (payment.withdrawalId) {
          await tx.withdrawal.update({
            where: { id: payment.withdrawalId },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
        }
      });

      this.logger.log(
        `OutboundPayment ${payment.id} COMPLETED: op=${dto.operationNumber}`,
      );

      // Notify user
      this.eventEmitter.emit('outbound_payment.completed', {
        ...payment,
        operationNumber: dto.operationNumber,
      });

      // Notify operators
      this.eventEmitter.emit('outbound_payment.status_changed', {
        id: payment.id,
        status: 'COMPLETED',
        operationNumber: dto.operationNumber,
      });
    } else {
      await this.prisma.outboundPayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          error: dto.error || 'Unknown error',
          screenshotUrl: dto.screenshotUrl,
          attempts: payment.attempts + 1,
        },
      });

      this.logger.error(
        `OutboundPayment ${payment.id} FAILED: ${dto.error}`,
      );

      this.eventEmitter.emit('outbound_payment.failed', {
        id: payment.id,
        error: dto.error,
        amount: payment.amount,
        userId: payment.userId,
      });
    }

    return { success: true };
  }

  // ==========================================
  // CRYPTO BUY
  // ==========================================

  async buyCrypto(dto: BuyCryptoDto, operatorId?: string): Promise<any> {
    const wallet = await this.prisma.paymentConfig.findUnique({
      where: { id: dto.walletId },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.type !== 'FIWIND') {
      throw new BadRequestException('Crypto buy only supported on Fiwind wallets');
    }
    if (!wallet.outboundEnabled) {
      throw new BadRequestException('Wallet not enabled for outbound operations');
    }

    // Create a job directly (no OutboundPayment record needed for crypto)
    const job = await this.prisma.job.create({
      data: {
        type: 'BUY_CRYPTO',
        status: 'QUEUED',
        amount: dto.amount,
        targetUsername: 'USDT', // Target currency
        panelId: null,
      },
    });

    this.logger.log(
      `BUY_CRYPTO job ${job.id} created: $${dto.amount} ARS → USDT ` +
      `(wallet: ${wallet.label}, by: ${operatorId || 'auto'})`,
    );

    this.eventEmitter.emit('crypto_buy.created', {
      jobId: job.id,
      walletId: dto.walletId,
      amount: dto.amount,
      triggeredBy: operatorId || 'auto',
    });

    return job;
  }

  // ==========================================
  // QUERIES
  // ==========================================

  async findPending() {
    return this.prisma.outboundPayment.findMany({
      where: { status: { in: ['PENDING', 'CONFIRMED', 'QUEUED', 'PROCESSING'] } },
      include: { prizeClaim: true, withdrawal: true, wallet: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByStatus(status: string) {
    return this.prisma.outboundPayment.findMany({
      where: { status: status as any },
      include: { prizeClaim: true, withdrawal: true, wallet: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findRecent(limit = 20) {
    return this.prisma.outboundPayment.findMany({
      include: { prizeClaim: true, withdrawal: true, wallet: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getStats() {
    const [pending, processing, completed, failed] = await Promise.all([
      this.prisma.outboundPayment.count({ where: { status: 'PENDING' } }),
      this.prisma.outboundPayment.count({ where: { status: 'PROCESSING' } }),
      this.prisma.outboundPayment.count({ where: { status: 'COMPLETED' } }),
      this.prisma.outboundPayment.count({ where: { status: 'FAILED' } }),
    ]);
    return { pending, processing, completed, failed };
  }

  // ==========================================
  // INTERNAL HELPERS
  // ==========================================

  /**
   * Select the best wallet for an outbound payment.
   * Prefers the configured default, then picks by highest reported balance.
   */
  private async selectWalletForPayment(amount: number): Promise<any | null> {
    const settings = await this.settingsService.getSystemSettings();

    // Try preferred wallet first
    if (settings.outboundPaymentWalletId) {
      const preferred = await this.prisma.paymentConfig.findFirst({
        where: {
          id: settings.outboundPaymentWalletId,
          outboundEnabled: true,
          isActive: true,
        },
      });
      if (preferred) {
        // Check balance if known
        if (preferred.outboundBalance === null || Number(preferred.outboundBalance) >= amount) {
          return preferred;
        }
        this.logger.warn(
          `Preferred wallet ${preferred.label} has insufficient balance ($${preferred.outboundBalance} < $${amount})`,
        );
      }
    }

    // Fallback: any enabled wallet with enough balance (prefer highest balance)
    const wallets = await this.prisma.paymentConfig.findMany({
      where: { outboundEnabled: true, isActive: true },
      orderBy: { outboundBalance: 'desc' },
    });

    for (const w of wallets) {
      if (w.outboundBalance === null || Number(w.outboundBalance) >= amount) {
        return w;
      }
    }

    return null;
  }

  /**
   * Create a Job for the payment extension to execute.
   */
  private async createJobForPayment(paymentId: string): Promise<void> {
    const payment = await this.prisma.outboundPayment.findUnique({
      where: { id: paymentId },
      include: { wallet: true },
    });

    if (!payment || payment.jobId) return;

    const job = await this.prisma.job.create({
      data: {
        type: 'OUTBOUND_PAYMENT',
        status: 'QUEUED',
        amount: payment.amount,
        targetUsername: (payment.paymentDetails as any)?.accountHolder || '',
      },
    });

    await this.prisma.outboundPayment.update({
      where: { id: paymentId },
      data: {
        status: 'QUEUED',
        jobId: job.id,
      },
    });

    this.logger.log(`Job ${job.id} created for outbound payment ${paymentId}`);

    // Emit to dispatch
    this.eventEmitter.emit('outbound_payment.job_created', {
      jobId: job.id,
      paymentId,
      walletType: payment.walletType,
      amount: Number(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentDetails: payment.paymentDetails,
    });
  }
}
