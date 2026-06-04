import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ChatsGateway } from './chats.gateway';
import { OperatorGateway } from './operator.gateway';
import { TelegramService } from '../notifications/telegram.service';
import { getCorsOrigin } from '../common/cors.config';

@WebSocketGateway({
  cors: {
    origin: getCorsOrigin(),
    credentials: true,
  },
  namespace: '/',
})
@UsePipes(new ValidationPipe({ whitelist: true }))
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedClients: Map<string, { socket: Socket; userId?: string; role?: string }> =
    new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatsGateway))
    private readonly chatsGateway: ChatsGateway,
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
    private readonly telegramService: TelegramService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (token) {
        const payload = await this.jwtService.verifyAsync(token);
        client.data.user = payload;

        // Join user-specific room
        client.join(`user:${payload.sub}`);

        // Join role-specific room
        if (payload.role) {
          client.join(`role:${payload.role}`);
        }

        this.connectedClients.set(client.id, {
          socket: client,
          userId: payload.sub,
          role: payload.role,
        });

        this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
      } else {
        // Fix 23: Reject unauthenticated clients instead of tracking them
        this.logger.warn(`Unauthenticated client rejected: ${client.id}`);
        client.emit('error', { message: 'Authentication required' });
        client.disconnect();
        return;
      }
    } catch (error) {
      this.logger.warn(`Client auth failed: ${client.id} - ${error.message}`);
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private extractToken(client: Socket): string | null {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return (client.handshake.auth?.token || client.handshake.query?.token) as string || null;
  }

  // ==========================================
  // ROOM MANAGEMENT
  // ==========================================

  @SubscribeMessage('join:chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = client.data.user;
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Operators can join any chat; clients must own the chat
    const isOperator = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(user.role);
    if (!isOperator) {
      const chat = await this.prisma.chat.findUnique({
        where: { id: data.chatId },
        select: { userId: true },
      });
      if (!chat || chat.userId !== user.sub) {
        this.logger.warn(`Client ${client.id} (user: ${user.sub}) denied join to chat:${data.chatId}`);
        return { success: false, error: 'Access denied' };
      }
    }

    client.join(`chat:${data.chatId}`);
    this.logger.debug(`Client ${client.id} joined chat:${data.chatId}`);
    return { success: true };
  }

  @SubscribeMessage('leave:chat')
  handleLeaveChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    client.leave(`chat:${data.chatId}`);
    return { success: true };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = client.data.user;
    if (user) {
      client.to(`chat:${data.chatId}`).emit('user:typing', {
        chatId: data.chatId,
        userId: user.sub,
        role: user.role,
      });
      // Bridge to /operator namespace so operators see user typing
      if (user.role === 'CLIENT') {
        this.operatorGateway.emitToAll('user_typing', {
          chatId: data.chatId,
          userId: user.sub,
        });
      }
    }
  }

  // ==========================================
  // EMIT METHODS (called by services)
  // ==========================================

  // Request events
  emitRequestCreated(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('request:created', data);
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('request:created', data);
    this.chatsGateway.emitToUser(userId, 'request:created', data);
  }

  emitRequestUpdated(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('request:updated', data);
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('request:updated', data);
    this.chatsGateway.emitToUser(userId, 'request:updated', data);
  }

  emitRequestCompleted(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('request:completed', data);
    this.chatsGateway.emitToUser(userId, 'request:completed', data);
  }

  emitRequestRejected(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('request:rejected', data);
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('request:rejected', data);
    this.chatsGateway.emitToUser(userId, 'request:rejected', data);
  }

  // Job events
  emitJobQueued(data: any) {
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('job:queued', data);
  }

  emitJobStarted(data: any, userId?: string) {
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('job:started', data);
    if (userId) {
      this.server.to(`user:${userId}`).emit('job:started', data);
      this.chatsGateway.emitToUser(userId, 'job:started', data);
    }
  }

  emitJobProgress(data: any, userId?: string) {
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('job:progress', data);
    if (userId) {
      this.server.to(`user:${userId}`).emit('job:progress', data);
      this.chatsGateway.emitToUser(userId, 'job:progress', data);
    }
  }

  emitJobCompleted(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('job:completed', data);
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('job:completed', data);
    this.chatsGateway.emitToUser(userId, 'job:completed', data);
  }

  emitJobFailed(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('job:failed', data);
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('job:failed', data);
    this.chatsGateway.emitToUser(userId, 'job:failed', data);
  }

  // Chat events
  emitNewMessage(chatId: string, message: any) {
    this.server.to(`chat:${chatId}`).emit('message:new', message);
  }

  emitMessageRead(chatId: string, data: any) {
    this.server.to(`chat:${chatId}`).emit('messages:read', data);
  }

  emitOperatorAssigned(chatId: string, data: any) {
    this.server.to(`chat:${chatId}`).emit('operator:assigned', data);
  }

  // Bot events
  emitBotStatus(data: any) {
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('bot:status', data);
    this.operatorGateway.emitToAll('bot_status', data);
  }

  // Dashboard refresh
  emitDashboardUpdate() {
    this.server.to('role:OPERATOR').to('role:SENIOR_OPERATOR').to('role:ADMIN').emit('dashboard:update', {
      timestamp: new Date().toISOString(),
    });
  }

  // ==========================================
  // ADDITIONAL EMIT METHODS
  // ==========================================

  // Emit to specific user
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
    this.chatsGateway.emitToUser(userId, event, data);
  }

  // Emit to all operators
  emitToOperators(event: string, data: any) {
    this.server
      .to('role:OPERATOR')
      .to('role:SENIOR_OPERATOR')
      .to('role:ADMIN')
      .emit(event, data);
  }

  // Emit to chat room
  emitToChatRoom(chatId: string, event: string, data: any) {
    this.server.to(`chat:${chatId}`).emit(event, data);
  }

  // Emit to all connected clients
  emitToAll(event: string, data: any) {
    this.server.emit(event, data);
  }

  // Validation events
  emitValidationStarted(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('validation:started', data);
    this.chatsGateway.emitToUser(userId, 'validation:started', data);
  }

  emitValidationCompleted(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('validation:completed', data);
    this.emitToOperators('validation:completed', data);
    this.chatsGateway.emitToUser(userId, 'validation:completed', data);
    // Bridge to /operator namespace
    this.operatorGateway.emitToAll('validation_completed', data);
  }

  emitValidationFailed(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('validation:failed', data);
    this.emitToOperators('validation:failed', data);
    this.chatsGateway.emitToUser(userId, 'validation:failed', data);
    // Bridge to /operator namespace so operator panel receives it in real-time
    this.operatorGateway.emitValidationFailed(data);
    this.telegramService.alertValidationFailed(data.requestId || data.id, data.reason || data.validationError).catch(() => {});
  }

  // Dispatch blocked (job queued but not dispatched)
  emitDispatchBlocked(data: { jobId: string; reason: string }) {
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.emitToOperators('dispatch:blocked', payload);
    this.operatorGateway.emitDispatchBlocked(payload);
  }

  // System alerts (stuck jobs, queue overflow, service outages)
  emitSystemAlert(data: { type: string; message: string; severity: 'info' | 'warning' | 'critical'; details?: any; [key: string]: any }) {
    this.emitToOperators('system_alert', data);
    this.operatorGateway.emitSystemAlert(data);
    // Forward critical/warning alerts to Telegram
    if (data.severity === 'critical') {
      this.telegramService.alertSystemCritical(data.message).catch(() => {});
    } else if (data.type === 'wallets_all_full') {
      this.telegramService.alertWalletsAllFull().catch(() => {});
    }
  }

  // Proof upload events
  emitProofUploaded(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('proof:uploaded', data);
    this.emitToOperators('proof:uploaded', data);
    this.chatsGateway.emitToUser(userId, 'proof:uploaded', data);
    this.operatorGateway.emitProofUploaded(data);
  }

  // Get connected clients count
  getConnectedCount(): number {
    return this.connectedClients.size;
  }

  // Get online operators count
  getOnlineOperatorsCount(): number {
    let count = 0;
    this.connectedClients.forEach((client) => {
      if (
        client.role === 'OPERATOR' ||
        client.role === 'SENIOR_OPERATOR' ||
        client.role === 'ADMIN'
      ) {
        count++;
      }
    });
    return count;
  }
}
