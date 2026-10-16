import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PANEL_USERNAME_REGEX,
  PANEL_USERNAME_MESSAGE,
} from '../../common/validators/username';

export class UpdateSavedTargetUsernameDto {
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres' })
  @MaxLength(20, { message: 'El nombre no puede tener más de 20 caracteres' })
  @Matches(PANEL_USERNAME_REGEX, { message: PANEL_USERNAME_MESSAGE })
  savedTargetUsername!: string;
}
