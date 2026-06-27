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
import {
  Logger,
  Inject,
  forwardRef,
  ForbiddenException,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { RequestsService } from '../requests/requests.service';
import { EventsGateway } from './events.gateway';
import { getCorsOrigin } from '../common/cors.config';
import { sanitizeError } from '../common/sanitize-error';

/**
 * ChatsGateway - Dedicated namespace for Chat App
 *
 * This gateway provides compatibility with the chat app's expected Socket.IO events.
 * It bridges the chat app's event format to the main EventsGateway.
 *
 * Chat App expects:
 * - Namespace: /chats
 * - Events: request_status_update, message_received, send_message
 *
 * This gateway translates these to the standard format used by EventsGateway.
 */
@WebSocketGateway({
  cors: {
    origin: getCorsOrigin(),
    credentials: true,
  },
  namespace: '/chats',
})
@UsePipes(new ValidationPipe({ whitelist: true }))
export class ChatsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatsGateway.name);
  private connectedClients: Map<
    string,
    { socket: Socket; userId?: string; role?: string }
  > = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    @Inject(forwardRef(() => RequestsService))
    private readonly requestsService: RequestsService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    private readonly moduleRef: ModuleRef,
  ) {}

  afterInit() {
    this.logger.log('ChatsGateway (/chats namespace) initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (token) {
        const payload = await this.jwtService.verifyAsync(token);
        client.data.user = payload;

        // Join user-specific room in this namespace
        client.join(`user:${payload.sub}`);

        this.connectedClients.set(client.id, {
          socket: client,
          userId: payload.sub,
          role: payload.role,
        });

        this.logger.log(
          `[/chats] Client connected: ${client.id} (user: ${payload.sub})`,
        );
      } else {
        // Reject unauthenticated connections
        this.logger.warn(
          `[/chats] Rejecting unauthenticated client: ${client.id}`,
        );
        client.emit('unauthorized', 'Authentication required');
        client.disconnect();
        return;
      }
    } catch (error) {
      this.logger.warn(
        `[/chats] Client connection failed: ${client.id} - ${error.message}`,
      );
      client.emit('unauthorized', 'Invalid token');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(`[/chats] Client disconnected: ${client.id}`);
  }

  private extractToken(client: Socket): string | null {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return (
      ((client.handshake.auth?.token ||
        client.handshake.query?.token) as string) || null
    );
  }

  // ==========================================
  // CHAT APP EVENT HANDLERS
  // ==========================================

  /**
   * Handle send_message event from chat app
   * Chat app sends: { chatId, content } or { requestId, content }
   * If requestId is provided instead of chatId, resolve the chat from the request
   */
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      requestId?: string;
      content: string;
      chatId?: string;
      imageUrl?: string;
    },
  ): Promise<any> {
    const user = client.data.user;
    if (!user) {
      return { error: 'Unauthorized' };
    }

    try {
      let chatId = data.chatId;

      // If chatId not provided, try to resolve it from requestId
      // The chat app's request detail page sends requestId as chatId
      if (!chatId && data.requestId) {
        chatId = await this.requestsService.getOrCreateRequestChat(
          data.requestId,
          user.sub,
          user.role,
        );
        this.logger.debug(
          `[/chats] Resolved chatId ${chatId} from requestId ${data.requestId}`,
        );
      }

      // Also check if the provided "chatId" might actually be a requestId
      // (this happens when the chat app passes request.id as chatId)
      if (chatId && !data.requestId) {
        try {
          // Try to get or create chat from the ID (treating it as requestId)
          const resolvedChatId =
            await this.requestsService.getOrCreateRequestChat(
              chatId,
              user.sub,
              user.role,
            );
          chatId = resolvedChatId;
        } catch (e) {
          // Re-throw authorization errors; only suppress NotFoundException
          if (
            e instanceof ForbiddenException ||
            e instanceof UnauthorizedException
          ) {
            throw e;
          }
          // If it fails for other reasons, the chatId is probably a real chat ID, continue
        }
      }

      if (!chatId) {
        this.logger.warn(
          `[/chats] send_message without chatId from user ${user.sub}`,
        );
        return { error: 'chatId or requestId is required' };
      }

      const message = await this.messagesService.sendMessage(
        user.sub,
        {
          chatId,
          content: data.content,
          ...(data.imageUrl && { imageUrl: data.imageUrl }),
        },
        user.role,
      );

      return { success: true, message };
    } catch (error) {
      this.logger.error(`[/chats] Error sending message: ${error.message}`);
      return { error: sanitizeError(error) };
    }
  }

  /**
   * Get or create a chat for the authenticated user.
   * Used by WhatsApp extension which needs a chat BEFORE creating a request.
   */
  @SubscribeMessage('create_or_get_chat')
  async handleCreateOrGetChat(@ConnectedSocket() client: Socket): Promise<any> {
    const user = client.data.user;
    if (!user) return { error: 'Unauthorized' };

    try {
      // Find existing open chat for this user
      let chat = await this.prisma.chat.findFirst({
        where: { userId: user.sub, status: 'OPEN' },
        orderBy: { updatedAt: 'desc' },
      });

      if (!chat) {
        chat = await this.prisma.chat.create({
          data: { userId: user.sub, status: 'OPEN' },
        });
        this.logger.log(
          `[/chats] Created new chat ${chat.id} for user ${user.sub}`,
        );

        // Notify operators of new chat
        try {
          // @ts-ignore — dynamic import to avoid circular dependency
          const { OperatorGateway } = await import('./operator.gateway');
          const operatorGateway = this.moduleRef.get(OperatorGateway, {
            strict: false,
          });
          operatorGateway.emitToAll('chat:new', {
            chatId: chat.id,
            userId: user.sub,
          });
        } catch (e) {
          this.logger.warn(
            `[/chats] Could not notify operators of new chat: ${e.message}`,
          );
        }
      }

      // Join the chat room
      client.join(`chat:${chat.id}`);
      return { success: true, chatId: chat.id };
    } catch (error) {
      this.logger.error(
        `[/chats] Error in create_or_get_chat: ${error.message}`,
      );
      return { error: sanitizeError(error) };
    }
  }

  /**
   * Handle join_chat event - join a specific chat room
   */
  @SubscribeMessage('join_chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = client.data.user;
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Operators can join any chat; clients must own the chat
    const isOperator = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(
      user.role,
    );
    if (!isOperator) {
      const chat = await this.prisma.chat.findUnique({
        where: { id: data.chatId },
        select: { userId: true },
      });
      if (!chat || chat.userId !== user.sub) {
        this.logger.warn(
          `[/chats] Client ${client.id} (user: ${user.sub}) denied join to chat:${data.chatId}`,
        );
        return { success: false, error: 'Access denied' };
      }
    }

    client.join(`chat:${data.chatId}`);
    this.logger.debug(
      `[/chats] Client ${client.id} joined chat:${data.chatId}`,
    );
    return { success: true };
  }

  /**
   * Handle leave_chat event - leave a specific chat room
   */
  @SubscribeMessage('leave_chat')
  handleLeaveChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    client.leave(`chat:${data.chatId}`);
    return { success: true };
  }

  /**
   * Handle typing indicator
   */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = client.data.user;
    if (user) {
      client.to(`chat:${data.chatId}`).emit('operator_typing', {
        chatId: data.chatId,
        userId: user.sub,
      });
    }
    return { success: true };
  }

  /**
   * Handle prize claim payment details from chat app (PrizePaymentCard)
   */
  @SubscribeMessage('prize_claim:set_payment')
  async handlePrizeClaimSetPayment(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      claimId: string;
      userId: string;
      paymentMethod: string;
      paymentDetails: any;
    },
  ): Promise<any> {
    const user = client.data.user;
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const {
        PrizeClaimsService,
      } = require('../prize-claims/prize-claims.service');
      const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
        strict: false,
      });

      await prizeClaimsService.setPaymentDetails(data.claimId, user.sub, {
        paymentMethod: data.paymentMethod,
        paymentDetails: data.paymentDetails,
      });

      return { success: true };
    } catch (error: any) {
      this.logger.error(`prize_claim:set_payment failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle unified prize claim creation (amount + payment details in one step)
   */
  @SubscribeMessage('prize_claim:create_unified')
  async handlePrizeClaimCreateUnified(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      amount: number;
      paymentMethod: string;
      paymentDetails: { cbu?: string; alias?: string; accountHolder: string };
    },
  ): Promise<any> {
    const user = client.data.user;
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const {
        PrizeClaimsService,
      } = require('../prize-claims/prize-claims.service');
      const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
        strict: false,
      });

      // Get the user's chat ID for the claim record
      const { ChatsService } = require('../chats/chats.service');
      const chatsService = this.moduleRef.get(ChatsService, { strict: false });
      const chat = await chatsService.getOrCreateChat(user.sub);

      const claim = await prizeClaimsService.createWithPayment(user.sub, {
        amount: data.amount,
        chatId: chat.id,
        paymentMethod: data.paymentMethod,
        paymentDetails: data.paymentDetails,
      });

      return { success: true, claimId: claim.id };
    } catch (error: any) {
      this.logger.error(`prize_claim:create_unified failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ==========================================
  // EMIT METHODS (for compatibility with chat app event names)
  // ==========================================

  /**
   * Emit request status update in chat app format
   * Chat app expects: request_status_update
   */
  emitRequestStatusUpdate(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('request_status_update', {
      requestId: data.requestId,
      status: data.status,
      proofUrl: data.proofUrl,
      validationScore: data.validationScore,
    });
  }

  /**
   * Emit new message in chat app format
   * Chat app expects: message_received
   */
  emitMessageReceived(userId: string, requestId: string, message: any) {
    this.server.to(`user:${userId}`).emit('message_received', {
      requestId,
      message: {
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt,
        ...(message.imageUrl && { imageUrl: message.imageUrl }),
        ...(message.sender && { sender: message.sender }),
      },
    });
  }

  /**
   * Emit to a specific chat room
   */
  emitToChatRoom(chatId: string, event: string, data: any) {
    this.server.to(`chat:${chatId}`).emit(event, data);
  }

  /**
   * Emit to a specific user
   */
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Get connected clients count for /chats namespace
   */
  getConnectedCount(): number {
    return this.connectedClients.size;
  }
}
