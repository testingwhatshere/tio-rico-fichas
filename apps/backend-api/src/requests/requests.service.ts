import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { OperatorGateway } from '../events/operator.gateway';
import { SettingsService } from '../settings/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { MessagesService } from '../messages/messages.service';
import { RequestStatus } from '@prisma/client';
import { CreateRequestDto, ApproveRequestDto, RejectRequestDto } from './dto';
import { PaymentsService } from '../payments/payments.service';
import { PushService } from '../notifications/push.service';
import { ChatsService } from '../chats/chats.service';
import { VALID_TRANSITIONS } from '../common/constants/statuses';
import {
  AppEvent,
  PaymentProofUploadedEvent,
} from '../common/events/app-events';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);
  private static readonly VALID_TRANSITIONS = VALID_TRANSITIONS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly settingsService: SettingsService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
    private readonly pushService: PushService,
  ) {}

  /**
   * Send a system message to the user's persistent chat, tagged with the request.
   * Falls back to per-request chat for old data.
   */
  private async sendRequestSystemMessage(requestId: string, userId: string, content: string) {
    try {
      const userChat = await this.chatsService.getOrCreateChat(userId);
      return this.messagesService.sendSystemMessage(userChat.id, content, requestId);
    } catch (err) {
      this.logger.error(`Failed to send request system message for ${requestId}: ${err.message}`);
    }
  }

  /**
   * Accumulate wallet amount on approval and check for auto-rotation.
   * Best-effort: never fails the approval.
   */
  private async handleWalletAccumulation(walletId: string | null, amount: number, requestId: string) {
    if (!walletId) return;

    // Guard against double-accumulation: check if this request was already accumulated
    const existing = await this.prisma.requestStatusHistory.findFirst({
      where: { requestId, metadata: { path: ['walletAccumulated'], equals: true } },
    });
    if (existing) {
      this.logger.warn(`Wallet already accumulated for request ${requestId}, skipping`);
      return;
    }
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.paymentsService.accumulateAndCheckRotation(walletId, amount);

        // Emit wallet_updated for the accumulated wallet
        const updatedWallet = await this.paymentsService.getWalletById(walletId);
        if (updatedWallet) {
          this.operatorGateway.emitToAll('wallet_updated', updatedWallet);
        }

        if (result.rotated) {
          this.operatorGateway.emitToAll('wallet_selected', {
            wallet: result.newWallet,
            reason: 'auto_rotation',
            previousWalletId: walletId,
            timestamp: new Date().toISOString(),
          });
        }

        if (result.allFull) {
          this.operatorGateway.emitToAll('wallets_all_full', {
            timestamp: new Date().toISOString(),
            message: 'Todas las billeteras superaron su límite',
          });
        }

        // Record that wallet was accumulated for this request (dedup marker)
        await this.prisma.requestStatusHistory.create({
          data: {
            requestId,
            status: 'APPROVED',
            changedBy: 'system-wallet',
            metadata: { walletAccumulated: true, walletId, amount },
          },
        }).catch(err => this.logger.error(`Failed to record wallet accumulation marker: ${err.message}`));

        return;
      } catch (err: any) {
        if (err.code === 'P2034' && attempt < MAX_RETRIES) {
          this.logger.warn(`Wallet accumulation serialization conflict for request ${requestId}, retrying...`);
          continue;
        }
        this.logger.error(`Wallet accumulation failed for request ${requestId}: ${err.message}`);
        return;
      }
    }
  }

  // ==========================================
  // CLIENT ENDPOINTS
  // ==========================================

  async create(userId: string, dto: CreateRequestDto) {
    this.logger.log(`Creating request for user ${userId}`, dto);

    // Fetch user to get their username and panel assignment
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, isActive: true, panelId: true },
    });

    if (!user || !user.username) {
      throw new BadRequestException(
        'Tu cuenta no tiene un nombre de usuario configurado. Por favor, contacta a soporte.',
      );
    }

    // Blacklist check: banned users cannot create requests
    if (!user.isActive) {
      throw new ForbiddenException('Tu cuenta ha sido deshabilitada. Contacta a soporte.');
    }

    // TypeScript now knows user.username is non-null
    const targetUsername: string = user.username;

    // Check for pending requests from same user
    const pendingCount = await this.prisma.request.count({
      where: {
        userId,
        status: {
          in: ['PENDING_PROOF', 'VALIDATING', 'PENDING_MP_VERIFICATION', 'APPROVED', 'PROCESSING'],
        },
      },
    });

    if (pendingCount >= 1) {
      throw new BadRequestException(
        'Ya tenés una carga en proceso. Esperá a que se complete.',
      );
    }

    // Check rate limit (max requests per hour)
    const rateLimit = await this.settingsService.checkUserRateLimit(userId);
    if (!rateLimit.allowed) {
      const minutesUntilReset = Math.max(1, Math.ceil(
        (rateLimit.resetAt.getTime() - Date.now()) / 60000,
      ));
      throw new BadRequestException(
        `Límite de solicitudes excedido. Intenta de nuevo en ${minutesUntilReset} minutos.`,
      );
    }

    // Defense-in-depth: service-level amount guard
    // Allow amount=0 only when autoDetectAmount is true (AI will extract from proof)
    if (dto.amount <= 0 && !dto.autoDetectAmount) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Enforce maximum request amount
    if (dto.amount > 0) {
      const settings = await this.settingsService.getSystemSettings();
      if (dto.amount > settings.maxRequestAmount) {
        throw new BadRequestException(
          `El monto máximo por solicitud es $${settings.maxRequestAmount.toLocaleString('es-AR')}`,
        );
      }
    }

    // Capture the currently selected wallet so we know which one the user will see
    const selectedWallet = await this.paymentsService.getSelectedWallet();

    if (!selectedWallet) {
      throw new BadRequestException(
        'No hay billetera configurada. Contacte al operador.',
      );
    }

    // Use the user's username as the targetUsername (they're the same!)
    const request = await this.prisma.$transaction(async (tx) => {
      const newRequest = await tx.request.create({
        data: {
          userId,
          targetUsername,
          amount: Math.floor(dto.amount),
          status: 'PENDING_PROOF',
          walletId: selectedWallet.id,
          panelId: user.panelId || null, // Copy from user (may be null until discovery)
        },
        include: {
          user: { select: { id: true, username: true, email: true } },
        },
      });

      // Record initial status in history
      await tx.requestStatusHistory.create({
        data: {
          requestId: newRequest.id,
          status: 'PENDING_PROOF',
          metadata: { initialRequest: true },
        },
      });

      return newRequest;
    });

    // Get (or create) the user's persistent chat — all request messages go here
    const userChat = await this.chatsService.getOrCreateChat(userId);

    // Send initial system message tagged with the new requestId
    this.messagesService.sendSystemMessage(
      userChat.id,
      `Solicitud creada por $${Number(request.amount).toLocaleString('es-AR')}. Esperando comprobante de pago.`,
      request.id,
    ).catch(err => this.logger.error(`Initial system message failed: ${err.message}`));

    this.events.emitRequestCreated(userId, {
      requestId: request.id,
      status: request.status,
      targetUsername: request.targetUsername,
      amount: Number(request.amount),
    });

    this.events.emitDashboardUpdate();

    return { ...request, chat: { id: userChat.id } };
  }

  async findAllByUser(userId: string) {
    const requests = await this.prisma.request.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        job: { select: { id: true, status: true } },
        chat: {
          select: {
            id: true,
            _count: {
              select: {
                messages: {
                  where: { isRead: false, senderId: { not: userId } },
                },
              },
            },
          },
        },
      },
    });

    return requests.map((r) => ({
      ...r,
      unreadCount: r.chat?._count?.messages ?? 0,
      chat: r.chat ? { id: r.chat.id } : null,
    }));
  }

  /**
   * Find the user's current active request (if any)
   */
  async findActiveForUser(userId: string) {
    return this.prisma.request.findFirst({
      where: {
        userId,
        status: {
          in: ['PENDING_PROOF', 'VALIDATING', 'PENDING_MP_VERIFICATION', 'APPROVED', 'PROCESSING'],
        },
      },
      include: {
        chat: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId?: string) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true } },
        job: true,
        chat: { select: { id: true } }, // Include chatId for message routing
      },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    // If userId provided, check ownership
    if (userId && request.userId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta solicitud');
    }

    return request;
  }

  async uploadProof(requestId: string, userId: string, proofUrl: string, proofHash: string) {
    // Fix 5: Use Serializable transaction to prevent concurrent proof uploads
    let updated: any;
    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
            select: { id: true, status: true, userId: true },
          });

          if (!request) {
            throw new NotFoundException('Solicitud no encontrada');
          }

          if (request.userId !== userId) {
            throw new ForbiddenException('No tienes acceso a esta solicitud');
          }

          if (request.status !== 'PENDING_PROOF' && request.status !== 'VALIDATION_FAILED') {
            throw new BadRequestException('Esta solicitud ya tiene un comprobante');
          }

          // Check for duplicate proof — block if used in ANY non-terminal request (same or different user)
          const duplicate = await tx.request.findFirst({
            where: {
              proofHash,
              id: { not: requestId },
              status: {
                notIn: ['CANCELLED', 'REJECTED'],
              },
            },
            select: { id: true, status: true, userId: true, createdAt: true },
          });

          if (duplicate) {
            const isSameUser = duplicate.userId === userId;
            this.logger.warn(
              `Duplicate proof detected: hash=${proofHash.slice(0, 16)}... ` +
              `original_request=${duplicate.id} status=${duplicate.status} ` +
              `same_user=${isSameUser}`,
            );
            throw new BadRequestException(
              isSameUser
                ? 'Ya usaste este comprobante en otra solicitud. Subí uno diferente.'
                : 'Este comprobante ya fue utilizado en otra solicitud. ' +
                  'Por favor, subí un comprobante diferente.',
            );
          }

          return tx.request.update({
            where: { id: requestId },
            data: {
              proofUrl,
              proofHash,
              proofUploadedAt: new Date(),
              status: 'VALIDATING',
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException('Otra operación en curso. Reintentá en unos segundos.');
      }
      throw error;
    }

    this.events.emitRequestUpdated(userId, {
      requestId: updated.id,
      status: updated.status,
    });

    this.events.emitDashboardUpdate();

    // Emit event for async validation (decoupled from PaymentsService via EventEmitter2)
    this.eventEmitter.emit(AppEvent.PAYMENT_PROOF_UPLOADED, {
      requestId,
    } satisfies PaymentProofUploadedEvent);

    return updated;
  }

  async cancel(requestId: string, userId: string) {
    const request = await this.findOne(requestId, userId);

    if (!['PENDING_PROOF', 'VALIDATING', 'VALIDATION_FAILED', 'PENDING_MP_VERIFICATION', 'APPROVED', 'CANCELLED'].includes(request.status)) {
      throw new BadRequestException(
        request.status === 'PROCESSING'
          ? 'La carga ya está en proceso, no se puede cancelar'
          : 'No se puede cancelar esta solicitud',
      );
    }

    // Already cancelled — idempotent
    if (request.status === 'CANCELLED') {
      return { success: true };
    }

    // If APPROVED, also cancel the associated QUEUED job (if any)
    if (request.status === 'APPROVED') {
      await this.prisma.job.updateMany({
        where: { requestId, status: 'QUEUED' },
        data: { status: 'FAILED', error: 'Cancelada por el usuario' },
      });
    }

    const updated = await this.prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        rejectionReason: 'Cancelada por el usuario',
      },
      include: { user: { select: { id: true, email: true } } },
    });

    // Notify operators in real-time
    this.events.emitToOperators('request_status_update', {
      requestId,
      status: 'CANCELLED',
      updatedAt: updated.updatedAt,
    });

    return { success: true };
  }

  // ==========================================
  // OPERATOR ENDPOINTS
  // ==========================================

  async findPending() {
    return this.prisma.request.findMany({
      where: {
        status: { in: ['PENDING_PROOF', 'VALIDATING', 'APPROVED'] },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, email: true } },
        job: { select: { id: true, status: true } },
      },
    });
  }

  async findFailedValidation() {
    return this.prisma.request.findMany({
      where: { status: 'VALIDATION_FAILED' },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, email: true } },
      },
    });
  }

  async findAll(options?: { status?: RequestStatus; limit?: number; offset?: number }) {
    return this.prisma.request.findMany({
      where: options?.status ? { status: options.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
      include: {
        user: { select: { id: true, email: true } },
        job: { select: { id: true, status: true } },
        approvedBy: { select: { id: true, email: true } },
      },
    });
  }

  async approve(requestId: string, operatorId: string, dto?: ApproveRequestDto) {
    // Fix 33: Use Serializable transaction to prevent two operators approving simultaneously
    let updated: any;
    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
          });

          if (!request) {
            throw new NotFoundException('Solicitud no encontrada');
          }

          if (!['VALIDATING', 'VALIDATION_FAILED', 'PENDING_MP_VERIFICATION'].includes(request.status)) {
            throw new BadRequestException('Esta solicitud no puede ser aprobada');
          }

          // If operator approved with a different (extracted) amount, update it
          const originalAmount = Number(request.amount);
          const useApprovedAmount = dto?.approvedAmount !== undefined
            && dto.approvedAmount > 0
            && dto.approvedAmount !== originalAmount;

          // Validate approvedAmount: cannot exceed original amount
          if (useApprovedAmount) {
            const approvedAmt = dto.approvedAmount!;
            if (approvedAmt > originalAmount) {
              throw new BadRequestException(
                `El monto aprobado ($${approvedAmt}) no puede superar el monto solicitado ($${originalAmount})`,
              );
            }
          }

          // Atomically update status + approval fields + record history
          const updatedRequest = await tx.request.update({
            where: { id: requestId },
            data: {
              status: 'APPROVED',
              manuallyApproved: true,
              approvedById: operatorId,
              approvedAt: new Date(),
              ...(useApprovedAmount ? { amount: dto.approvedAmount } : {}),
            },
          });

          await tx.requestStatusHistory.create({
            data: {
              requestId,
              status: 'APPROVED',
              changedBy: operatorId,
              metadata: {
                manualApproval: true,
                note: dto?.note,
                ...(useApprovedAmount ? { originalAmount, approvedAmount: dto.approvedAmount } : {}),
              },
            },
          });

          return updatedRequest;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException('Esta solicitud fue modificada por otro operador. Reintentá.');
      }
      throw error;
    }

    this.logger.log(`Request ${requestId} approved by operator ${operatorId}`);

    // Send system message to chat
    // Send system message to user's persistent chat
    this.sendRequestSystemMessage(
      requestId,
      updated.userId,
      'Pago aprobado manualmente por un operador. Procesando carga de fichas...',
    );

    // After commit: emit events, send notification, create job


    this.events.emitRequestUpdated(updated.userId, {
      requestId: updated.id,
      status: 'APPROVED',
    });

    this.events.emitDashboardUpdate();

    // Accumulate wallet amount and check for auto-rotation
    try {
      await this.handleWalletAccumulation(updated.walletId, Number(updated.amount), requestId);
    } catch (walletError) {
      this.logger.error(`Wallet accumulation failed for request ${requestId}: ${walletError.message}`);
      this.operatorGateway.emitToAll('wallet_accumulation_failed', {
        requestId,
        walletId: updated.walletId,
        amount: Number(updated.amount),
        error: walletError.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Auto-create job for the approved request (Fix 15)
    try {
      await this.jobsService.createJobForRequest(requestId);
      this.logger.log(`Job auto-created for approved request ${requestId}`);
    } catch (jobError: any) {
      // Request is APPROVED but no Job exists — inconsistent state. Operator must intervene.
      this.logger.error(
        `CRITICAL: Approved request ${requestId} but job creation failed: ${jobError.message}. Request remains APPROVED — operator must retry or reject manually.`,
      );
      // Use the standard system:alert channel (same as JobsService.handleValidationCompleted)
      // so operator-panel surfaces this in its alerts queue, not as a one-off event.
      this.operatorGateway.emitToAll('system:alert', {
        type: 'JOB_CREATION_FAILED',
        severity: 'critical',
        requestId,
        userId: updated.userId,
        amount: Number(updated.amount),
        error: jobError.message,
        message: `Aprobación ${requestId.slice(0, 8)} sin job — intervención manual requerida`,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  async reject(requestId: string, operatorId: string, dto: RejectRequestDto) {
    // Fix 33: Use Serializable transaction to prevent concurrent approve+reject
    let updated: any;
    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
          });

          if (!request) {
            throw new NotFoundException('Solicitud no encontrada');
          }

          if (!['VALIDATING', 'VALIDATION_FAILED', 'APPROVED'].includes(request.status)) {
            throw new BadRequestException('Esta solicitud ya fue procesada');
          }

          const wasApproved = request.status === 'APPROVED';

          // Atomically update status + rejection fields + record history
          const updatedRequest = await tx.request.update({
            where: { id: requestId },
            data: {
              status: 'REJECTED',
              rejectionReason: dto.reason,
              approvedById: operatorId,
            },
          });

          await tx.requestStatusHistory.create({
            data: {
              requestId,
              status: 'REJECTED',
              changedBy: operatorId,
              metadata: { reason: dto.reason, wasApproved },
            },
          });

          // Attach wasApproved + walletId for post-commit wallet decrement
          (updatedRequest as any)._wasApproved = wasApproved;
          (updatedRequest as any)._walletId = request.walletId;
          (updatedRequest as any)._amount = Number(request.amount);

          return updatedRequest;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException('Esta solicitud fue modificada por otro operador. Reintentá.');
      }
      throw error;
    }

    this.logger.log(`Request ${requestId} rejected by operator ${operatorId}: ${dto.reason}`);

    // Send system message to chat with rejection reason
    // Send rejection message to user's persistent chat
    const rejectMsg = dto.reason
      ? `Solicitud rechazada. Motivo: ${dto.reason}`
      : 'Solicitud rechazada.';
    this.sendRequestSystemMessage(requestId, updated.userId, rejectMsg);

    // After commit: emit events, send notification


    this.events.emitRequestUpdated(updated.userId, {
      requestId: updated.id,
      status: 'REJECTED',
      reason: dto.reason,
    });

    // Emit dedicated rejection event so chat app can show specific rejection UI
    this.events.emitRequestRejected(updated.userId, {
      requestId: updated.id,
      status: 'REJECTED',
      reason: dto.reason,
    });

    // Native push notification — works even when the app is closed.
    this.pushService
      .sendToUser(
        updated.userId,
        'Solicitud rechazada',
        dto.reason ? `Motivo: ${dto.reason}` : 'Tu solicitud fue rechazada. Abrí la app para más detalle.',
        { requestId: updated.id, type: 'request_rejected' },
      )
      .catch((err: any) => this.logger.warn(`Push (reject) failed for user ${updated.userId}: ${err.message}`));

    this.events.emitDashboardUpdate();

    // Fix 9: Reverse wallet accumulation if request was previously APPROVED
    if ((updated as any)._wasApproved && (updated as any)._walletId) {
      try {
        await this.paymentsService.decrementWalletAmount(
          (updated as any)._walletId,
          (updated as any)._amount,
        );
        const wallet = await this.paymentsService.getWalletById((updated as any)._walletId);
        if (wallet) {
          this.operatorGateway.emitToAll('wallet_updated', wallet);
        }
        this.logger.log(`Wallet amount decremented for rejected request ${requestId}`);
      } catch (walletError) {
        this.logger.error(`Failed to decrement wallet for rejected request ${requestId}: ${walletError.message}`);
      }
    }

    return updated;
  }

  // ==========================================
  // VALIDATION RESULT (called by payments service)
  // ==========================================

  async setValidationResult(
    requestId: string,
    result: {
      valid: boolean;
      score: number;
      error?: string;
      details?: any;
    },
  ) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'VALIDATING') {
      this.logger.warn(
        `setValidationResult called for request ${requestId} in status ${request.status} — skipping (already processed)`,
      );
      return request;
    }

    // Check if this wallet requires payment verification (per-wallet setting)
    let walletRequiresVerification = false;
    if (request.walletId) {
      const wallet = await this.prisma.paymentConfig.findUnique({
        where: { id: request.walletId },
        select: { requiresVerification: true },
      });
      walletRequiresVerification = wallet?.requiresVerification ?? false;
    }
    const approvedStatus: RequestStatus = walletRequiresVerification ? 'PENDING_MP_VERIFICATION' : 'APPROVED';

    // Auto-detect amount: if request was created with amount=0, fill it from AI extraction
    const isAutoDetect = Number(request.amount) === 0;
    let autoDetectedAmount: number | undefined;

    if (isAutoDetect && result.valid) {
      const extracted = result.details?.extractedAmount;
      if (extracted && extracted > 0) {
        autoDetectedAmount = Math.floor(extracted);
        this.logger.log(`Auto-detect: extracted amount $${autoDetectedAmount} for request ${requestId}`);
      } else {
        // AI couldn't extract amount — mark as failed so operator can review
        result.valid = false;
        result.error = 'No se pudo detectar el monto del comprobante. Intentá cargando manualmente.';
        this.logger.warn(`Auto-detect: could not extract amount for request ${requestId}`);
      }
    }

    const newStatus: RequestStatus = result.valid ? approvedStatus : 'VALIDATION_FAILED';

    // Merge status update + validation fields + history record in a single transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.request.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          validationScore: result.score,
          validationError: result.error,
          validationDetails: result.details,
          extractedTransactionId: result.details?.transactionId || null,
          approvedAt: approvedStatus === 'APPROVED' ? new Date() : undefined,
          ...(autoDetectedAmount ? { amount: autoDetectedAmount } : {}),
        },
      });

      await tx.requestStatusHistory.create({
        data: {
          requestId,
          status: newStatus,
          changedBy: 'system-validator',
          metadata: {
            validationScore: result.score,
            validationError: result.error,
            autoValidation: true,
          },
        },
      });

      return updatedRequest;
    });

    // Post-commit: send system message to chat
    // Send status message to user's persistent chat
    const statusMsg = this.getStatusSystemMessage(newStatus);
    if (statusMsg) {
      this.sendRequestSystemMessage(requestId, request.userId, statusMsg);
    }

    this.events.emitRequestUpdated(request.userId, {
      requestId: updated.id,
      status: newStatus,
      validationScore: result.score,
    });

    this.events.emitDashboardUpdate();

    // Wallet accumulation: only if going straight to APPROVED (MP verification disabled)
    if (newStatus === 'APPROVED') {
      this.handleWalletAccumulation(request.walletId, Number(request.amount), requestId);
    }

    return updated;
  }

  // ==========================================
  // OPERATOR ASSIGNMENT
  // ==========================================

  async assignOperator(requestId: string, operatorId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (!['VALIDATION_FAILED', 'FAILED'].includes(request.status)) {
      throw new BadRequestException('Solo se pueden asignar solicitudes fallidas');
    }

    const updated = await this.prisma.request.update({
      where: { id: requestId },
      data: {
        assignedOperatorId: operatorId,
        assignedAt: new Date(),
      },
      include: {
        user: { select: { id: true, email: true } },
      },
    });

    this.logger.log(`Request ${requestId} assigned to operator ${operatorId}`);

    this.events.emitToOperators('request:assigned', {
      requestId,
      operatorId,
    });

    this.events.emitDashboardUpdate();

    return updated;
  }

  async unassignOperator(requestId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    const updated = await this.prisma.request.update({
      where: { id: requestId },
      data: {
        assignedOperatorId: null,
        assignedAt: null,
      },
    });

    this.logger.log(`Request ${requestId} unassigned`);

    this.events.emitToOperators('request:unassigned', {
      requestId,
    });

    this.events.emitDashboardUpdate();

    return updated;
  }

  async getAssignedToOperator(operatorId: string) {
    return this.prisma.request.findMany({
      where: {
        assignedOperatorId: operatorId,
        status: { in: ['VALIDATION_FAILED', 'FAILED'] },
      },
      orderBy: { assignedAt: 'asc' },
      include: {
        user: { select: { id: true, email: true } },
        job: { select: { id: true, status: true, error: true, screenshot: true } },
      },
    });
  }

  async getUnassignedFailures() {
    return this.prisma.request.findMany({
      where: {
        status: { in: ['VALIDATION_FAILED', 'FAILED'] },
        assignedOperatorId: null,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, email: true } },
        job: { select: { id: true, status: true, error: true, screenshot: true } },
      },
    });
  }

  // ==========================================
  // STATISTICS
  // ==========================================

  async getStats() {
    const [
      pending,
      validating,
      validationFailed,
      approved,
      processing,
      completed,
      failed,
      rejected,
      todayCompleted,
    ] = await Promise.all([
      this.prisma.request.count({ where: { status: 'PENDING_PROOF' } }),
      this.prisma.request.count({ where: { status: 'VALIDATING' } }),
      this.prisma.request.count({ where: { status: 'VALIDATION_FAILED' } }),
      this.prisma.request.count({ where: { status: 'APPROVED' } }),
      this.prisma.request.count({ where: { status: 'PROCESSING' } }),
      this.prisma.request.count({ where: { status: 'COMPLETED' } }),
      this.prisma.request.count({ where: { status: 'FAILED' } }),
      this.prisma.request.count({ where: { status: 'REJECTED' } }),
      this.prisma.request.count({
        where: {
          status: 'COMPLETED',
          updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return {
      pending,
      validating,
      validationFailed,
      approved,
      processing,
      completed,
      failed,
      rejected,
      todayCompleted,
    };
  }

  // ==========================================
  // REQUEST-CONTEXTUAL CHAT
  // ==========================================

  /**
   * Get or create a chat associated with a request
   * Returns the chat ID for message operations
   */
  async getOrCreateRequestChat(
    requestId: string,
    userId: string,
    userRole: string,
  ): Promise<string> {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { chat: true },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    // Check access: user must be owner or operator
    const isOwner = request.userId === userId;
    const isOperator = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(userRole);

    if (!isOwner && !isOperator) {
      throw new ForbiddenException('No tienes acceso a esta solicitud');
    }

    // If request already has a dedicated per-request chat (old data), return it
    if (request.chat) {
      return request.chat.id;
    }

    // For new requests (unified chat model), return the user's persistent chat
    const userChat = await this.chatsService.getOrCreateChat(request.userId);
    return userChat.id;
  }

  // ==========================================
  // STATUS → SYSTEM MESSAGE MAPPING
  // ==========================================

  private getStatusSystemMessage(status: RequestStatus): string | null {
    const map: Partial<Record<RequestStatus, string>> = {
      VALIDATING: 'Validando comprobante de pago...',
      PENDING_MP_VERIFICATION: 'Comprobante validado. Verificando recepción del pago...',
      APPROVED: 'Pago verificado. Procesando carga de fichas...',
      PROCESSING: 'Cargando fichas en tu cuenta...',
      COMPLETED: 'Fichas cargadas exitosamente!',
      FAILED: 'Error al cargar fichas. Un operador va a revisar tu caso.',
      VALIDATION_FAILED: 'No pudimos validar el comprobante. Un operador va a revisar tu solicitud.',
      REJECTED: 'Solicitud rechazada.',
    };
    return map[status] || null;
  }

  // ==========================================
  // STATUS HISTORY & TIMELINE
  // ==========================================

  /**
   * Update request status and record in history
   * Use this helper method for all status changes to ensure history is tracked
   */
  async updateRequestStatus(
    requestId: string,
    newStatus: RequestStatus,
    changedBy?: string,
    metadata?: any,
  ) {
    // Validate status transition
    const currentRequest = await this.prisma.request.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    if (currentRequest) {
      const allowedTransitions = RequestsService.VALID_TRANSITIONS[currentRequest.status] || [];
      if (!allowedTransitions.includes(newStatus)) {
        this.logger.warn(
          `Invalid status transition for request ${requestId}: ${currentRequest.status} → ${newStatus}. Allowed: ${allowedTransitions.join(', ')}`,
        );
        throw new BadRequestException(
          `Transición de estado inválida: ${currentRequest.status} → ${newStatus}`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update request status
      const updatedRequest = await tx.request.update({
        where: { id: requestId },
        data: { status: newStatus },
      });

      // Record status change in history
      await tx.requestStatusHistory.create({
        data: {
          requestId,
          status: newStatus,
          changedBy,
          metadata,
        },
      });

      return updatedRequest;
    });

    // Send system message to user's persistent chat
    const statusMsg2 = this.getStatusSystemMessage(newStatus);
    if (statusMsg2) {
      this.sendRequestSystemMessage(requestId, updated.userId, statusMsg2);
    }

    return updated;
  }

  /**
   * Get status change timeline for a request
   */
  async getRequestTimeline(requestId: string, userId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      select: { userId: true },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    // Only allow owner to view timeline
    if (request.userId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta solicitud');
    }

    const timeline = await this.prisma.requestStatusHistory.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
    });

    return timeline;
  }

  // ==========================================
  // EVENT LISTENERS (decoupled from bot.service)
  // ==========================================

  @OnEvent(AppEvent.JOB_STARTED)
  async onJobStarted(event: { jobId: string; requestId: string; userId: string }) {
    this.logger.log(`[Event] job.started — requestId=${event.requestId}, jobId=${event.jobId}`);
    try {
      await this.updateRequestStatus(event.requestId, 'PROCESSING', 'system-bot', {
        jobId: event.jobId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update request ${event.requestId} to PROCESSING: ${error.message}`,
      );
    }
  }

  @OnEvent(AppEvent.JOB_COMPLETED)
  async onJobCompleted(event: { requestId: string; jobId: string }) {
    this.logger.log(`[Event] job.completed — requestId=${event.requestId}, jobId=${event.jobId}`);
    try {
      await this.updateRequestStatus(event.requestId, 'COMPLETED', 'system-bot', {
        jobId: event.jobId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update request ${event.requestId} to COMPLETED: ${error.message}`,
      );
    }
  }

  @OnEvent(AppEvent.JOB_FAILED)
  async onJobFailed(event: { requestId: string; jobId: string; error?: string }) {
    this.logger.log(`[Event] job.failed — requestId=${event.requestId}, jobId=${event.jobId}`);
    try {
      await this.updateRequestStatus(event.requestId, 'FAILED', 'system-bot', {
        jobId: event.jobId,
        error: event.error,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update request ${event.requestId} to FAILED: ${error.message}`,
      );
    }
  }
}
