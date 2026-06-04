import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LogLevel, LogSource } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

export interface LogContext {
  userId?: string;
  operatorId?: string;
  requestId?: string;
  jobId?: string;
  chatId?: string;
  panelId?: string;
  ipAddress?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
}

export interface LogEntry {
  level?: LogLevel;
  source?: LogSource;
  category: string;
  action: string;
  message: string;
  context?: LogContext;
  metadata?: Record<string, any>;
  error?: string;
  stackTrace?: string;
  screenshotId?: string;
}

export interface ScreenshotData {
  buffer: Buffer;
  filename: string;
  category: string;
  description?: string;
  jobId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class LoggingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoggingService.name);
  private readonly logDir: string;
  private readonly screenshotDir: string;
  private readonly fileLoggingEnabled: boolean;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.logDir = this.configService.get<string>('LOG_DIR', './logs');
    this.screenshotDir = this.configService.get<string>('SCREENSHOT_DIR', './screenshots');
    this.fileLoggingEnabled = this.configService.get<boolean>('FILE_LOGGING_ENABLED', true);

    this.ensureDirectories();
  }

  async onModuleInit() {
    // Run cleanup once on startup (catches up if server was down)
    this.cleanupOldLogs(30).catch((err) =>
      this.logger.error(`Startup log cleanup failed: ${err.message}`),
    );

    // Schedule daily cleanup (every 24 hours)
    this.cleanupTimer = setInterval(() => {
      this.logger.log('Running scheduled log cleanup...');
      this.cleanupOldLogs(30).catch((err) =>
        this.logger.error(`Scheduled log cleanup failed: ${err.message}`),
      );
    }, 24 * 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private ensureDirectories() {
    if (this.fileLoggingEnabled) {
      [this.logDir, this.screenshotDir].forEach((dir) => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });
    }
  }

  /**
   * Log an activity to both database and file
   */
  async log(entry: LogEntry) {
    const timestamp = new Date();

    // Log to database
    try {
      await this.prisma.activityLog.create({
        data: {
          level: entry.level || LogLevel.INFO,
          source: entry.source || LogSource.BACKEND,
          category: entry.category,
          action: entry.action,
          message: entry.message,
          userId: entry.context?.userId,
          operatorId: entry.context?.operatorId,
          requestId: entry.context?.requestId,
          jobId: entry.context?.jobId,
          chatId: entry.context?.chatId,
          ipAddress: entry.context?.ipAddress,
          userAgent: entry.context?.userAgent,
          endpoint: entry.context?.endpoint,
          method: entry.context?.method,
          statusCode: entry.context?.statusCode,
          duration: entry.context?.duration,
          metadata: entry.metadata,
          error: entry.error,
          stackTrace: entry.stackTrace,
          screenshotId: entry.screenshotId,
          timestamp,
        },
      });
    } catch (err) {
      this.logger.error('Failed to log to database', err);
    }

    // Log to file
    if (this.fileLoggingEnabled) {
      this.logToFile(entry, timestamp);
    }

    // Also log to console via NestJS logger
    this.logToConsole(entry);
  }

  /**
   * Log to file with daily rotation
   */
  private logToFile(entry: LogEntry, timestamp: Date) {
    const dateStr = timestamp.toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `${entry.category.toLowerCase()}-${dateStr}.log`);

    const logLine = JSON.stringify({
      timestamp: timestamp.toISOString(),
      level: entry.level || 'INFO',
      source: entry.source || 'BACKEND',
      category: entry.category,
      action: entry.action,
      message: entry.message,
      ...entry.context,
      metadata: entry.metadata,
      error: entry.error,
    }) + '\n';

    fsPromises.appendFile(logFile, logLine).catch((err) => {
      this.logger.error(`Failed to write to log file ${logFile}: ${err.message}`);
    });
  }

  private logToConsole(entry: LogEntry) {
    const msg = `[${entry.category}:${entry.action}] ${entry.message}`;
    switch (entry.level) {
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        this.logger.error(msg, entry.error);
        break;
      case LogLevel.WARN:
        this.logger.warn(msg);
        break;
      case LogLevel.DEBUG:
        this.logger.debug(msg);
        break;
      default:
        this.logger.log(msg);
    }
  }

  // ==========================================
  // CONVENIENCE METHODS
  // ==========================================

  async info(category: string, action: string, message: string, context?: LogContext, metadata?: Record<string, any>) {
    return this.log({ level: LogLevel.INFO, category, action, message, context, metadata });
  }

  async warn(category: string, action: string, message: string, context?: LogContext, metadata?: Record<string, any>) {
    return this.log({ level: LogLevel.WARN, category, action, message, context, metadata });
  }

  async error(category: string, action: string, message: string, error?: Error, context?: LogContext, metadata?: Record<string, any>) {
    return this.log({
      level: LogLevel.ERROR,
      category,
      action,
      message,
      context,
      metadata,
      error: error?.message,
      stackTrace: error?.stack,
    });
  }

  async critical(category: string, action: string, message: string, error?: Error, context?: LogContext, metadata?: Record<string, any>) {
    return this.log({
      level: LogLevel.CRITICAL,
      category,
      action,
      message,
      context,
      metadata,
      error: error?.message,
      stackTrace: error?.stack,
    });
  }

  // ==========================================
  // DOMAIN-SPECIFIC LOGGING
  // ==========================================

  async logAuth(action: string, message: string, context?: LogContext, metadata?: Record<string, any>) {
    return this.info('AUTH', action, message, context, metadata);
  }

  async logRequest(action: string, message: string, context?: LogContext, metadata?: Record<string, any>) {
    return this.info('REQUEST', action, message, context, metadata);
  }

  async logJob(action: string, message: string, context?: LogContext, metadata?: Record<string, any>) {
    return this.info('JOB', action, message, context, metadata);
  }

  async logPayment(action: string, message: string, context?: LogContext, metadata?: Record<string, any>) {
    return this.info('PAYMENT', action, message, context, metadata);
  }

  async logBot(action: string, message: string, context?: LogContext, metadata?: Record<string, any>) {
    return this.log({
      level: LogLevel.INFO,
      source: LogSource.BOT,
      category: 'BOT',
      action,
      message,
      context,
      metadata,
    });
  }

  async logBotError(action: string, message: string, error?: Error, context?: LogContext, metadata?: Record<string, any>) {
    return this.log({
      level: LogLevel.ERROR,
      source: LogSource.BOT,
      category: 'BOT',
      action,
      message,
      context,
      metadata,
      error: error?.message,
      stackTrace: error?.stack,
    });
  }

  // ==========================================
  // SCREENSHOT MANAGEMENT
  // ==========================================

  async saveScreenshot(data: ScreenshotData): Promise<string> {
    const timestamp = Date.now();
    const filename = `${data.category}-${timestamp}-${data.filename}`;

    // Upload to Cloudinary instead of local filesystem
    let screenshotPath: string;
    try {
      const uploadResult = await new Promise<{ secure_url: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'screenshots',
            public_id: filename.replace(/\.[^.]+$/, ''),
            resource_type: 'image',
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result!);
          },
        );
        stream.end(data.buffer);
      });
      screenshotPath = uploadResult.secure_url;
    } catch (uploadError) {
      // Fallback to local storage if Cloudinary fails
      this.logger.warn(`Cloudinary upload failed, saving locally: ${uploadError.message}`);
      const filepath = path.join(this.screenshotDir, filename);
      await fsPromises.writeFile(filepath, data.buffer);
      screenshotPath = filepath;
    }

    // Save to database
    const screenshot = await this.prisma.screenshot.create({
      data: {
        filename: data.filename,
        path: screenshotPath,
        mimeType: 'image/png',
        size: data.buffer.length,
        source: LogSource.BOT,
        category: data.category,
        description: data.description,
        jobId: data.jobId,
        requestId: data.requestId,
        metadata: data.metadata,
      },
    });

    this.logger.log(`Screenshot saved: ${filename} (${screenshot.id})`);

    return screenshot.id;
  }

  async getScreenshot(id: string) {
    return this.prisma.screenshot.findUnique({
      where: { id },
    });
  }

  async getScreenshotsForJob(jobId: string) {
    return this.prisma.screenshot.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ==========================================
  // BOT SESSION LOGGING
  // ==========================================

  async logBotAction(data: {
    sessionId: string;
    action: string;
    selector?: string;
    url?: string;
    value?: string;
    startedAt: Date;
    completedAt?: Date;
    success?: boolean;
    error?: string;
    screenshotPath?: string;
    jobId?: string;
    step?: string;
    metadata?: Record<string, any>;
  }) {
    const duration = data.completedAt
      ? data.completedAt.getTime() - data.startedAt.getTime()
      : undefined;

    return this.prisma.botSessionLog.create({
      data: {
        sessionId: data.sessionId,
        action: data.action,
        selector: data.selector,
        url: data.url,
        value: data.value ? this.maskSensitiveData(data.value) : undefined,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        duration,
        success: data.success ?? true,
        error: data.error,
        screenshotPath: data.screenshotPath,
        jobId: data.jobId,
        step: data.step,
        metadata: data.metadata,
      },
    });
  }

  async getBotSessionLogs(sessionId: string) {
    return this.prisma.botSessionLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getJobBotLogs(jobId: string) {
    return this.prisma.botSessionLog.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ==========================================
  // QUERY METHODS
  // ==========================================

  async getActivityLogs(options: {
    level?: LogLevel;
    source?: LogSource;
    category?: string;
    action?: string;
    userId?: string;
    requestId?: string;
    jobId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    return this.prisma.activityLog.findMany({
      where: {
        level: options.level,
        source: options.source,
        category: options.category,
        action: options.action,
        userId: options.userId,
        requestId: options.requestId,
        jobId: options.jobId,
        timestamp: {
          gte: options.from,
          lte: options.to,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: options.limit || 100,
      skip: options.offset || 0,
      include: {
        screenshot: true,
      },
    });
  }

  async getErrorLogs(options: { from?: Date; to?: Date; limit?: number }) {
    return this.prisma.activityLog.findMany({
      where: {
        level: { in: [LogLevel.ERROR, LogLevel.CRITICAL] },
        timestamp: {
          gte: options.from,
          lte: options.to,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: options.limit || 50,
      include: {
        screenshot: true,
      },
    });
  }

  async getLogsForRequest(requestId: string) {
    return this.prisma.activityLog.findMany({
      where: { requestId },
      orderBy: { timestamp: 'asc' },
      include: {
        screenshot: true,
      },
    });
  }

  async getLogsForJob(jobId: string) {
    const [activityLogs, botLogs, screenshots] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: { jobId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.botSessionLog.findMany({
        where: { jobId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.screenshot.findMany({
        where: { jobId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return { activityLogs, botLogs, screenshots };
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  private maskSensitiveData(value: string): string {
    // Mask passwords and sensitive data
    if (value.length > 4) {
      return value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2);
    }
    return '****';
  }

  async cleanupOldLogs(daysToKeep: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const [deletedLogs, deletedBotLogs, deletedHistory, deletedScreenshots] = await Promise.all([
      this.prisma.activityLog.deleteMany({
        where: { timestamp: { lt: cutoffDate } },
      }),
      this.prisma.botSessionLog.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      }),
      this.prisma.requestStatusHistory.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      }),
      this.prisma.screenshot.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      }),
    ]);

    this.logger.log(
      `Cleanup: ${deletedLogs.count} activity logs, ${deletedBotLogs.count} bot logs, ` +
      `${deletedHistory.count} status history, ${deletedScreenshots.count} screenshots ` +
      `(older than ${daysToKeep} days)`,
    );

    return {
      deletedLogs: deletedLogs.count,
      deletedBotLogs: deletedBotLogs.count,
      deletedHistory: deletedHistory.count,
      deletedScreenshots: deletedScreenshots.count,
    };
  }
}
