import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const res = exceptionResponse as Record<string, unknown>;
        // El ValidationPipe devuelve `message` como array de strings. El chat-app
        // lo pasa tal cual a Alert.alert(), y Android cierra la app cuando le llega
        // un array donde espera un String. Lo aplanamos acá, una sola vez, para
        // todos los endpoints: la respuesta siempre lleva `message` string.
        message = Array.isArray(res.message)
          ? (res.message as unknown[]).join('. ')
          : (res.message as string) || exception.message;
        error = (res.error as string) || 'Error';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error,
      message,
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status}`,
        JSON.stringify(errorResponse),
      );
    } else if (status >= 400) {
      // Los 4xx no dejaban rastro: el LoggingInterceptor sólo corre en el camino
      // feliz (`tap` de éxito) y acá se cortaban en el 500. Resultado: el día que
      // varios clientes quedaron trabados con "Ya tenés una carga en proceso" no
      // había una sola línea en los logs — el incidente hubo que reconstruirlo
      // por los "Creating request" que no tenían un 201 detrás.
      this.logger.warn(
        `${request.method} ${request.url} ${status} - ${message}`,
      );
    }

    response.status(status).json(errorResponse);
  }
}
