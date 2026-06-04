import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { TelegramBotService } from './telegram-bot.service';

@Controller('api/telegram-bot')
export class TelegramBotController {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  @Post('webhook')
  @Public()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    const handler = this.telegramBotService.getWebhookHandler();
    if (!handler) {
      res.status(404).json({ error: 'Telegram bot not configured' });
      return;
    }
    return handler(req, res);
  }
}
