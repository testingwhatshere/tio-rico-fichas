import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const client: Socket = context.switchToWs().getClient();
      const token = this.extractToken(client);

      if (!token) {
        throw new WsException('Missing authentication token');
      }

      const payload = await this.jwtService.verifyAsync(token);
      client.data.user = payload;

      return true;
    } catch (error) {
      throw new WsException('Invalid authentication token');
    }
  }

  private extractToken(client: Socket): string | null {
    // Try auth header first
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Try query param
    const token = client.handshake.auth?.token || client.handshake.query?.token;
    return (token as string) || null;
  }
}
