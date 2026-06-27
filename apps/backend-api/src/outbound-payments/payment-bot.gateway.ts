import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundPaymentsService } from './outbound-payments.service';

/**
 * PaymentBotGateway — WebSocket gateway for payment extension connections.
 * Each payment extension connects with its walletType (FIWIND, MERCADOPAGO, RIPIO, PREX).
 * Receives payment results and dispatches OUTBOUND_PAYMENT / BUY_CRYPTO jobs.
 */
@WebSocketGateway({
  namespace: '/payment-bot',
  cors: { origin: '*', credentials: false },
  pingInterval: 60000,
  pingTimeout: 30000,
})
export class PaymentBotGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PaymentBotGateway.name);

  // walletType → Socket (one bot per wallet type)
  private connectedBots = new Map<string, Socket>();
  // socketId → walletType (reverse lookup)
  private socketToWalletType = new Map<string, string>();

  private readonly expectedApiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
  ) {
    const key = this.configService.get<string>('BOT_API_KEY');
    if (!key) {
      throw new Error('BOT_API_KEY is required for PaymentBotGateway');
    }
    this.expectedApiKey = key;
  }

  // ==========================================
  // CONNECTION HANDLING
  // ==========================================

  handleConnection(client: Socket) {
    const apiKey =
      (client.handshake?.auth?.apiKey as string) ||
      (client.handshake?.query?.apiKey as string) ||
      '';
    const walletType =
      (client.handshake?.auth?.walletType as string) ||
      (client.handshake?.query?.walletType as string) ||
      '';

    if (apiKey !== this.expectedApiKey) {
      this.logger.warn(
        `Payment bot rejected: invalid API key (socket ${client.id})`,
      );
      client.emit('error', { message: 'Invalid API key' });
      client.disconnect();
      return;
    }

    if (!walletType) {
      this.logger.warn(
        `Payment bot rejected: no walletType (socket ${client.id})`,
      );
      client.emit('error', { message: 'walletType required' });
      client.disconnect();
      return;
    }

    // Replace existing bot for this walletType
    const existing = this.connectedBots.get(walletType);
    if (existing && existing.id !== client.id) {
      this.logger.warn(
        `Replacing existing payment bot for ${walletType} (old: ${existing.id})`,
      );
      this.socketToWalletType.delete(existing.id);
    }

    this.connectedBots.set(walletType, client);
    this.socketToWalletType.set(client.id, walletType);

    this.logger.log(
      `Payment bot connected: ${walletType} (socket ${client.id})`,
    );
    client.emit('connected', { walletType });

    // Emit status to operators
    this.emitPaymentBotStatus();

    // Check for queued jobs for this walletType
    this.dispatchQueuedJobs(walletType);
  }

  handleDisconnect(client: Socket) {
    const walletType = this.socketToWalletType.get(client.id);
    if (walletType) {
      const current = this.connectedBots.get(walletType);
      if (current?.id === client.id) {
        this.connectedBots.delete(walletType);
      }
      this.socketToWalletType.delete(client.id);
      this.logger.log(`Payment bot disconnected: ${walletType}`);
      this.emitPaymentBotStatus();
    }
  }

  // ==========================================
  // INCOMING EVENTS FROM PAYMENT EXTENSIONS
  // ==========================================

  @SubscribeMessage('payment_result')
  async handlePaymentResult(
    @MessageBody()
    data: {
      jobId: string;
      success: boolean;
      operationNumber?: string;
      screenshotUrl?: string;
      error?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const walletType = this.socketToWalletType.get(client.id) || 'unknown';
    this.logger.log(
      `Payment result from ${walletType}: job=${data.jobId}, success=${data.success}`,
    );

    try {
      const service = this.getOutboundPaymentsService();
      const result = await service.handlePaymentResult(data.jobId, {
        success: data.success,
        operationNumber: data.operationNumber,
        screenshotUrl: data.screenshotUrl,
        error: data.error,
      });
      return result;
    } catch (err: any) {
      this.logger.error(`Failed to process payment result: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    const walletType = this.socketToWalletType.get(client.id);
    if (walletType) {
      this.logger.debug(`Payment bot heartbeat: ${walletType}`);
    }
    return { ack: true };
  }

  @SubscribeMessage('balance_report')
  async handleBalanceReport(
    @MessageBody() data: { walletType: string; balance: number },
    @ConnectedSocket() client: Socket,
  ) {
    const walletType =
      this.socketToWalletType.get(client.id) || data.walletType;
    this.logger.log(`Balance report from ${walletType}: $${data.balance}`);

    // Update wallet outbound balance
    try {
      await this.prisma.paymentConfig.updateMany({
        where: { type: walletType as any, outboundEnabled: true },
        data: {
          outboundBalance: data.balance,
          lastBalanceCheck: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to update wallet balance: ${err.message}`);
    }
  }

  // ==========================================
  // JOB DISPATCH
  // ==========================================

  /**
   * Dispatch a payment job to the correct extension bot.
   */
  async pushPaymentJob(job: any, walletType: string): Promise<boolean> {
    const bot = this.connectedBots.get(walletType);
    if (!bot?.connected) {
      this.logger.warn(`No payment bot connected for ${walletType}`);
      return false;
    }

    this.logger.log(`Dispatching payment job ${job.id} to ${walletType}`);
    bot.emit('new_payment_job', job);
    return true;
  }

  /**
   * Check for queued OUTBOUND_PAYMENT jobs matching this walletType and dispatch.
   */
  private async dispatchQueuedJobs(walletType: string) {
    try {
      const queuedPayments = await this.prisma.outboundPayment.findMany({
        where: {
          status: 'QUEUED',
          walletType: walletType as any,
        },
        include: { job: true },
        orderBy: { createdAt: 'asc' },
        take: 1, // One at a time
      });

      if (queuedPayments.length > 0) {
        const payment = queuedPayments[0];
        if (payment.job) {
          const dispatched = await this.pushPaymentJob(
            {
              id: payment.job.id,
              type: payment.job.type,
              amount: Number(payment.amount),
              paymentMethod: payment.paymentMethod,
              paymentDetails: payment.paymentDetails,
              walletType,
            },
            walletType,
          );

          if (dispatched) {
            await this.prisma.outboundPayment.update({
              where: { id: payment.id },
              data: { status: 'PROCESSING', executedAt: new Date() },
            });
          }
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to dispatch queued jobs for ${walletType}: ${err.message}`,
      );
    }
  }

  // ==========================================
  // EVENT LISTENERS (from OutboundPaymentsService)
  // ==========================================

  @OnEvent('outbound_payment.job_created')
  async onJobCreated(data: {
    jobId: string;
    paymentId: string;
    walletType: string;
    amount: number;
    paymentMethod: string;
    paymentDetails: any;
  }) {
    const dispatched = await this.pushPaymentJob(
      {
        id: data.jobId,
        type: 'OUTBOUND_PAYMENT',
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        paymentDetails: data.paymentDetails,
        walletType: data.walletType,
      },
      data.walletType,
    );

    if (dispatched) {
      await this.prisma.outboundPayment.update({
        where: { id: data.paymentId },
        data: { status: 'PROCESSING', executedAt: new Date() },
      });
    }
  }

  @OnEvent('crypto_buy.created')
  async onCryptoBuyCreated(data: {
    jobId: string;
    walletId: string;
    amount: number;
  }) {
    const dispatched = await this.pushPaymentJob(
      {
        id: data.jobId,
        type: 'BUY_CRYPTO',
        amount: data.amount,
      },
      'FIWIND',
    ); // Crypto only on Fiwind

    if (!dispatched) {
      this.logger.warn(
        `No Fiwind payment bot connected for crypto buy job ${data.jobId}`,
      );
    }
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private getOutboundPaymentsService(): OutboundPaymentsService {
    return this.moduleRef.get(OutboundPaymentsService, { strict: false });
  }

  isPaymentBotConnected(walletType: string): boolean {
    const bot = this.connectedBots.get(walletType);
    return !!bot?.connected;
  }

  getConnectedWalletTypes(): string[] {
    return Array.from(this.connectedBots.entries())
      .filter(([, socket]) => socket.connected)
      .map(([type]) => type);
  }

  private emitPaymentBotStatus() {
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('payment_bot_status', {
        connectedTypes: this.getConnectedWalletTypes(),
        timestamp: new Date().toISOString(),
      });
    } catch {}
  }
}
