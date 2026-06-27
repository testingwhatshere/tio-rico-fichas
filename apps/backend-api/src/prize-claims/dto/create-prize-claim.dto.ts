import {
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsIn,
  IsObject,
} from 'class-validator';

export class CreatePrizeClaimDto {
  @IsNumber()
  @Min(3000, { message: 'El monto mínimo para cobrar es $3.000' })
  amount: number;
}

export class SetPrizePaymentDto {
  @IsString()
  @IsIn(['CBU', 'ALIAS'], { message: 'Método de pago debe ser CBU o ALIAS' })
  paymentMethod: string;

  @IsObject()
  paymentDetails: {
    cbu?: string;
    alias?: string;
    accountHolder: string;
  };
}

export class RejectPrizeClaimDto {
  @IsString()
  reason: string;
}
