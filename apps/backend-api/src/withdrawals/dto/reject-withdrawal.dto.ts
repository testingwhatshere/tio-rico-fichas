import { IsString, IsNotEmpty } from 'class-validator';

export class RejectWithdrawalDto {
  @IsString()
  @IsNotEmpty({ message: 'Debes proporcionar una razón para el rechazo' })
  reason: string;
}
