import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef, UsePipes, ValidationPipe, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { OperatorGateway } from '../events/operator.gateway';
import {
  VALIDATOR_HEARTBEAT_TIMEOUT_MS,
  VALIDATOR_HEARTBEAT_CHECK_MS,
} from '../common/constants/timeouts';

interface WalletValidationInfo {
  holderName: string;
  holderLegalName?: string | null;
  holderDni?: string | null;
  type: string;
  alias?: string;
  cbu?: string;
  cvu?: string;
  bank?: string;
  requiresVerification?: boolean; // true = extension verifies payment arrival, skip Ollama authenticity
}

interface ValidationRequest {
  id: string;
  requestId: string;
  imageUrl: string;       // Cloudinary URL — validator fetches directly
  imageBase64?: string;   // Legacy fallback (kept for backward compat during rollout)
  mimeType: string;
  expectedAmount: number;
  expectedWallet?: WalletValidationInfo | null;
}

interface ValidationResult {
  id: string;
  requestId: string;
  isValid: boolean;
  confidence: number;
  extractedAmount: number | null;
  extractedDate: string | null;
  paymentMethod: string | null;
  reasoning: string;
  flags: string[];
  // Enhanced fields (optional for backward compatibility with older validators)
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

type PendingValidation = {
  request: ValidationRequest;
  resolve: (result: ValidationResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

@WebSocketGateway({
  namespace: '/validator',
  cors: {
    origin: '*',
  },
  pingInterval: 60000,
  pingTimeout: 30000,
})
@UsePipes(new ValidationPipe({ whitelist: true }))
export class ValidatorGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ValidatorGateway.name);
  private connectedValidator: Socket | null = null;
  private validatorApiKey: string;
  private pendingValidations: Map<string, PendingValidation> = new Map();
  private operatorGateway: OperatorGateway | null = null;
  private lastHeartbeat: Date | null = null;
  private heartbeatCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_TIMEOUT_MS = VALIDATOR_HEARTBEAT_TIMEOUT_MS;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.validatorApiKey = this.configService.get<string>(
      'VALIDATOR_API_KEY',
      this.configService.get<string>('BOT_API_KEY', ''),
    );
  }

  /**
   * Clean up pending validation timeouts on module destroy.
   * Reject any in-flight validations so callers (PaymentsService) don't hang
   * forever waiting on a promise that will never resolve.
   */
  onModuleDestroy() {
    this.stopHeartbeatMonitor();
    for (const [, pending] of this.pendingValidations) {
      if (pending.timeout) clearTimeout(pending.timeout);
      try {
        pending.reject?.(new Error('Validator module shutting down'));
      } catch {
        // best-effort — pending may have already settled
      }
    }
    this.pendingValidations.clear();
  }

  /**
   * Lazy-load OperatorGateway to avoid circular injection
   */
  private getOperatorGateway(): OperatorGateway | null {
    if (!this.operatorGateway) {
      try {
        this.operatorGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      } catch {
        this.logger.warn('OperatorGateway not available for validator status events');
      }
    }
    return this.operatorGateway;
  }

