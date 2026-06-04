/**
 * Application-wide event constants for EventEmitter2.
 * Used to decouple services that would otherwise have circular dependencies.
 */

export const AppEvent = {
  // Job lifecycle
  JOB_COMPLETED: 'job.completed',
  JOB_FAILED: 'job.failed',
  JOB_STARTED: 'job.started',
  JOB_QUEUED: 'job.queued',

  // Validation lifecycle
  VALIDATION_COMPLETED: 'validation.completed',
  VALIDATION_FAILED: 'validation.failed',
  PAYMENT_PROOF_UPLOADED: 'payment.proof.uploaded',

  // MercadoPago verification
  MP_VERIFICATION_NEEDED: 'mp.verification.needed',
  MP_VERIFICATION_CONFIRMED: 'mp.verification.confirmed',

  // System
  DASHBOARD_UPDATE: 'dashboard.update',

  // Operator alerts (generic)
  OPERATOR_ALERT: 'operator.alert',
} as const;

// Event payload interfaces
export interface JobCompletedEvent {
  jobId: string;
  requestId: string;
  userId: string;
  targetUsername: string;
  amount: number;
}

export interface JobFailedEvent {
  jobId: string;
  requestId: string;
  userId: string;
  targetUsername: string;
  amount: number;
  error?: string;
}

export interface JobStartedEvent {
  jobId: string;
  requestId: string;
  userId: string;
}

export interface ValidationCompletedEvent {
  requestId: string;
  score: number;
}

export interface ValidationFailedEvent {
  requestId: string;
  score: number;
  error?: string;
}

export interface PaymentProofUploadedEvent {
  requestId: string;
}

export interface MpVerificationNeededEvent {
  requestId: string;
  walletId: string;
  amount: number;
  expectedSenderName?: string;
}

export interface MpVerificationConfirmedEvent {
  requestId: string;
  operationNumber: string;
  walletId: string;
}
