export class ValidationTrendDto {
  date: string;
  total: number;
  successful: number;
  failed: number;
}

export class RejectionReasonDto {
  reason: string;
  count: number;
  percentage: number;
}

export class PaymentMethodStatsDto {
  method: string;
  count: number;
}

export class ValidationSummaryDto {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  successRate: number;
  averageConfidence: number;
  averageProcessingTimeMs: number;
}

export class ValidationAnalyticsDto {
  period: {
    from: Date;
    to: Date;
    days: number;
  };
  summary: ValidationSummaryDto;
  trends: ValidationTrendDto[];
  rejectionReasons: RejectionReasonDto[];
  paymentMethods: PaymentMethodStatsDto[];
  validatorStatus: {
    connected: boolean;
    lastHeartbeat?: Date;
  };
}
