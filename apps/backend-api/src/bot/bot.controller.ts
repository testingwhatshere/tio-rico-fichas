import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BotService } from './bot.service';
import { BotApiKeyGuard } from './guards/bot-api-key.guard';
import { Public } from '../common/decorators/public.decorator';
import { LoggingService } from '../logging/logging.service';
import { LogLevel, LogSource } from '@prisma/client';
import {
  JobResultDto,
  JobProgressDto,
  BotStatusDto,
  HeartbeatDto,
} from './dto';
import { DiscoveryService } from '../discovery/discovery.service';
import { PrizeClaimsService } from '../prize-claims/prize-claims.service';

/**
 * Bot Controller
 *
 * Handles all communication between the automation bot and the backend.
 * All endpoints are protected by API key authentication (except public ones).
 *
 * Endpoints:
 * - POST /bot/jobs/:jobId/result   - Receive job completion result
 * - POST /bot/jobs/:jobId/started  - Receive job started notification
 * - POST /bot/jobs/:jobId/progress - Receive job progress updates
 * - GET  /bot/jobs/pending         - Get pending jobs (polling mode)
 * - POST /bot/heartbeat            - Receive bot heartbeat
 * - POST /bot/status               - Receive bot status changes
 * - GET  /bot/kill-switch          - Check if kill switch is active
 * - GET  /bot/activity-window      - Check if within activity hours
 * - GET  /bot/state                - Get current bot state (admin)
 */
