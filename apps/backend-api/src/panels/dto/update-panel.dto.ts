import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdatePanelDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
