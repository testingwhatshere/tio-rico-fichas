import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Autentica a TioRicoCargas con `X-Integration-Key` = TRC_INTEGRATION_KEY.
 * Sin la variable configurada la integración queda apagada (todo 401).
 */
@Injectable()
export class IntegrationKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('TRC_INTEGRATION_KEY') || '';
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const raw = req.headers['x-integration-key'];
    const given = Array.isArray(raw) ? raw[0] : raw || '';
    if (!expected || !given) throw new UnauthorizedException();
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
