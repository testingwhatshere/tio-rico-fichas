import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email?: string; // For OPERATOR/ADMIN users
  username?: string; // For CLIENT users
  role: UserRole;
  iat?: number;
  exp?: number;
}
