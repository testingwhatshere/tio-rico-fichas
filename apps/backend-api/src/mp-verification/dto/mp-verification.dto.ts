import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsObject,
} from 'class-validator';

export class MpVerificationConfirmDto {
  @IsString()
  requestId: string;

  @IsString()
  operationNumber: string;

  @IsString()
  senderName: string;

  @IsNumber()
  amount: number;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsString()
  transactionTime?: string;

  @IsOptional()
  @IsString()
  senderBank?: string;

  @IsOptional()
  @IsString()
  senderCbu?: string;

  @IsOptional()
  @IsString()
  senderCuit?: string;

  @IsOptional()
  @IsString()
  mpActivityUrl?: string;

  @IsOptional()
  @IsString()
  identificationCode?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  reconciliation?: {
    amountMatch?: boolean;
    nameMatch?: boolean;
    dateMatch?: boolean;
    flags?: string[];
    aiExtracted?: Record<string, any>;
    mpActual?: Record<string, any>;
  };
}

export class MpUnmatchedTransferDto {
  @IsString()
  operationNumber: string;

  @IsString()
  senderName: string;

  @IsNumber()
  amount: number;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsString()
  transactionTime?: string;

  @IsOptional()
  @IsString()
  senderBank?: string;

  @IsOptional()
  @IsString()
  senderCbu?: string;

  @IsOptional()
  @IsString()
  senderCuit?: string;

  @IsOptional()
  @IsString()
  mpActivityUrl?: string;

  @IsOptional()
  @IsString()
  identificationCode?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class PendingVerificationResponseDto {
  requestId: string;
  amount: number;
  expectedSenderName?: string;
  walletId: string;
  createdAt: string;
  validationDetails?: {
    senderName?: string;
    extractedAmount?: number;
    extractedDate?: string;
    extractedTime?: string;
  };
}
