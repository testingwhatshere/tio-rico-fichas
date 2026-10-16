import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import {
  Logger,
  Inject,
  forwardRef,
  UsePipes,
  ValidationPipe,
  OnModuleDestroy,
} from '@nestjs/common';
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
  imageUrl: string; // Cloudinary URL — validator fetches directly
  imageBase64?: string; // Legacy fallback (kept for backward compat during rollout)
  mimeType: string;
  expectedAmount: number;
  expectedWallet?: WalletValidationInfo | null;
  // Tells the validator how long the backend will wait, so it can size its own
  // internal Ollama timeout to land a result BEFORE the backend gives up.
  // Without this the validator defaulted to 120s while the backend rejected at
  // 90s → the (late) result was dropped and the load got stuck as "Validation
  // timeout" (the martina34t incident).
  validationTimeoutMs?: number;
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
  /** Texto OCR crudo (recortado). Los validadores viejos no lo mandan. */
  ocrText?: string | null;
}

type PendingValidation = {
  request: ValidationRequest;
  resolve: (result: ValidationResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  /** Socket al que se mandó por última vez (diagnóstico). */
  sentTo: string | null;
  /** Cuántas veces se envió (1 = sin reenvíos). */
  sends: number;
};

/** Cuánto se espera antes de cortar el socket reemplazado (deja salir el aviso). */
const REPLACED_DISCONNECT_DELAY_MS = 250;

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
  /**
   * Sockets que pasaron la autenticación y siguen abiertos. Un resultado se
   * acepta de cualquiera de ellos si la validación sigue pendiente: durante un
   * deploy del validador la instancia saliente todavía puede estar terminando un
   * comprobante cuando la entrante ya tomó el lugar.
   */
  private readonly authenticatedSockets = new Set<string>();
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
        this.operatorGateway = this.moduleRef.get(OperatorGateway, {
          strict: false,
        });
      } catch {
        this.logger.warn(
          'OperatorGateway not available for validator status events',
        );
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
    const value = await this.settingsService.getSetting(
      'VALIDATION_TIMEOUT_MS',
    );
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

    this.authenticatedSockets.add(client.id);

    // Single-validator model: only ever one legitimate validator is deployed
    // (the Render worker). Any NEW connection that authenticates with the valid
    // API key is therefore the validator restarting, reconnecting after a
    // network blip, or the new instance of a deploy — never a competing second
    // instance. So we always let the newcomer take over and reap the previous
    // socket immediately. Waiting for a staleness window (the old behaviour)
    // meant a reconnecting validator got rejected for up to
    // VALIDATOR_TAKEOVER_STALE_MS because Socket.IO hadn't yet detected the
    // dropped TCP socket — that was the source of the reconnect-storm churn.
    //
    // The replaced socket gets a 'replaced' event first so a still-alive
    // instance (the outgoing one in a deploy) stops reconnecting instead of
    // taking the slot back.
    if (this.connectedValidator && this.connectedValidator.id !== client.id) {
      const previous = this.connectedValidator;
      const lastHb = this.lastHeartbeat?.toISOString() || 'never';
      this.logger.warn(
        `Replacing existing validator ${previous.id} (lastHeartbeat ${lastHb}) with validator ${client.id}`,
      );
      try {
        previous.emit('replaced', {
          by: client.id,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* noop */
      }
      setTimeout(() => {
        try {
          previous.disconnect(true);
        } catch {
          /* noop */
        }
      }, REPLACED_DISCONNECT_DELAY_MS);
      this.connectedValidator = null;
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

    // Lo que quedó pendiente de un validador anterior (corte, reinicio, deploy)
    // se le reenvía a este con el mismo id.
    this.resendPendingTo(client);

    // Notify operators that validator is online
    this.emitValidatorStatusToOperators(true);
  }

  handleDisconnect(client: Socket) {
    this.authenticatedSockets.delete(client.id);
    if (this.connectedValidator?.id === client.id) {
      this.connectedValidator = null;
      this.lastHeartbeat = null;
      this.stopHeartbeatMonitor();

      // Las validaciones pendientes NO se rechazan: siguen esperando con su
      // timeout original y se reenvían al validador que se conecte (el mismo
      // reconectado o la instancia nueva de un deploy). Antes se rechazaban
      // todas y un microcorte mandaba cada comprobante en vuelo a revisión
      // manual (2026-10-13). Si nadie se conecta a tiempo, vence el timeout y
      // sigue el camino de siempre.
      this.logger.warn(
        `Validator disconnected: ${client.id} (${this.pendingValidations.size} pending kept for resend)`,
      );

      // Notify operators that validator is offline
      this.emitValidatorStatusToOperators(false);
    }
  }

  /**
   * Reenvía las validaciones pendientes al validador recién conectado. El
   * validador es idempotente por id: si ya lo había resuelto, contesta con el
   * resultado guardado sin volver a leer el comprobante.
   */
  private resendPendingTo(client: Socket) {
    if (this.pendingValidations.size === 0) return;
    for (const [id, pending] of this.pendingValidations) {
      if (pending.sentTo === client.id) continue;
      pending.sentTo = client.id;
      pending.sends += 1;
      this.logger.log(
        `Re-sending pending validation ${id} for request ${pending.request.requestId} to ${client.id} (send #${pending.sends})`,
      );
      client.emit('validate', pending.request);
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

    // Get timeout from settings (dynamic) — computed BEFORE building the request
    // so we can pass it to the validator as a hint.
    const validationTimeout = await this.getValidationTimeout();

    const request: ValidationRequest = {
      id,
      requestId,
      imageUrl,
      mimeType,
      expectedAmount,
      expectedWallet: walletInfo || null,
      validationTimeoutMs: validationTimeout,
    };

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingValidations.delete(id);
        reject(new Error('Validation timeout'));
      }, validationTimeout);

      // Store pending validation
      const target = this.connectedValidator!;
      this.pendingValidations.set(id, {
        request,
        resolve,
        reject,
        timeout,
        sentTo: target.id,
        sends: 1,
      });

      // Send to validator
      this.logger.log(
        `Sending validation request ${id} for request ${requestId}`,
      );
      target.emit('validate', request);
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
    if (!this.authenticatedSockets.has(client.id)) {
      this.logger.warn(
        `Received result from unauthenticated socket ${client.id}`,
      );
      return;
    }

    const pending = result?.id
      ? this.pendingValidations.get(result.id)
      : undefined;
    if (!pending) {
      // Ya resuelto (llegó otra copia antes) o vencido.
      this.logger.warn(
        `Received result for unknown validation: ${result?.id} (request ${result?.requestId ?? '?'})`,
      );
      return;
    }

    this.logger.log(
      `Received validation result for ${result.id}: valid=${result.isValid}` +
        (pending.sends > 1 ? ` (after ${pending.sends} sends)` : '') +
        (client.id !== this.connectedValidator?.id
          ? ` from previous validator ${client.id}`
          : ''),
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
