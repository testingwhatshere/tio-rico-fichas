import { IsNumber, IsInt, Min, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for creating a credit load request
 * Note: targetUsername is NOT included - it's auto-populated from the user's username
 */
export class CreateRequestDto {
  @IsNumber()
  @IsInt({ message: 'El monto debe ser un número entero (sin centavos)' })
  @Min(0)
  amount: number;

  /**
   * If true, amount can be 0 and will be auto-detected from the payment proof by AI.
   * The extracted amount replaces the placeholder during validation.
   */
  @IsOptional()
  @IsBoolean()
  autoDetectAmount?: boolean;
}
