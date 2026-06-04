import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard to protect bot endpoints with API key authentication.
 * The bot sends X-Bot-API-Key header which must match BOT_API_KEY env var.
 */
@Injectable()
export class BotApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(BotApiKeyGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-bot-api-key'];

    const expectedApiKey = this.configService.get<string>('BOT_API_KEY');

    if (!expectedApiKey) {
      this.logger.error('BOT_API_KEY not configured — rejecting bot request');
      throw new UnauthorizedException('Bot API key not configured');
    }

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-Bot-API-Key header');
    }

    if (apiKey !== expectedApiKey) {
      throw new UnauthorizedException('Invalid bot API key');
    }

    return true;
  }
}
