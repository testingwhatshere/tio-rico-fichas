import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getCorsOrigin } from './common/cors.config';
import { CorrelationInterceptor } from './common/interceptors/correlation.interceptor';

const logger = new Logger('Process');

/**
 * Niveles de log activos.
 *
 * Nest por defecto deja prendido todo, debug y verbose incluidos: en producción eso son
 * miles de líneas por día que nadie lee (una por request HTTP OK, más las transiciones
 * de estado duplicadas), y encima acortan la ventana útil de los 7 días que retiene
 * Render. En prod quedan log/warn/error; en dev sigue todo.
 *
 * Se puede forzar con LOG_LEVELS (lista separada por comas), p. ej. para depurar en
 * producción sin tocar código: LOG_LEVELS=log,warn,error,debug
 */
function resolveLogLevels(): LogLevel[] {
  const fromEnv = process.env.LOG_LEVELS?.trim();
  if (fromEnv) {
    return fromEnv.split(',').map((l) => l.trim()) as LogLevel[];
  }
  return process.env.NODE_ENV === 'production'
    ? ['log', 'warn', 'error']
    : ['log', 'warn', 'error', 'debug', 'verbose'];
}

process.on('unhandledRejection', (reason: any) => {
  logger.error(
    `Unhandled Rejection: ${reason?.message || reason}`,
    reason?.stack,
  );
});

process.on('uncaughtException', (error: Error) => {
  logger.error(`Uncaught Exception: ${error.message}`, error.stack);
  // Give logger time to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: resolveLogLevels(),
  });

  app.enableCors({
    origin: getCorsOrigin(),
    credentials: true,
  });

  app.useGlobalInterceptors(new CorrelationInterceptor());
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`Application running on port ${port}`);
}
bootstrap();
