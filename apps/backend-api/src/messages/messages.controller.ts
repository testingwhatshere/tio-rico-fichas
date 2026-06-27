import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Request,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { Roles } from '../common/decorators/roles.decorator';
import { SendMessageDto, GetMessagesQueryDto, SystemMessageDto } from './dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * Send a message
   */
  @Post()
  async sendMessage(@Body() dto: SendMessageDto, @Request() req: any) {
    return this.messagesService.sendMessage(req.user.sub, dto, req.user.role);
  }

  /**
   * Get messages for a chat
   */
  @Get('chat/:chatId')
  async getMessages(
    @Param('chatId') chatId: string,
    @Query() query: GetMessagesQueryDto,
    @Request() req: any,
  ) {
    return this.messagesService.getMessages(
      chatId,
      req.user.sub,
      req.user.role,
      query,
    );
  }

  /**
   * Mark messages as read
   */
  @Post('chat/:chatId/read')
  async markAsRead(@Param('chatId') chatId: string, @Request() req: any) {
    return this.messagesService.markAsRead(chatId, req.user.sub, req.user.role);
  }

  /**
   * Get unread message count
   */
  @Get('unread/count')
  async getUnreadCount(@Request() req: any) {
    return this.messagesService.getUnreadCount(req.user.sub);
  }

  /**
   * Emit typing indicator
   */
  @Post('chat/:chatId/typing')
  async emitTyping(
    @Param('chatId') chatId: string,
    @Body() body: { isTyping: boolean },
    @Request() req: any,
  ) {
    this.messagesService.emitTyping(
      chatId,
      req.user.sub,
      req.user.role,
      body.isTyping,
    );
    return { success: true };
  }

  // ==========================================
  // ADMIN/SYSTEM ENDPOINTS
  // ==========================================

  /**
   * Send system message (for automated notifications)
   */
  @Post('system')
  @Roles('ADMIN')
  async sendSystemMessage(@Body() dto: SystemMessageDto) {
    return this.messagesService.sendSystemMessage(dto.chatId, dto.content);
  }
}
