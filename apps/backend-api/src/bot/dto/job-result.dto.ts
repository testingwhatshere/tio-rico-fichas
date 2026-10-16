import {
  IsBoolean,
  IsIn,
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

  // Extensión 1.0.8+: qué pasó con la plata, más allá de success. APPLIED = se
  // movió; NOT_APPLIED = seguro que no se movió; UNCERTAIN = no se pudo confirmar.
  @IsOptional()
  @IsIn(['APPLIED', 'NOT_APPLIED', 'UNCERTAIN'])
  outcome?: 'APPLIED' | 'NOT_APPLIED' | 'UNCERTAIN';

  // Id de transacción que devolvió el panel en addCredit/addDebit.
  @IsOptional()
  @IsString()
  panelTransaction?: string;

  // El resultado salió de mirar el saldo del usuario (no de la respuesta del panel).
  @IsOptional()
  @IsBoolean()
  verifiedByBalance?: boolean;
}
