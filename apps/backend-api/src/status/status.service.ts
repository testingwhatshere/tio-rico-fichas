import { Injectable, NotFoundException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BotService, JobProgress } from '../bot/bot.service';
import { JobsService } from '../jobs/jobs.service';

@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => BotService))
    private readonly botService: BotService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
  ) {}

  async getRequestStatus(requestId: string, userId: string, role: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: {
        job: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    // Check access
    const isOperator = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(role);
    if (!isOperator && request.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // Get job progress if processing
    let progress: JobProgress | null = null;
    if (request.job && request.status === 'PROCESSING') {
      progress = this.botService.getJobProgress(request.job.id);
    }

    return {
      requestId: request.id,
      status: request.status,
      targetUsername: request.targetUsername,
      amount: Number(request.amount),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      job: request.job ? {
        id: request.job.id,
        status: request.job.status,
        startedAt: request.job.startedAt,
        completedAt: request.job.completedAt,
        progress,
      } : null,
    };
  }

  async getJobStatus(jobId: string, userId: string, role: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        request: {
          select: {
            id: true,
            userId: true,
            targetUsername: true,
            amount: true,
            status: true,
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // Check access
    const isOperator = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(role);
    if (!isOperator && job.request?.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // Get progress if processing
    let progress: JobProgress | null = null;
    if (job.status === 'PROCESSING') {
      progress = this.botService.getJobProgress(jobId);
    }

    return {
      jobId: job.id,
      requestId: job.requestId,
      status: job.status,
      targetUsername: job.targetUsername || job.request?.targetUsername || '',
      amount: job.amount ? Number(job.amount) : (job.request ? Number(job.request.amount) : 0),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      progress,
    };
  }

  async getUserActiveRequests(userId: string) {
    const requests = await this.prisma.request.findMany({
      where: {
        userId,
        status: {
          in: ['PENDING_PROOF', 'VALIDATING', 'APPROVED', 'PROCESSING'],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        job: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    return requests.map((r) => {
      let progress: JobProgress | null = null;
      if (r.job && r.status === 'PROCESSING') {
        progress = this.botService.getJobProgress(r.job.id);
      }

      return {
        requestId: r.id,
        status: r.status,
        targetUsername: r.targetUsername,
        amount: Number(r.amount),
        createdAt: r.createdAt,
        job: r.job ? {
          id: r.job.id,
          status: r.job.status,
          progress,
        } : null,
      };
    });
  }

  async getSystemStatus() {
    const botState = this.botService.getBotState();
    const killSwitch = await this.botService.checkKillSwitch();
    const activityWindow = await this.botService.checkActivityWindow();
    const queueStatus = await this.jobsService.getQueueStatus();

    // Get counts
    const [activeJobs, queuedJobs, pendingRequests, failedToday] = await Promise.all([
      this.prisma.job.count({ where: { status: 'PROCESSING' } }),
      this.prisma.job.count({ where: { status: 'QUEUED' } }),
      this.prisma.request.count({
        where: { status: { in: ['PENDING_PROOF', 'VALIDATING', 'VALIDATION_FAILED'] } },
      }),
      this.prisma.job.count({
        where: {
          status: 'FAILED',
          completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return {
      bot: {
        status: botState.status,
        lastHeartbeat: botState.lastHeartbeat,
        version: botState.version,
        isHealthy: this.botService.isBotHealthy(),
      },
      queue: queueStatus,
      killSwitch,
      activityWindow,
      counts: {
        activeJobs,
        queuedJobs,
        pendingRequests,
        failedToday,
      },
    };
  }

  async getQueueStatus() {
    return this.jobsService.getQueueStatus();
  }
}
