import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import {
  DashboardStatsDto,
  RequestTrendDto,
  RevenueStatsDto,
  SystemHealthDto,
} from './dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
  ) {}

  /**
   * Get comprehensive dashboard statistics
   */
  async getDashboardStats(from?: Date, to?: Date): Promise<DashboardStatsDto> {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const fromDate = from || startOfDay;
    const toDate = to || now;

    const dateFilter = {
      createdAt: {
        gte: fromDate,
        lte: toDate,
      },
    };

    // Request statistics
    const [
      totalRequests,
      pendingRequests,
      validatingRequests,
      validationFailedRequests,
      pendingMpVerification,
      approvedRequests,
      processingRequests,
      completedRequests,
      failedRequests,
      rejectedRequests,
      cancelledRequests,
    ] = await Promise.all([
      this.prisma.request.count({ where: dateFilter }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'PENDING_PROOF' },
      }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'VALIDATING' },
      }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'VALIDATION_FAILED' },
      }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'PENDING_MP_VERIFICATION' },
      }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'APPROVED' },
      }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'PROCESSING' },
      }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'COMPLETED' },
      }),
      this.prisma.request.count({ where: { ...dateFilter, status: 'FAILED' } }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'REJECTED' },
      }),
      this.prisma.request.count({
        where: { ...dateFilter, status: 'CANCELLED' },
      }),
    ]);

    // Job statistics
    const [totalJobs, queuedJobs, processingJobs, completedJobs, failedJobs] =
      await Promise.all([
        this.prisma.job.count({ where: dateFilter }),
        this.prisma.job.count({ where: { ...dateFilter, status: 'QUEUED' } }),
        this.prisma.job.count({
          where: { ...dateFilter, status: 'PROCESSING' },
        }),
        this.prisma.job.count({
          where: { ...dateFilter, status: 'COMPLETED' },
        }),
        this.prisma.job.count({ where: { ...dateFilter, status: 'FAILED' } }),
      ]);

    // Chat statistics
    const [totalChats, openChats, assignedChats, closedChats] =
      await Promise.all([
        this.prisma.chat.count(),
        this.prisma.chat.count({ where: { status: 'OPEN' } }),
        this.prisma.chat.count({ where: { status: 'ASSIGNED' } }),
        this.prisma.chat.count({ where: { status: 'CLOSED' } }),
      ]);

    const unreadMessages = await this.prisma.message.count({
      where: { isRead: false },
    });

    // Operator statistics
    const [totalOperators, availableOperators] = await Promise.all([
      this.prisma.operator.count(),
      this.prisma.operator.count({ where: { isAvailable: true } }),
    ]);

    // Prize claim statistics
    const [pendingPrizeClaims, todayPrizeClaims] = await Promise.all([
      this.prisma.prizeClaim.count({
        where: {
          status: { in: ['VERIFIED', 'CHIPS_WITHDRAWN', 'PROCESSING'] },
        },
      }),
      this.prisma.prizeClaim.count({ where: dateFilter }),
    ]);

    // Get active chats across all operators
    const operatorActiveChats = assignedChats;

    // System status
    const queueStatus = await this.jobsService.getQueueStatus();
    const killSwitch = await this.getKillSwitchStatus();
    const lastJob = await this.prisma.job.findFirst({
      where: { completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
    });

    return {
      requests: {
        total: totalRequests,
        pending: pendingRequests,
        validating: validatingRequests,
        validationFailed: validationFailedRequests,
        pendingMpVerification,
        approved: approvedRequests,
        processing: processingRequests,
        completed: completedRequests,
        failed: failedRequests,
        rejected: rejectedRequests,
        cancelled: cancelledRequests,
      },
      jobs: {
        total: totalJobs,
        queued: queuedJobs,
        processing: processingJobs,
        completed: completedJobs,
        failed: failedJobs,
      },
      chats: {
        total: totalChats,
        open: openChats,
        assigned: assignedChats,
        closed: closedChats,
        unreadMessages,
      },
      operators: {
        total: totalOperators,
        available: availableOperators,
        activeChats: operatorActiveChats,
      },
      prizeClaims: {
        pending: pendingPrizeClaims,
        today: todayPrizeClaims,
      },
      system: {
        botStatus: this.determineBotStatus(queueStatus),
        killSwitchActive: killSwitch,
        queueLength: queueStatus.waiting,
        lastJobAt: lastJob?.completedAt || undefined,
      },
      timeRange: {
        from: fromDate,
        to: toDate,
      },
    };
  }

  /**
   * Get request trends over time
   */
  async getRequestTrends(days: number = 7): Promise<RequestTrendDto[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    // Single query to get all counts grouped by date and status
    const results: any[] = await this.prisma.$queryRaw`
      SELECT
        DATE("createdAt") as date,
        COUNT(*) FILTER (WHERE true) as created,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed
      FROM "Request"
      WHERE "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    // Build a map for quick lookup
    const resultMap = new Map<
      string,
      { created: number; completed: number; failed: number }
    >();
    for (const row of results) {
      const dateStr = new Date(row.date).toISOString().split('T')[0];
      resultMap.set(dateStr, {
        created: Number(row.created),
        completed: Number(row.completed),
        failed: Number(row.failed),
      });
    }

    // Fill in all days (including days with 0 activity)
    const trends: RequestTrendDto[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      )
        .toISOString()
        .split('T')[0];

      const data = resultMap.get(dateStr);
      trends.push({
        date: dateStr,
        created: data?.created ?? 0,
        completed: data?.completed ?? 0,
        failed: data?.failed ?? 0,
      });
    }

    return trends;
  }

  /**
   * Get revenue statistics
   */
  async getRevenueStats(from?: Date, to?: Date): Promise<RevenueStatsDto> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = from || startOfMonth;
    const toDate = to || now;

    const dateFilter = {
      createdAt: {
        gte: fromDate,
        lte: toDate,
      },
    };

    const [totalResult, completedResult, pendingResult] = await Promise.all([
      this.prisma.request.aggregate({
        where: dateFilter,
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      this.prisma.request.aggregate({
        where: { ...dateFilter, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.request.aggregate({
        where: {
          ...dateFilter,
          status: {
            in: ['PENDING_PROOF', 'VALIDATING', 'APPROVED', 'PROCESSING'],
          },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalAmount: Number(totalResult._sum.amount || 0),
      completedAmount: Number(completedResult._sum.amount || 0),
      pendingAmount: Number(pendingResult._sum.amount || 0),
      averageAmount: Number(totalResult._avg.amount || 0),
      currency: 'ARS',
    };
  }

  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<SystemHealthDto> {
    const startTime = Date.now();

    // Database health check
    let dbStatus: 'healthy' | 'unhealthy' = 'unhealthy';
    let dbLatency = 0;
    try {
      const dbStart = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - dbStart;
      dbStatus = 'healthy';
    } catch (error) {
      this.logger.error('Database health check failed', error);
    }

    // Queue health check (Postgres-based)
    let queueStatus: 'healthy' | 'unhealthy' = 'unhealthy';
    let queueLatency = 0;
    let queueLength = 0;
    try {
      const queueStart = Date.now();
      const queueInfo = await this.jobsService.getQueueStatus();
      queueLatency = Date.now() - queueStart;
      queueLength = queueInfo.waiting;
      queueStatus = 'healthy';
    } catch (error) {
      this.logger.error('Queue health check failed', error);
    }

    // Bot status
    const botStatus = await this.getBotStatus();

    return {
      database: {
        status: dbStatus,
        latencyMs: dbLatency,
      },
      queue: {
        status: queueStatus,
        latencyMs: queueLatency,
        queueLength,
      },
      bot: botStatus,
      uptime: process.uptime(),
      timestamp: new Date(),
    };
  }

  /**
   * Get failure queue (validation failed + job failed)
   */
  async getFailureQueue() {
    const [validationFailures, jobFailures] = await Promise.all([
      this.prisma.request.findMany({
        where: { status: 'VALIDATION_FAILED' },
        include: {
          user: { select: { id: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.job.findMany({
        where: { status: 'FAILED' },
        include: {
          request: {
            include: {
              user: { select: { id: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      validationFailures: validationFailures.map((r) => ({
        id: r.id,
        type: 'validation_failed',
        userId: r.userId,
        userEmail: r.user.email,
        targetUsername: r.targetUsername,
        amount: Number(r.amount),
        proofUrl: r.proofUrl,
        validationScore: r.validationScore,
        validationError: r.validationError,
        validationDetails: r.validationDetails,
        createdAt: r.createdAt,
      })),
      jobFailures: jobFailures
        .filter((j) => j.request)
        .map((j) => ({
          id: j.id,
          type: 'job_failed',
          requestId: j.requestId,
          userId: j.request!.userId,
          userEmail: j.request!.user.email,
          targetUsername: j.request!.targetUsername,
          amount: Number(j.request!.amount),
          error: j.error,
          screenshot: j.screenshot,
          createdAt: j.createdAt,
        })),
      total: validationFailures.length + jobFailures.length,
    };
  }

  /**
   * Get recent activity feed
   */
  async getRecentActivity(limit: number = 20) {
    const [recentRequests, recentJobs, recentChats] = await Promise.all([
      this.prisma.request.findMany({
        orderBy: { updatedAt: 'desc' },
        take: limit,
        include: {
          user: { select: { id: true, email: true } },
        },
      }),
      this.prisma.job.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          request: {
            select: { targetUsername: true, amount: true },
          },
        },
      }),
      this.prisma.chat.findMany({
        where: { status: { in: ['OPEN', 'ASSIGNED'] } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        include: {
          user: { select: { id: true, email: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    // Combine and sort by timestamp
    const activities = [
      ...recentRequests.map((r) => ({
        type: 'request' as const,
        id: r.id,
        action: r.status,
        description: `Request ${r.status.toLowerCase()} for ${r.targetUsername}`,
        amount: Number(r.amount),
        user: r.user.email,
        timestamp: r.updatedAt,
      })),
      ...recentJobs
        .filter((j) => j.request)
        .map((j) => ({
          type: 'job' as const,
          id: j.id,
          action: j.status,
          description: `Job ${j.status.toLowerCase()} for ${j.request!.targetUsername}`,
          amount: Number(j.request!.amount),
          timestamp: j.completedAt || j.createdAt,
        })),
      ...recentChats.map((c) => ({
        type: 'chat' as const,
        id: c.id,
        action: c.status,
        description: `Chat ${c.status.toLowerCase()} with ${c.user.email}`,
        lastMessage: c.messages[0]?.content,
        timestamp: c.updatedAt,
      })),
    ];

    return activities
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, limit);
  }

  /**
   * Get comprehensive analytics for the owner dashboard (ADMIN only)
   */
  async getAnalytics() {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // --- DAU: unique users who created a request today ---
    const dauResult: any[] = await this.prisma.$queryRaw`
      SELECT COUNT(DISTINCT "userId")::int as count
      FROM "Request"
      WHERE "createdAt" >= ${startOfToday}
    `;
    const dau = dauResult[0]?.count ?? 0;

    // --- MAU: unique users who created a request in last 30 days ---
    const mauResult: any[] = await this.prisma.$queryRaw`
      SELECT COUNT(DISTINCT "userId")::int as count
      FROM "Request"
      WHERE "createdAt" >= ${thirtyDaysAgo}
    `;
    const mau = mauResult[0]?.count ?? 0;

    // --- Revenue by day (last 30 days) ---
    const revenueByDay: any[] = await this.prisma.$queryRaw`
      SELECT
        DATE("createdAt") as date,
        COALESCE(SUM(amount), 0) as revenue,
        COUNT(*)::int as count
      FROM "Request"
      WHERE status = 'COMPLETED' AND "createdAt" >= ${thirtyDaysAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    // Fill in missing days
    const revenueByDayFilled: {
      date: string;
      revenue: number;
      count: number;
    }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        .toISOString()
        .split('T')[0];
      const found = revenueByDay.find(
        (r) => new Date(r.date).toISOString().split('T')[0] === dateStr,
      );
      revenueByDayFilled.push({
        date: dateStr,
        revenue: found ? Number(found.revenue) : 0,
        count: found ? Number(found.count) : 0,
      });
    }

    // --- Revenue by week (last 4 weeks) ---
    const revenueByWeek: { week: string; revenue: number; count: number }[] =
      [];
    for (let w = 3; w >= 0; w--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - w * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);
      weekEnd.setHours(23, 59, 59, 999);

      const weekResult = await this.prisma.request.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: weekStart, lte: weekEnd },
        },
        _sum: { amount: true },
        _count: true,
      });

      revenueByWeek.push({
        week: `${weekStart.toISOString().split('T')[0]} - ${weekEnd.toISOString().split('T')[0]}`,
        revenue: Number(weekResult._sum.amount || 0),
        count: weekResult._count,
      });
    }

    // --- Success rate ---
    const [completedCount, failedCount] = await Promise.all([
      this.prisma.request.count({ where: { status: 'COMPLETED' } }),
      this.prisma.request.count({ where: { status: 'FAILED' } }),
    ]);
    const totalFinished = completedCount + failedCount;
    const successRate =
      totalFinished > 0
        ? Math.round((completedCount / totalFinished) * 10000) / 100
        : 0;

    // --- Average processing time (APPROVED -> COMPLETED) ---
    const avgProcessingResult: any[] = await this.prisma.$queryRaw`
      SELECT AVG(EXTRACT(EPOCH FROM (j."completedAt" - j."createdAt")))::float as avg_seconds
      FROM "Job" j
      WHERE j.status = 'COMPLETED' AND j."completedAt" IS NOT NULL
    `;
    const avgProcessingSeconds = avgProcessingResult[0]?.avg_seconds ?? 0;

    // --- Top 10 users by volume ---
    const topUsers = await this.prisma.request.groupBy({
      by: ['userId'],
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    });

    // Fetch user details for top users
    const userIds = topUsers.map((u) => u.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const topUsersList = topUsers.map((u) => {
      const user = userMap.get(u.userId);
      return {
        userId: u.userId,
        email: user?.email || null,
        username: user?.username || null,
        totalAmount: Number(u._sum.amount || 0),
        requestCount: u._count,
      };
    });

    // --- Total system balance ---
    const balanceResult = await this.prisma.user.aggregate({
      _sum: { balance: true },
    });
    const totalSystemBalance = Number(balanceResult._sum.balance || 0);

    // --- Request distribution by status ---
    const statusDistribution = await this.prisma.request.groupBy({
      by: ['status'],
      _count: true,
    });
    const requestDistribution = statusDistribution.map((s) => ({
      status: s.status,
      count: s._count,
    }));

    // --- Validation success rate ---
    const [autoApproved, manuallyApproved, rejected, validationFailed] =
      await Promise.all([
        this.prisma.request.count({
          where: {
            status: { in: ['APPROVED', 'PROCESSING', 'COMPLETED'] },
            manuallyApproved: false,
            validationScore: { not: null },
          },
        }),
        this.prisma.request.count({
          where: { manuallyApproved: true },
        }),
        this.prisma.request.count({
          where: { status: 'REJECTED' },
        }),
        this.prisma.request.count({
          where: { status: 'VALIDATION_FAILED' },
        }),
      ]);

    const validationBreakdown = {
      autoApproved,
      manuallyApproved,
      rejected,
      validationFailed,
      total: autoApproved + manuallyApproved + rejected + validationFailed,
    };

    // --- Revenue today ---
    const todayRevenue = await this.prisma.request.aggregate({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: startOfToday },
      },
      _sum: { amount: true },
    });

    // --- Total revenue all time ---
    const totalRevenue = await this.prisma.request.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
    });

    // --- Prize claims analytics ---
    const [totalPrizesPaidResult, prizeClaimCount] = await Promise.all([
      this.prisma.prizeClaim.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.prizeClaim.count({ where: { status: 'COMPLETED' } }),
    ]);
    const totalPrizesPaid = Number(totalPrizesPaidResult._sum.amount || 0);
    const totalRevenueNum = Number(totalRevenue._sum.amount || 0);
    const profitAmount = totalRevenueNum - totalPrizesPaid;
    const profitPercentage =
      totalRevenueNum > 0
        ? Math.round((profitAmount / totalRevenueNum) * 10000) / 100
        : 0;

    // --- Recent prize claims ---
    const recentPrizes = await this.prisma.prizeClaim.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { user: { select: { username: true, email: true } } },
    });

    // --- Monthly stats (last 12 months) ---
    const monthlyStats: any[] = [];
    for (let m = 11; m >= 0; m--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth() - m + 1,
        0,
        23,
        59,
        59,
        999,
      );

      const [monthRevenue, monthPrizes, monthExpenses] = await Promise.all([
        this.prisma.request.aggregate({
          where: {
            status: 'COMPLETED',
            createdAt: { gte: monthStart, lte: monthEnd },
          },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.prizeClaim.aggregate({
          where: {
            status: 'COMPLETED',
            updatedAt: { gte: monthStart, lte: monthEnd },
          },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.expense
          .aggregate({
            where: { date: { gte: monthStart, lte: monthEnd } },
            _sum: { amount: true },
          })
          .catch(() => ({ _sum: { amount: null } })),
      ]);

      const rev = Number(monthRevenue._sum.amount || 0);
      const prizes = Number(monthPrizes._sum.amount || 0);
      const expenses = Number(monthExpenses._sum.amount || 0);

      monthlyStats.push({
        month: monthStart.toLocaleString('es-AR', { month: 'short' }),
        year: monthStart.getFullYear(),
        monthKey: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
        revenue: rev,
        prizesPaid: prizes,
        expenses,
        profit: rev - prizes - expenses,
        requestCount: monthRevenue._count,
        prizeCount: monthPrizes._count,
      });
    }

    // --- Kill switch status ---
    const killSwitchActive = await this.getKillSwitchStatus();

    return {
      dau,
      mau,
      revenueToday: Number(todayRevenue._sum.amount || 0),
      totalRevenue: Number(totalRevenue._sum.amount || 0),
      successRate,
      avgProcessingTimeSeconds: Math.round(avgProcessingSeconds),
      revenueByDay: revenueByDayFilled,
      revenueByWeek,
      topUsers: topUsersList,
      totalSystemBalance,
      requestDistribution,
      validationBreakdown,
      completedRequests: completedCount,
      failedRequests: failedCount,
      totalPrizesPaid,
      prizeClaimCount,
      profitAmount,
      profitPercentage,
      recentPrizes: recentPrizes.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        user: p.user?.username || p.user?.email || 'Unknown',
        date: p.updatedAt,
      })),
      monthlyStats,
      killSwitchActive,
      generatedAt: new Date(),
    };
  }

  /**
   * Helper: Get kill switch status from settings
   */
  private async getKillSwitchStatus(): Promise<boolean> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'KILL_SWITCH' },
    });
    return setting?.value === 'true';
  }

  /**
   * Helper: Get bot status
   */
  private async getBotStatus(): Promise<SystemHealthDto['bot']> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'BOT_STATUS' },
    });

    const lastHeartbeat = await this.prisma.setting.findUnique({
      where: { key: 'BOT_LAST_HEARTBEAT' },
    });

    const currentJob = await this.prisma.job.findFirst({
      where: { status: 'PROCESSING' },
    });

    return {
      status: (setting?.value as any) || 'offline',
      lastHeartbeat: lastHeartbeat?.value
        ? new Date(lastHeartbeat.value)
        : undefined,
      currentJob: currentJob?.id,
    };
  }

  /**
   * Helper: Determine bot status from queue
   */
  private determineBotStatus(
    queueStatus: any,
  ): 'online' | 'offline' | 'busy' | 'error' {
    if (queueStatus.active > 0) return 'busy';
    if (queueStatus.failed > 0) return 'error';
    return 'online';
  }

  // ==========================================
  // KILL SWITCH (owner dashboard)
  // ==========================================

  async getKillSwitchInfo() {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'KILL_SWITCH' },
    });
    const reason = await this.prisma.setting.findUnique({
      where: { key: 'KILL_SWITCH_REASON' },
    });
    return {
      active: setting?.value === 'true',
      reason: reason?.value || null,
    };
  }

  async activateKillSwitch(reason?: string) {
    await this.prisma.setting.upsert({
      where: { key: 'KILL_SWITCH' },
      update: { value: 'true' },
      create: { key: 'KILL_SWITCH', value: 'true' },
    });
    if (reason) {
      await this.prisma.setting.upsert({
        where: { key: 'KILL_SWITCH_REASON' },
        update: { value: reason },
        create: { key: 'KILL_SWITCH_REASON', value: reason },
      });
    }
    return { active: true, reason };
  }

  async deactivateKillSwitch() {
    await this.prisma.setting.upsert({
      where: { key: 'KILL_SWITCH' },
      update: { value: 'false' },
      create: { key: 'KILL_SWITCH', value: 'false' },
    });
    return { active: false };
  }

  // ==========================================
  // EXPENSES
  // ==========================================

  async getExpenses(month?: string) {
    const where: any = {};
    if (month) {
      const [year, m] = month.split('-').map(Number);
      const start = new Date(year, m - 1, 1);
      const end = new Date(year, m, 0, 23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }
    const expenses = await this.prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
    });
    const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    return { expenses, total };
  }

  async createExpense(data: {
    category: string;
    description: string;
    amount: number;
    date: string;
    recurring?: boolean;
  }) {
    return this.prisma.expense.create({
      data: {
        category: data.category,
        description: data.description,
        amount: data.amount,
        date: new Date(data.date),
        recurring: data.recurring || false,
      },
    });
  }

  async deleteExpense(id: string) {
    await this.prisma.expense.delete({ where: { id } });
    return { success: true };
  }

  // ==========================================
  // VAULT
  // ==========================================

  async getVaultEntries() {
    const entries = await this.prisma.vaultEntry.findMany({
      orderBy: { category: 'asc' },
    });
    return entries;
  }

  async createVaultEntry(data: {
    category: string;
    label: string;
    username?: string;
    password: string;
    url?: string;
    notes?: string;
  }) {
    return this.prisma.vaultEntry.create({ data });
  }

  async updateVaultEntry(id: string, data: any) {
    const { id: _, createdAt, ...updateData } = data;
    return this.prisma.vaultEntry.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteVaultEntry(id: string) {
    await this.prisma.vaultEntry.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Consolidated monitoring data for Client Manager.
   * Single endpoint that returns everything needed for remote monitoring.
   */
  async getMonitoringData() {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yesterday = new Date(todayStart);
    yesterday.setDate(yesterday.getDate() - 1);

    // Run all queries in parallel
    const [
      revenueToday,
      revenueWeek,
      revenueMonth,
      revenueTotal,
      volumeToday,
      volumeWeek,
      volumeMonth,
      volumeTotal,
      failuresPending,
      failuresToday,
      operatorsTotal,
      operatorsOnline,
      panelBalances,
      recentCompleted,
      recentFailed,
      recentPending,
      queueLength,
      activeJobs,
    ] = await Promise.all([
      // Revenue (sum of completed request amounts)
      this.prisma.request.aggregate({
        where: { status: 'COMPLETED', updatedAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      this.prisma.request.aggregate({
        where: { status: 'COMPLETED', updatedAt: { gte: weekStart } },
        _sum: { amount: true },
      }),
      this.prisma.request.aggregate({
        where: { status: 'COMPLETED', updatedAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.request.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      // Volume (count of completed requests)
      this.prisma.request.count({
        where: { status: 'COMPLETED', updatedAt: { gte: todayStart } },
      }),
      this.prisma.request.count({
        where: { status: 'COMPLETED', updatedAt: { gte: weekStart } },
      }),
      this.prisma.request.count({
        where: { status: 'COMPLETED', updatedAt: { gte: monthStart } },
      }),
      this.prisma.request.count({ where: { status: 'COMPLETED' } }),
      // Failures
      this.prisma.request.count({
        where: { status: { in: ['VALIDATION_FAILED', 'FAILED'] } },
      }),
      this.prisma.request.count({
        where: {
          status: { in: ['VALIDATION_FAILED', 'FAILED'] },
          updatedAt: { gte: todayStart },
        },
      }),
      // Operators
      this.prisma.operator.count(),
      this.prisma.operator.count({ where: { isAvailable: true } }),
      // Panel balances
      this.prisma.panel.findMany({
        where: { isActive: true },
        select: { name: true },
      }),
      // Recent 24h
      this.prisma.request.count({
        where: { status: 'COMPLETED', updatedAt: { gte: yesterday } },
      }),
      this.prisma.request.count({
        where: { status: 'FAILED', updatedAt: { gte: yesterday } },
      }),
      this.prisma.request.count({
        where: {
          status: {
            in: ['PENDING_PROOF', 'VALIDATING', 'APPROVED', 'PROCESSING'],
          },
        },
      }),
      // Queue
      this.prisma.job.count({ where: { status: 'QUEUED' } }),
      this.prisma.job.count({ where: { status: 'PROCESSING' } }),
    ]);

    // Get bot status and kill switch from settings
    let botStatus = 'offline';
    let killSwitch = false;
    try {
      const botStatusSetting = await this.prisma.setting.findUnique({
        where: { key: 'BOT_STATUS' },
      });
      const killSwitchSetting = await this.prisma.setting.findUnique({
        where: { key: 'KILL_SWITCH' },
      });
      botStatus = botStatusSetting?.value || 'offline';
      killSwitch = killSwitchSetting?.value === 'true';
    } catch {}

    // DB latency check
    const dbStart = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - dbStart;

    return {
      revenue: {
        today: Number(revenueToday._sum.amount || 0),
        week: Number(revenueWeek._sum.amount || 0),
        month: Number(revenueMonth._sum.amount || 0),
        total: Number(revenueTotal._sum.amount || 0),
        currency: 'ARS',
      },
      volume: {
        todayCount: volumeToday,
        weekCount: volumeWeek,
        monthCount: volumeMonth,
        totalCount: volumeTotal,
      },
      system: {
        botStatus,
        killSwitch,
        uptime: process.uptime() * 1000,
        dbLatency,
        queueLength,
        activeJobs,
      },
      failures: {
        pendingCount: failuresPending,
        todayCount: failuresToday,
      },
      operators: {
        total: operatorsTotal,
        online: operatorsOnline,
      },
      panelBalance: panelBalances.map((p) => ({
        panelName: p.name,
        amount: 0,
      })),
      recentRequests: {
        completed: recentCompleted,
        failed: recentFailed,
        pending: recentPending,
      },
    };
  }
}
