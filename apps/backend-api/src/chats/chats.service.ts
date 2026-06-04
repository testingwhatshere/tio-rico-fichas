import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { OperatorGateway } from '../events/operator.gateway';
import { ChatStatus, ChatQueryDto, ChatResponseDto } from './dto';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
  ) {}

  /**
   * Get or create a chat for a user
   * Each user has one active chat at a time
   */
  async getOrCreateChat(userId: string): Promise<ChatResponseDto> {
    // Check for existing open/assigned chat
    let chat = await this.prisma.chat.findFirst({
      where: {
        userId,
        status: { in: ['OPEN', 'ASSIGNED'] },
      },
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
    });

    if (!chat) {
      // Create new chat
      chat = await this.prisma.chat.create({
        data: {
          userId,
          status: 'OPEN',
        },
        include: {
          user: { select: { id: true, email: true, username: true } },
          operator: { select: { id: true, email: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: {
            select: {
              messages: {
                where: { isRead: false, type: 'USER' },
              },
            },
          },
        },
      });

      this.logger.log(`Created new chat ${chat.id} for user ${userId}`);

      // Notify operators about new chat (root namespace)
      this.eventsGateway.emitToOperators('chat:new', {
        chatId: chat.id,
        userId,
        createdAt: chat.createdAt,
      });

      // Also emit on /operator namespace where the operator panel connects
      this.operatorGateway.emitNewChat(this.formatChatResponse(chat));
    }

    return this.formatChatResponse(chat);
  }

  /**
   * Get chat by ID
   */
  async getChatById(chatId: string, userId?: string): Promise<ChatResponseDto> {
    const where: any = { id: chatId };

    // If userId provided, ensure user owns the chat or is assigned operator
    if (userId) {
      where.OR = [
        { userId },
        { operatorId: userId },
      ];
    }

    const chat = await this.prisma.chat.findFirst({
      where,
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return this.formatChatResponse(chat);
  }

  /**
   * List chats with filters (for operators)
   */
  async listChats(query: ChatQueryDto): Promise<ChatResponseDto[]> {
    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.operatorId) {
      where.operatorId = query.operatorId;
    }

    const chats = await this.prisma.chat.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return chats.map((chat) => this.formatChatResponse(chat));
  }

  /**
   * Get open chats waiting for operator (queue)
   */
  async getOpenChats(): Promise<ChatResponseDto[]> {
    const chats = await this.prisma.chat.findMany({
      where: { status: 'OPEN' },
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' }, // FIFO
    });

    return chats.map((chat) => this.formatChatResponse(chat));
  }

  /**
   * Assign chat to operator
   */
  async assignChat(chatId: string, operatorId: string): Promise<ChatResponseDto> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.status === 'CLOSED') {
      throw new BadRequestException('Cannot assign a closed chat');
    }

    // Check operator exists and is available
    const operator = await this.prisma.operator.findFirst({
      where: { userId: operatorId },
      include: { user: true },
    });

    if (!operator) {
      throw new BadRequestException('Operator not found');
    }

    // Atomic count + check + update to prevent TOCTOU race (Fix 48)
    let updatedChat;
    try {
      updatedChat = await this.prisma.$transaction(
        async (tx) => {
          const activeChats = await tx.chat.count({
            where: { operatorId, status: 'ASSIGNED' },
          });

          if (activeChats >= operator.maxChats) {
            throw new BadRequestException('Operator has reached maximum chat limit');
          }

          return tx.chat.update({
            where: { id: chatId },
            data: { operatorId, status: 'ASSIGNED' },
            include: {
              user: { select: { id: true, email: true, username: true } },
              operator: { select: { id: true, email: true } },
              messages: { orderBy: { createdAt: 'desc' }, take: 1 },
              _count: {
                select: {
                  messages: {
                    where: { isRead: false, type: 'USER' },
                  },
                },
              },
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error?.code === 'P2034') {
        throw new BadRequestException('Chat assignment conflict, please try again');
      }
      throw error;
    }

    this.logger.log(`Chat ${chatId} assigned to operator ${operatorId}`);

    // Notify user that operator joined
    this.eventsGateway.emitToUser(chat.userId, 'chat:operator_assigned', {
      chatId,
      operatorId,
      operatorName: operator.displayName,
    });

    // Notify all operators about the assignment
    this.eventsGateway.emitToOperators('chat:assigned', {
      chatId,
      operatorId,
    });

    return this.formatChatResponse(updatedChat);
  }

  /**
   * Close chat
   */
  async closeChat(chatId: string, closedById: string, reason?: string): Promise<ChatResponseDto> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.status === 'CLOSED') {
      throw new BadRequestException('Chat is already closed');
    }

    // Atomic chat close + system message creation (Fix 49)
    await this.prisma.$transaction([
      this.prisma.chat.update({
        where: { id: chatId },
        data: { status: 'CLOSED' },
      }),
      this.prisma.message.create({
        data: {
          chatId,
          senderId: closedById,
          content: reason || 'Chat cerrado',
          type: 'SYSTEM',
        },
      }),
    ]);

    // Re-query after transaction to get fresh lastMessage including the system message
    const updatedChat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
    });

    if (!updatedChat) {
      throw new NotFoundException('Chat not found after closing');
    }

    this.logger.log(`Chat ${chatId} closed by ${closedById}${reason ? `: ${reason}` : ''}`);

    // Notify user
    this.eventsGateway.emitToUser(chat.userId, 'chat:closed', {
      chatId,
      reason,
    });

    // Notify operators
    this.eventsGateway.emitToOperators('chat:closed', {
      chatId,
      closedById,
    });

    return this.formatChatResponse(updatedChat);
  }

  /**
   * Reopen a closed chat
   */
  async reopenChat(chatId: string): Promise<ChatResponseDto> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.status !== 'CLOSED') {
      throw new BadRequestException('Chat is not closed');
    }

    const updatedChat = await this.prisma.chat.update({
      where: { id: chatId },
      data: {
        status: 'OPEN',
        operatorId: null,
      },
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
    });

    this.logger.log(`Chat ${chatId} reopened`);

    // Notify operators about reopened chat
    this.eventsGateway.emitToOperators('chat:reopened', {
      chatId,
      userId: chat.userId,
    });

    return this.formatChatResponse(updatedChat);
  }

  /**
   * Get user's chat history
   */
  async getUserChatHistory(userId: string): Promise<ChatResponseDto[]> {
    const chats = await this.prisma.chat.findMany({
      where: { userId },
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return chats.map((chat) => this.formatChatResponse(chat));
  }

  /**
   * Get chats assigned to an operator
   */
  async getOperatorChats(operatorId: string): Promise<ChatResponseDto[]> {
    const chats = await this.prisma.chat.findMany({
      where: {
        operatorId,
        status: 'ASSIGNED',
      },
      include: {
        user: { select: { id: true, email: true, username: true } },
        operator: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return chats.map((chat) => this.formatChatResponse(chat));
  }

  /**
   * Format chat for response
   */
  private formatChatResponse(chat: any): ChatResponseDto {
    return {
      id: chat.id,
      userId: chat.userId,
      operatorId: chat.operatorId,
      requestId: chat.requestId,
      status: chat.status as ChatStatus,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      user: chat.user,
      operator: chat.operator,
      lastMessage: chat.messages?.[0]
        ? {
            content: chat.messages[0].content,
            createdAt: chat.messages[0].createdAt,
            type: chat.messages[0].type,
          }
        : undefined,
      unreadCount: chat._count?.messages ?? 0,
    };
  }
}
