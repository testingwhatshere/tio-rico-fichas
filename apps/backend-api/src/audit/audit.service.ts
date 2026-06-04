import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAuditLogDto,
  AuditLogQueryDto,
  AuditLogResponseDto,
  AuditAction,
  EntityType,
} from './dto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an audit log entry
   */
  async log(dto: CreateAuditLogDto): Promise<AuditLogResponseDto> {
    const auditLog = await this.prisma.auditLog.create({
      data: {
        operatorId: dto.operatorId,
        action: dto.action,
        entityType: dto.entityType,
        entityId: dto.entityId,
        metadata: dto.metadata,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      },
      include: {
        operator: {
          select: { id: true, email: true },
        },
      },
    });

    this.logger.log(
      `Audit: ${dto.action} on ${dto.entityType}:${dto.entityId}${dto.operatorId ? ` by ${dto.operatorId}` : ''}`,
    );

    return this.formatAuditLog(auditLog);
  }

  /**
   * Quick logging helper for request events
   */
  async logRequest(
    action: AuditAction,
    requestId: string,
    operatorId?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      action,
      entityType: EntityType.REQUEST,
      entityId: requestId,
      operatorId,
      metadata,
    });
  }

  /**
   * Quick logging helper for job events
   */
  async logJob(
    action: AuditAction,
    jobId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      action,
      entityType: EntityType.JOB,
      entityId: jobId,
      metadata,
    });
  }

  /**
   * Quick logging helper for system events
   */
  async logSystem(
    action: AuditAction,
    operatorId?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      action,
      entityType: EntityType.SYSTEM,
      entityId: 'SYSTEM',
      operatorId,
      metadata,
    });
  }

  /**
   * Query audit logs with filters
   */
  async query(query: AuditLogQueryDto): Promise<{
    logs: AuditLogResponseDto[];
    total: number;
    hasMore: boolean;
  }> {
    const where: any = {};

    if (query.action) {
      where.action = query.action;
    }
    if (query.entityType) {
      where.entityType = query.entityType;
    }
    if (query.entityId) {
      where.entityId = query.entityId;
    }
    if (query.operatorId) {
      where.operatorId = query.operatorId;
    }
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) {
        where.timestamp.gte = query.from;
      }
      if (query.to) {
        where.timestamp.lte = query.to;
      }
    }

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          operator: {
            select: { id: true, email: true },
          },
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs: logs.map((log) => this.formatAuditLog(log)),
      total,
      hasMore: offset + logs.length < total,
    };
  }

  /**
   * Get audit logs for a specific entity
   */
  async getEntityHistory(
    entityType: EntityType,
    entityId: string,
  ): Promise<AuditLogResponseDto[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        entityType,
        entityId,
      },
      include: {
        operator: {
          select: { id: true, email: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    return logs.map((log) => this.formatAuditLog(log));
  }

  /**
   * Get operator activity
   */
  async getOperatorActivity(
    operatorId: string,
    from?: Date,
    to?: Date,
  ): Promise<AuditLogResponseDto[]> {
    const where: any = { operatorId };

    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      include: {
        operator: {
          select: { id: true, email: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    return logs.map((log) => this.formatAuditLog(log));
  }

  /**
   * Get recent system activity
   */
  async getRecentActivity(limit: number = 50): Promise<AuditLogResponseDto[]> {
    const logs = await this.prisma.auditLog.findMany({
      include: {
        operator: {
          select: { id: true, email: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return logs.map((log) => this.formatAuditLog(log));
  }

  /**
   * Get action statistics
   */
  async getActionStats(from?: Date, to?: Date): Promise<Record<string, number>> {
    const where: any = {};
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const stats = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: { action: true },
    });

    return stats.reduce(
      (acc, stat) => {
        acc[stat.action] = stat._count.action;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  /**
   * Format audit log for response
   */
  private formatAuditLog(log: any): AuditLogResponseDto {
    return {
      id: log.id,
      operatorId: log.operatorId,
      action: log.action as AuditAction,
      entityType: log.entityType as EntityType,
      entityId: log.entityId,
      metadata: log.metadata,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      timestamp: log.timestamp,
      operator: log.operator,
    };
  }
}