@Controller('bot')
@Public() // Exempt from JWT auth - uses API key instead
@UseGuards(BotApiKeyGuard)
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(
    private readonly botService: BotService,
    private readonly loggingService: LoggingService,
    private readonly discoveryService: DiscoveryService,
    private readonly prizeClaimsService: PrizeClaimsService,
  ) {}

  // =========================================
  // JOB ENDPOINTS
  // =========================================

  /**
   * Receive job completion result from bot
   */
  @Post('jobs/:jobId/result')
  @HttpCode(HttpStatus.OK)
  async handleJobResult(
    @Param('jobId') jobId: string,
    @Body() dto: JobResultDto,
  ) {
    return this.botService.handleJobResult(jobId, dto);
  }

  /**
   * Receive job started notification from bot
   */
  @Post('jobs/:jobId/started')
  @HttpCode(HttpStatus.OK)
  async handleJobStarted(
    @Param('jobId') jobId: string,
    @Body() body: { startedAt?: string },
  ) {
    return this.botService.handleJobStarted(jobId, body.startedAt);
  }

  /**
   * Receive job progress updates from bot
   */
  @Post('jobs/:jobId/progress')
  @HttpCode(HttpStatus.OK)
  async handleJobProgress(
    @Param('jobId') jobId: string,
    @Body() dto: JobProgressDto,
  ) {
    return this.botService.handleJobProgress(jobId, dto);
  }

  /**
   * Extension reports the target username does not exist on its panel.
   * Backend invalidates the stale User.panelId and re-runs discovery on
   * the remaining panels — prevents duplicate user creation across panels.
   */
  @Post('jobs/:jobId/user-not-found')
  @HttpCode(HttpStatus.OK)
  async handleUserNotFoundOnPanel(
    @Param('jobId') jobId: string,
    @Headers('x-panel-id') panelId: string,
    @Body()
    _body: { targetUsername?: string; panelId?: string; timestamp?: string },
  ) {
    if (!panelId) {
      throw new BadRequestException('X-Panel-Id header is required');
    }
    return this.discoveryService.handleUserNotFoundOnAssignedPanel(
      jobId,
      panelId,
    );
  }

  /**
   * Get pending jobs (for bot polling mode)
   * Filters by X-Panel-Id header when provided.
   */
  @Get('jobs/pending')
  async getPendingJobs(@Headers('x-panel-id') panelId?: string) {
    return this.botService.getPendingJobs(panelId);
  }

  // =========================================
  // STATUS ENDPOINTS
  // =========================================

  /**
   * Receive heartbeat from bot
   */
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async handleHeartbeat(
    @Body() dto: HeartbeatDto,
    @Headers('x-panel-id') panelId?: string,
  ) {
    return this.botService.handleHeartbeat(dto, panelId);
  }

  /**
   * Receive panel balance report from extension
   */
  @Post('panel-balance')
  @HttpCode(HttpStatus.OK)
  async handlePanelBalance(
    @Body() body: { balance: number; timestamp?: string },
    @Headers('x-panel-id') panelId?: string,
  ) {
    return this.botService.handlePanelBalance(body.balance, panelId);
  }

  /**
   * Receive bot status change notification
   */
  @Post('status')
  @HttpCode(HttpStatus.OK)
  async handleStatusChange(
    @Body() dto: BotStatusDto,
    @Headers('x-panel-id') panelId?: string,
  ) {
    return this.botService.handleStatusChange(dto, panelId);
  }

  /**
   * Get current bot state (for monitoring)
   */
  @Get('state')
  async getBotState() {
    return this.botService.getBotState();
  }

  /**
   * Get dispatch diagnostic status (shows why jobs may not be dispatching)
   */
  @Get('dispatch-status')
  async getDispatchStatus() {
    return this.botService.getDispatchStatus();
  }

  /**
   * Get job statistics for extension popup
   */
  @Get('stats')
  async getStats() {
    return this.botService.getJobStats();
  }

  /**
   * Health check endpoint for extension connection test
   */
  @Get('health')
  async healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * List available panels (for extension options dropdown)
   */
  @Get('panels')
  async listPanels() {
    return this.botService.listPanels();
  }

  // =========================================
  // CONTROL ENDPOINTS
  // =========================================

  /**
   * Check if kill switch is active
   * Bot should call this before processing any job
   */
  @Get('kill-switch')
  async checkKillSwitch(@Headers('x-panel-id') panelId?: string) {
    return this.botService.checkKillSwitch(panelId);
  }

  /**
   * Check if within allowed activity window
   * Bot should call this before processing any job
   */
  @Get('activity-window')
  async checkActivityWindow(@Headers('x-panel-id') panelId?: string) {
    return this.botService.checkActivityWindow(panelId);
  }

  // =========================================
  // DISCOVERY ENDPOINTS
  // =========================================

  /**
   * Receive discovery result from extension.
   * Extension reports whether the target username was found on its panel.
   */
  @Post('discovery/:taskId/result')
  @HttpCode(HttpStatus.OK)
  async handleDiscoveryResult(
    @Param('taskId') taskId: string,
    @Headers('x-panel-id') panelId: string,
    @Body()
    body: {
      found: boolean;
      busy?: boolean;
      error?: string;
      matched?: number;
      totalRows?: number;
      paginationVisible?: boolean;
      pageInfoText?: string;
      reason?: string;
    },
  ) {
    if (!panelId) {
      throw new BadRequestException(
        'X-Panel-Id header is required for discovery',
      );
    }
    return this.discoveryService.handleDiscoveryResult(
      taskId,
      panelId,
      body.found,
      body.busy,
      body.error,
      {
        matched: body.matched,
        totalRows: body.totalRows,
        paginationVisible: body.paginationVisible,
        pageInfoText: body.pageInfoText,
        reason: body.reason,
      },
    );
  }

  // =========================================
  // USER CREATION ENDPOINTS
  // =========================================

  /**
   * Receive user creation result from extension.
   * Extension reports whether it successfully created the user on the panel.
   */
  @Post('create-user/:taskId/result')
  @HttpCode(HttpStatus.OK)
  async handleCreateUserResult(
    @Param('taskId') taskId: string,
    @Headers('x-panel-id') panelId: string,
    @Body()
    body: {
      success: boolean;
      targetUsername?: string;
      password?: string;
      error?: string;
    },
  ) {
    if (!panelId) {
      throw new BadRequestException(
        'X-Panel-Id header is required for user creation',
      );
    }
    return this.discoveryService.handleUserCreationResult(
      taskId,
      panelId,
      body.success,
      body.error,
    );
  }

  // =========================================
  // CHIP VERIFICATION ENDPOINTS
  // =========================================

  /**
   * Receive chip verification result from extension.
   * Extension reports the user's chip balance on the panel.
   */
  @Post('verify-chips/result')
  @HttpCode(HttpStatus.OK)
  async handleVerifyChipsResult(
    @Body()
    body: {
      taskId: string;
      success: boolean;
      balance?: number;
      error?: string;
    },
  ) {
    if (!body.taskId) {
      throw new BadRequestException('taskId is required');
    }
    await this.prizeClaimsService.handleVerificationResult(body.taskId, {
      success: body.success,
      balance: body.balance,
      error: body.error,
    });
    return { success: true };
  }

  // =========================================
  // LOGGING ENDPOINTS
  // =========================================

  /**
   * Receive log entry from bot
   */
  @Post('logs')
  @HttpCode(HttpStatus.OK)
  async submitLog(
    @Body()
    body: {
      level?: string;
      category: string;
      action: string;
      message: string;
      jobId?: string;
      requestId?: string;
      sessionId?: string;
      metadata?: Record<string, any>;
      error?: string;
      stackTrace?: string;
    },
    @Headers('x-panel-id') panelId?: string,
  ) {
    await this.loggingService.log({
      level: (body.level as LogLevel) || LogLevel.INFO,
      source: LogSource.BOT,
      category: body.category,
      action: body.action,
      message: body.message,
      context: {
        jobId: body.jobId,
        requestId: body.requestId,
        panelId,
      },
      metadata: {
        ...body.metadata,
        sessionId: body.sessionId,
        panelId,
      },
      error: body.error,
      stackTrace: body.stackTrace,
    });

    return { success: true };
  }

  /**
   * Receive screenshot from bot
   */
  @Post('screenshots')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('screenshot'))
  async submitScreenshot(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      category: string;
      description?: string;
      jobId?: string;
      requestId?: string;
      metadata?: string; // JSON string
    },
    @Headers('x-panel-id') panelId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    let parsedMetadata: Record<string, any> | undefined;
    if (body.metadata) {
      try {
        parsedMetadata = JSON.parse(body.metadata);
      } catch {
        parsedMetadata = { _rawMetadata: body.metadata };
      }
    }

    const screenshotId = await this.loggingService.saveScreenshot({
      buffer: file.buffer,
      filename: file.originalname || `screenshot-${Date.now()}.png`,
      category: body.category,
      description: body.description,
      jobId: body.jobId,
      requestId: body.requestId,
      metadata: { ...parsedMetadata, panelId },
    });

    return { success: true, screenshotId };
  }

  /**
   * Log bot session action (for detailed action tracking)
   */
  @Post('session-log')
  @HttpCode(HttpStatus.OK)
  async submitSessionLog(
    @Body()
    body: {
      sessionId: string;
      action: string;
      selector?: string;
      url?: string;
      value?: string;
      startedAt: string;
      completedAt?: string;
      success?: boolean;
      error?: string;
      screenshotPath?: string;
      jobId?: string;
      step?: string;
      metadata?: Record<string, any>;
    },
    @Headers('x-panel-id') panelId?: string,
  ) {
    await this.loggingService.logBotAction({
      sessionId: body.sessionId,
      action: body.action,
      selector: body.selector,
      url: body.url,
      value: body.value,
      startedAt: new Date(body.startedAt),
      completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
      success: body.success,
      error: body.error,
      screenshotPath: body.screenshotPath,
      jobId: body.jobId,
      step: body.step,
      metadata: { ...body.metadata, panelId },
    });

    return { success: true };
  }

  /**
   * Receive selector health check from extension.
   * Reports which selectors still match in the casino panel DOM.
   */
  @Post('selector-check')
  @HttpCode(HttpStatus.OK)
  async handleSelectorCheck(
    @Body()
    body: {
      total: number;
      matched: number;
      failed: string[];
      checkedAt?: string;
    },
  ) {
    this.logger.log(
      `Selector check: ${body.matched}/${body.total} OK, ${body.failed.length} failed`,
    );

    if (body.failed.length > 0) {
      this.logger.warn(`Failed selectors: ${body.failed.join(', ')}`);
      // Store last check result in settings for monitoring
      await this.botService.handleSelectorCheckResult(body);
    }

    return { success: true };
  }
}
