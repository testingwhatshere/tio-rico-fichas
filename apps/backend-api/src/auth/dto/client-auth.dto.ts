import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import {
  PANEL_USERNAME_REGEX,
  PANEL_USERNAME_MESSAGE,
} from '../../common/validators/username';

/**
 * DTO for client-only authentication (username + phone).
 * Phone is ALWAYS required — both on first registration and on every login —
 * as an anti-fraud check. We re-verify the stored phone matches what the user
 * types in, so a stolen username alone isn't enough to log in.
 *
 * `phone` stays optional at the DTO level so we can return PHONE_REQUIRED with
 * a clean message from the service when the field is missing.
 */
export class ClientAuthDto {
  @IsString()
  @MinLength(3, {
    message: 'El nombre de usuario debe tener al menos 3 caracteres',
  })
  @MaxLength(30, {
    message: 'El nombre de usuario debe tener máximo 30 caracteres',
  })
  // Los usuarios del panel de juego arrancan con número muy seguido
  // ("15sebas15", "3312diego"): exigir letra inicial dejaba afuera a 122 clientes
  // precargados, que no podían entrar nunca. Mismo criterio que valida el chat-app.
  @Matches(PANEL_USERNAME_REGEX, { message: PANEL_USERNAME_MESSAGE })
  username: string;

  @IsOptional()
  @IsString()
  // Accept any common Argentine input: with/without +, spaces, dashes, parens.
  // The service (canonicalArPhone) normalizes to digits-only before lookup/storage.
  @Matches(/^[+\d\s\-()]{7,25}$/, { message: 'Número de teléfono inválido' })
  phone?: string;
}
