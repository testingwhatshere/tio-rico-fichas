import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const ACTION_TYPES = [
  'LOAD_CREDITS',
  'CHECK_BALANCE',
  'CREATE_USER',
  'CHANGE_PASSWORD',
  'WITHDRAW_PRIZE',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export class CreateIntegrationActionDto {
  /** Clave de idempotencia de la app: el mismo valor dos veces = una acción. */
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  externalId: string;

  @IsIn(ACTION_TYPES)
  type: ActionType;

  /** Usuario del panel de juego. */
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]{2,40}$/)
  username: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  newPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  requestedBy?: string;
}

export class PayoutProofDto {
  /** Archivo en el Cloudinary de TioRicoCargas: la plataforma guarda su propia copia. */
  @IsString()
  @Matches(/^https:\/\/res\.cloudinary\.com\//)
  @MaxLength(500)
  url: string;

  @IsIn(['image', 'pdf'])
  type: 'image' | 'pdf';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

/** Premio retirado por la app: el operador pagó y adjunta el comprobante. */
export class PayoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PayoutProofDto)
  proofs: PayoutProofDto[];
}
