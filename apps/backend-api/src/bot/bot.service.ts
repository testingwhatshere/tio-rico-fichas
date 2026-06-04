import { Injectable, Logger, NotFoundException, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { BalanceService } from '../balance/balance.service';
import { BotGateway } from './bot.gateway';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../notifications/telegram.service';
import { JobStatus, RequestStatus, JobType } from '@prisma/client';
import { JobResultDto, JobProgressDto, BotStatusDto, HeartbeatDto } from './dto';
import { STALE_PROGRESS_MS, BOT_HEARTBEAT_TIMEOUT_MS } from '../common/constants/timeouts';
import { PrizeClaimsService } from '../prize-claims/prize-claims.service';
import { ChatsService } from '../chats/chats.service';
import { MessagesService } from '../messages/messages.service';
import { AppEvent, JobCompletedEvent, JobFailedEvent, JobStartedEvent } from '../common/events/app-events';

// Bot state (in-memory, will be reset on server restart)
export interface BotState {
  status: 'online' | 'offline' | 'busy' | 'error' | 'unknown';
  lastHeartbeat: Date | null;
  lastJobId: string | null;
  version: string | null;
  uptime: number | null;
}

// Job progress tracking (in-memory)
export interface JobProgress {
  step: string;
  progress: number;
  details?: Record<string, any>;
  updatedAt: Date;
}

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  // Per-panel bot states (panelId → BotState)
  private botStates: Map<string, BotState> = new Map();
  // Legacy single state (fallback for non-panel-aware callers)
  private botState: BotState = {
    status: 'unknown',
    lastHeartbeat: null,
    lastJobId: null,
    version: null,
    uptime: null,
  };
  private jobProgress: Map<string, JobProgress> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly balanceService: BalanceService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
    private readonly telegramService: TelegramService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Restore bot state from database on startup
   */
  async onModuleInit() {
    try {
      const keys = ['BOT_STATUS', 'BOT_LAST_HEARTBEAT', 'BOT_LAST_JOB_ID', 'BOT_VERSION'];
      const settings = await this.prisma.setting.findMany({
        where: { key: { in: keys } },
      });

      const map = new Map(settings.map((s) => [s.key, s.value]));

      if (map.has('BOT_STATUS')) {
        const status = map.get('BOT_STATUS') as BotState['status'];
        // If it was 'online' or 'busy' before restart, mark as unknown (needs heartbeat to confirm)
        this.botState.status = (status === 'online' || status === 'busy') ? 'unknown' : status;
      }
      if (map.has('BOT_LAST_HEARTBEAT')) {
        this.botState.lastHeartbeat = new Date(map.get('BOT_LAST_HEARTBEAT')!);
      }
      if (map.has('BOT_LAST_JOB_ID')) {
        this.botState.lastJobId = map.get('BOT_LAST_JOB_ID')!;
      }
      if (map.has('BOT_VERSION')) {
        this.botState.version = map.get('BOT_VERSION')!;
      }

      this.logger.log(`Bot state restored from DB: status=${this.botState.status}`);
    } catch (error) {
      this.logger.warn(`Failed to restore bot state from DB: ${error.message}`);
    }
  }

  /**
   * Persist bot state to database (fire-and-forget)
   */
  private async persistBotState() {
    try {
      const entries: { key: string; value: string }[] = [
        { key: 'BOT_STATUS', value: this.botState.status },
      ];
      if (this.botState.lastHeartbeat) {
        entries.push({ key: 'BOT_LAST_HEARTBEAT', value: this.botState.lastHeartbeat.toISOString() });
      }
      if (this.botState.lastJobId) {
        entries.push({ key: 'BOT_LAST_JOB_ID', value: this.botState.lastJobId });
      }
      if (this.botState.version) {
        entries.push({ key: 'BOT_VERSION', value: this.botState.version });
      }

      await this.prisma.$transaction(
        entries.map(({ key, value }) =>
          this.prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(`Failed to persist bot state: ${error.message}`);
    }
  }

  /**
   * Handle job result from bot
   */
  async handleJobResult(jobId: string, dto: JobResultDto) {
    this.logger.log(`Received job result for ${jobId}: success=${dto.success}`);

    // Find the job
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { request: true, prizeClaim: true },
    });

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Fix 22: Idempotency guard — skip if job already has a final status
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      this.logger.warn(
        `Job ${jobId} already in final state ${job.status}, ignoring duplicate result`,
      );
      return { success: true, message: 'Job result already processed (idempotent)' };
    }

    // Update job status
    const newStatus = dto.success ? JobStatus.COMPLETED : JobStatus.FAILED;

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: newStatus,
        completedAt: new Date(),
        result: dto.success ? { success: true } : undefined,
        error: dto.error || undefined,
        screenshot: dto.screenshotPath || undefined,
      },
    });

    // Handle WITHDRAW_CHIPS jobs (prize claims) separately
    if (job.type === 'WITHDRAW_CHIPS') {
      if (job.prizeClaim) {
        try {
          const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, { strict: false });
          if (!prizeClaimsService) {
            this.logger.error(`PrizeClaimsService not available — cannot process withdrawal result for job ${jobId}`);
          } else {
            await prizeClaimsService.handleWithdrawalResult(job.prizeClaim.id, dto.success, dto.error);
          }
        } catch (error: any) {
          this.logger.error(`Failed to handle prize withdrawal result: ${error.message}`);
        }
      } else {
        this.logger.error(`WITHDRAW_CHIPS job ${jobId} has no associated prize claim`);
      }

      // Clear progress, update bot state, mark panel idle
      this.jobProgress.delete(jobId);
      this.botState.lastJobId = jobId;
      this.botState.status = 'online';
      this.persistBotState();
      if (job.panelId) {
        this.botGateway.markPanelIdle(job.panelId);
        this.updatePanelState(job.panelId, { status: 'online', lastJobId: jobId });
      }
      this.eventsGateway.emitDashboardUpdate();

      // Try dispatch next job
      if (job.panelId) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, { jobId, panelId: job.panelId });
      }

      return { success: true, message: 'Withdrawal job result recorded' };
    }

    // Handle CHANGE_PASSWORD jobs
    if (job.type === 'CHANGE_PASSWORD') {
      // Clear newPassword from DB immediately (security)
      await this.prisma.job.update({
        where: { id: jobId },
        data: { newPassword: null },
      });

      // Send system message to user's chat
      if (job.requestingUserId) {
        try {
          const chatsService = this.moduleRef.get(ChatsService, { strict: false });
          const messagesService = this.moduleRef.get(MessagesService, { strict: false });
          const chat = await chatsService.getOrCreateChat(job.requestingUserId);
          const msg = dto.success
            ? '✅ Tu contraseña fue cambiada con éxito. Ya podés usar la nueva contraseña para ingresar.'
            : `❌ No se pudo cambiar tu contraseña. ${dto.error || 'Contacta a soporte para más información.'}`;
          await messagesService.sendSystemMessage(chat.id, msg);
        } catch (err) {
          this.logger.warn(`Failed to send password change notification: ${err.message}`);
        }
      }

      // Clear progress, update bot state, mark panel idle
      this.jobProgress.delete(jobId);
      this.botState.lastJobId = jobId;
      this.botState.status = 'online';
      this.persistBotState();
      if (job.panelId) {
        this.botGateway.markPanelIdle(job.panelId);
        this.updatePanelState(job.panelId, { status: 'online', lastJobId: jobId });
      }
      this.eventsGateway.emitDashboardUpdate();

      if (job.panelId) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, { jobId, panelId: job.panelId });
      }

      return { success: true, message: 'Password change job result recorded' };
    }

    // Handle CREATE_USER jobs
    if (job.type === 'CREATE_USER') {
      // Clear newPassword from DB immediately (security)
      await this.prisma.job.update({
        where: { id: jobId },
        data: { newPassword: null },
      });

      // Notify operators
      try {
        const msg = dto.success
          ? `Usuario "${job.targetUsername}" creado en el panel con contraseña 123casino.`
          : `Error al crear usuario "${job.targetUsername}": ${dto.error || 'Error desconocido'}`;
        this.logger.log(msg);
      } catch (err) {
        this.logger.warn(`Failed to send create user notification: ${err.message}`);
      }

      // Clear progress, update bot state, mark panel idle
      this.jobProgress.delete(jobId);
      this.botState.lastJobId = jobId;
      this.botState.status = 'online';
      this.persistBotState();
      if (job.panelId) {
        this.botGateway.markPanelIdle(job.panelId);
        this.updatePanelState(job.panelId, { status: 'online', lastJobId: jobId });
      }
      this.eventsGateway.emitDashboardUpdate();

      if (job.panelId) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, { jobId, panelId: job.panelId });
      }

      return { success: true, message: 'Create user job result recorded' };
    }

    // Update request status directly (critical path — must not be lost)
    if (!job.requestId) {
      this.logger.error(`Job ${jobId} has no requestId — cannot update request status`);
      return { success: true, message: 'Job result recorded (no request)' };
    }
    const requestStatus: RequestStatus = dto.success ? 'COMPLETED' : 'FAILED';
    await this.prisma.request.update({
      where: { id: job.requestId },
      data: { status: requestStatus },
    });

    // Add balance on successful completion
    // Fix 35B: Use try/catch on P2002 (unique constraint on Transaction.requestId)
    // instead of check-then-act to prevent double-addition from concurrent completions
    if (dto.success && job.request) {
      try {
        await this.balanceService.addBalance(
          job.request.userId,
          Number(job.request.amount),
          job.requestId,
          `Carga de fichas completada - ${job.request.targetUsername}`,
        );
        this.logger.log(
          `Balance added: $${job.request.amount} to user ${job.request.userId}`,
        );
      } catch (error: any) {
        // P2002 = unique constraint violation on Transaction.requestId → balance already added
        const isP2002 = error.code === 'P2002' || error?.cause?.code === 'P2002';
        if (isP2002) {
          // Defensive verification: confirm the Transaction actually exists. If the prior
          // attempt rolled back after partial state, P2002 could appear without a real
          // dedup row — that would silently lose a balance addition. Alert ops on that.
          const existing = await this.prisma.transaction.findUnique({
            where: { requestId: job.requestId },
            select: { id: true, amount: true },
          });
          if (existing) {
            this.logger.warn(
              `Balance already added for request ${job.requestId} (concurrent completion), skipping`,
            );
          } else {
            this.logger.error(
              `P2002 on balance add for request ${job.requestId} but no Transaction found — possible lost balance`,
            );
            this.eventsGateway.emitToOperators('balance_error', {
              requestId: job.requestId,
              userId: job.request.userId,
              amount: Number(job.request.amount),
              error: 'P2002 without dedup row — manual review required',
              timestamp: new Date().toISOString(),
            });
          }
        } else {
          this.logger.error(
            `Failed to add balance for request ${job.requestId}: ${error.message}`,
          );
          // Alert operators so they can manually fix the balance
          this.eventsGateway.emitToOperators('balance_error', {
            requestId: job.requestId,
            userId: job.request.userId,
            amount: Number(job.request.amount),
            error: error.message,
            timestamp: new Date().toISOString(),
          });
        }
        // Don't throw - job still completed successfully, balance can be added manually
      }
    } else if (dto.success && !job.request) {
      this.logger.error(`Job ${jobId} completed but request is missing — cannot add balance`);
    }

    // Clear progress tracking
    this.jobProgress.delete(jobId);

    // Update bot state and persist
    this.botState.lastJobId = jobId;
    this.botState.status = 'online';
    this.persistBotState();

    // Mark panel as idle (job finished)
    if (job.panelId) {
      this.botGateway.markPanelIdle(job.panelId);
      this.updatePanelState(job.panelId, { status: 'online', lastJobId: jobId });
    }

    this.logger.log(
      `Job ${jobId} ${dto.success ? 'completed successfully' : 'failed'}: ${dto.error || 'No error'}`,
    );

    // Emit real-time events (guard against deleted request)
    if (job.request) {
      const eventData = {
        jobId,
        requestId: job.requestId,
        targetUsername: job.request.targetUsername,
        amount: Number(job.request.amount),
        error: dto.error,
      };

      if (dto.success) {
        this.eventsGateway.emitJobCompleted(job.request.userId, eventData);
        this.eventsGateway.emitRequestCompleted(job.request.userId, {
          requestId: job.requestId,
          status: 'COMPLETED',
        });
      } else {
        this.eventsGateway.emitJobFailed(job.request.userId, eventData);
        this.telegramService.alertJobFailed(jobId, dto.error || 'Unknown error', job.request?.targetUsername).catch((e) => this.logger.warn(`Telegram alert failed: ${e.message}`));
      }
    } else {
      this.logger.error(`Job ${jobId} completed but request relation is missing — skipping event emission`);
    }

    this.eventsGateway.emitDashboardUpdate();

    // Emit event for side effects (request history, next job dispatch, push notifications)
    if (job.request) {
      if (dto.success) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, {
          jobId,
          requestId: job.requestId,
          userId: job.request.userId,
          targetUsername: job.request.targetUsername,
          amount: Number(job.request.amount),
        } satisfies JobCompletedEvent);
      } else {
        this.eventEmitter.emit(AppEvent.JOB_FAILED, {
          jobId,
          requestId: job.requestId,
          userId: job.request.userId,
          targetUsername: job.request.targetUsername,
          amount: Number(job.request.amount),
          error: dto.error,
        } satisfies JobFailedEvent);
      }
    }

    return { success: true, message: 'Job result recorded' };
  }

  /**
   * Handle job started notification from bot
   */
  async handleJobStarted(jobId: string, startedAt?: string) {
    this.logger.log(`Job ${jobId} started`);

    // Atomic claim: only update if still QUEUED (prevents two bots from both claiming)
    const claimed = await this.prisma.job.updateMany({
      where: { id: jobId, status: JobStatus.QUEUED },
      data: {
        status: JobStatus.PROCESSING,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
      },
    });

    if (claimed.count === 0) {
      // Either job doesn't exist or was already moved to PROCESSING by the dispatcher
      const existingJob = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!existingJob) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }
      // If already PROCESSING, this is the same bot confirming start (dispatcher already set PROCESSING)
      // Only flag alreadyClaimed if job is in a terminal state (COMPLETED/FAILED) — meaning another bot finished it
      if (existingJob.status === 'PROCESSING') {
        this.logger.log(`Job ${jobId} already PROCESSING (set by dispatcher), confirming start`);
        // Update startedAt if not set
        await this.prisma.job.update({
          where: { id: jobId },
          data: { startedAt: startedAt ? new Date(startedAt) : new Date() },
        }).catch(() => {});
        // Fall through to emit events below — do NOT return alreadyClaimed
      } else {
        this.logger.warn(`Job ${jobId} in terminal state ${existingJob.status}, another bot already handled it`);
        return { success: true, message: 'Job already completed/failed by another bot', alreadyClaimed: true };
      }
    }

    // Update request status
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { type: true, panelId: true, request: { select: { id: true, userId: true } } },
    });

    if (job?.request) {
      // Update request status directly (critical path)
      await this.prisma.request.update({
        where: { id: job.request.id },
        data: { status: 'PROCESSING' },
      });

      // Emit job started event (include userId so users receive it)
      this.eventsGateway.emitJobStarted(
        {
          jobId,
          requestId: job.request.id,
        },
        job.request.userId,
      );

      // Emit event for side effects (request history, push notifications)
      this.eventEmitter.emit(AppEvent.JOB_STARTED, {
        jobId,
        requestId: job.request.id,
        userId: job.request.userId,
      } satisfies JobStartedEvent);
    } else if (job?.type === 'WITHDRAW_CHIPS') {
      // WITHDRAW_CHIPS jobs don't have a request — prize claim tracks its own status
      this.logger.log(`WITHDRAW_CHIPS job ${jobId} started`);
    }

    // Update bot state
    this.botState.status = 'busy';
    this.botState.lastJobId = jobId;

    // Mark panel as busy
    const fullJob = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { panelId: true },
    });
    if (fullJob?.panelId) {
      this.botGateway.markPanelBusy(fullJob.panelId);
      this.updatePanelState(fullJob.panelId, { status: 'busy', lastJobId: jobId });
    }

    // Initialize progress tracking
    this.jobProgress.set(jobId, {
      step: 'starting',
      progress: 0,
      updatedAt: new Date(),
    });

    this.eventsGateway.emitDashboardUpdate();

    return { success: true, message: 'Job start acknowledged' };
  }

  /**
   * Handle job progress update from bot
   */
  async handleJobProgress(jobId: string, dto: JobProgressDto) {
    this.logger.debug(`Job ${jobId} progress: ${dto.step} (${dto.progress}%)`);

    // Store progress in memory
    this.jobProgress.set(jobId, {
      step: dto.step,
      progress: dto.progress,
      details: dto.details,
      updatedAt: new Date(),
    });

    // Look up userId so progress events reach end users
    let userId: string | undefined;
    try {
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        include: { request: { select: { userId: true } } },
      });
      userId = job?.request?.userId;
    } catch (error) {
      this.logger.warn(`Failed to look up userId for job progress ${jobId}: ${error.message}`);
    }

    // Emit real-time progress update (to operators and user)
    this.eventsGateway.emitJobProgress(
      {
        jobId,
        step: dto.step,
        progress: dto.progress,
        details: dto.details,
      },
      userId,
    );

    return { success: true };
  }

  /**
   * Get current progress for a job
   */
  getJobProgress(jobId: string): JobProgress | null {
    return this.jobProgress.get(jobId) || null;
  }

  /**
   * List available panels (for extension options dropdown)
   */
  async listPanels() {
    return this.prisma.panel.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Handle heartbeat from bot — optionally panel-aware
   */
  async handleHeartbeat(dto: HeartbeatDto, panelId?: string) {
    this.logger.debug(`Bot heartbeat received${panelId ? ` (panel ${panelId})` : ''}`);

    this.botState.lastHeartbeat = new Date();
    this.botState.status = 'online';
    if (dto.version) this.botState.version = dto.version;
    if (dto.uptime) this.botState.uptime = dto.uptime;
    this.persistBotState();

    // Update per-panel state
    if (panelId) {
      this.updatePanelState(panelId, {
        status: 'online',
        lastHeartbeat: new Date(),
        version: dto.version || null,
        uptime: dto.uptime || null,
      });
    }

    // Clean up stale progress entries (bot crash recovery)
    const now = Date.now();
    for (const [jobId, progress] of this.jobProgress.entries()) {
      if (now - progress.updatedAt.getTime() > STALE_PROGRESS_MS) {
        this.logger.warn(`Cleaning stale job progress: ${jobId} (last update: ${progress.updatedAt.toISOString()})`);
        this.jobProgress.delete(jobId);
      }
    }

    return {
      success: true,
      message: 'Heartbeat acknowledged',
      serverTime: new Date().toISOString(),
    };
  }

  // Track last alert time per panel to avoid spamming (5 min cooldown)
  private panelBalanceAlertCooldowns = new Map<string, number>();
  private panelBalanceAlertMuted = new Set<string>();

  /**
   * Handle panel balance report from extension.
   * Compares with configurable threshold and emits alert to operators.
   */
  async handlePanelBalance(balance: number, panelId?: string) {
    const key = panelId || 'default';

    // Persist last known balance so /fichas command can show it
    try {
      await this.settingsService.setSetting(`PANEL_BALANCE_${key.toUpperCase()}`, String(balance));
      await this.settingsService.setSetting(`PANEL_BALANCE_UPDATED_AT`, new Date().toISOString());
    } catch (err) {
      this.logger.warn(`Failed to persist panel balance: ${err.message}`);
    }

    // Skip if muted by operator
    if (this.panelBalanceAlertMuted.has(key)) {
      return { success: true, message: 'Alert muted' };
    }

    // Get threshold from settings (default 1000)
    let threshold = 1000;
    try {
      const val = await this.settingsService.getSetting('PANEL_BALANCE_THRESHOLD');
      if (val) threshold = parseFloat(val);
    } catch (err) {
      this.logger.warn(`Failed to read balance threshold setting: ${err.message}`);
    }

    if (balance > threshold) {
      return { success: true, message: 'Balance OK' };
    }

    // Cooldown: don't alert more than once every 5 minutes per panel
    const lastAlert = this.panelBalanceAlertCooldowns.get(key) || 0;
    if (Date.now() - lastAlert < 5 * 60 * 1000) {
      return { success: true, message: 'Alert cooldown active' };
    }

    this.panelBalanceAlertCooldowns.set(key, Date.now());

    const severity = balance <= threshold * 0.2 ? 'critical' : 'warning';

    this.eventsGateway.emitSystemAlert({
      type: 'low_panel_balance',
      severity,
      message: `Fichas bajas en el panel${panelId ? ` (${panelId})` : ''}: $${balance.toLocaleString('es-AR')}`,
      details: {
        panelId: key,
        balance,
        threshold,
      },
    });

    this.logger.warn(`Low panel balance alert: $${balance} (threshold: $${threshold}, panel: ${key})`);
    this.telegramService.alertLowPanelBalance(balance, threshold, panelId).catch((e) => this.logger.warn(`Telegram low balance alert failed: ${e.message}`));

    return { success: true, message: 'Alert sent' };
  }

  /**
   * Mute/unmute panel balance alerts for a specific panel
   */
  mutePanelBalanceAlert(panelId: string, mute: boolean) {
    if (mute) {
      this.panelBalanceAlertMuted.add(panelId);
    } else {
      this.panelBalanceAlertMuted.delete(panelId);
    }
  }

  /**
   * Handle bot status change
   */
  async handleStatusChange(dto: BotStatusDto, panelId?: string) {
    this.logger.log(`Bot status changed to: ${dto.status} (panelId=${panelId || 'unknown'})`);

    this.botState.status = dto.status;
    this.botState.lastHeartbeat = new Date();
    this.persistBotState();

    // Update per-panel state
    if (panelId) {
      this.updatePanelState(panelId, {
        status: dto.status,
        lastHeartbeat: new Date(),
      });
    }

    // Notify operators of status change
    try {
      this.eventsGateway.emitBotStatus({
        status: dto.status,
        panelId: panelId || 'default',
        connectedPerPanel: Object.fromEntries(this.botStates),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(`Failed to emit bot status to operators: ${err.message}`);
    }

    return { success: true, message: 'Status updated' };
  }

  /**
   * Get pending jobs for bot polling mode.
   * When panelId is provided, only returns jobs for that panel.
   */
  async getPendingJobs(panelId?: string) {
    this.logger.log(`getPendingJobs called (polling, panelId=${panelId || 'any'})`);

    const whereClause: any = { status: JobStatus.QUEUED };
    if (panelId) {
      whereClause.panelId = panelId;
    }

    const jobs = await this.prisma.job.findMany({
      where: whereClause,
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });

    if (jobs.length === 0) {
      this.logger.debug('getPendingJobs: no queued jobs found');
      return { job: null };
    }

    const job = jobs[0];
    const targetUsername = job.targetUsername || job.request?.targetUsername || '?';
    const amount = job.amount ? Number(job.amount) : (job.request ? Number(job.request.amount) : 0);
    this.logger.log(`getPendingJobs: returning job ${job.id} (${job.type}) for ${targetUsername} ($${amount})`);
    const jobData: any = {
      id: job.id,
      type: job.type,
      requestId: job.request?.id,
      targetUsername,
      amount,
      panelId: job.panelId,
    };

    // Include newPassword only for CHANGE_PASSWORD jobs
    if (job.type === 'CHANGE_PASSWORD' && job.newPassword) {
      jobData.newPassword = job.newPassword;
    }

    return { job: jobData };
  }

  /**
   * Check if kill switch is active (delegates to SettingsService for consistent format)
   */
  async checkKillSwitch(panelId?: string): Promise<{ active: boolean; reason?: string }> {
    return this.settingsService.getKillSwitch();
  }

  /**
   * Set kill switch status (delegates to SettingsService for consistent format)
   */
  async setKillSwitch(active: boolean, reason?: string) {
    if (active) {
      await this.settingsService.activateKillSwitch('system-bot', reason);
    } else {
      await this.settingsService.deactivateKillSwitch('system-bot');
    }

    return { success: true, active, reason };
  }

  /**
   * Check if within allowed activity window (delegates to SettingsService for consistent keys)
   */
  async checkActivityWindow(panelId?: string): Promise<{ allowed: boolean; reason?: string }> {
    return this.settingsService.isWithinActivityWindow();
  }

  /**
   * Get current bot state
   */
  getBotState(): BotState {
    // Check if bot is online (heartbeat within threshold)
    if (
      this.botState.lastHeartbeat &&
      Date.now() - this.botState.lastHeartbeat.getTime() > BOT_HEARTBEAT_TIMEOUT_MS
    ) {
      this.botState.status = 'offline';
    }

    return { ...this.botState };
  }

  /**
   * Check if bot is healthy
   */
  isBotHealthy(): boolean {
    const state = this.getBotState();
    return state.status === 'online' || state.status === 'busy';
  }

  /**
   * Get full dispatch diagnostic status — shows why jobs may not be dispatching
   */
  async getDispatchStatus() {
    const cooldownMs = this.configService.get<number>('QUEUE_COOLDOWN_MS', 30000);

    const [queuedCount, processingJobs, killSwitch, activityWindow, lastCompletedJob] =
      await Promise.all([
        this.prisma.job.count({ where: { status: 'QUEUED' } }),
        this.prisma.job.findMany({
          where: { status: 'PROCESSING' },
          select: { id: true, requestId: true, startedAt: true, panelId: true },
        }),
        this.checkKillSwitch(),
        this.checkActivityWindow(),
        this.prisma.job.findFirst({
          where: {
            status: { in: ['COMPLETED', 'FAILED'] },
            completedAt: { not: null },
          },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true },
        }),
      ]);

    const elapsed = lastCompletedJob?.completedAt
      ? Date.now() - lastCompletedJob.completedAt.getTime()
      : Infinity;
    const remainingMs = Math.max(0, cooldownMs - elapsed);
    const cooldown = { active: remainingMs > 0, remainingMs };

    return {
      queuedJobs: queuedCount,
      processingJobs,
      processingJob: processingJobs[0] || null, // backward compat
      killSwitch,
      activityWindow,
      cooldown,
      botConnected: this.botGateway.isAnyBotConnected(),
      connectedPanels: this.botGateway.getConnectedPanelIds(),
      connectedPerPanel: this.botGateway.getConnectedCountPerPanel(),
      botState: this.getBotState(),
      panelStates: Object.fromEntries(this.botStates),
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================
  // PER-PANEL STATE MANAGEMENT
  // ==========================================

  private updatePanelState(panelId: string, partial: Partial<BotState>) {
    const existing = this.botStates.get(panelId) || {
      status: 'unknown' as const,
      lastHeartbeat: null,
      lastJobId: null,
      version: null,
      uptime: null,
    };
    this.botStates.set(panelId, { ...existing, ...partial });
  }

  getPanelState(panelId: string): BotState | null {
    return this.botStates.get(panelId) || null;
  }

  getAllPanelStates(): Record<string, BotState> {
    return Object.fromEntries(this.botStates);
  }

  /**
   * Get job statistics for extension popup
   */
  async getJobStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [queued, processing, completed, failed, todayCompleted] = await Promise.all([
      this.prisma.job.count({ where: { status: JobStatus.QUEUED } }),
      this.prisma.job.count({ where: { status: JobStatus.PROCESSING } }),
      this.prisma.job.count({ where: { status: JobStatus.COMPLETED } }),
      this.prisma.job.count({ where: { status: JobStatus.FAILED } }),
      this.prisma.job.count({
        where: {
          status: JobStatus.COMPLETED,
          completedAt: { gte: today },
        },
      }),
    ]);

    return {
      queued,
      processing,
      completed,
      failed,
      todayCompleted,
    };
  }

  /**
   * Handle selector health check result from extension.
   * Stores the result and alerts if selectors are broken.
   */
  async handleSelectorCheckResult(result: { total: number; matched: number; failed: string[]; checkedAt?: string }) {
    // Store last check in settings
    await this.prisma.setting.upsert({
      where: { key: 'SELECTOR_CHECK_LAST' },
      update: { value: JSON.stringify(result) },
      create: { key: 'SELECTOR_CHECK_LAST', value: JSON.stringify(result) },
    });

    // Alert via Telegram if required selectors are broken
    if (result.failed.length > 0) {
      try {
        const telegram = this.moduleRef.get('TelegramService', { strict: false });
        if (telegram?.send) {
          await telegram.send(
            `⚠️ <b>SELECTORES ROTOS</b>\n\n` +
            `${result.matched}/${result.total} selectores OK\n` +
            `<b>${result.failed.length} fallaron:</b>\n` +
            result.failed.map(s => `  • <code>${s}</code>`).join('\n') +
            `\n\n<i>El casino puede haber cambiado su UI. Revisar perfil de selectores.</i>`
          );
        }
      } catch (e) {
        this.logger.warn('Could not send selector alert via Telegram:', e.message);
      }
    }
  }
}