  /**
   * Notify operators about validator connection status change
   */
  private emitValidatorStatusToOperators(connected: boolean) {
    const opGateway = this.getOperatorGateway();
    if (opGateway) {
      opGateway.emitToAll('validator:status', {
        connected,
        validatorId: this.connectedValidator?.id || null,
        pendingValidations: this.pendingValidations.size,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get validation timeout from settings (dynamic)
   */
  private async getValidationTimeout(): Promise<number> {
    const value = await this.settingsService.getSetting('VALIDATION_TIMEOUT_MS');
    return parseInt(value || '60000', 10);
  }

  async handleConnection(client: Socket) {
    const apiKey = client.handshake.auth?.apiKey;

    if (!this.validatorApiKey || apiKey !== this.validatorApiKey) {
      this.logger.warn(`Validator connection rejected: invalid API key`);
      client.emit('error', { message: 'Invalid API key' });
      client.disconnect();
      return;
    }

    // Only allow one validator at a time. If the existing socket is dead
    // (no heartbeat in 90s) treat it as zombie and let the new one take over —
    // otherwise a network blip on the validator's side leaves us unable to
    // reconnect because the old socket lingers in our state.
    if (this.connectedValidator) {
      const lastHb = this.lastHeartbeat?.getTime() || 0;
      const stale = Date.now() - lastHb > 90_000;
      const dead = this.connectedValidator.disconnected || stale;
      if (dead) {
        this.logger.warn(
          `Replacing stale validator ${this.connectedValidator.id} (lastHeartbeat ${
            this.lastHeartbeat?.toISOString() || 'never'
          }) with ${client.id}`,
        );
        try { this.connectedValidator.disconnect(); } catch { /* noop */ }
        this.connectedValidator = null;
      } else {
        this.logger.warn('Another validator already connected, rejecting');
        client.emit('error', { message: 'Another validator is already connected' });
        client.disconnect();
        return;
      }
    }

    this.connectedValidator = client;
    this.lastHeartbeat = new Date();
    this.logger.log(`Validator connected: ${client.id}`);

    client.emit('connected', {
      message: 'Connected to validation service',
      timestamp: new Date().toISOString(),
    });

    // Start heartbeat monitoring
    this.startHeartbeatMonitor();

    // Notify operators that validator is online
    this.emitValidatorStatusToOperators(true);
  }

  handleDisconnect(client: Socket) {
    if (this.connectedValidator?.id === client.id) {
      this.logger.warn(`Validator disconnected: ${client.id}`);
      this.connectedValidator = null;
      this.lastHeartbeat = null;
      this.stopHeartbeatMonitor();

      // Reject all pending validations
      for (const [id, pending] of this.pendingValidations) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Validator disconnected'));
      }
      this.pendingValidations.clear();

      // Notify operators that validator is offline
      this.emitValidatorStatusToOperators(false);
    }
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: { timestamp?: string },
  ) {
    if (this.connectedValidator?.id === client.id) {
      this.lastHeartbeat = new Date();
    }
    // The validator client waits for an ACK on every heartbeat (10s timeout).
    // Returning a value from this handler tells Socket.IO to send it back as the ACK.
    // Without it the validator force-disconnects every minute thinking we're dead.
    return { received: true, ts: new Date().toISOString() };
  }

  private startHeartbeatMonitor() {
    this.stopHeartbeatMonitor();
    this.heartbeatCheckInterval = setInterval(() => {
      if (!this.connectedValidator || !this.lastHeartbeat) return;

      const elapsed = Date.now() - this.lastHeartbeat.getTime();
      if (elapsed > this.HEARTBEAT_TIMEOUT_MS) {
        this.logger.warn(
          `Validator heartbeat timeout (${Math.round(elapsed / 1000)}s without heartbeat), force-disconnecting`,
        );
        this.connectedValidator.disconnect(true);
      }
    }, VALIDATOR_HEARTBEAT_CHECK_MS);
  }

  private stopHeartbeatMonitor() {
    if (this.heartbeatCheckInterval) {
      clearInterval(this.heartbeatCheckInterval);
      this.heartbeatCheckInterval = null;
    }
  }

  /**
   * Check if a validator is connected
   */
  isValidatorConnected(): boolean {
    return this.connectedValidator !== null;
  }

  /**
   * Send validation request to connected validator
   */
  async requestValidation(
    requestId: string,
    imageUrl: string,
    mimeType: string,
    expectedAmount: number,
    walletInfo?: WalletValidationInfo | null,
  ): Promise<ValidationResult> {
    if (!this.connectedValidator) {
      throw new Error('No validator connected');
    }

    const id = `val_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const request: ValidationRequest = {
      id,
      requestId,
      imageUrl,
      mimeType,
      expectedAmount,
      expectedWallet: walletInfo || null,
    };

    // Get timeout from settings (dynamic)
    const validationTimeout = await this.getValidationTimeout();

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingValidations.delete(id);
        reject(new Error('Validation timeout'));
      }, validationTimeout);

      // Store pending validation
      this.pendingValidations.set(id, {
        request,
        resolve,
        reject,
        timeout,
      });

      // Send to validator
      this.logger.log(`Sending validation request ${id} for request ${requestId}`);
      this.connectedValidator!.emit('validate', request);
    });
  }

  /**
   * Handle validation result from validator
   */
  @SubscribeMessage('validation_result')
  handleValidationResult(
    @ConnectedSocket() client: Socket,
    @MessageBody() result: ValidationResult,
  ) {
    if (client.id !== this.connectedValidator?.id) {
      this.logger.warn('Received result from unknown validator');
      return;
    }

    const pending = this.pendingValidations.get(result.id);
    if (!pending) {
      this.logger.warn(`Received result for unknown validation: ${result.id}`);
      return;
    }

    this.logger.log(
      `Received validation result for ${result.id}: valid=${result.isValid}`,
    );

    clearTimeout(pending.timeout);
    this.pendingValidations.delete(result.id);
    pending.resolve(result);
  }

  /**
   * Get validator status
   */
  getStatus() {
    return {
      connected: this.isValidatorConnected(),
      validatorId: this.connectedValidator?.id || null,
      pendingValidations: this.pendingValidations.size,
    };
  }
}
