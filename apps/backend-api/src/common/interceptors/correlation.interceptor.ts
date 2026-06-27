import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

const HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const correlationId = (req.headers[HEADER] as string) || randomUUID();

    // Attach to request so other interceptors/services can read it
    (req as any).correlationId = correlationId;

    // Echo back in response header
    res.setHeader(HEADER, correlationId);

    return next.handle();
  }
}
