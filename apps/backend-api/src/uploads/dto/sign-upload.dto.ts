import {
  IsString,
  IsNumber,
  IsPositive,
  Max,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class SignUploadDto {
  @IsString()
  requestId: string;

  @IsString()
  fileHash: string;

  @IsNumber()
  @IsPositive()
  @Max(10 * 1024 * 1024) // 10MB
  fileSize: number;

  @IsString()
  mimeType: string;
}

export class ConfirmProofUploadDto {
  @IsString()
  cloudinaryUrl: string;

  @IsString()
  cloudinaryPublicId: string;

  @IsString()
  fileHash: string;

  /**
   * El cliente sabe mostrarle al jugador "transferiste de mas, ¿lo cargamos?".
   * Solo lo manda el chat web; el APK no lo tiene y su carga sigue yendo al
   * operador como siempre.
   */
  @IsOptional()
  @IsBoolean()
  canConfirmOverpaid?: boolean;
}
