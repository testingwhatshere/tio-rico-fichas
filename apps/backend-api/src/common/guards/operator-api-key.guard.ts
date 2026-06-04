import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OperatorApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(OperatorApiKeyGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-operator-api-key'];

    const expectedApiKey = this.configService.get<string>('OPERATOR_API_KEY');

    if (!expectedApiKey) {
      this.logger.error('OPERATOR_API_KEY not configured');
      throw new UnauthorizedException('Operator API key not configured');
    }

    if (!apiKey || apiKey !== expectedApiKey) {
      throw new UnauthorizedException('Invalid operator API key');
    }

    return true;
  }
}
