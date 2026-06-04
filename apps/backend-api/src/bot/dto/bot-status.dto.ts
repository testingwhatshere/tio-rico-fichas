import { IsIn, IsOptional, IsString } from 'class-validator';

export class BotStatusDto {
  @IsIn(['online', 'offline', 'busy', 'error'])
  status: 'online' | 'offline' | 'busy' | 'error';

  @IsOptional()
  @IsString()
  timestamp?: string;
}
