import { IsString, IsNumber, IsPositive, Max } from 'class-validator';

export class SignUploadDto {
  @IsString()
  requestId: string;

  @IsString()
  fileHash: string;

  @IsNumber()
  @IsPositive()
  @Max(10 * 1024 * 1024) // 10MB
  fileSize: number;

  @IsString()
  mimeType: string;
}

export class ConfirmProofUploadDto {
  @IsString()
  cloudinaryUrl: string;

  @IsString()
  cloudinaryPublicId: string;

  @IsString()
  fileHash: string;
}
