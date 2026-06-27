import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateSavedTargetUsernameDto {
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres' })
  @MaxLength(20, { message: 'El nombre no puede tener más de 20 caracteres' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Solo letras, números y guion bajo (sin espacios ni signos)',
  })
  savedTargetUsername!: string;
}
