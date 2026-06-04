import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { BotGateway } from '../bot/bot.gateway';
import { TelegramService } from '../notifications/telegram.service';
import { SetPrizePaymentDto, RejectPrizeClaimDto } from './dto';
import { PrizeClaimStatus } from '@prisma/client';

const MIN_PRIZE_CLAIM_AMOUNT = 3_000;
const VERIFY_CHIPS_TIMEOUT_MS = 60_000; // 60 seconds

interface VerificationState {
  claimId: string;
  targetUsername: string;
  userId: string;
  panelId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE';
  timeoutTimer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class PrizeClaimsService {
  private readonly logger = new Logger(PrizeClaimsService.name);

  // In-memory verification tracking (claimId → state)
  private verifications: Map<string, VerificationState> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    private readonly telegramService: TelegramService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ==========================================
  // CREATE
  // ==========================================

  async create(
    userId: string,
    data: { amount: number; chatId?: string },
  ) {
    if (!Number.isInteger(data.amount)) {
      throw new BadRequestException('El monto debe ser un número entero (sin centavos)');
    }
    if (data.amount < MIN_PRIZE_CLAIM_AMOUNT) {
      throw new BadRequestException(
        `El monto mínimo para cobrar es $${MIN_PRIZE_CLAIM_AMOUNT.toLocaleString('es-AR')}`,
      );
    }

    // Validate user has a gaming username
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTargetUsername: true, panelId: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.savedTargetUsername) {
      throw new BadRequestException(
        'No tenés un usuario de juego configurado. Decile tu nombre de usuario primero.',
      );
    }

    // Check no active prize claim
    const activeClaim = await this.findActiveForUser(userId);
    if (activeClaim) {
      throw new BadRequestException(
        `Ya tenés un cobro de premio en proceso (${activeClaim.status}). Esperá a que se resuelva.`,
      );
    }

    const claim = await this.prisma.prizeClaim.create({
      data: {
        userId,
        targetUsername: user.savedTargetUsername,
        amount: data.amount,
        status: 'PENDING_PAYMENT_DETAILS',
        panelId: user.panelId,
        chatId: data.chatId,
      },
    });

    this.logger.log(
      `Prize claim ${claim.id} created: ${user.savedTargetUsername} wants $${data.amount}`,
    );

    return claim;
  }

  // ==========================================
  // CREATE WITH PAYMENT (UNIFIED FLOW)
  // ==========================================

  async createWithPayment(
    userId: string,
    data: {
      amount: number;
      chatId?: string;
      paymentMethod: string;
      paymentDetails: { cbu?: string; alias?: string; accountHolder: string };
    },
  ) {
    // Validate amount
    if (!Number.isInteger(data.amount)) {
      throw new BadRequestException('El monto debe ser un número entero (sin centavos)');
    }
    if (data.amount < MIN_PRIZE_CLAIM_AMOUNT) {
      throw new BadRequestException(
        `El monto mínimo para cobrar es $${MIN_PRIZE_CLAIM_AMOUNT.toLocaleString('es-AR')}`,
      );
    }

    // Validate user has a gaming username
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTargetUsername: true, panelId: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.savedTargetUsername) {
      throw new BadRequestException(
        'No tenés un usuario de juego configurado. Decile tu nombre de usuario primero.',
      );
    }

    // Check no active prize claim
    const activeClaim = await this.findActiveForUser(userId);
    if (activeClaim) {
      throw new BadRequestException(
        `Ya tenés un cobro de premio en proceso (${activeClaim.status}). Esperá a que se resuelva.`,
      );
    }

    // Validate payment details
    if (data.paymentMethod === 'CBU') {
      const cbu = data.paymentDetails.cbu?.replace(/\s/g, '');
      if (!cbu || cbu.length !== 22) {
        throw new BadRequestException('El CBU debe tener 22 dígitos');
      }
    } else if (data.paymentMethod === 'ALIAS') {
      const alias = data.paymentDetails.alias;
      if (!alias || alias.length < 6) {
        throw new BadRequestException('El alias debe tener al menos 6 caracteres');
      }
    } else {
      throw new BadRequestException('Método de pago inválido');
    }

    if (!data.paymentDetails.accountHolder) {
      throw new BadRequestException('El titular de la cuenta es obligatorio');
    }

