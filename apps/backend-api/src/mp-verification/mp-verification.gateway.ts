import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { OperatorGateway } from '../events/operator.gateway';
import { AppEvent } from '../common/events/app-events';
import type { MpVerificationNeededEvent } from '../common/events/app-events';
import { MpVerificationService } from './mp-verification.service';
import { TelegramService } from '../notifications/telegram.service';

@WebSocketGateway({
  namespace: '/mp-verifier',
  cors: { origin: '*', credentials: false },
  pingInterval: 90000,   // 90s — Chrome MV3 service workers can suspend for 30-60s
  pingTimeout: 45000,    // 45s — generous for suspended service workers
})
export class MpVerificationGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MpVerificationGateway.name);

  // walletId → Map<socketId, Socket>
  private connectedVerifiers = new Map<string, Map<string, Socket>>();
  // socketId → walletId (reverse lookup)
  private socketToWallet = new Map<string, string>();
  // walletId → disconnect debounce timer (prevents flapping from MV3 suspension)
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  // Enriched heartbeat data per extension
  private extensionHealth = new Map<string, any>();
  // walletId → ms epoch of last detected transfer (for canary EX12)
  private lastTransferAt = new Map<string, number>();
  // walletId → walletType for alert messages (mp / fiwind / ripio / prex)
  private walletTypes = new Map<string, string>();

  constructor(
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
    @Inject(forwardRef(() => MpVerificationService))
    private readonly mpVerificationService: MpVerificationService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
  ) {}

  onModuleDestroy() {
    this.disconnectTimers.forEach(timer => clearTimeout(timer));
    this.disconnectTimers.clear();
  }

  handleConnection(client: Socket) {
    const apiKey = (client.handshake.query?.apiKey as string) ||
      (client.handshake.auth?.apiKey as string);
    const walletId = (client.handshake.query?.walletId as string) ||
      (client.handshake.auth?.walletId as string);

    // Validate API key
    const expectedKey = process.env.BOT_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      this.logger.warn(`MP verifier rejected: invalid API key from ${client.id}`);
      client.disconnect(true);
      return;
    }

    if (!walletId) {
      this.logger.warn(`MP verifier rejected: no walletId from ${client.id}`);
      client.disconnect(true);
      return;
    }

    // Cancel any pending disconnect debounce for this wallet
    const pendingDisconnect = this.disconnectTimers.get(walletId);
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      this.disconnectTimers.delete(walletId);
      this.logger.log(`MP verifier reconnected during debounce: wallet=${walletId}`);
    }

    // Track connection
    if (!this.connectedVerifiers.has(walletId)) {
      this.connectedVerifiers.set(walletId, new Map());
    }
    this.connectedVerifiers.get(walletId)!.set(client.id, client);
    this.socketToWallet.set(client.id, walletId);

    this.logger.log(`MP verifier connected: wallet=${walletId}, socket=${client.id}`);

    // Notify operators
    this.operatorGateway.emitToAll('mp_verifier_status', {
      walletId,
      connected: true,
      connectedCount: this.connectedVerifiers.get(walletId)!.size,
    });

    // Send any pending verifications immediately
    this.mpVerificationService.getPendingForWallet(walletId).then((pending) => {
      if (pending.length > 0) {
        client.emit('pending_verifications', pending);
      }
    });
  }

  handleDisconnect(client: Socket) {
    const walletId = this.socketToWallet.get(client.id);
    if (!walletId) return;

    // Remove this specific socket
    this.socketToWallet.delete(client.id);
    const walletSockets = this.connectedVerifiers.get(walletId);
    if (walletSockets) {
      walletSockets.delete(client.id);
    }

    this.logger.log(`MP verifier socket disconnected: wallet=${walletId}, socket=${client.id}`);

    // If other sockets remain for this wallet, no further action
    if (walletSockets && walletSockets.size > 0) return;

    // Debounce: wait 120s before declaring wallet offline
    // Chrome MV3 service workers suspend and reconnect frequently
    const existing = this.disconnectTimers.get(walletId);
    if (existing) clearTimeout(existing);

    this.disconnectTimers.set(walletId, setTimeout(() => {
      this.disconnectTimers.delete(walletId);
      // Verify wallet didn't reconnect during debounce
      const current = this.connectedVerifiers.get(walletId);
      if (!current || current.size === 0) {
        this.connectedVerifiers.delete(walletId);
        this.operatorGateway.emitToAll('mp_verifier_status', {
          walletId,
          connected: false,
          connectedCount: 0,
        });

        // Emit offline heartbeat to operators
        const offlineHealth = {
          extensionId: walletId,
          type: 'mp-verifier',
          status: 'offline',
          panelId: null,
          walletId,
          receivedAt: new Date().toISOString(),
        };
        this.extensionHealth.set(walletId, offlineHealth);
        this.operatorGateway.emitToAll('extension:heartbeat', offlineHealth);

        // Telegram alert (with internal cooldown so flapping doesn't spam) — EX11.
        const walletType = this.walletTypes.get(walletId) || 'verifier';
        this.telegram.alertVerifierOffline(walletId, walletType).catch(() => {});

        this.logger.log(`MP verifier offline (after 120s debounce): wallet=${walletId}`);
      }
    }, 120000));
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(client: Socket, data?: any) {
    client.emit('heartbeat_ack', { timestamp: Date.now() });

    // Store enriched heartbeat data
    const walletId = this.socketToWallet.get(client.id) || 'unknown';
    const healthData = {
      extensionId: walletId,
      type: data?.type || 'mp-verifier',
      status: 'online',
      panelId: null,
      walletId,
      tabStatus: data?.tabStatus || 'unknown',
      currentUrl: data?.currentUrl || '',
      sessionValid: data?.sessionValid ?? true,
      version: data?.version || 'unknown',
      consecutiveErrors: data?.consecutiveErrors || 0,
      receivedAt: new Date().toISOString(),
    };
    this.extensionHealth.set(walletId, healthData);
    if (healthData.type) this.walletTypes.set(walletId, healthData.type);
    this.operatorGateway.emitToAll('extension:heartbeat', healthData);
  }

  /**
   * Verifier reports a session-expired state (login/QR page detected). Surface to operators
   * via the existing `mp_session_expired` event PLUS Telegram (with cooldown).
   */
  @SubscribeMessage('session_expired')
  handleSessionExpired(client: Socket, data?: any) {
    const walletId = this.socketToWallet.get(client.id) || (data?.walletId ?? 'unknown');
    const walletType = this.walletTypes.get(walletId) || data?.type || 'verifier';
    this.logger.warn(`Session expired reported by verifier: wallet=${walletId}`);
    this.operatorGateway.emitToAll('mp_session_expired', { walletId, type: walletType, at: new Date().toISOString() });
    this.telegram.alertVerifierSessionExpired(walletId, walletType).catch(() => {});
  }

  /**
   * Verifier reports it just detected a new transfer. Used to mark the canary alive.
   */
  @SubscribeMessage('transfer_detected')
  handleTransferDetected(client: Socket, data?: any) {
    const walletId = this.socketToWallet.get(client.id) || (data?.walletId ?? 'unknown');
    if (walletId && walletId !== 'unknown') this.lastTransferAt.set(walletId, Date.now());
  }

  // EX12: every 30 minutes, alert about wallets that have been online for >6h without
  // detecting any incoming transfer. Most likely a broken DOM selector after a wallet UI redesign.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async canaryCheck() {
    const STALE_MS = 6 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [walletId, sockets] of this.connectedVerifiers.entries()) {
      if (sockets.size === 0) continue;
      const last = this.lastTransferAt.get(walletId);
      if (!last) continue; // never seen a transfer yet — could be new wallet, skip until first one
      const elapsed = now - last;
      if (elapsed < STALE_MS) continue;
      const hours = Math.round(elapsed / (60 * 60 * 1000));
      const walletType = this.walletTypes.get(walletId) || 'verifier';
      this.logger.warn(`Canary: wallet ${walletId} (${walletType}) has not detected a transfer in ${hours}h`);
      this.operatorGateway.emitToAll('system_alert', {
        type: 'verifier_stale',
        message: `Verifier ${walletId} (${walletType}): ${hours}h sin transfers detectadas`,
        severity: 'warning',
        timestamp: new Date().toISOString(),
      });
      this.telegram.alertVerifierStale(walletId, walletType, hours).catch(() => {});
    }
  }

  // EX11: daily report at 23:55 ART (= 02:55 UTC next day; cron runs in UTC).
  @Cron('55 2 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async sendDailySummary() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const walletReports: Array<{ walletId: string; walletType: string; transfersDetected: number; offlineMinutes: number; lastSeenAt?: string | null }> = [];
    for (const walletId of this.walletTypes.keys()) {
      const walletType = this.walletTypes.get(walletId) || 'verifier';
      const lastTransfer = this.lastTransferAt.get(walletId);
      walletReports.push({
        walletId,
        walletType,
        // We don't currently keep a per-day counter — just show whether it saw anything today.
        transfersDetected: lastTransfer && (Date.now() - lastTransfer) < 24 * 60 * 60 * 1000 ? 1 : 0,
        offlineMinutes: 0, // future: aggregate disconnect timer durations
        lastSeenAt: lastTransfer ? new Date(lastTransfer).toISOString() : null,
      });
    }
    await this.telegram.sendDailyVerifierReport({ date: today, walletReports });
  }

  getExtensionHealth(): any[] {
    return Array.from(this.extensionHealth.values());
  }

  /**
   * When a new request needs MP verification, push to the appropriate verifier
   */
  @OnEvent(AppEvent.MP_VERIFICATION_NEEDED)
  handleNewVerificationNeeded(event: MpVerificationNeededEvent) {
    const walletId = event.walletId;
    if (!walletId) return;

    const walletSockets = this.connectedVerifiers.get(walletId);
    if (!walletSockets || walletSockets.size === 0) {
      this.logger.warn(
        `No MP verifier connected for wallet ${walletId} — request ${event.requestId} will wait for polling`,
      );
      return;
    }

    // Emit to all sockets for this wallet
    for (const [, socket] of walletSockets) {
      socket.emit('new_pending_verification', {
        requestId: event.requestId,
        walletId: event.walletId,
        amount: event.amount,
        expectedSenderName: event.expectedSenderName,
      });
    }

    this.logger.log(
      `Pushed new_pending_verification to ${walletSockets.size} verifier(s) for wallet ${walletId}`,
    );
  }

  /**
   * Check if a verifier is connected for a specific wallet
   */
  isVerifierConnected(walletId: string): boolean {
    const sockets = this.connectedVerifiers.get(walletId);
    return !!sockets && sockets.size > 0;
  }

  /**
   * Get all connected wallet IDs
   */
  getConnectedWallets(): string[] {
    return Array.from(this.connectedVerifiers.keys());
  }
}
