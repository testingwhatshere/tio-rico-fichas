import { Injectable, Logger, NotFoundException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { ChatsGateway } from '../events/chats.gateway';
import { OperatorGateway } from '../events/operator.gateway';
import {
  SendMessageDto,
  GetMessagesQueryDto,
  MessageResponseDto,
  MessageType,
} from './dto';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => ChatsGateway))
    private readonly chatsGateway: ChatsGateway,
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
  ) {}

  /**
   * Send a message in a chat
   */
  async sendMessage(
    senderId: string,
    dto: SendMessageDto,
    senderRole: string,
  ): Promise<MessageResponseDto> {
    // Verify chat exists and user has access
    const chat = await this.prisma.chat.findUnique({
      where: { id: dto.chatId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Check access: user must be chat owner or assigned operator
    const isOwner = chat.userId === senderId;
    const isAssignedOperator = chat.operatorId === senderId;
    const isOperatorRole = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(senderRole);

    if (!isOwner && !isAssignedOperator && !isOperatorRole) {
      throw new ForbiddenException('You do not have access to this chat');
    }

    // Determine message type — clients are always USER to prevent spoofing
    let messageType: MessageType;
    if (dto.type && isOperatorRole) {
      messageType = dto.type;
    } else if (isOwner && senderRole === 'CLIENT') {
      messageType = MessageType.USER;
    } else if (isOperatorRole) {
      messageType = MessageType.OPERATOR;
    } else {
      messageType = MessageType.USER;
    }

    // Create the message
    const message = await this.prisma.message.create({
      data: {
        chatId: dto.chatId,
        senderId,
        content: dto.content,
        type: messageType,
        ...(dto.requestId && { requestId: dto.requestId }),
        ...(dto.imageUrl && { imageUrl: dto.imageUrl }),
      },
      include: {
        sender: {
          select: { id: true, email: true, role: true, operator: { select: { displayName: true } } },
        },
      },
    });

    // Update chat's updatedAt
    await this.prisma.chat.update({
      where: { id: dto.chatId },
      data: { updatedAt: new Date() },
    });

    this.logger.log(`Message sent in chat ${dto.chatId} by ${senderId}`);

    const formattedMessage = this.formatMessage(message);

    // Emit to root namespace (for any clients connected there)
    this.eventsGateway.emitNewMessage(dto.chatId, formattedMessage);

    // Emit to /chats namespace (where chat app connects)
    // Chat app joins `chat:${chatId}` room and listens for 'message:new'
    this.chatsGateway.emitToChatRoom(dto.chatId, 'message:new', formattedMessage);

    // Emit to /operator namespace (where operator panel connects)
    // Operators receive all messages to stay updated on chats
    // Note: formattedMessage already contains chatId, content, etc.
    this.operatorGateway.emitNewMessage(formattedMessage);

    // If user message, also notify operators via root namespace (legacy)
    if (messageType === MessageType.USER) {
      this.eventsGateway.emitToOperators('message:new_from_user', {
        chatId: dto.chatId,
        message: formattedMessage,
      });
    }

    // Emit event for Telegram bridge (operator → TG user)
    if (messageType === MessageType.OPERATOR) {
      this.eventEmitter.emit('chat.operator_message', {
        chatId: dto.chatId,
        content: dto.content,
        senderId,
      });
    }

    return formattedMessage;
  }

  /**
   * Send a system message (for automated notifications)
   */
  async sendSystemMessage(chatId: string, content: string, requestId?: string): Promise<MessageResponseDto> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Use the chat's userId as sender for system messages
    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId: chat.userId,
        content,
        type: 'SYSTEM',
        ...(requestId && { requestId }),
      },
      include: {
        sender: {
          select: { id: true, email: true, role: true, operator: { select: { displayName: true } } },
        },
      },
    });

    // Update chat's updatedAt so it bubbles up in sort order
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    const formattedMessage = this.formatMessage(message);

    // Emit to root namespace
    this.eventsGateway.emitNewMessage(chatId, formattedMessage);

    // Emit to /chats namespace (where chat app connects)
    this.chatsGateway.emitToChatRoom(chatId, 'message:new', formattedMessage);

    // Emit to /operator namespace (where operator panel connects)
    this.operatorGateway.emitNewMessage(formattedMessage);

    return formattedMessage;
  }

  /**
   * Get messages for a chat with pagination
   */
  async getMessages(
    chatId: string,
    userId: string,
    userRole: string,
    query: GetMessagesQueryDto,
  ): Promise<{ messages: MessageResponseDto[]; hasMore: boolean; nextCursor?: string }> {
    // Verify access
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const isOwner = chat.userId === userId;
    const isAssignedOperator = chat.operatorId === userId;
    const isOperatorRole = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(userRole);

    if (!isOwner && !isAssignedOperator && !isOperatorRole) {
      throw new ForbiddenException('You do not have access to this chat');
    }

    const limit = query.limit || 50;
    const where: any = { chatId };

    // Cursor-based pagination (composite: createdAt + id to avoid skipping same-timestamp messages)
    if (query.cursor) {
      const cursorMessage = await this.prisma.message.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, id: true },
      });
      if (cursorMessage) {
        where.OR = [
          { createdAt: { lt: cursorMessage.createdAt } },
          { createdAt: cursorMessage.createdAt, id: { lt: cursorMessage.id } },
        ];
      }
      // If cursor message doesn't exist (deleted/stale), skip pagination filter
      // and return from the beginning
    }

    const messages = await this.prisma.message.findMany({
      where,
      include: {
        sender: {
          select: { id: true, email: true, role: true, operator: { select: { displayName: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // Fetch one extra to check if there are more
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop(); // Remove the extra message
    }

    const nextCursor = hasMore && messages.length > 0
      ? messages[messages.length - 1].id
      : undefined;

    return {
      messages: messages.map((m) => this.formatMessage(m)),
      hasMore,
      nextCursor,
    };
  }

  /**
   * Mark messages as read
   */
  async markAsRead(chatId: string, userId: string, userRole?: string): Promise<{ count: number }> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Authorization: only chat owner, assigned operator, or operator roles
    const isOwner = chat.userId === userId;
    const isAssignedOperator = chat.operatorId === userId;
    const isOperatorRole = userRole && ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(userRole);

    if (!isOwner && !isAssignedOperator && !isOperatorRole) {
      throw new ForbiddenException('You do not have access to this chat');
    }

    // Mark messages not sent by this user as read
    const result = await this.prisma.message.updateMany({
      where: {
        chatId,
        senderId: { not: userId },
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} messages as read in chat ${chatId}`);

      const readData = {
        chatId,
        readBy: userId,
        count: result.count,
      };

      // Emit read receipt to all namespaces
      this.eventsGateway.emitToChatRoom(chatId, 'messages:read', readData);
      this.chatsGateway.emitToChatRoom(chatId, 'messages:read', readData);
      this.operatorGateway.emitToAll('messages:read', readData);
    }

    return { count: result.count };
  }

  /**
   * Get unread message count for a user
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    // Get all chats where user is participant
    const chats = await this.prisma.chat.findMany({
      where: {
        OR: [{ userId }, { operatorId: userId }],
      },
      select: { id: true },
    });

    const chatIds = chats.map((c) => c.id);

    const count = await this.prisma.message.count({
      where: {
        chatId: { in: chatIds },
        senderId: { not: userId },
        isRead: false,
      },
    });

    return { count };
  }

  /**
   * Emit typing indicator
   */
  async emitTyping(chatId: string, userId: string, userRole: string, isTyping: boolean): Promise<void> {
    // Verify chat exists and user has access before broadcasting
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) return; // Silently ignore typing for non-existent chats

    const isOwner = chat.userId === userId;
    const isAssignedOperator = chat.operatorId === userId;
    const isOperatorRole = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(userRole);

    if (!isOwner && !isAssignedOperator && !isOperatorRole) return; // Silently ignore unauthorized typing

    const typingData = {
      chatId,
      userId,
      isTyping,
    };

    // Emit to all namespaces
    this.eventsGateway.emitToChatRoom(chatId, 'user:typing', typingData);
    this.chatsGateway.emitToChatRoom(chatId, 'user:typing', typingData);
    // Also emit to /operator namespace so operators see user typing
    this.operatorGateway.emitToAll('user_typing', typingData);
  }

  /**
   * Format message for response
   */
  private formatMessage(message: any): MessageResponseDto {
    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      ...(message.imageUrl && { imageUrl: message.imageUrl }),
      type: message.type as MessageType,
      isRead: message.isRead,
      createdAt: message.createdAt,
      ...(message.requestId && { requestId: message.requestId }),
      sender: message.sender ? {
        id: message.sender.id,
        email: message.sender.email,
        role: message.sender.role,
        displayName: message.sender.operator?.displayName,
      } : undefined,
    };
  }
}
