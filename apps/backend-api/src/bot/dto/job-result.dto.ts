import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

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
}
