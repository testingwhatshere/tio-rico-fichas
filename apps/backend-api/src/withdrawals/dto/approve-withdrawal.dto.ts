import { IsOptional, IsString } from 'class-validator';

export class ApproveWithdrawalDto {
  @IsOptional()
  @IsString()
  note?: string;
}
