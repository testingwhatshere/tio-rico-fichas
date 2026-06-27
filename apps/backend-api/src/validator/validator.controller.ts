import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Query,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatorGateway } from './validator.gateway';
import { ValidatorAnalyticsService } from './validator-analytics.service';
import { ValidatorHealthService } from './validator-health.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface ValidatorLogDto {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data?: any;
}

@Controller('validator')
export class ValidatorController {
  private readonly logger = new Logger(ValidatorController.name);
  private readonly validatorApiKey: string;

  constructor(
    private readonly validatorGateway: ValidatorGateway,
    private readonly validatorAnalyticsService: ValidatorAnalyticsService,
    private readonly validatorHealthService: ValidatorHealthService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.validatorApiKey = this.configService.get<string>(
      'VALIDATOR_API_KEY',
      this.configService.get<string>('BOT_API_KEY', ''),
    );
  }

  /**
   * Validate API key from validator app
   */
  private validateApiKey(apiKey: string | undefined) {
    if (!apiKey || apiKey !== this.validatorApiKey) {
      throw new UnauthorizedException('Invalid validator API key');
    }
  }

  /**
   * Get validator status (public endpoint for health checks)
   */
  @Public()
  @Get('status')
  getStatus() {
    return this.validatorGateway.getStatus();
  }

  /**
   * Receive logs from validator app
   */
  @Public()
  @Post('logs')
  async receiveLogs(
    @Headers('x-validator-api-key') apiKey: string,
    @Body() logEntry: ValidatorLogDto,
  ) {
    this.validateApiKey(apiKey);

    this.logger.debug(
      `[Validator] ${logEntry.level} - ${logEntry.category}: ${logEntry.message}`,
    );

    // Store in database
    try {
      await this.prisma.validatorLog.create({
        data: {
          timestamp: new Date(logEntry.timestamp),
          level: logEntry.level,
          category: logEntry.category,
          message: logEntry.message,
          data: logEntry.data || {},
        },
      });
    } catch (error) {
      // Log table might not exist yet, just log to console
      this.logger.warn('Could not store validator log in DB:', error.message);
    }

    return { success: true };
  }

  /**
   * Receive batch logs from validator app
   */
  @Public()
  @Post('logs/batch')
  async receiveBatchLogs(
    @Headers('x-validator-api-key') apiKey: string,
    @Body() body: { logs: ValidatorLogDto[] },
  ) {
    this.validateApiKey(apiKey);

    if (!body.logs || !Array.isArray(body.logs) || body.logs.length === 0) {
      return { success: true, count: 0 };
    }

    this.logger.debug(
      `[Validator] Receiving batch of ${body.logs.length} logs`,
    );

    try {
      await this.prisma.validatorLog.createMany({
        data: body.logs.map((log) => ({
          timestamp: new Date(log.timestamp),
          level: log.level,
          category: log.category,
          message: log.message,
          data: log.data || {},
        })),
        skipDuplicates: true,
      });

      return { success: true, count: body.logs.length };
    } catch (error) {
      this.logger.warn('Could not store batch logs in DB:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get validator logs (for operator panel)
   */
  @Public()
  @Get('logs')
  async getLogs(@Headers('x-validator-api-key') apiKey: string) {
    this.validateApiKey(apiKey);

    try {
      const logs = await this.prisma.validatorLog.findMany({
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
      return logs;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get validation statistics
   */
  @Public()
  @Get('stats')
  async getStats(@Headers('x-validator-api-key') apiKey: string) {
    this.validateApiKey(apiKey);

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [totalValidations, todayValidations, successfulToday, failedToday] =
        await Promise.all([
          this.prisma.validatorLog.count({
            where: { category: 'VALIDATION' },
          }),
          this.prisma.validatorLog.count({
            where: {
              category: 'VALIDATION',
              timestamp: { gte: today },
            },
          }),
          this.prisma.validatorLog.count({
            where: {
              category: 'VALIDATION',
              level: 'SUCCESS',
              timestamp: { gte: today },
            },
          }),
          this.prisma.validatorLog.count({
            where: {
              category: 'VALIDATION',
              level: { in: ['WARN', 'ERROR'] },
              timestamp: { gte: today },
            },
          }),
        ]);

      return {
        total: totalValidations,
        today: todayValidations,
        todaySuccessful: successfulToday,
        todayFailed: failedToday,
        validatorConnected: this.validatorGateway.isValidatorConnected(),
      };
    } catch (error) {
      return {
        total: 0,
        today: 0,
        todaySuccessful: 0,
        todayFailed: 0,
        validatorConnected: this.validatorGateway.isValidatorConnected(),
      };
    }
  }

  /**
   * Get comprehensive validation analytics
   * @param days Number of days to analyze (default: 7)
   */
  @Public()
  @Get('analytics')
  async getAnalytics(
    @Headers('x-validator-api-key') apiKey: string,
    @Query('days') days?: string,
  ) {
    this.validateApiKey(apiKey);
    const daysNum = days ? parseInt(days, 10) : 7;
    return this.validatorAnalyticsService.getValidationAnalytics(daysNum);
  }

  /**
   * Get quick stats for dashboard widgets
   */
  @Public()
  @Get('analytics/quick')
  async getQuickStats(@Headers('x-validator-api-key') apiKey: string) {
    this.validateApiKey(apiKey);
    return this.validatorAnalyticsService.getQuickStats();
  }

  /**
   * Get validator health status
   */
  @Public()
  @Get('health')
  async getHealth(@Headers('x-validator-api-key') apiKey: string) {
    this.validateApiKey(apiKey);
    return this.validatorHealthService.getHealthStatus();
  }

  /**
   * Trigger a health check
   */
  @Public()
  @Post('health/check')
  async triggerHealthCheck(@Headers('x-validator-api-key') apiKey: string) {
    this.validateApiKey(apiKey);
    return this.validatorHealthService.triggerHealthCheck();
  }
}