    // Create claim with payment details already set → skip PENDING_PAYMENT_DETAILS
    const claim = await this.prisma.prizeClaim.create({
      data: {
        userId,
        targetUsername: user.savedTargetUsername,
        amount: data.amount,
        status: 'PENDING_VERIFICATION',
        panelId: user.panelId,
        chatId: data.chatId,
        paymentMethod: data.paymentMethod,
        paymentDetails: data.paymentDetails as any,
      },
    });

    this.logger.log(
      `Prize claim ${claim.id} created (unified): ${user.savedTargetUsername} wants $${data.amount} → PENDING_VERIFICATION`,
    );

    // Emit status to user
    this.events.emitToUser(userId, 'prize_claim:status_update', {
      claimId: claim.id,
      status: 'PENDING_VERIFICATION',
      message: 'Datos recibidos. Verificando tus fichas en el panel...',
    });

    // Trigger chip verification immediately
    await this.triggerVerification(claim);

    return claim;
  }

  // ==========================================
  // SET PAYMENT DETAILS + TRIGGER VERIFICATION
  // ==========================================

  async setPaymentDetails(
    claimId: string,
    userId: string,
    dto: SetPrizePaymentDto,
  ) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');
    if (claim.userId !== userId) throw new BadRequestException('No autorizado');
    if (claim.status !== 'PENDING_PAYMENT_DETAILS') {
      throw new BadRequestException('Los datos de pago ya fueron enviados');
    }

    // Validate payment details
    if (dto.paymentMethod === 'CBU') {
      const cbu = (dto.paymentDetails as any).cbu?.replace(/\s/g, '');
      if (!cbu || cbu.length !== 22) {
        throw new BadRequestException('El CBU debe tener 22 dígitos');
      }
    } else if (dto.paymentMethod === 'ALIAS') {
      const alias = (dto.paymentDetails as any).alias;
      if (!alias || alias.length < 6) {
        throw new BadRequestException('El alias debe tener al menos 6 caracteres');
      }
    }

    if (!(dto.paymentDetails as any).accountHolder) {
      throw new BadRequestException('El titular de la cuenta es obligatorio');
    }

    const updated = await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        paymentMethod: dto.paymentMethod,
        paymentDetails: dto.paymentDetails as any,
        status: 'PENDING_VERIFICATION',
      },
    });

    this.logger.log(`Prize claim ${claimId}: payment details set, triggering verification`);

    // Emit status to user
    this.events.emitToUser(userId, 'prize_claim:status_update', {
      claimId,
      status: 'PENDING_VERIFICATION',
      message: 'Datos de pago recibidos. Verificando tus fichas en el panel...',
    });

    // Trigger chip verification
    await this.triggerVerification(updated);

    return updated;
  }

  // ==========================================
  // CHIP VERIFICATION
  // ==========================================

  private async triggerVerification(claim: any) {
    const panelId = claim.panelId;

    if (!panelId) {
      // Need discovery first — use discovery service
      this.logger.log(`Prize claim ${claim.id}: no panelId, starting discovery`);
      await this.startDiscoveryForPrizeClaim(claim);
      return;
    }

    // Check if bot is connected for this panel
    if (!this.botGateway.isBotConnectedForPanel(panelId)) {
      this.logger.warn(`Prize claim ${claim.id}: no bot connected for panel ${panelId}`);
      await this.prisma.prizeClaim.update({
        where: { id: claim.id },
        data: { status: 'VERIFICATION_FAILED' },
      });
      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId: claim.id,
        status: 'VERIFICATION_FAILED',
        message: 'No hay conexión con el servidor de juego. Un operador va a revisar tu solicitud.',
      });
      this.events.emitToOperators('new_prize_claim', this.formatClaimForOperator(claim));
      return;
    }

    // Update status to VERIFYING_CHIPS
    await this.prisma.prizeClaim.update({
      where: { id: claim.id },
      data: { status: 'VERIFYING_CHIPS' },
    });

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId: claim.id,
      status: 'VERIFYING_CHIPS',
      message: 'Verificando tus fichas en el panel de juego...',
    });

    // Send verify_chips to the bot
    this.pushVerifyChipsTask(panelId, claim.id, claim.targetUsername);

    // Set timeout
    const timeoutTimer = setTimeout(() => {
      this.handleVerificationTimeout(claim.id);
    }, VERIFY_CHIPS_TIMEOUT_MS);

    this.verifications.set(claim.id, {
      claimId: claim.id,
      targetUsername: claim.targetUsername,
      userId: claim.userId,
      panelId,
      status: 'IN_PROGRESS',
      timeoutTimer,
    });
  }

  private pushVerifyChipsTask(panelId: string, taskId: string, targetUsername: string) {
    const panelBots = (this.botGateway as any).connectedBots?.get(panelId);
    if (!panelBots || panelBots.size === 0) {
      this.logger.warn(`No bot connected for panel ${panelId} to verify chips`);
      return;
    }

    const [, bot] = panelBots.entries().next().value!;
    bot.emit('verify_chips', { taskId, targetUsername });
    this.logger.log(`Sent verify_chips to panel ${panelId} for "${targetUsername}" (task ${taskId})`);
  }

  private async startDiscoveryForPrizeClaim(claim: any) {
    // Use discovery service to find the user's panel
    try {
      const { DiscoveryService } = require('../discovery/discovery.service');
      const discoveryService = this.moduleRef.get(DiscoveryService, { strict: false });

      // We need to create a temporary request-like entry for discovery
      // Instead, we'll directly search — discovery service works with requestId
      // Let's use the claim.id as the taskId for discovery
      const sentTo = this.botGateway.pushDiscoveryToIdlePanels(claim.id, claim.targetUsername);

      if (sentTo.length === 0) {
        this.logger.warn(`No idle bots for prize claim discovery: ${claim.id}`);
        await this.prisma.prizeClaim.update({
          where: { id: claim.id },
          data: { status: 'VERIFICATION_FAILED' },
        });
        this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
          claimId: claim.id,
          status: 'VERIFICATION_FAILED',
          message: 'No pudimos encontrar tu perfil. Un operador va a revisar tu solicitud.',
        });
        this.events.emitToOperators('new_prize_claim', this.formatClaimForOperator(claim));
      } else {
        this.logger.log(`Prize claim ${claim.id}: discovery sent to ${sentTo.length} panels`);
        // The discovery result will come back via handleDiscoveryResultForPrizeClaim
        // Set a timeout
        const timeoutTimer = setTimeout(() => {
          this.handleVerificationTimeout(claim.id);
        }, VERIFY_CHIPS_TIMEOUT_MS);

        this.verifications.set(claim.id, {
          claimId: claim.id,
          targetUsername: claim.targetUsername,
          userId: claim.userId,
          panelId: '',
          status: 'PENDING',
          timeoutTimer,
        });
      }
    } catch (error: any) {
      this.logger.error(`Discovery for prize claim ${claim.id} failed: ${error.message}`);
      await this.prisma.prizeClaim.update({
        where: { id: claim.id },
        data: { status: 'VERIFICATION_FAILED' },
      });
    }
  }

  /**
   * Handle discovery result for a prize claim (user found on a panel).
   * Called by the discovery result handler when the taskId matches a prize claim.
   */
  async handleDiscoveryResultForPrizeClaim(
    claimId: string,
    panelId: string,
    found: boolean,
  ) {
    const verification = this.verifications.get(claimId);
    if (!verification) return;

    if (found) {
      clearTimeout(verification.timeoutTimer);
      this.verifications.delete(claimId);

      // Update claim and user with panelId
      const claim = await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { panelId },
      });
      await this.prisma.user.update({
        where: { id: claim.userId },
        data: { panelId },
      });

      // Now trigger chip verification on the found panel
      await this.triggerVerification(claim);
    }
    // If not found, wait for other panels or timeout
  }

  private async handleVerificationTimeout(claimId: string) {
    const verification = this.verifications.get(claimId);
    if (!verification || verification.status === 'DONE') return;

    this.verifications.delete(claimId);
    this.logger.warn(`Verification timed out for prize claim ${claimId}`);

    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });
    if (!claim || claim.status === 'VERIFIED' || claim.status === 'VERIFICATION_FAILED') return;

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: { status: 'VERIFICATION_FAILED' },
    });

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'VERIFICATION_FAILED',
      message: 'No pudimos verificar tus fichas a tiempo. Un operador va a revisar tu solicitud.',
    });
    this.events.emitToOperators('new_prize_claim', this.formatClaimForOperator(claim));
  }

  // ==========================================
  // HANDLE VERIFICATION RESULT FROM EXTENSION
  // ==========================================

  async handleVerificationResult(
    claimId: string,
    result: { success: boolean; balance?: number; error?: string },
  ) {
    const verification = this.verifications.get(claimId);
    if (verification) {
      clearTimeout(verification.timeoutTimer);
      verification.status = 'DONE';
      this.verifications.delete(claimId);
    }

    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      this.logger.warn(`Verification result for unknown claim: ${claimId}`);
      return;
    }

    // Idempotency: skip if already in a final-ish state
    if (!['PENDING_VERIFICATION', 'VERIFYING_CHIPS'].includes(claim.status)) {
      this.logger.warn(`Claim ${claimId} already in ${claim.status}, ignoring verification result`);
      return;
    }

    if (result.success && result.balance != null) {
      const hasEnough = result.balance >= Number(claim.amount);

      if (hasEnough) {
        await this.prisma.prizeClaim.update({
          where: { id: claimId },
          data: {
            status: 'VERIFIED',
            verifiedBalance: result.balance,
            verifiedAt: new Date(),
          },
        });

        this.logger.log(
          `Prize claim ${claimId} VERIFIED: user has ${result.balance} chips, claimed ${claim.amount}`,
        );

        this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
          claimId,
          status: 'VERIFIED',
          message: `¡Fichas verificadas! Tenés ${result.balance.toLocaleString('es-AR')} fichas. Un operador va a procesar tu premio de $${Number(claim.amount).toLocaleString('es-AR')}.`,
        });

        const formattedClaim = this.formatClaimForOperator({
          ...claim,
          verifiedBalance: result.balance,
          status: 'VERIFIED',
        });
        this.events.emitToOperators('new_prize_claim', formattedClaim);
        // Bridge to /operator namespace
        try {
          const { OperatorGateway } = require('../events/operator.gateway');
          const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
          opGateway?.emitToAll('new_prize_claim', formattedClaim);
        } catch (err) {
          this.logger.warn(`Failed to emit new_prize_claim to operators: ${err?.message || err}`);
        }

        // Telegram alert
        this.telegramService
          .alertNewPrizeClaim(
            claim.targetUsername,
            Number(claim.amount),
            result.balance,
          )
          .catch(() => {});

        this.events.emitDashboardUpdate();
      } else {
        await this.prisma.prizeClaim.update({
          where: { id: claimId },
          data: {
            status: 'VERIFICATION_FAILED',
            verifiedBalance: result.balance,
            verifiedAt: new Date(),
          },
        });

        this.logger.log(
          `Prize claim ${claimId} FAILED: user has ${result.balance} chips but claimed ${claim.amount}`,
        );

        this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
          claimId,
          status: 'VERIFICATION_FAILED',
          message: `No tenés suficientes fichas. Tenés ${result.balance.toLocaleString('es-AR')} pero pediste $${Number(claim.amount).toLocaleString('es-AR')}. Podés intentar con un monto menor.`,
        });
      }
    } else {
      // Verification failed (error)
      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { status: 'VERIFICATION_FAILED' },
      });

      this.logger.error(`Prize claim ${claimId} verification error: ${result.error}`);

      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId,
        status: 'VERIFICATION_FAILED',
        message: 'Hubo un problema al verificar tus fichas. Un operador va a revisar tu solicitud.',
      });
      this.events.emitToOperators('new_prize_claim', this.formatClaimForOperator(claim));
    }
  }

  // ==========================================
  // OPERATOR ACTIONS
  // ==========================================

  /**
   * Operator triggers chip withdrawal (VERIFIED → PROCESSING).
   * Creates a WITHDRAW_CHIPS job for the extension.
   */
  async process(claimId: string, operatorId: string) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');
    if (claim.status !== 'VERIFIED') {
      throw new BadRequestException(
        `El premio debe estar verificado para procesarlo. Estado actual: ${claim.status}`,
      );
    }

    if (!claim.panelId) {
      throw new BadRequestException('El premio no tiene panel asignado');
    }

    // Create job + update claim atomically to prevent orphaned jobs
    const job = await this.prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: {
          type: 'WITHDRAW_CHIPS',
          status: 'QUEUED',
          panelId: claim.panelId,
          targetUsername: claim.targetUsername,
          amount: claim.amount,
        },
      });

      await tx.prizeClaim.update({
        where: { id: claimId },
        data: {
          status: 'PROCESSING',
          processedBy: operatorId,
          jobId: newJob.id,
        },
      });

      return newJob;
    });

    this.logger.log(`Prize claim ${claimId} PROCESSING: job ${job.id} created`);

    // Emit events
    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'PROCESSING',
      message: 'Retirando tus fichas del panel de juego...',
    });
    this.events.emitToOperators('prize_claim_updated', {
      id: claimId,
      status: 'PROCESSING',
      jobId: job.id,
      processedBy: operatorId,
    });
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('prize_claim_updated', {
        id: claimId,
        status: 'PROCESSING',
        jobId: job.id,
      });
    } catch (err) {
      this.logger.warn(`Failed to emit prize_claim_updated (PROCESSING): ${err?.message || err}`);
    }

    // Dispatch the job to the bot
    try {
      const { JobsService } = require('../jobs/jobs.service');
      const jobsService = this.moduleRef.get(JobsService, { strict: false });
      await jobsService.tryDispatchNextJob(claim.panelId);
    } catch (error: any) {
      this.logger.error(`Failed to dispatch withdraw job ${job.id}: ${error.message}`);
    }

    this.events.emitDashboardUpdate();

    return { success: true, jobId: job.id };
  }

  /**
   * Handle result from WITHDRAW_CHIPS job.
   * Called by BotService when a WITHDRAW_CHIPS job completes/fails.
   */
  async handleWithdrawalResult(claimId: string, success: boolean, error?: string) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      this.logger.warn(`Withdrawal result for unknown claim: ${claimId}`);
      return;
    }

    if (claim.status !== 'PROCESSING') {
      this.logger.warn(`Claim ${claimId} not in PROCESSING state, ignoring withdrawal result`);
      return;
    }

    if (success) {
      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { status: 'CHIPS_WITHDRAWN' },
      });

      this.logger.log(`Prize claim ${claimId}: chips withdrawn successfully`);

      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId,
        status: 'CHIPS_WITHDRAWN',
        message: '¡Fichas retiradas! Un operador va a enviarte el pago.',
      });

      const formattedClaim = this.formatClaimForOperator({
        ...claim,
        status: 'CHIPS_WITHDRAWN',
      });
      this.events.emitToOperators('prize_claim_updated', formattedClaim);
      try {
        const { OperatorGateway } = require('../events/operator.gateway');
        const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
        opGateway?.emitToAll('prize_claim_updated', formattedClaim);
      } catch (err) {
        this.logger.warn(`Failed to emit prize_claim_updated (CHIPS_WITHDRAWN): ${err?.message || err}`);
      }

      // Auto-create outbound payment (if auto-payment enabled)
      try {
        const { OutboundPaymentsService } = require('../outbound-payments/outbound-payments.service');
        const outboundService = this.moduleRef.get(OutboundPaymentsService, { strict: false });
        if (outboundService) {
          await outboundService.createFromPrizeClaim(claimId);
        }
      } catch (err: any) {
        this.logger.warn(`Auto-payment creation failed for prize ${claimId}: ${err?.message || err}`);
      }
    } else {
      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { status: 'FAILED' },
      });

      this.logger.error(`Prize claim ${claimId}: chip withdrawal FAILED: ${error}`);

      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId,
        status: 'FAILED',
        message: 'Hubo un problema al retirar tus fichas. Un operador va a revisarlo.',
      });

      this.events.emitToOperators('prize_claim_updated', {
        id: claimId,
        status: 'FAILED',
        error,
      });

      // Telegram alert
      this.telegramService
        .alertPrizeWithdrawalFailed(claim.targetUsername, error || 'Error desconocido')
        .catch(() => {});
    }

    this.events.emitDashboardUpdate();
  }

  /**
   * Operator marks prize as paid (CHIPS_WITHDRAWN → COMPLETED)
   */
  async complete(claimId: string, operatorId: string) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
      include: { user: { select: { balance: true } } },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');
    if (claim.status !== 'CHIPS_WITHDRAWN') {
      throw new BadRequestException(
        `Solo se puede completar un premio con fichas ya retiradas. Estado actual: ${claim.status}`,
      );
    }

    // Create transaction record for audit trail
    const balanceBefore = Number(claim.user.balance);
    await this.prisma.transaction.create({
      data: {
        userId: claim.userId,
        type: 'WITHDRAWAL',
        amount: claim.amount,
        balanceBefore,
        balanceAfter: balanceBefore, // Balance doesn't change (chips were on panel, not internal)
        prizeClaimId: claimId,
        description: `Premio cobrado - ${claim.targetUsername} ($${Number(claim.amount).toLocaleString('es-AR')})`,
      },
    });

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        status: 'COMPLETED',
        completedBy: operatorId,
      },
    });

    this.logger.log(`Prize claim ${claimId} COMPLETED by operator ${operatorId}`);

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'COMPLETED',
      message: `¡Listo! Tu premio de $${Number(claim.amount).toLocaleString('es-AR')} fue enviado. ¡Felicitaciones!`,
    });

    this.events.emitToOperators('prize_claim_updated', {
      id: claimId,
      status: 'COMPLETED',
      completedBy: operatorId,
    });
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('prize_claim_updated', {
        id: claimId,
        status: 'COMPLETED',
        completedBy: operatorId,
      });
    } catch (err) {
      this.logger.warn(`Failed to emit prize_claim_updated (COMPLETED): ${err?.message || err}`);
    }

    this.events.emitDashboardUpdate();

    return { success: true };
  }

  /**
   * Operator rejects prize claim
   */
  async reject(claimId: string, operatorId: string, dto: RejectPrizeClaimDto) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');

    const terminalStatuses: PrizeClaimStatus[] = ['COMPLETED', 'REJECTED'];
    if (terminalStatuses.includes(claim.status)) {
      throw new BadRequestException(`El premio ya está ${claim.status}`);
    }

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        status: 'REJECTED',
        rejectedBy: operatorId,
        rejectionReason: dto.reason,
      },
    });

    this.logger.log(`Prize claim ${claimId} REJECTED by ${operatorId}: ${dto.reason}`);

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'REJECTED',
      message: `Tu solicitud de premio fue rechazada. Motivo: ${dto.reason}`,
    });

    this.events.emitToOperators('prize_claim_updated', {
      id: claimId,
      status: 'REJECTED',
      rejectedBy: operatorId,
      reason: dto.reason,
    });
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('prize_claim_updated', {
        id: claimId,
        status: 'REJECTED',
      });
    } catch (err) {
      this.logger.warn(`Failed to emit prize_claim_updated (REJECTED): ${err?.message || err}`);
    }

    this.events.emitDashboardUpdate();

    return { success: true };
  }

  // ==========================================
  // QUERIES
  // ==========================================

  async findPending() {
    return this.prisma.prizeClaim.findMany({
      where: {
        status: { in: ['VERIFIED', 'CHIPS_WITHDRAWN', 'PROCESSING', 'FAILED'] },
      },
      include: {
        user: {
          select: { username: true, phone: true, savedTargetUsername: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAll(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    return this.prisma.prizeClaim.findMany({
      where,
      include: {
        user: {
          select: { username: true, phone: true, savedTargetUsername: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id },
      include: {
        user: {
          select: { username: true, phone: true, savedTargetUsername: true },
        },
        job: {
          select: { id: true, status: true, error: true, screenshot: true },
        },
      },
    });
    if (!claim) throw new NotFoundException('Premio no encontrado');
    return claim;
  }

  async findActiveForUser(userId: string) {
    const terminalStatuses: PrizeClaimStatus[] = [
      'COMPLETED',
      'REJECTED',
      'VERIFICATION_FAILED',
      'FAILED',
    ];
    return this.prisma.prizeClaim.findFirst({
      where: {
        userId,
        status: { notIn: terminalStatuses },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private formatClaimForOperator(claim: any) {
    return {
      id: claim.id,
      userId: claim.userId,
      targetUsername: claim.targetUsername,
      amount: Number(claim.amount),
      status: claim.status,
      paymentMethod: claim.paymentMethod,
      paymentDetails: claim.paymentDetails,
      verifiedBalance: claim.verifiedBalance ? Number(claim.verifiedBalance) : null,
      verifiedAt: claim.verifiedAt,
      panelId: claim.panelId,
      chatId: claim.chatId,
      createdAt: claim.createdAt,
    };
  }
}
