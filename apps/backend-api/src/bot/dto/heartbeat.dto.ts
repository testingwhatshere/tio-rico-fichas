import { IsNumber, IsOptional, IsString } from 'class-validator';

export class HeartbeatDto {
  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsNumber()
  uptime?: number;

  @IsOptional()
  @IsString()
  version?: string;
}
