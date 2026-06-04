import { IsOptional, IsString, IsNumber, Min } from 'class-validator';

export class ApproveRequestDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedAmount?: number;
}

export class RejectRequestDto {
  @IsString()
  reason: string;
}
