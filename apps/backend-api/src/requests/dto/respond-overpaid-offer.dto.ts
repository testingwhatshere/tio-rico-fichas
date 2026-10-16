import { IsBoolean } from 'class-validator';

export class RespondOverpaidOfferDto {
  @IsBoolean()
  accept: boolean;
}
