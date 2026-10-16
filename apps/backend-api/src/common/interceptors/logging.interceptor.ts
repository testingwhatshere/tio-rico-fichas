import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

/** Una respuesta OK que tardó esto o más se sigue logueando: sirve para detectar
 *  degradación aunque no haya error. */
const SLOW_REQUEST_MS = 3_000;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;
    const correlationId = (request as any).correlationId || '-';
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        const delay = Date.now() - now;
        const line = `[${correlationId}] ${method} ${url} ${statusCode} - ${delay}ms`;

        // Las respuestas OK van a debug: son la enorme mayoría del volumen y sólo
        // sirven agregadas. Los errores y las respuestas lentas siguen en log, que es
        // lo que uno busca cuando algo anda mal. Menos ruido también estira la ventana
        // útil de los 7 días de retención de Render.
        if (statusCode >= 400 || delay >= SLOW_REQUEST_MS) {
          this.logger.log(line);
        } else {
          this.logger.debug(line);
        }
      }),
    );
  }
}
