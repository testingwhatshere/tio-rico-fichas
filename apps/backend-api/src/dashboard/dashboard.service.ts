import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { invalidateSettingsCache } from '../settings/settings-cache';
import { JobsService } from '../jobs/jobs.service';
import { UploadsService } from '../uploads/uploads.service';
import { attachProofTwins } from '../common/utils/proof-twins';
import { fetchValidationSummaries } from '../common/utils/validation-summary';
import {
  DashboardStatsDto,
  RequestTrendDto,
  RevenueStatsDto,
  SystemHealthDto,
} from './dto';

/**
 * El monto que el OCR leyo en el comprobante, aplanado desde `validationDetails`.
 *
 * Es el numero con el que el operador decide cuanto cargar cuando lo transferido
 * no coincide con lo pedido. Vive anidado en un Json de ~20 campos y el panel
 * esperaba un campo plano, asi que en la practica no llegaba nunca.
 */
function extractedAmountOf(validationDetails: unknown): number | null {
  const raw = (validationDetails as any)?.extractedAmount;
  const n = Number(raw);
  return raw != null && Number.isFinite(n) && n > 0 ? n : null;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
    private readonly uploadsService: UploadsService,
  ) {}

  /**
   * Get comprehensive dashboard statistics
   */
  /**
   * Cache del payload de stats sin argumentos (el caso que usa `getInitialData`).
   *
   * Son 32 queries en 9 oleadas secuenciales y el resultado es identico para
   * todos los operadores: no depende de quien pregunta. Se recalculaba entero en
   * cada conexion y cada reconexion. Cinco segundos alcanzan para colapsar la
   * rafaga de reconexiones sin que el numero se sienta viejo.
   */
  private statsCache: { at: number; data: DashboardStatsDto } | null = null;
  private static readonly STATS_CACHE_MS = 5000;

  async getDashboardStats(from?: Date, to?: Date): Promise<DashboardStatsDto> {
    const cacheable = !from && !to;
    if (cacheable && this.statsCache) {
      if (Date.now() - this.statsCache.at < DashboardService.STATS_CACHE_MS) {
        return this.statsCache.data;
      }
    }
    const result = await this.computeDashboardStats(from, to);
    if (cacheable) this.statsCache = { at: Date.now(), data: result };
    return result;
  }

  private async computeDashboardStats(
    from?: Date,
    to?: Date,
  ): Promise<DashboardStatsDto> {
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

    // Estadísticas por estado: un `groupBy` por tabla en vez de un `count` por
    // estado.
    //
    // Eran 20 consultas disparadas juntas contra un pool de 9 conexiones. Con
    // dos operadores conectando a la vez el pool se agotaba y fallaba TODO —
    // incluida la app de los usuarios, que comparte el mismo pool: el
    // 2026-08-26 hubo 500 en /api/messages y respuestas de 9 segundos.
    const [requestGroups, jobGroups, chatGroups] = await Promise.all([
      this.prisma.request.groupBy({
        by: ['status'],
        where: dateFilter,
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['status'],
        where: dateFilter,
        _count: { _all: true },
      }),
      this.prisma.chat.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const countOf = (groups: any[], status: string) =>
      groups.find((g) => g.status === status)?._count?._all ?? 0;
    const totalOf = (groups: any[]) =>
      groups.reduce((acc, g) => acc + (g._count?._all ?? 0), 0);

    // Request statistics
    const totalRequests = totalOf(requestGroups);
    const pendingRequests = countOf(requestGroups, 'PENDING_PROOF');
    const validatingRequests = countOf(requestGroups, 'VALIDATING');
    const validationFailedRequests = countOf(requestGroups, 'VALIDATION_FAILED');
    const pendingMpVerification = countOf(
      requestGroups,
      'PENDING_MP_VERIFICATION',
    );
    const approvedRequests = countOf(requestGroups, 'APPROVED');
    const processingRequests = countOf(requestGroups, 'PROCESSING');
    const completedRequests = countOf(requestGroups, 'COMPLETED');
    const failedRequests = countOf(requestGroups, 'FAILED');
    const rejectedRequests = countOf(requestGroups, 'REJECTED');
    const cancelledRequests = countOf(requestGroups, 'CANCELLED');

    // Job statistics
    const totalJobs = totalOf(jobGroups);
    const queuedJobs = countOf(jobGroups, 'QUEUED');
    const processingJobs = countOf(jobGroups, 'PROCESSING');
    const completedJobs = countOf(jobGroups, 'COMPLETED');
    const failedJobs = countOf(jobGroups, 'FAILED');

    // Chat statistics
    const totalChats = totalOf(chatGroups);
    const openChats = countOf(chatGroups, 'OPEN');
    const assignedChats = countOf(chatGroups, 'ASSIGNED');
    const closedChats = countOf(chatGroups, 'CLOSED');

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
    // Un fallo de discovery deja el Request en FAILED SIN fila Job: el bot nunca se
    // despacha porque nunca se resolvio un panel. Esos casos caian entre las dos
    // consultas de abajo (no son VALIDATION_FAILED y no tienen Job fallido) y quedaban
    // invisibles para el operador: se veian en "Solicitudes" pero sin ninguna accion
    // posible. Corte a 7 dias para que filas viejas sin resolver no inunden la cola.
    const discoveryCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Las otras dos colas no tenian ningun corte: se arrastraban fallos de
    // meses que nadie va a resolver (habia filas de 134 dias en la cola de
    // "pendientes"). 30 dias cubre de sobra lo accionable; lo mas viejo sigue
    // consultable por los endpoints de requests/jobs, que si paginan.
    const failureCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [validationFailures, jobFailures, discoveryFailures] =
      await Promise.all([
        this.prisma.request.findMany({
          where: {
            status: 'VALIDATION_FAILED',
            createdAt: { gte: failureCutoff },
          },
          // Sin `validationDetails`: el JSON del OCR viajaba entero desde
          // Supabase en cada payload inicial. Se pide recortado mas abajo.
          select: {
            id: true,
            userId: true,
            targetUsername: true,
            amount: true,
            status: true,
            proofUrl: true,
            proofHash: true,
            extractedTransactionId: true,
            validationScore: true,
            validationError: true,
            createdAt: true,
            user: { select: { id: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.job.findMany({
          where: {
            status: 'FAILED',
            createdAt: { gte: failureCutoff },
            // El job queda FAILED para siempre, pero el caso puede haberse
            // resuelto por otro lado: el usuario canceló la carga, un operador
            // la marcó cargada a mano o la rechazó. El job fallido seguía
            // apareciendo en la bandeja sin nada que hacer con él —muerto—
            // porque esta consulta sólo miraba el estado del job.
            //
            // Los jobs sin request (retiro de fichas, cambio de contraseña,
            // creación de usuario) no tienen a quién mirar, así que pasan.
            OR: [
              { requestId: null },
              {
                request: {
                  is: {
                    status: { notIn: ['CANCELLED', 'COMPLETED', 'REJECTED'] },
                  },
                },
              },
            ],
          },
          // `select` en vez de `include`: antes traia la fila entera del Job
          // (result, screenshot, newPassword) y del Request, para descartar
          // casi todo en el mapper de abajo.
          select: {
            id: true,
            requestId: true,
            error: true,
            screenshot: true,
            createdAt: true,
            request: {
              select: {
                id: true,
                userId: true,
                targetUsername: true,
                amount: true,
                proofUrl: true,
                // Para marcar "comprobante repetido" sin comparar a ojo.
                proofHash: true,
                extractedTransactionId: true,
                user: { select: { id: true, email: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.request.findMany({
          where: {
            status: 'FAILED',
            job: { is: null },
            createdAt: { gte: discoveryCutoff },
          },
          select: {
            id: true,
            userId: true,
            targetUsername: true,
            amount: true,
            status: true,
            proofUrl: true,
            proofHash: true,
            extractedTransactionId: true,
            validationScore: true,
            validationError: true,
            createdAt: true,
            user: { select: { id: true, email: true } },
            statusHistory: {
              where: { status: 'FAILED' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { metadata: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);

    // Lo unico que se usa del JSON del OCR, recortado por Postgres.
    const summaries = await fetchValidationSummaries(this.prisma, [
      ...validationFailures.map((r) => r.id),
      ...jobFailures.map((j) => j.request?.id ?? ''),
      ...discoveryFailures.map((r) => r.id),
    ]);

    // Los repetidos de las tres listas salen de una sola query: el operador que
    // recibe un segundo comprobante necesita saber si es el mismo de antes.
    const twinsById = new Map(
      (
        await attachProofTwins(this.prisma, [
          ...validationFailures.map((r) => ({
            id: r.id,
            userId: r.userId,
            proofHash: r.proofHash,
            extractedTransactionId: r.extractedTransactionId,
          })),
          ...jobFailures
            .filter((j) => j.request)
            .map((j) => ({
              id: j.request!.id,
              userId: j.request!.userId,
              proofHash: j.request!.proofHash,
              extractedTransactionId: j.request!.extractedTransactionId,
            })),
          ...discoveryFailures.map((r) => ({
            id: r.id,
            userId: r.userId,
            proofHash: r.proofHash,
            extractedTransactionId: r.extractedTransactionId,
          })),
        ])
      ).map((r) => [r.id, r.proofTwins] as const),
    );

    return {
      validationFailures: validationFailures.map((r) => ({
        id: r.id,
        type: 'validation_failed',
        userId: r.userId,
        userEmail: r.user.email,
        targetUsername: r.targetUsername,
        amount: Number(r.amount),
        // Normalize PDF proofs (Personal Pay etc.) to a first-page JPG so the
        // operator's <img> can render them — raw Cloudinary PDFs return 401.
        proofUrl: this.uploadsService.toDeliverableUrl(r.proofUrl ?? ''),
        proofTwins: twinsById.get(r.id) ?? [],
        validationScore: r.validationScore,
        validationError: r.validationError,
        validationDetails: summaries.get(r.id) ?? null,
        // Plano, ademas de anidado: el panel decide con este numero (cuanto
        // transfirio de verdad) y leerlo de adentro de validationDetails es lo
        // que fallaba — el boton "aceptar y cargar $X" nunca aparecia.
        extractedAmount: extractedAmountOf(summaries.get(r.id)),
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
          // El comprobante ya venia en la query (el include trae la fila entera
          // del Request) y se descartaba. Cuesta cero mandarlo, y le sirve al
          // operador para ver que pago la persona antes de decidir si carga a
          // mano: el bot casi nunca deja screenshot.
          proofUrl: this.uploadsService.toDeliverableUrl(j.request!.proofUrl ?? ''),
          proofTwins: twinsById.get(j.request!.id) ?? [],
          extractedAmount: extractedAmountOf(summaries.get(j.request!.id)),
          createdAt: j.createdAt,
        })),
      // Van keyed por el id del Request (no de un Job): approve/reject/retry del panel
      // resuelven un Request via `requestId ?? id`, asi que ambos campos apuntan ahi.
      discoveryFailures: discoveryFailures.map((r) => ({
        id: r.id,
        type: 'job_failed',
        requestId: r.id,
        userId: r.userId,
        userEmail: r.user.email,
        targetUsername: r.targetUsername,
        amount: Number(r.amount),
        proofUrl: this.uploadsService.toDeliverableUrl(r.proofUrl ?? ''),
        proofTwins: twinsById.get(r.id) ?? [],
        error:
          ((r.statusHistory[0]?.metadata as any)?.reason as string) ||
          'No se pudo asignar un panel para este usuario',
        extractedAmount: extractedAmountOf(summaries.get(r.id)),
        createdAt: r.createdAt,
      })),
      total:
        validationFailures.length +
        jobFailures.length +
        discoveryFailures.length,
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
        select: {
          id: true,
          status: true,
          targetUsername: true,
          amount: true,
          updatedAt: true,
          user: { select: { id: true, email: true } },
        },
      }),
      this.prisma.job.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          createdAt: true,
          completedAt: true,
          request: {
            select: { targetUsername: true, amount: true },
          },
        },
      }),
      // Sin `include: { messages: { take: 1 } }`: Prisma 6 lo resolvia trayendo
      // todos los mensajes de esos chats. El ultimo va aparte, uno por chat.
      this.prisma.chat.findMany({
        where: { status: { in: ['OPEN', 'ASSIGNED'] } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          updatedAt: true,
          user: { select: { id: true, email: true } },
        },
      }),
    ]);

    const lastByChat = new Map(
      (recentChats.length
        ? await this.prisma.$queryRaw<Array<{ chatId: string; content: string }>>`
            SELECT c.id AS "chatId", m.content
            FROM unnest(${recentChats.map((c) => c.id)}::text[]) AS c(id)
            CROSS JOIN LATERAL (
              SELECT left(content, 300) AS content FROM "Message"
              WHERE "chatId" = c.id ORDER BY "createdAt" DESC LIMIT 1
            ) m`
        : []
      ).map((r) => [r.chatId, r.content] as const),
    );

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
        lastMessage: lastByChat.get(c.id),
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
    invalidateSettingsCache();
    if (reason) {
      await this.prisma.setting.upsert({
        where: { key: 'KILL_SWITCH_REASON' },
        update: { value: reason },
        create: { key: 'KILL_SWITCH_REASON', value: reason },
      });
      invalidateSettingsCache();
    }
    return { active: true, reason };
  }

  async deactivateKillSwitch() {
    await this.prisma.setting.upsert({
      where: { key: 'KILL_SWITCH' },
      update: { value: 'false' },
      create: { key: 'KILL_SWITCH', value: 'false' },
    });
    invalidateSettingsCache();
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
