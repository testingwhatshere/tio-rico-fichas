import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Request,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ChatQueryDto, AssignChatDto, CloseChatDto } from './dto';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  // ==========================================
  // CLIENT ENDPOINTS
  // ==========================================

  /**
   * Get or create chat for current user
   * Users always have one active chat
   */
  @Get('me')
  async getMyChat(@Request() req: any) {
    return this.chatsService.getOrCreateChat(req.user.sub);
  }

  /**
   * Alias for getMyChat - Get or create support chat
   * This endpoint exists for chat app compatibility
   */
  @Get('support')
  async getSupportChat(@Request() req: any) {
    return this.chatsService.getOrCreateChat(req.user.sub);
  }

  /**
   * User taps "Necesito ayuda" — flag the chat, alert operators (panel +
   * Telegram), and persist a user-side message so the request appears in the
   * conversation. `context` distinguishes plain chat help from prize-flow help.
   */
  @Post('me/help')
  async requestHelp(@Request() req: any, @Body() body: { context?: 'chat' | 'prize' }) {
    return this.chatsService.requestHelp(req.user.sub, body?.context === 'prize' ? 'prize' : 'chat');
  }

  /**
   * Get user's chat history
   */
  @Get('me/history')
  async getMyChatHistory(@Request() req: any) {
    return this.chatsService.getUserChatHistory(req.user.sub);
  }

  // ==========================================
  // OPERATOR ENDPOINTS
  // ==========================================

  /**
   * List all chats (with filters)
   */
  @Get()
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async listChats(@Query() query: ChatQueryDto) {
    return this.chatsService.listChats(query);
  }

  /**
   * Get open chats queue
   */
  @Get('queue')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getOpenChats() {
    return this.chatsService.getOpenChats();
  }

  /**
   * Get my assigned chats (operator)
   */
  @Get('assigned')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getMyAssignedChats(@Request() req: any) {
    return this.chatsService.getOperatorChats(req.user.sub);
  }

  /**
   * Get chat by ID
   */
  @Get(':id')
  async getChatById(@Param('id') id: string, @Request() req: any) {
    // Pass userId for access control (user can only see their own chats)
    return this.chatsService.getChatById(id, req.user.sub);
  }

  /**
   * Assign chat to operator
   */
  @Patch(':id/assign')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async assignChat(
    @Param('id') id: string,
    @Body() body: AssignChatDto,
    @Request() req: any,
  ) {
    // If no operatorId provided, assign to current user
    const operatorId = body.operatorId || req.user.sub;
    return this.chatsService.assignChat(id, operatorId);
  }

  /**
   * Take chat (assign to self)
   */
  @Post(':id/take')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async takeChat(@Param('id') id: string, @Request() req: any) {
    return this.chatsService.assignChat(id, req.user.sub);
  }

  /**
   * Close chat
   */
  @Patch(':id/close')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async closeChat(
    @Param('id') id: string,
    @Body() body: CloseChatDto,
    @Request() req: any,
  ) {
    return this.chatsService.closeChat(id, req.user.sub, body.reason);
  }

  /**
   * Reopen a closed chat
   */
  @Patch(':id/reopen')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async reopenChat(@Param('id') id: string) {
    return this.chatsService.reopenChat(id);
  }
}
