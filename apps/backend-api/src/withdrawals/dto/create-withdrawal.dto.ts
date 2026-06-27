import { IsNumber, IsString, IsObject, Min } from 'class-validator';
import { MIN_WITHDRAWAL_AMOUNT } from '../../common/constants/timeouts';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(MIN_WITHDRAWAL_AMOUNT, {
    message: `El monto mínimo de retiro es $${MIN_WITHDRAWAL_AMOUNT}`,
  })
  amount: number;

  @IsString()
  paymentMethod: string;

  @IsObject()
  paymentDetails: {
    cbu?: string;
    alias?: string;
    accountHolder?: string;
    bank?: string;
  };
}
