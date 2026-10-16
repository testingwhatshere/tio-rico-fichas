import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class JobResultDto {
  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsString()
  screenshotPath?: string;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsString()
  completedAt?: string;

  // VERIFY_CHIPS: saldo leído del panel. La extensión los manda desde siempre y
  // el ValidationPipe global (forbidNonWhitelisted) rechazaba el POST con 400:
  // por eso las verificaciones de fichas "nunca volvían" (2026-08-28).
  @IsOptional()
  @IsNumber()
  balance?: number;

  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;
}
