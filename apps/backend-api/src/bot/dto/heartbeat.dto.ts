import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Payload del heartbeat de la extensión.
 *
 * OJO con recortar este DTO: el ValidationPipe global corre con
 * `forbidNonWhitelisted: true` (main.ts), así que CUALQUIER propiedad que la
 * extensión mande y no esté declarada acá hace que el request entero salga 400.
 *
 * Y un 400 no es solo ruido: `ApiClient.sendHeartbeat` devuelve false ante
 * cualquier respuesta no-OK, el service worker cuenta 3 fallos seguidos y llama
 * a `initializeConnection()`. Con el heartbeat cada 24s, eso es un reconnect
 * completo del WebSocket cada ~72 segundos, para siempre. Esa es la tormenta de
 * reconexiones que deja al bot sin responder `search_user` y cuelga cargas.
 *
 * Regla: este DTO tiene que ser un superset de lo que manda
 * `apps/automation-extension/background/api-client.js` → `sendHeartbeat()`.
 * Los campos que el backend no usa se aceptan y se ignoran a propósito.
 */
export class HeartbeatDto {
  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  version?: string;

  /**
   * Minutos desde que arrancó el service worker. Es lo que manda la extensión
   * hoy; `uptime` quedó de una versión anterior y se conserva para no romper
   * clientes viejos que sigan mandando ese nombre.
   */
  @IsOptional()
  @IsNumber()
  uptimeMinutes?: number;

  @IsOptional()
  @IsNumber()
  uptime?: number;

  @IsOptional()
  @IsString()
  type?: string;

  /**
   * El panelId autoritativo llega por el header `x-panel-id` y es el que usa el
   * controller. Este campo del body se acepta para no rechazar el request, pero
   * no se lee: si alguna vez difieren, manda el header.
   */
  @IsOptional()
  @IsString()
  panelId?: string;

  @IsOptional()
  @IsString()
  walletId?: string;

  @IsOptional()
  @IsString()
  tabStatus?: string;

  @IsOptional()
  @IsString()
  currentUrl?: string;

  @IsOptional()
  @IsBoolean()
  sessionValid?: boolean;

  @IsOptional()
  @IsNumber()
  pendingJobs?: number;

  @IsOptional()
  @IsString()
  lastJobAt?: string;

  @IsOptional()
  @IsNumber()
  consecutiveErrors?: number;

  /** La extensión está frenada (circuit breaker): rechaza toda carga. */
  @IsOptional()
  @IsBoolean()
  circuitBreakerActive?: boolean;

  /** Motivos de las últimas fallas (para el cartel del operador). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  breakerReasons?: string[];
}
