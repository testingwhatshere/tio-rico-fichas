import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { OperatorGateway } from '../events/operator.gateway';
import { TelegramService } from '../notifications/telegram.service';
import { ChatStatus, ChatQueryDto, ChatResponseDto } from './dto';
import { toDeliverableProofUrlOrNull } from '../common/utils/proof-url';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  // ==========================================
  // HELP REQUESTS
  // ==========================================

  /**
   * The user hit "Necesito ayuda" in chat-app. Mark the chat, persist a system
   * message describing the context, and fan out alerts to every operator
   * channel (operator-panel, mobile, Telegram).
   *
   * `context` is "chat" or "prize" — lets the operator see at a glance what the
   * user was doing when they asked for help.
   */
  async requestHelp(
    userId: string,
    context: 'chat' | 'prize' = 'chat',
  ): Promise<{ chatId: string }> {
    const chat = await this.getOrCreateChat(userId);

    const now = new Date();
    await this.prisma.chat.update({
      where: { id: chat.id },
      data: {
        needsHelp: true,
        helpRequestedAt: now,
        helpContext: context,
        updatedAt: now,
      },
    });

    const contextLabel = context === 'prize' ? 'cobro de premio' : 'chat';
    const messageContent =
      context === 'prize'
        ? '🙋 Necesito ayuda con mi cobro de premio.'
        : '🙋 Necesito ayuda. ¿Un operador me puede atender?';

    // Persist a USER message so it's visible in the conversation as a normal
    // bubble. Operator clients also pick this up via 'new_message' and surface
    // a notification of their own.
    const message = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        senderId: userId,
        content: messageContent,
        type: 'USER',
      },
      include: {
        sender: {
          select: { id: true, email: true, username: true, role: true },
        },
      },
    });

    const formatted = {
      id: message.id,
      chatId: chat.id,
      senderId: userId,
      content: messageContent,
      type: 'USER' as const,
      createdAt: message.createdAt,
      sender: message.sender,
    };

    // 1) Emit the chat message as if the user had typed it.
    this.eventsGateway.emitToChatRoom(chat.id, 'message:new', formatted);
    this.operatorGateway.emitNewMessage(formatted);

    // 2) Dedicated help_requested event so the operator panel can play a
    //    distinct sound + highlight the chat in the sidebar.
    const helpPayload = {
      chatId: chat.id,
      userId,
      context,
      message: messageContent,
      requestedAt: now.toISOString(),
      username: (chat.user as any)?.username || chat.user?.email || 'usuario',
    };
    this.operatorGateway.emitHelpRequested(helpPayload);
    this.eventsGateway.emitToOperators('chat:help_requested', helpPayload);

    // 3) Telegram ping for operators who aren't watching the panel.
    this.telegramService
      .alertHelpRequested(helpPayload.username, context)
      .catch((err) =>
        this.logger.warn(`Telegram help alert failed: ${err.message}`),
      );

    this.logger.log(
      `Help requested by ${userId} in chat ${chat.id} (context: ${context})`,
    );

    return { chatId: chat.id };
  }

  /**
   * Clear the needsHelp flag — called automatically when an operator sends any
   * message into the chat (in messages.service). Idempotent.
   */
  async clearHelpFlag(chatId: string): Promise<void> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { needsHelp: true },
    });
    if (!chat || !chat.needsHelp) return;
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { needsHelp: false },
    });
    const payload = { chatId };
    this.operatorGateway.emitToAll('chat:help_cleared', payload);
    this.eventsGateway.emitToOperators('chat:help_cleared', payload);
  }

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
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
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
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              phone: true,
              savedTargetUsername: true,
            },
          },
          operator: { select: { id: true, email: true } },
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
      const formatted = await this.formatChat(chat);
      this.operatorGateway.emitNewChat(formatted);
      return formatted;
    }

    return this.formatChat(chat);
  }

  /**
   * Get chat by ID
   */
  async getChatById(chatId: string, userId?: string): Promise<ChatResponseDto> {
    const where: any = { id: chatId };

    // If userId provided, ensure user owns the chat or is assigned operator
    if (userId) {
      where.OR = [{ userId }, { operatorId: userId }];
    }

    const chat = await this.prisma.chat.findFirst({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
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

    return (await this.formatChat(chat));
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
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      // Sin cota traia TODOS los chats abiertos —con user, operator, ultimo
      // mensaje y un count de no-leidos por cada uno— en cada conexion de cada
      // operador. El gemelo `findAll` de este mismo servicio ya usaba take: 100.
      // Van 150 y ordenados por actividad: lo de arriba es lo que se atiende.
      take: 150,
    });

    return this.formatChats(chats);
  }

  /**
   * Get open chats waiting for operator (queue)
   */
  async getOpenChats(): Promise<ChatResponseDto[]> {
    const chats = await this.prisma.chat.findMany({
      where: { status: 'OPEN' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
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

    return this.formatChats(chats);
  }

  /**
   * Assign chat to operator
   */
  async assignChat(
    chatId: string,
    operatorId: string,
  ): Promise<ChatResponseDto> {
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
            throw new BadRequestException(
              'Operator has reached maximum chat limit',
            );
          }

          return tx.chat.update({
            where: { id: chatId },
            data: { operatorId, status: 'ASSIGNED' },
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  username: true,
                  phone: true,
                  savedTargetUsername: true,
                },
              },
              operator: { select: { id: true, email: true } },
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
        throw new BadRequestException(
          'Chat assignment conflict, please try again',
        );
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

    return (await this.formatChat(updatedChat));
  }

  /**
   * Close chat
   */
  async closeChat(
    chatId: string,
    closedById: string,
    reason?: string,
  ): Promise<ChatResponseDto> {
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
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
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

    this.logger.log(
      `Chat ${chatId} closed by ${closedById}${reason ? `: ${reason}` : ''}`,
    );

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

    return (await this.formatChat(updatedChat));
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
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
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

    return (await this.formatChat(updatedChat));
  }

  /**
   * Get user's chat history
   */
  async getUserChatHistory(userId: string): Promise<ChatResponseDto[]> {
    const chats = await this.prisma.chat.findMany({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
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

    return this.formatChats(chats);
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
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            phone: true,
            savedTargetUsername: true,
          },
        },
        operator: { select: { id: true, email: true } },
        _count: {
          select: {
            messages: {
              where: { isRead: false, type: 'USER' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      // Sin cota traia TODOS los chats abiertos —con user, operator, ultimo
      // mensaje y un count de no-leidos por cada uno— en cada conexion de cada
      // operador. El gemelo `findAll` de este mismo servicio ya usaba take: 100.
      // Van 150 y ordenados por actividad: lo de arriba es lo que se atiende.
      take: 150,
    });

    return this.formatChats(chats);
  }

  /**
   * Pending summary for the chat's user: open Requests (cargas) and open PrizeClaims (premios)
   * that the operator should see at a glance when opening the chat. Used by the chat sidebar
   * in operator-panel.
   */
  async getPendingSummary(chatId: string): Promise<{
    requests: Array<{
      id: string;
      amount: string;
      status: string;
      targetUsername: string;
      proofUrl: string | null;
      createdAt: Date;
    }>;
    prizeClaims: Array<{
      id: string;
      amount: string;
      status: string;
      targetUsername: string;
      createdAt: Date;
    }>;
  }> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { userId: true },
    });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const OPEN_REQUEST_STATUSES = [
      'VALIDATING',
      'VALIDATION_FAILED',
      'PENDING_MP_VERIFICATION',
      'APPROVED',
      'PROCESSING',
    ];
    const OPEN_PRIZE_STATUSES = [
      'PENDING_PAYMENT_DETAILS',
      'PENDING_VERIFICATION',
      'VERIFYING_CHIPS',
      'VERIFIED',
      'PROCESSING',
      'CHIPS_WITHDRAWN',
    ];

    const [requests, prizeClaims] = await Promise.all([
      this.prisma.request.findMany({
        where: {
          userId: chat.userId,
          status: { in: OPEN_REQUEST_STATUSES as any },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amount: true,
          status: true,
          targetUsername: true,
          proofUrl: true,
          createdAt: true,
        },
      }),
      this.prisma.prizeClaim.findMany({
        where: {
          userId: chat.userId,
          status: { in: OPEN_PRIZE_STATUSES as any },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amount: true,
          status: true,
          targetUsername: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      requests: requests.map((r) => ({
        ...r,
        amount: r.amount.toString(),
        // Un PDF crudo de Cloudinary da 401: el operador abria el comprobante
        // desde el chat y veia un recuadro vacio.
        proofUrl: toDeliverableProofUrlOrNull(r.proofUrl),
      })),
      prizeClaims: prizeClaims.map((p) => ({
        ...p,
        amount: p.amount.toString(),
      })),
    };
  }

  /**
   * Format chat for response
   */
  /**
   * El ultimo mensaje de cada chat va en una consulta aparte. Prisma 6 (sin
   * relationJoins) resolvia `include: { messages: { take: 1 } }` trayendo TODOS
   * los mensajes de los chats pedidos y cortando en memoria: ~4.600 mensajes
   * por cada carga de la bandeja, y era lo que mas egress gastaba en Supabase.
   * Con LATERAL + LIMIT 1 viaja una fila por chat.
   */
  private async attachLastMessages<T extends { id: string }>(
    chats: T[],
  ): Promise<Array<T & { messages: any[] }>> {
    if (chats.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{ chatId: string; content: string; type: string; createdAt: Date }>
    >`
      SELECT c.id AS "chatId", m.content, m.type::text AS type, m."createdAt"
      FROM unnest(${chats.map((c) => c.id)}::text[]) AS c(id)
      CROSS JOIN LATERAL (
        SELECT left(content, 300) AS content, type, "createdAt"
        FROM "Message"
        WHERE "chatId" = c.id
        ORDER BY "createdAt" DESC
        LIMIT 1
      ) m`;
    const byChat = new Map(rows.map((r) => [r.chatId, r]));
    return chats.map((chat) => {
      const last = byChat.get(chat.id);
      return { ...chat, messages: last ? [last] : [] };
    });
  }

  private async formatChat(chat: any): Promise<ChatResponseDto> {
    const [withLast] = await this.attachLastMessages([chat]);
    return this.formatChatResponse(withLast);
  }

  private async formatChats(chats: any[]): Promise<ChatResponseDto[]> {
    const withLast = await this.attachLastMessages(chats);
    return withLast.map((chat) => this.formatChatResponse(chat));
  }

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
