import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BotApiKeyGuard } from '../bot/guards/bot-api-key.guard';
import { OutboundPaymentsService } from './outbound-payments.service';
import { PaymentBotGateway } from './payment-bot.gateway';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Payment Bot Controller
 *
 * HTTP fallback endpoints for payment Chrome extensions.
 * Primary communication is via WebSocket (/payment-bot namespace).
 * These endpoints are used when WebSocket is unavailable.
 *
 * All endpoints protected by BotApiKeyGuard (same API key as automation bot).
 */
@Controller('bot/payment-jobs')
@Public()
@UseGuards(BotApiKeyGuard)
export class PaymentBotController {
  private readonly logger = new Logger(PaymentBotController.name);

  constructor(
    private readonly outboundPaymentsService: OutboundPaymentsService,
    private readonly paymentBotGateway: PaymentBotGateway,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Poll for next available payment job.
   * Extension calls this when WebSocket is disconnected.
   * GET /bot/payment-jobs/next?walletType=FIWIND
   */
  @Get('next')
  async getNextJob(@Query('walletType') walletType: string) {
    if (!walletType) {
      return { job: null, error: 'walletType query parameter required' };
    }

    const payment = await this.prisma.outboundPayment.findFirst({
      where: {
        status: 'QUEUED',
        walletType: walletType as any,
      },
      include: { job: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!payment || !payment.job) {
      return { job: null };
    }

    return {
      job: {
        id: payment.job.id,
        type: payment.job.type,
        amount: Number(payment.amount),
        paymentMethod: payment.paymentMethod,
        paymentDetails: payment.paymentDetails,
        walletType: payment.walletType,
      },
    };
  }

  /**
   * Report that a payment job has started processing.
   * POST /bot/payment-jobs/:jobId/started
   */
  @Post(':jobId/started')
  @HttpCode(HttpStatus.OK)
  async reportStarted(@Param('jobId') jobId: string) {
    // Mark as PROCESSING
    const payment = await this.prisma.outboundPayment.findUnique({
      where: { jobId },
    });

    if (!payment) {
      return { success: false, error: 'Payment not found for this job' };
    }

    if (payment.status === 'PROCESSING') {
      return { success: true, alreadyClaimed: true };
    }

    if (payment.status !== 'QUEUED') {
      return {
        success: false,
        error: `Payment in unexpected status: ${payment.status}`,
      };
    }

    await this.prisma.outboundPayment.update({
      where: { id: payment.id },
      data: { status: 'PROCESSING', executedAt: new Date() },
    });

    this.logger.log(`Payment job ${jobId} started (payment ${payment.id})`);
    return { success: true, alreadyClaimed: false };
  }

  /**
   * Report payment job result (success or failure).
   * POST /bot/payment-jobs/:jobId/result
   */
  @Post(':jobId/result')
  @HttpCode(HttpStatus.OK)
  async reportResult(
    @Param('jobId') jobId: string,
    @Body()
    dto: {
      success: boolean;
      operationNumber?: string;
      screenshotUrl?: string;
      error?: string;
    },
  ) {
    this.logger.log(`Payment result for job ${jobId}: success=${dto.success}`);
    return this.outboundPaymentsService.handlePaymentResult(jobId, dto);
  }

  /**
   * Upload error screenshot for a payment job.
   * POST /bot/payment-jobs/:jobId/screenshot
   */
  @Post(':jobId/screenshot')
  @HttpCode(HttpStatus.OK)
  async uploadScreenshot(
    @Param('jobId') jobId: string,
    @Body() dto: { screenshot: string },
  ) {
    // Store screenshot URL on the payment record
    const payment = await this.prisma.outboundPayment.findUnique({
      where: { jobId },
    });

    if (payment && dto.screenshot) {
      await this.prisma.outboundPayment.update({
        where: { id: payment.id },
        data: { screenshotUrl: dto.screenshot },
      });
      return { success: true, url: dto.screenshot };
    }

    return { success: false, error: 'Payment not found or no screenshot data' };
  }
}

/**
 * Separate controller for payment bot heartbeat and balance.
 * Mounted at /bot/payment-heartbeat and /bot/payment-balance.
 */
@Controller('bot')
@Public()
@UseGuards(BotApiKeyGuard)
export class PaymentBotStatusController {
  private readonly logger = new Logger(PaymentBotStatusController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Receive heartbeat from payment extension.
   * POST /bot/payment-heartbeat
   */
  @Post('payment-heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @Body() dto: { walletType: string; status: string; currentJobId?: string },
  ) {
    this.logger.debug(
      `Payment bot heartbeat: ${dto.walletType} (${dto.status})`,
    );
    return { ack: true, timestamp: new Date().toISOString() };
  }

  /**
   * Receive balance report from payment extension.
   * POST /bot/payment-balance
   */
  @Post('payment-balance')
  @HttpCode(HttpStatus.OK)
  async balanceReport(@Body() dto: { walletType: string; balance: number }) {
    this.logger.log(`Payment bot balance: ${dto.walletType} = $${dto.balance}`);

    await this.prisma.paymentConfig.updateMany({
      where: { type: dto.walletType as any, outboundEnabled: true },
      data: {
        outboundBalance: dto.balance,
        lastBalanceCheck: new Date(),
      },
    });

    return { success: true };
  }
}
