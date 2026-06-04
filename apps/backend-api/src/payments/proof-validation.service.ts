import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ValidatorGateway } from '../validator/validator.gateway';

export interface WalletInfo {
  holderName: string;
  holderLegalName?: string | null;
  holderDni?: string | null;
  type: string;
  alias?: string;
  cbu?: string;
  cvu?: string;
  bank?: string;
}

export interface ProofValidationResult {
  isValid: boolean;
  confidence: number;
  extractedAmount: number | null;
  extractedDate: string | null;
  paymentMethod: string | null;
  reasoning: string;
  flags: string[];
  // Enhanced fields (optional for backward compatibility)
  extractedTime?: string | null;
  transactionId?: string | null;
  referenceNumber?: string | null;
  senderName?: string | null;
  senderDniCuit?: string | null;
  recipientName?: string | null;
  recipientAccount?: string | null;
  recipientMatch?: boolean | null;
  bankName?: string | null;
  transactionStatus?: string | null;
  authenticityChecks?: {
    has_proper_formatting?: boolean;
    has_consistent_fonts?: boolean;
    has_bank_logo?: boolean;
    has_transaction_id?: boolean;
    screenshot_quality?: string;
    editing_signs?: string;
  } | null;
}

@Injectable()
export class ProofValidationService {
  private readonly logger = new Logger(ProofValidationService.name);

  constructor(
    @Inject(forwardRef(() => ValidatorGateway))
    private readonly validatorGateway: ValidatorGateway,
  ) {}

  /**
   * Validate a payment proof image using remote validator (Ollama on client)
   */
  async validateProof(
    proofUrl: string,
    mimeType: string,
    expectedAmount: number,
    requestId: string,
    walletInfo?: WalletInfo | null,
  ): Promise<ProofValidationResult> {
    // Check if validator is connected
    if (!this.validatorGateway.isValidatorConnected()) {
      this.logger.warn('No validator connected, requiring manual review');
      return this.manualReviewRequired('Validador no conectado');
    }

    try {
      this.logger.log(
        `Sending validation request for ${requestId}, expected amount: ${expectedAmount}`,
      );

      // Send image URL to validator — validator fetches from Cloudinary directly
      const result = await this.validatorGateway.requestValidation(
        requestId,
        proofUrl,
        mimeType,
        expectedAmount,
        walletInfo || null,
      );

      this.logger.log(
        `Validation result for ${requestId}: valid=${result.isValid}, confidence=${result.confidence}`,
      );

      return {
        isValid: result.isValid,
        confidence: result.confidence,
        extractedAmount: result.extractedAmount,
        extractedDate: result.extractedDate,
        paymentMethod: result.paymentMethod,
        reasoning: result.reasoning,
        flags: result.flags,
        extractedTime: result.extractedTime ?? null,
        transactionId: result.transactionId ?? null,
        referenceNumber: result.referenceNumber ?? null,
        senderName: result.senderName ?? null,
        senderDniCuit: result.senderDniCuit ?? null,
        recipientName: result.recipientName ?? null,
        recipientAccount: result.recipientAccount ?? null,
        recipientMatch: result.recipientMatch ?? null,
        bankName: result.bankName ?? null,
        transactionStatus: result.transactionStatus ?? null,
        authenticityChecks: result.authenticityChecks ?? null,
      };
    } catch (error: any) {
      this.logger.error(`Remote validation failed: ${error.message}`);
      return this.manualReviewRequired(`Error de validacion: ${error.message}`);
    }
  }

  /**
   * Return result that requires manual review
   */
  private manualReviewRequired(reason: string): ProofValidationResult {
    return {
      isValid: false,
      confidence: 0,
      extractedAmount: null,
      extractedDate: null,
      paymentMethod: null,
      reasoning: reason,
      flags: ['REQUIRES_MANUAL_REVIEW'],
    };
  }

  /**
   * Check if validation service is available
   */
  isAvailable(): boolean {
    return this.validatorGateway.isValidatorConnected();
  }
}
