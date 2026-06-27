import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { LoggingService } from './logging.service';
import { Roles } from '../common/decorators/roles.decorator';
import { LogLevel, LogSource } from '@prisma/client';

@Controller('logs')
@Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
export class LoggingController {
  constructor(private readonly loggingService: LoggingService) {}

  /**
   * Get activity logs with filters
   */
  @Get()
  async getActivityLogs(
    @Query('level') level?: string,
    @Query('source') source?: string,
    @Query('category') category?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('requestId') requestId?: string,
    @Query('jobId') jobId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.loggingService.getActivityLogs({
      level: level as LogLevel,
      source: source as LogSource,
      category,
      action,
      userId,
      requestId,
      jobId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  /**
   * Get error logs
   */
  @Get('errors')
  async getErrorLogs(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loggingService.getErrorLogs({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  /**
   * Get logs for a specific request
   */
  @Get('request/:requestId')
  async getLogsForRequest(@Param('requestId') requestId: string) {
    return this.loggingService.getLogsForRequest(requestId);
  }

  /**
   * Get all logs for a specific job (activity + bot + screenshots)
   */
  @Get('job/:jobId')
  async getLogsForJob(@Param('jobId') jobId: string) {
    return this.loggingService.getLogsForJob(jobId);
  }

  /**
   * Get bot session logs
   */
  @Get('bot/session/:sessionId')
  async getBotSessionLogs(@Param('sessionId') sessionId: string) {
    return this.loggingService.getBotSessionLogs(sessionId);
  }

  /**
   * Get bot logs for a job
   */
  @Get('bot/job/:jobId')
  async getJobBotLogs(@Param('jobId') jobId: string) {
    return this.loggingService.getJobBotLogs(jobId);
  }

  /**
   * Get screenshots for a job
   */
  @Get('screenshots/job/:jobId')
  async getScreenshotsForJob(@Param('jobId') jobId: string) {
    return this.loggingService.getScreenshotsForJob(jobId);
  }

  /**
   * Get a specific screenshot metadata
   */
  @Get('screenshot/:id')
  async getScreenshot(@Param('id') id: string) {
    const screenshot = await this.loggingService.getScreenshot(id);
    if (!screenshot) {
      throw new NotFoundException('Screenshot not found');
    }
    return screenshot;
  }

  /**
   * Download a screenshot file
   */
  @Get('screenshot/:id/download')
  async downloadScreenshot(@Param('id') id: string, @Res() res: Response) {
    const screenshot = await this.loggingService.getScreenshot(id);
    if (!screenshot) {
      throw new NotFoundException('Screenshot not found');
    }

    // If path is a Cloudinary URL, redirect to it
    if (screenshot.path.startsWith('http')) {
      res.redirect(screenshot.path);
      return;
    }

    // Legacy local file path
    if (!fs.existsSync(screenshot.path)) {
      throw new NotFoundException('Screenshot file not found');
    }

    res.setHeader('Content-Type', screenshot.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${screenshot.filename}"`,
    );
    fs.createReadStream(screenshot.path).pipe(res);
  }

  /**
   * Cleanup old logs (admin only)
   */
  @Post('cleanup')
  @Roles('ADMIN')
  async cleanupOldLogs(@Query('days') days?: string) {
    const daysToKeep = days ? parseInt(days) : 30;
    return this.loggingService.cleanupOldLogs(daysToKeep);
  }
}
