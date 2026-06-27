import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidatorGateway } from './validator.gateway';
import {
  ValidationAnalyticsDto,
  ValidationTrendDto,
  RejectionReasonDto,
  PaymentMethodStatsDto,
} from './dto/validation-analytics.dto';

@Injectable()
export class ValidatorAnalyticsService {
  private readonly logger = new Logger(ValidatorAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validatorGateway: ValidatorGateway,
  ) {}

  /**
   * Get comprehensive validation analytics
   */
  async getValidationAnalytics(
    days: number = 7,
  ): Promise<ValidationAnalyticsDto> {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);

    // Fetch all data in parallel for performance
    const [
      totalCount,
      successCount,
      failedCount,
      avgConfidenceResult,
      trends,
      rejectionReasons,
      paymentMethods,
      avgProcessingTime,
    ] = await Promise.all([
      this.getTotalValidations(fromDate),
      this.getSuccessfulValidations(fromDate),
      this.getFailedValidations(fromDate),
      this.getAverageConfidence(fromDate),
      this.getTrends(days, fromDate),
      this.getTopRejectionReasons(fromDate),
      this.getPaymentMethodBreakdown(fromDate),
      this.getAverageProcessingTime(fromDate),
    ]);

    const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;

    return {
      period: {
        from: fromDate,
        to: toDate,
        days,
      },
      summary: {
        totalValidations: totalCount,
        successfulValidations: successCount,
        failedValidations: failedCount,
        successRate: Math.round(successRate * 100) / 100,
        averageConfidence: avgConfidenceResult,
        averageProcessingTimeMs: avgProcessingTime,
      },
      trends,
      rejectionReasons,
      paymentMethods,
      validatorStatus: {
        connected: this.validatorGateway.isValidatorConnected(),
        lastHeartbeat: undefined, // Could be tracked separately
      },
    };
  }

  private async getTotalValidations(fromDate: Date): Promise<number> {
    return this.prisma.request.count({
      where: {
        status: { notIn: ['PENDING_PROOF'] },
        proofUploadedAt: { gte: fromDate },
      },
    });
  }

  private async getSuccessfulValidations(fromDate: Date): Promise<number> {
    return this.prisma.request.count({
      where: {
        status: { in: ['APPROVED', 'PROCESSING', 'COMPLETED'] },
        validationScore: { gte: 0 },
        proofUploadedAt: { gte: fromDate },
      },
    });
  }

  private async getFailedValidations(fromDate: Date): Promise<number> {
    return this.prisma.request.count({
      where: {
        status: 'VALIDATION_FAILED',
        proofUploadedAt: { gte: fromDate },
      },
    });
  }

  private async getAverageConfidence(fromDate: Date): Promise<number> {
    const result = await this.prisma.request.aggregate({
      where: {
        validationScore: { not: null },
        proofUploadedAt: { gte: fromDate },
      },
      _avg: { validationScore: true },
    });
    return Math.round((result._avg.validationScore || 0) * 100) / 100;
  }

  private async getAverageProcessingTime(fromDate: Date): Promise<number> {
    // Calculate from validator logs where we track duration
    const logs = await this.prisma.validatorLog.findMany({
      where: {
        category: 'VALIDATION',
        level: { in: ['SUCCESS', 'WARN'] },
        timestamp: { gte: fromDate },
      },
      select: { data: true },
    });

    const durations = logs
      .map((log) => {
        const data = log.data as any;
        return data?.durationMs || 0;
      })
      .filter((d) => d > 0);

    if (durations.length === 0) return 0;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }

  private async getTrends(
    days: number,
    fromDate: Date,
  ): Promise<ValidationTrendDto[]> {
    const trends: ValidationTrendDto[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      );
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const [total, successful, failed] = await Promise.all([
        this.prisma.request.count({
          where: {
            status: { notIn: ['PENDING_PROOF'] },
            proofUploadedAt: { gte: startOfDay, lt: endOfDay },
          },
        }),
        this.prisma.request.count({
          where: {
            status: { in: ['APPROVED', 'PROCESSING', 'COMPLETED'] },
            proofUploadedAt: { gte: startOfDay, lt: endOfDay },
          },
        }),
        this.prisma.request.count({
          where: {
            status: 'VALIDATION_FAILED',
            proofUploadedAt: { gte: startOfDay, lt: endOfDay },
          },
        }),
      ]);

      trends.push({
        date: startOfDay.toISOString().split('T')[0],
        total,
        successful,
        failed,
      });
    }

    return trends;
  }

  private async getTopRejectionReasons(
    fromDate: Date,
  ): Promise<RejectionReasonDto[]> {
    // Get failed validations with their error messages
    const failedRequests = await this.prisma.request.findMany({
      where: {
        status: 'VALIDATION_FAILED',
        proofUploadedAt: { gte: fromDate },
        validationError: { not: null },
      },
      select: { validationError: true, validationDetails: true },
    });

    // Count occurrences of each flag/reason
    const reasonCounts: Record<string, number> = {};

    for (const request of failedRequests) {
      const details = request.validationDetails as any;
      const flags = details?.flags || [];

      // Count by flags
      for (const flag of flags) {
        reasonCounts[flag] = (reasonCounts[flag] || 0) + 1;
      }

      // If no flags, count by error message
      if (flags.length === 0 && request.validationError) {
        const shortReason = request.validationError.split('.')[0] || 'Unknown';
        reasonCounts[shortReason] = (reasonCounts[shortReason] || 0) + 1;
      }
    }

    const total = failedRequests.length || 1;

    return Object.entries(reasonCounts)
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: Math.round((count / total) * 100 * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 reasons
  }

  private async getPaymentMethodBreakdown(
    fromDate: Date,
  ): Promise<PaymentMethodStatsDto[]> {
    // Get validated requests with payment method info
    const requests = await this.prisma.request.findMany({
      where: {
        proofUploadedAt: { gte: fromDate },
      },
      select: { validationDetails: true },
    });

    const methodCounts: Record<string, number> = {};

    for (const request of requests) {
      if (!request.validationDetails) continue;
      const details = request.validationDetails as any;
      const method = details?.paymentMethod || 'Unknown';
      methodCounts[method] = (methodCounts[method] || 0) + 1;
    }

    return Object.entries(methodCounts)
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get quick stats for dashboard widgets
   */
  async getQuickStats(): Promise<{
    today: { total: number; successful: number; failed: number };
    validatorConnected: boolean;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, successful, failed] = await Promise.all([
      this.prisma.request.count({
        where: {
          status: { notIn: ['PENDING_PROOF'] },
          proofUploadedAt: { gte: today },
        },
      }),
      this.prisma.request.count({
        where: {
          status: { in: ['APPROVED', 'PROCESSING', 'COMPLETED'] },
          proofUploadedAt: { gte: today },
        },
      }),
      this.prisma.request.count({
        where: {
          status: 'VALIDATION_FAILED',
          proofUploadedAt: { gte: today },
        },
      }),
    ]);

    return {
      today: { total, successful, failed },
      validatorConnected: this.validatorGateway.isValidatorConnected(),
    };
  }
}
