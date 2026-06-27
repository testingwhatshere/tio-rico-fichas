import {
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Sanitize error messages before returning to clients via Socket.IO.
 * Prevents leaking implementation details (Prisma errors, stack traces, etc.).
 */
export function sanitizeError(error: any): string {
  // Known Prisma error codes → friendly messages
  if (error?.code === 'P2025') return 'Registro no encontrado';
  if (error?.code === 'P2002') return 'Registro duplicado';
  if (error?.code === 'P2034')
    return 'Operación en conflicto, intentá de nuevo';

  // Known NestJS HTTP exceptions → pass through their message
  if (
    error instanceof ForbiddenException ||
    error instanceof UnauthorizedException ||
    error instanceof BadRequestException ||
    error instanceof NotFoundException
  ) {
    return error.message;
  }

  // Everything else → generic message (don't leak internals)
  return 'Operación fallida';
}
