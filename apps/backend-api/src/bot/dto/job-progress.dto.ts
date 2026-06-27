import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class JobProgressDto {
  @IsString()
  step: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  progress: number;

  @IsOptional()
  @IsObject()
  details?: Record<string, any>;

  @IsOptional()
  @IsString()
  timestamp?: string;
}
