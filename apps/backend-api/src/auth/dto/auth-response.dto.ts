import { UserRole } from '@prisma/client';

export class AuthResponseDto {
  accessToken: string;
  user: {
    id: string;
    email: string;
    username?: string;
    savedTargetUsername?: string;
    role: UserRole;
  };
}
