import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { BotService } from '../bot/bot.service';
import { BotGateway } from '../bot/bot.gateway';
import { RequestsService } from '../requests/requests.service';
import { JobStatus } from '@prisma/client';
import {
  STUCK_JOB_CHECK_INTERVAL_MS,
  STUCK_JOB_TIMEOUT_MS,
  PERIODIC_DISPATCH_RETRY_MS,
} from '../common/constants/timeouts';
import { AppEvent, ValidationCompletedEvent } from '../common/events/app-events';

interface JobData {
  id: string;
  type?: string;
  requestId?: string | null;
  targetUsername: string;
  amount: number;
  panelId?: string;
}

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly cooldownMs: number;
  private stuckJobCheckInterval: ReturnType<typeof setInterval> | null = null;
  private periodicDispatchInterval: ReturnType<typeof setInterval> | null = null;
  private nextDispatchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
    @Inject(forwardRef(() => BotService))
    private readonly botService: BotService,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    @Inject(forwardRef(() => RequestsService))
    private readonly requestsService: RequestsService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.cooldownMs = this.configService.get<number>('QUEUE_COOLDOWN_MS', 30000);
    this.logger.log('JobsService initialized (Postgres-based queue)');
  }

  // Fix 6: Recover queued jobs on server startup
  // Fix 16: Also recover stuck PROCESSING jobs + start periodic check
  async onModuleInit() {
    setTimeout(async () => {
      try {
        // Recover stuck PROCESSING jobs from before restart
        await this.checkForStuckJobs();

        const queuedCount = await this.prisma.job.count({ where: { status: 'QUEUED' } });
        if (queuedCount > 0) {
          this.logger.log(`Found ${queuedCount} queued jobs on startup, attempting dispatch...`);
          await this.tryDispatchNextJob();
        }
      } catch (error) {
        this.logger.error(`Startup dispatch recovery failed: ${error.message}`);
      }
    }, 5000);

    // Start periodic stuck job detection
    this.stuckJobCheckInterval = setInterval(async () => {
      try {
        await this.checkForStuckJobs();
      } catch (error) {
        this.logger.error(`Stuck job check failed: ${error.message}`);
      }
    }, STUCK_JOB_CHECK_INTERVAL_MS);

    this.logger.log(`Stuck job checker started (every ${STUCK_JOB_CHECK_INTERVAL_MS / 1000}s)`);

    // Start periodic dispatch retry (catches jobs that were never dispatched)
    this.startPeriodicDispatchRetry();
  }

  onModuleDestroy() {
    if (this.stuckJobCheckInterval) {
      clearInterval(this.stuckJobCheckInterval);
      this.stuckJobCheckInterval = null;
      this.logger.log('Stuck job checker stopped');
    }
    if (this.periodicDispatchInterval) {
      clearInterval(this.periodicDispatchInterval);
      this.periodicDispatchInterval = null;
      this.logger.log('Periodic dispatch retry stopped');
    }
    if (this.nextDispatchTimer) {
      clearTimeout(this.nextDispatchTimer);
      this.nextDispatchTimer = null;
      this.logger.log('Next dispatch timer cleared on shutdown');
    }
  }

  /**
   * Fix 16: Detect and clean up stuck PROCESSING jobs.
   * A job is considered stuck if it has been in PROCESSING status
   * for longer than STUCK_JOB_TIMEOUT_MS (5 minutes).
   */
  private async checkForStuckJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);

    // Only detect PROCESSING jobs that have been running too long
    const stuckJobs = await this.prisma.job.findMany({
      where: {
        status: 'PROCESSING',
        OR: [
          { startedAt: { lt: cutoff } },
          { startedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      include: {
        request: {
          select: { id: true, targetUsername: true, amount: true, userId: true },
        },
      },
      // Need panelId for per-panel dispatch after cleanup
    });

    if (stuckJobs.length === 0) return;

    this.logger.warn(`Found ${stuckJobs.length} stuck PROCESSING job(s), cleaning up...`);

    for (const job of stuckJobs) {
      try {
        // Mark job as FAILED
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            error: `Job timed out - no progress received for ${STUCK_JOB_TIMEOUT_MS / 1000}s`,
            completedAt: new Date(),
          },
        });

        // Update request status to FAILED (only for LOAD_CREDITS jobs)
        if (job.requestId && job.request) {
          try {
            await this.requestsService.updateRequestStatus(job.requestId, 'FAILED', 'system-stuck-job-cleanup', {
              reason: 'job_timed_out',
              jobId: job.id,
              startedAt: job.startedAt,
            });
          } catch (reqError) {
            this.logger.error(`Failed to update request ${job.requestId} for stuck job ${job.id}: ${reqError.message}`);
          }

          // Emit events for operators and user
          this.events.emitJobFailed(job.request.userId, {
            jobId: job.id,
            requestId: job.requestId,
            error: 'Job timed out - stuck in PROCESSING',
          });
        }

        const targetUsername = job.targetUsername || job.request?.targetUsername || '?';
        const amount = job.amount ? Number(job.amount) : (job.request ? Number(job.request.amount) : 0);

        this.events.emitSystemAlert({
          type: 'STUCK_JOB_CLEANED',
          message: `Job ${job.id.slice(0, 8)} stuck for ${targetUsername} ($${amount}) — auto-failed`,
          severity: 'warning',
          details: {
            jobId: job.id,
            requestId: job.requestId,
            targetUsername,
            amount,
            stuckSince: job.startedAt,
          },
        });

        this.logger.warn(
          `Stuck job ${job.id} cleaned up (request=${job.requestId || 'none'}, user=${targetUsername})`,
        );
      } catch (error) {
        this.logger.error(`Failed to clean up stuck job ${job.id}: ${error.message}`);
      }
    }

    this.events.emitDashboardUpdate();

    // Try to dispatch next job for each panel that had stuck jobs
    const affectedPanels = new Set(stuckJobs.map(j => j.panelId).filter(Boolean));
    for (const pId of affectedPanels) {
      try {
        const result = await this.tryDispatchNextJob(pId!);
        if (result.dispatched) {
          this.logger.log(`Dispatched next job for panel ${pId} after stuck job cleanup`);
        }
      } catch (error: any) {
        this.logger.error(`Failed to dispatch for panel ${pId} after stuck job cleanup: ${error.message}`);
      }
    }
    // Also try unassigned
    try {
      await this.tryDispatchNextJob();
    } catch (error: any) {
      this.logger.error(`Failed to dispatch after stuck job cleanup: ${error.message}`);
    }
  }

  /**
   * Periodic dispatch retry: every 60s, check if there are QUEUED jobs
   * with no PROCESSING job. Catches jobs that fell through the cracks
   * (e.g. bot reconnect missed, dispatch reverted to QUEUED with no listener).
   */
  private startPeriodicDispatchRetry() {
    this.periodicDispatchInterval = setInterval(async () => {
      try {
        // Find all panels that have queued jobs
        const queuedJobs = await this.prisma.job.findMany({
          where: { status: 'QUEUED' },
          select: { panelId: true },
          distinct: ['panelId'],
        });
        if (queuedJobs.length === 0) return;

        // Check each panel independently
        for (const { panelId } of queuedJobs) {
          const hasProcessing = await this.prisma.job.findFirst({
            where: { status: 'PROCESSING', panelId },
            select: { id: true },
          });
          if (hasProcessing) continue;

          this.logger.log(`[PeriodicRetry] Queued jobs for panel ${panelId || 'unassigned'}, attempting dispatch...`);
          const result = await this.tryDispatchNextJob(panelId || undefined);
          if (result.dispatched) {
            this.logger.log(`[PeriodicRetry] Successfully dispatched for panel ${panelId || 'unassigned'}`);
          } else {
            this.logger.debug(`[PeriodicRetry] Not dispatched for panel ${panelId || 'unassigned'}: ${result.reason}`);
          }
        }
      } catch (e: any) {
        this.logger.error(`[PeriodicRetry] Error: ${e.message}`);
      }
    }, PERIODIC_DISPATCH_RETRY_MS);

    this.logger.log('Periodic dispatch retry started (every 60s)');
  }

  // ==========================================
  // QUEUE MANAGEMENT (Postgres-based)
  // ==========================================

  /**
   * Check if we're within the cooldown period after the last completed job.
   * When panelId is provided, checks cooldown for that specific panel only.
   */
  async isCooldownActive(panelId?: string): Promise<{ active: boolean; remainingMs: number }> {
    const whereClause: any = {
      status: { in: ['COMPLETED', 'FAILED'] },
      completedAt: { not: null },
    };
    if (panelId) {
      whereClause.panelId = panelId;
    }

    const lastCompletedJob = await this.prisma.job.findFirst({
      where: whereClause,
      orderBy: { completedAt: 'desc' },
    });

    if (!lastCompletedJob?.completedAt) {
      return { active: false, remainingMs: 0 };
    }

    const elapsed = Date.now() - lastCompletedJob.completedAt.getTime();
    const remaining = this.cooldownMs - elapsed;

    return {
      active: remaining > 0,
      remainingMs: Math.max(0, remaining),
    };
  }

  /**
   * Check if there's already a job being processed.
   * When panelId is provided, checks only for that panel.
   */
  async hasActiveJob(panelId?: string): Promise<boolean> {
    const whereClause: any = { status: 'PROCESSING' };
    if (panelId) {
      whereClause.panelId = panelId;
    }
    const activeJob = await this.prisma.job.findFirst({
      where: whereClause,
    });
    return !!activeJob;
  }

  /**
   * Get the next queued job (FIFO order).
   * When panelId is provided, only returns jobs for that panel.
   */
  async getNextQueuedJob(panelId?: string): Promise<JobData | null> {
    const whereClause: any = { status: 'QUEUED' };
    if (panelId) {
      whereClause.panelId = panelId;
    }

    const job = await this.prisma.job.findFirst({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
      include: {
        request: {
          select: {
            targetUsername: true,
            amount: true,
          },
        },
      },
    });

    if (!job) return null;

    return {
      id: job.id,
      type: job.type,
      requestId: job.requestId,
      targetUsername: job.targetUsername || job.request?.targetUsername || '',
      amount: job.amount ? Number(job.amount) : (job.request ? Number(job.request.amount) : 0),
      panelId: job.panelId || undefined,
    };
  }

  /**
   * Try to dispatch the next queued job to the bot.
   * When panelId is provided, only dispatches jobs for that panel.
   * When panelId is omitted, iterates all panels with connected bots.
   */
  async tryDispatchNextJob(panelId?: string): Promise<{ dispatched: boolean; reason?: string }> {
    // Pre-flight checks (global — not per-panel)
    const killSwitch = await this.botService.checkKillSwitch();
    if (killSwitch.active) {
      this.logger.warn(`Dispatch blocked: Kill switch active — ${killSwitch.reason}`);
      return { dispatched: false, reason: `Kill switch active: ${killSwitch.reason}` };
    }

    const activityWindow = await this.botService.checkActivityWindow();
    if (!activityWindow.allowed) {
      this.logger.warn(`Dispatch blocked: Outside activity window — ${activityWindow.reason}`);
      return { dispatched: false, reason: `Outside activity window: ${activityWindow.reason}` };
    }

    if (panelId) {
      return this.tryDispatchForPanel(panelId);
    }

    // No specific panel — try all panels with connected bots
    const connectedPanels = this.botGateway.getConnectedPanelIds();
    if (connectedPanels.length === 0) {
      return { dispatched: false, reason: 'No bots connected' };
    }

    for (const pId of connectedPanels) {
      const result = await this.tryDispatchForPanel(pId);
      if (result.dispatched) return result;
    }

    // Also try jobs without panelId (legacy or discovery-pending)
    return this.tryDispatchForPanel(undefined);
  }

  /**
   * Try to dispatch next job for a specific panel.
   * Enforces one-at-a-time PER PANEL (not global).
   */
  private async tryDispatchForPanel(panelId?: string): Promise<{ dispatched: boolean; reason?: string }> {
    const label = panelId || 'unassigned';

    // Per-panel cooldown
    const cooldown = await this.isCooldownActive(panelId);
    if (cooldown.active) {
      this.logger.debug(`Dispatch blocked for panel ${label}: Cooldown, ${Math.ceil(cooldown.remainingMs / 1000)}s remaining`);
      return {
        dispatched: false,
        reason: `Cooldown active for panel ${label}, ${Math.ceil(cooldown.remainingMs / 1000)}s remaining`,
      };
    }

    // Atomic claim scoped to panel
    let claimedJob: JobData | null = null;

    try {
      claimedJob = await this.prisma.$transaction(
        async (tx) => {
          // Check for active job FOR THIS PANEL
          const activeWhere: any = { status: 'PROCESSING' as const };
          if (panelId) activeWhere.panelId = panelId;
          else activeWhere.panelId = null; // Only match unassigned

          const activeJob = await tx.job.findFirst({ where: activeWhere });
          if (activeJob) return null;

          // Find next QUEUED job for this panel
          const queuedWhere: any = { status: 'QUEUED' as const };
          if (panelId) queuedWhere.panelId = panelId;
          else queuedWhere.panelId = null;

          const nextJob = await tx.job.findFirst({
            where: queuedWhere,
            orderBy: { createdAt: 'asc' },
            include: {
              request: {
                select: { targetUsername: true, amount: true },
              },
            },
          });
          if (!nextJob) return null;

          await tx.job.update({
            where: { id: nextJob.id },
            data: { status: 'PROCESSING', startedAt: new Date() },
          });

          return {
            id: nextJob.id,
            type: nextJob.type,
            requestId: nextJob.requestId,
            targetUsername: nextJob.targetUsername || nextJob.request?.targetUsername || '',
            amount: nextJob.amount ? Number(nextJob.amount) : (nextJob.request ? Number(nextJob.request.amount) : 0),
            panelId: nextJob.panelId || undefined,
            newPassword: nextJob.newPassword || undefined,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        this.logger.log(`Dispatch serialization conflict for panel ${label}, skipping`);
        return { dispatched: false, reason: 'Concurrent dispatch resolved by another caller' };
      }
      throw error;
    }

    if (!claimedJob) {
      return { dispatched: false, reason: `No dispatchable jobs for panel ${label}` };
    }

    return this.dispatchClaimedJob(claimedJob);
  }

  /**
   * Dispatch a job that has already been atomically claimed (status = PROCESSING).
   * Routes to the correct panel's bot. If no bot connected, reverts to QUEUED.
   */
  private async dispatchClaimedJob(job: JobData): Promise<{ dispatched: boolean; reason?: string }> {
    this.logger.log(`Dispatching claimed job ${job.id} for ${job.targetUsername} (panel ${job.panelId || 'any'})`);

    let pushed = false;
    if (job.panelId) {
      // Panel-specific dispatch
      if (this.botGateway.isBotConnectedForPanel(job.panelId)) {
        pushed = await this.botGateway.pushJobToPanel(job.panelId, job);
      }
    } else {
      // Legacy: push to any available bot
      if (this.botGateway.isAnyBotConnected()) {
        pushed = await this.botGateway.pushJobToBot(job);
      }
    }

    if (pushed) {
      this.logger.log(`Job ${job.id} pushed to bot via WebSocket`);
      return { dispatched: true };
    }

    // No bot connected — revert to QUEUED
    try {
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'QUEUED' },
      });
      this.logger.log(`No bot connected for panel ${job.panelId || 'any'}, job ${job.id} reverted to QUEUED`);
      // Schedule quick retry — bot may reconnect or switch to polling shortly
      setTimeout(() => {
        this.tryDispatchNextJob(job.panelId).catch((e) =>
          this.logger.warn(`Quick retry dispatch for job ${job.id} failed: ${e.message}`),
        );
      }, 5000);
    } catch (revertError: any) {
      this.logger.error(`Failed to revert job ${job.id} to QUEUED: ${revertError.message}`);
    }
    return { dispatched: false, reason: `No bot connected for panel ${job.panelId || 'any'} - reverted to QUEUED` };
  }

  // ==========================================
  // EVENT HANDLERS
  // ==========================================

  @OnEvent(AppEvent.VALIDATION_COMPLETED)
  async handleValidationCompleted(event: { requestId: string; score: number }): Promise<void> {
    this.logger.log(`Received VALIDATION_COMPLETED event for request ${event.requestId} (score=${event.score})`);
    try {
      await this.createJobForRequest(event.requestId);
    } catch (error: any) {
      this.logger.error(`Failed to create job for request ${event.requestId}: ${error.message}`);

      // Emit failure to operators so they can intervene manually
      this.events.emitToOperators('system:alert', {
        type: 'JOB_CREATION_FAILED',
        requestId: event.requestId,
        error: error.message,
      });
    }
  }

  // ==========================================
  // PUBLIC METHODS
  // ==========================================

  async createJobForRequest(requestId: string): Promise<any> {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { panelId: true } } },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'APPROVED') {
      throw new BadRequestException('Request must be approved to create job');
    }

    let panelId = request.panelId || request.user?.panelId || null;

    // Re-fetch user panelId in case discovery completed between request creation and now
    if (!panelId) {
      const freshUser = await this.prisma.user.findUnique({
        where: { id: request.userId },
        select: { panelId: true },
      });
      if (freshUser?.panelId) {
        panelId = freshUser.panelId;
        // Update request too so future lookups are fast
        await this.prisma.request.update({ where: { id: requestId }, data: { panelId } }).catch(() => {});
        this.logger.log(`Request ${requestId} panelId updated to ${panelId} (from fresh user lookup)`);
      }
    }

    // If still no panelId, trigger discovery instead of creating job
    if (!panelId) {
      this.logger.log(`Request ${requestId} has no panelId — triggering discovery for "${request.targetUsername}"`);
      try {
        // Lazy-load DiscoveryService to avoid circular DI
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { DiscoveryService } = require('../discovery/discovery.service');
        const discoveryService = this.moduleRef.get(DiscoveryService, { strict: false });
        await discoveryService.startDiscovery(requestId, request.targetUsername, request.userId);
        return { discovery: true, requestId, message: 'Discovery started — job will be created when panel is found' };
      } catch (error: any) {
        this.logger.error(`Discovery failed for request ${requestId}: ${error.message}`);
        // Fallback: create job without panelId (will fail at dispatch but operator can intervene)
      }
    }

    // Create job with panelId
    let job: any;
    try {
      job = await this.prisma.job.create({
        data: {
          requestId,
          status: 'QUEUED',
          panelId,
          targetUsername: request.targetUsername,
          amount: request.amount,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.warn(`Job already exists for request ${requestId} (concurrent creation), returning existing`);
        const existingJob = await this.prisma.job.findUnique({
          where: { requestId },
        });
        if (existingJob) {
          return existingJob;
        }
      }
      throw error;
    }

    this.logger.log(`Job ${job.id} created for request ${requestId} (panel ${panelId || 'none'})`);

    // Emit events
    this.events.emitJobQueued({
      jobId: job.id,
      requestId,
      targetUsername: request.targetUsername,
    });
    this.events.emitDashboardUpdate();

    // Try to dispatch immediately (scoped to panel)
    const result = await this.tryDispatchNextJob(panelId || undefined);
    if (result.dispatched) {
      this.logger.log(`Job ${job.id} dispatched immediately`);
    } else {
      this.logger.warn(`Job ${job.id} queued but NOT dispatched: ${result.reason}`);
      this.events.emitDispatchBlocked({ jobId: job.id, reason: result.reason || 'Unknown' });
    }

    return job;
  }

  async findAll(options?: { status?: JobStatus; limit?: number; offset?: number }) {
    return this.prisma.job.findMany({
      where: options?.status ? { status: options.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
            userId: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        request: {
          include: {
            user: { select: { id: true, email: true } },
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  async getActiveJob() {
    return this.prisma.job.findFirst({
      where: { status: 'PROCESSING' },
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
          },
        },
      },
    });
  }

  async getQueuedJobs() {
    return this.prisma.job.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      include: {
        request: {
          select: {
            targetUsername: true,
            amount: true,
          },
        },
      },
    });
  }

  async cancelJob(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== 'QUEUED') {
      throw new BadRequestException('Only queued jobs can be cancelled');
    }

    // Atomic: delete job + revert request
    const txOps: any[] = [this.prisma.job.delete({ where: { id: jobId } })];
    if (job.requestId) {
      txOps.push(this.prisma.request.update({
        where: { id: job.requestId },
        data: { status: 'APPROVED' },
      }));
    }
    await this.prisma.$transaction(txOps);

    this.events.emitDashboardUpdate();

    return { success: true };
  }

  async getStats() {
    const [queued, processing, completed, failed, todayCompleted] = await Promise.all([
      this.prisma.job.count({ where: { status: 'QUEUED' } }),
      this.prisma.job.count({ where: { status: 'PROCESSING' } }),
      this.prisma.job.count({ where: { status: 'COMPLETED' } }),
      this.prisma.job.count({ where: { status: 'FAILED' } }),
      this.prisma.job.count({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    // Calculate average completion time
    const recentJobs = await this.prisma.job.findMany({
      where: {
        status: 'COMPLETED',
        startedAt: { not: null },
        completedAt: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
    });

    let averageTime = 0;
    if (recentJobs.length > 0) {
      const totalTime = recentJobs.reduce((acc, job) => {
        const duration = job.completedAt!.getTime() - job.startedAt!.getTime();
        return acc + duration;
      }, 0);
      averageTime = Math.round(totalTime / recentJobs.length / 1000);
    }

    return {
      queued,
      processing,
      completed,
      failed,
      todayCompleted,
      averageTime,
    };
  }

  /**
   * Queue status from Postgres (replaces BullMQ getQueueInfo)
   */
  async getQueueInfo() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.prisma.job.count({ where: { status: 'QUEUED' } }),
      this.prisma.job.count({ where: { status: 'PROCESSING' } }),
      this.prisma.job.count({ where: { status: 'COMPLETED' } }),
      this.prisma.job.count({ where: { status: 'FAILED' } }),
    ]);

    const cooldown = await this.isCooldownActive();

    return {
      waiting,
      active,
      completed,
      failed,
      cooldown: {
        active: cooldown.active,
        remainingMs: cooldown.remainingMs,
      },
    };
  }

  async getQueueStatus() {
    return this.getQueueInfo();
  }

  // ==========================================
  // OPERATOR ASSIGNMENT (for failed jobs)
  // ==========================================

  async assignOperator(jobId: string, operatorId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { request: true },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== 'FAILED') {
      throw new BadRequestException('Only failed jobs can be assigned');
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        assignedOperatorId: operatorId,
        assignedAt: new Date(),
      },
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
            userId: true,
          },
        },
      },
    });

    this.logger.log(`Job ${jobId} assigned to operator ${operatorId}`);

    this.events.emitToOperators('job:assigned', { jobId, operatorId });
    this.events.emitDashboardUpdate();

    return updated;
  }

  async unassignOperator(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        assignedOperatorId: null,
        assignedAt: null,
      },
    });

    this.logger.log(`Job ${jobId} unassigned`);

    this.events.emitToOperators('job:unassigned', { jobId });
    this.events.emitDashboardUpdate();

    return updated;
  }

  async getAssignedToOperator(operatorId: string) {
    return this.prisma.job.findMany({
      where: {
        assignedOperatorId: operatorId,
        status: 'FAILED',
      },
      orderBy: { assignedAt: 'asc' },
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
            userId: true,
            user: { select: { id: true, email: true } },
          },
        },
      },
    });
  }

  async getUnassignedFailedJobs() {
    return this.prisma.job.findMany({
      where: {
        status: 'FAILED',
        assignedOperatorId: null,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
            userId: true,
            user: { select: { id: true, email: true } },
          },
        },
      },
    });
  }

  // ==========================================
  // OPERATOR PANEL METHODS
  // ==========================================

  async getRecentJobs(limit: number = 20) {
    return this.prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
            userId: true,
            user: { select: { id: true, email: true } },
          },
        },
      },
    });
  }

  async retryJob(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { request: true },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== 'FAILED') {
      throw new BadRequestException('Only failed jobs can be retried');
    }

    // Atomic: delete old job + revert request status
    const retryTxOps: any[] = [this.prisma.job.delete({ where: { id: jobId } })];
    if (job.requestId) {
      retryTxOps.push(this.prisma.request.update({
        where: { id: job.requestId },
        data: { status: 'APPROVED' },
      }));
    }
    await this.prisma.$transaction(retryTxOps);

    if (!job.requestId) {
      throw new BadRequestException('Cannot retry WITHDRAW_CHIPS jobs via this method');
    }

    // Create new job (outside transaction — has its own idempotency)
    const newJob = await this.createJobForRequest(job.requestId);

    this.logger.log(`Job ${jobId} retried - new job ${newJob.id} created`);

    return newJob;
  }

  // ==========================================
  // BOT INTEGRATION
  // ==========================================

  /**
   * Called when bot connects - try to dispatch pending jobs
   */
  async onBotConnected() {
    this.logger.log('Bot connected, checking for queued jobs...');
    const result = await this.tryDispatchNextJob();
    if (result.dispatched) {
      this.logger.log('Dispatched queued job to newly connected bot');
    }
  }

  /**
   * Called when a job completes - try to dispatch next job for the SAME panel after cooldown.
   * Also checks for pending discoveries that may need this now-idle panel.
   */
  async onJobCompleted(jobId: string) {
    // Look up panelId from the completed job
    const completedJob = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { panelId: true },
    });
    const panelId = completedJob?.panelId;

    this.logger.log(`Job ${jobId} completed (panel ${panelId || 'unknown'}), scheduling next dispatch after cooldown`);

    // Clear any existing timer to prevent pileup (Fix 52)
    if (this.nextDispatchTimer) {
      clearTimeout(this.nextDispatchTimer);
      this.nextDispatchTimer = null;
    }

    this.nextDispatchTimer = setTimeout(async () => {
      this.nextDispatchTimer = null;
      try {
        // Dispatch next job for the same panel
        const result = await this.tryDispatchNextJob(panelId || undefined);
        if (result.dispatched) {
          this.logger.log(`Dispatched next job for panel ${panelId || 'any'} after cooldown`);
        } else {
          this.logger.log(`No job dispatched for panel ${panelId || 'any'}: ${result.reason}`);
        }

        // Check for pending discoveries now that this panel is idle
        if (panelId) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { DiscoveryService } = require('../discovery/discovery.service');
            const discoveryService = this.moduleRef.get(DiscoveryService, { strict: false });
            await discoveryService.retryPendingDiscoveries(panelId);
          } catch {
            // Discovery service not available — not critical
          }
        }
      } catch (error: any) {
        this.logger.error(`Failed to dispatch next job: ${error.message}`);
      }
    }, this.cooldownMs);
  }
}
