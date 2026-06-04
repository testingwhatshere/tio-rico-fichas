import { IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

/**
 * DTO for client-only authentication (username only, no password)
 * Used by the chat app for simple user identification
 * Phone is required on first registration, optional on subsequent logins
 */
export class ClientAuthDto {
  @IsString()
  @MinLength(3, { message: 'El nombre de usuario debe tener al menos 3 caracteres' })
  @MaxLength(30, { message: 'El nombre de usuario debe tener máximo 30 caracteres' })
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message: 'El nombre de usuario debe comenzar con una letra y solo contener letras, números y guiones bajos',
  })
  username: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{7,15}$/, { message: 'Número de teléfono inválido' })
  phone?: string;
}
