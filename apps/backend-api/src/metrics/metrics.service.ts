import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

interface HourlyBucket {
  requests: number;
  jobsCompleted: number;
  jobsFailed: number;
  validationsSucceeded: number;
  validationsFailed: number;
  totalProcessingMs: number;
  jobsProcessed: number; // for avg calculation
}

@Injectable()
export class MetricsService implements OnModuleInit {
  private startTime: number;
  private current: HourlyBucket;
  private previousHours: HourlyBucket[] = [];
  private rotateInterval: ReturnType<typeof setInterval>;

  onModuleInit() {
    this.startTime = Date.now();
    this.current = this.emptyBucket();

    // Rotate hourly bucket every hour
    this.rotateInterval = setInterval(
      () => this.rotateBucket(),
      60 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.rotateInterval) clearInterval(this.rotateInterval);
  }

  // ---- Event Listeners ----

  @OnEvent('request.created')
  onRequestCreated() {
    this.current.requests++;
  }

  @OnEvent('job.completed')
  onJobCompleted(data?: { durationMs?: number }) {
    this.current.jobsCompleted++;
    this.current.jobsProcessed++;
    if (data?.durationMs) {
      this.current.totalProcessingMs += data.durationMs;
    }
  }

  @OnEvent('job.failed')
  onJobFailed() {
    this.current.jobsFailed++;
    this.current.jobsProcessed++;
  }

  @OnEvent('validation.completed')
  onValidationCompleted() {
    this.current.validationsSucceeded++;
  }

  @OnEvent('validation.failed')
  onValidationFailed() {
    this.current.validationsFailed++;
  }

  // ---- Public API ----

  getMetrics() {
    const uptimeMs = Date.now() - this.startTime;
    const allBuckets = [...this.previousHours, this.current];

    const totals = allBuckets.reduce(
      (acc, b) => ({
        requests: acc.requests + b.requests,
        jobsCompleted: acc.jobsCompleted + b.jobsCompleted,
        jobsFailed: acc.jobsFailed + b.jobsFailed,
        validationsSucceeded: acc.validationsSucceeded + b.validationsSucceeded,
        validationsFailed: acc.validationsFailed + b.validationsFailed,
        totalProcessingMs: acc.totalProcessingMs + b.totalProcessingMs,
        jobsProcessed: acc.jobsProcessed + b.jobsProcessed,
      }),
      this.emptyBucket(),
    );

    const totalJobs = totals.jobsCompleted + totals.jobsFailed;
    const successRate =
      totalJobs > 0 ? Math.round((totals.jobsCompleted / totalJobs) * 100) : 0;
    const avgProcessingMs =
      totals.jobsProcessed > 0
        ? Math.round(totals.totalProcessingMs / totals.jobsProcessed)
        : 0;

    return {
      uptime: {
        ms: uptimeMs,
        hours: Math.floor(uptimeMs / 3600000),
        human: this.formatUptime(uptimeMs),
      },
      currentHour: {
        requests: this.current.requests,
        jobsCompleted: this.current.jobsCompleted,
        jobsFailed: this.current.jobsFailed,
        validationsSucceeded: this.current.validationsSucceeded,
        validationsFailed: this.current.validationsFailed,
      },
      last24h: {
        requests: totals.requests,
        jobsCompleted: totals.jobsCompleted,
        jobsFailed: totals.jobsFailed,
        validationsSucceeded: totals.validationsSucceeded,
        validationsFailed: totals.validationsFailed,
        successRate,
        avgProcessingMs,
      },
      hourlyBreakdown: allBuckets.slice(-12).map((b, i) => ({
        hoursAgo: allBuckets.length - 1 - i,
        requests: b.requests,
        jobsCompleted: b.jobsCompleted,
        jobsFailed: b.jobsFailed,
      })),
    };
  }

  // ---- Internal ----

  private rotateBucket() {
    this.previousHours.push({ ...this.current });
    // Keep last 24 hours
    if (this.previousHours.length > 23) {
      this.previousHours.shift();
    }
    this.current = this.emptyBucket();
  }

  private emptyBucket(): HourlyBucket {
    return {
      requests: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      validationsSucceeded: 0,
      validationsFailed: 0,
      totalProcessingMs: 0,
      jobsProcessed: 0,
    };
  }

  private formatUptime(ms: number): string {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
  }
}
