import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import type { CurrentUserPayload } from '../interfaces/current-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not defined');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Cada request HTTP autenticado buscaba al usuario en la base (~4.500 por
   * dia contra Supabase, que cobra cada viaje). Se reusa 30 s: es lo maximo
   * que tarda en hacer efecto desactivar a alguien o cambiarle el alias.
   */
  private static readonly USER_TTL_MS = 30_000;
  private static readonly userCache = new Map<
    string,
    { at: number; user: CurrentUserPayload }
  >();

  async validate(payload: JwtPayload): Promise<CurrentUserPayload> {
    const hit = JwtStrategy.userCache.get(payload.sub);
    if (hit && Date.now() - hit.at < JwtStrategy.USER_TTL_MS) return hit.user;

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        username: true,
        savedTargetUsername: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Return CurrentUserPayload - must include both sub and id
    const result: CurrentUserPayload = {
      sub: user.id, // JWT standard field for user ID
      id: user.id, // Duplicate for convenience
      email: user.email ?? undefined,
      username: user.username ?? undefined,
      savedTargetUsername: user.savedTargetUsername ?? undefined,
      role: user.role,
    };
    if (JwtStrategy.userCache.size > 5000) JwtStrategy.userCache.clear();
    JwtStrategy.userCache.set(user.id, { at: Date.now(), user: result });
    return result;
  }
}
