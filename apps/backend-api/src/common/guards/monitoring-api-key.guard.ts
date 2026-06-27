import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard for the Client Manager monitoring endpoint.
 * Checks X-Monitoring-API-Key header against MONITORING_API_KEY env var.
 */
@Injectable()
export class MonitoringApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(MonitoringApiKeyGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Accept either X-Monitoring-API-Key or X-Bot-API-Key
    const monitoringKey = request.headers['x-monitoring-api-key'];
    const botKey = request.headers['x-bot-api-key'];

    const expectedMonitoringKey =
      this.configService.get<string>('MONITORING_API_KEY');
    const expectedBotKey = this.configService.get<string>('BOT_API_KEY');

    // Try monitoring key first
    if (
      monitoringKey &&
      expectedMonitoringKey &&
      monitoringKey === expectedMonitoringKey
    ) {
      return true;
    }

    // Fallback to bot key
    if (botKey && expectedBotKey && botKey === expectedBotKey) {
      return true;
    }

    if (!monitoringKey && !botKey) {
      throw new UnauthorizedException(
        'Missing X-Monitoring-API-Key or X-Bot-API-Key header',
      );
    }

    throw new UnauthorizedException('Invalid API key');
  }
}
