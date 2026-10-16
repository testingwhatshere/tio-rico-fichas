import { IsOptional, IsString, IsNumber, Min, IsBoolean } from 'class-validator';

export class ApproveRequestDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedAmount?: number;

  /**
   * El operador vio el comprobante y decidio cargar un monto que el sistema no
   * puede respaldar solo (el OCR leyo otra cosa, o no leyo nada). Sin esta
   * bandera el tope sigue siendo lo que dice el comprobante.
   *
   * No es un permiso especial: es la diferencia entre "aprobar" y "aprobar
   * sabiendo que no coincide", para que quede asentado quien lo decidio.
   */
  @IsOptional()
  @IsBoolean()
  amountOverride?: boolean;

  @IsOptional()
  @IsString()
  overrideReason?: string;
}

export class RejectRequestDto {
  @IsString()
  reason: string;
}
