import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { OperatorGateway } from '../events/operator.gateway';
import { JobsService } from '../jobs/jobs.service';
import { PanelsService } from '../panels/panels.service';
import {
  BOT_PING_INTERVAL_MS,
  BOT_PING_TIMEOUT_MS,
  BOT_DISCONNECT_DEBOUNCE_MS,
} from '../common/constants/timeouts';

/**
 * BotGateway - WebSocket gateway for bot/extension connections.
 * Supports multiple panels: each bot identifies its panelId on connection.
 * Tracks bots per-panel for targeted job dispatch and discovery.
 */
@WebSocketGateway({
  namespace: '/bot',
  cors: {
    origin: '*',
    credentials: false,
  },
  pingInterval: BOT_PING_INTERVAL_MS,
  pingTimeout: BOT_PING_TIMEOUT_MS,
})
@UsePipes(new ValidationPipe({ whitelist: true }))
export class BotGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BotGateway.name);

  // panelId → Map<socketId, Socket>
  private connectedBots: Map<string, Map<string, Socket>> = new Map();
  // socketId → panelId (reverse lookup)
  private socketToPanelId: Map<string, string> = new Map();
  // Per-panel disconnect debounce timers
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  // Per-panel reconnect-dispatch timers (dedup multiple SW reconnects in <3s)
  private reconnectDispatchTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  // Track which panels have a busy bot (processing a job)
  private busyPanels: Set<string> = new Set();
  // Enriched heartbeat data per extension
  private extensionHealth = new Map<string, any>();

  private readonly expectedApiKey: string;
  private operatorGateway: OperatorGateway | null = null;
  private static readonly DISCONNECT_DEBOUNCE_MS = BOT_DISCONNECT_DEBOUNCE_MS;

  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {
    const key = this.configService.get<string>('BOT_API_KEY');
    if (!key) {
      throw new Error(
        'BOT_API_KEY environment variable is required but not set.',
      );
    }
    this.expectedApiKey = key;

    // Periodic zombie socket cleanup (every 60s)
    setInterval(() => this.cleanupZombieSockets(), 60_000);
  }

  /**
   * Remove disconnected sockets from connectedBots map.
   * Chrome MV3 service workers suspend frequently, leaving zombie sockets.
   */
  private cleanupZombieSockets(): void {
    let cleaned = 0;
    for (const [panelId, panelBots] of this.connectedBots) {
      for (const [socketId, socket] of panelBots) {
        if (!socket.connected) {
          panelBots.delete(socketId);
          this.socketToPanelId.delete(socketId);
          cleaned++;
        }
      }
      if (panelBots.size === 0) {
        this.connectedBots.delete(panelId);
      }
    }
    if (cleaned > 0) {
      this.logger.log(
        `Zombie cleanup: removed ${cleaned} dead socket(s). Active: ${this.getTotalBotCount()} bot(s)`,
      );
    }
  }

  private getOperatorGateway(): OperatorGateway | null {
    if (!this.operatorGateway) {
      try {
        this.operatorGateway = this.moduleRef.get(OperatorGateway, {
          strict: false,
        });
      } catch {
        this.logger.warn('OperatorGateway not available for bot status events');
      }
    }
    return this.operatorGateway;
  }

  /**
   * Emit per-panel bot status to operators
   */
  private emitBotStatusToOperators(
    panelId: string,
    connected: boolean,
    botId: string,
  ) {
    const opGateway = this.getOperatorGateway();
    if (opGateway) {
      opGateway.emitToAll('bot_status', {
        status: connected ? 'online' : 'offline',
        botId,
        panelId,
        connectedBots: this.getTotalBotCount(),
        connectedPerPanel: this.getConnectedCountPerPanel(),
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Handle bot connection — requires panelId in handshake
   */
  async handleConnection(client: Socket) {
    this.logger.log(`Bot attempting to connect: ${client.id}`);

    // Authenticate
    const apiKey =
      client.handshake.auth?.apiKey ||
      client.handshake.headers['x-bot-api-key'] ||
      client.handshake.query?.apiKey;

    if (!apiKey || apiKey !== this.expectedApiKey) {
      this.logger.warn(`Bot authentication failed: ${client.id}`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
      return;
    }

    // Extract panelId
    const panelId =
      client.handshake.auth?.panelId || client.handshake.query?.panelId;

    if (!panelId) {
      this.logger.warn(
        `Bot ${client.id} connected without panelId — rejecting`,
      );
      client.emit('error', {
        message: 'panelId is required. Configure it in extension options.',
      });
      client.disconnect();
      return;
    }

    // Validate panel exists
    try {
      const panelsService = this.moduleRef.get(PanelsService, {
        strict: false,
      });
      const isValid = await panelsService.validatePanelId(panelId);
      if (!isValid) {
        this.logger.warn(
          `Bot ${client.id} has invalid/inactive panelId: ${panelId}`,
        );
        client.emit('error', {
          message: `Panel ${panelId} not found or inactive`,
        });
        client.disconnect();
        return;
      }
    } catch (e) {
      this.logger.error(`Failed to validate panelId ${panelId}: ${e.message}`);
      // Allow connection if validation service unavailable (graceful degradation)
    }

    // Store in nested map
    if (!this.connectedBots.has(panelId)) {
      this.connectedBots.set(panelId, new Map());
    }
    this.connectedBots.get(panelId)!.set(client.id, client);
    this.socketToPanelId.set(client.id, panelId);

    this.logger.log(`Bot ${client.id} connected for panel ${panelId}`);

    // Cancel per-panel disconnect timer
    const timer = this.disconnectTimers.get(panelId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(panelId);
      this.logger.log(`Panel ${panelId} bot reconnected within grace period`);
    }

    // Notify operators
    this.emitBotStatusToOperators(panelId, true, client.id);

    // Send connection confirmation
    client.emit('connected', {
      message: 'Bot authenticated successfully',
      botId: client.id,
      panelId,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(
      `Total bots connected: ${this.getTotalBotCount()} across ${this.connectedBots.size} panel(s)`,
    );

    // Try to dispatch queued jobs for this panel
    this.tryPushQueuedJobOnReconnect(panelId);
  }

  /**
   * On reconnect, dispatch queued jobs for the specific panel
   */
  private tryPushQueuedJobOnReconnect(panelId: string) {
    const existing = this.reconnectDispatchTimers.get(panelId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.reconnectDispatchTimers.delete(panelId);
      if (!this.isBotConnectedForPanel(panelId)) return;
      try {
        const jobsService = this.moduleRef.get(JobsService, { strict: false });
        const result = await jobsService.tryDispatchNextJob(panelId);
        if (result.dispatched) {
          this.logger.log(
            `Dispatched queued job to reconnected bot for panel ${panelId}`,
          );
        } else {
          this.logger.debug(
            `Reconnect dispatch for panel ${panelId}: ${result.reason}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `Failed to dispatch on reconnect for panel ${panelId}: ${e.message}`,
        );
      }
    }, 3000);

    this.reconnectDispatchTimers.set(panelId, timer);
  }

  /**
   * Handle bot disconnection — per-panel debounce
   */
  handleDisconnect(client: Socket) {
    const panelId = this.socketToPanelId.get(client.id);
    this.logger.log(
      `Bot disconnected: ${client.id} (panel: ${panelId || 'unknown'})`,
    );

    // Clean up maps
    this.socketToPanelId.delete(client.id);
    if (panelId) {
      const panelBots = this.connectedBots.get(panelId);
      if (panelBots) {
        panelBots.delete(client.id);
        if (panelBots.size === 0) {
          this.connectedBots.delete(panelId);
          // Only clear busy status when NO bots remain for this panel
          this.busyPanels.delete(panelId);
        }
      }
    }

    this.logger.log(`Total bots connected: ${this.getTotalBotCount()}`);

    if (!panelId) return;

    // If panel still has bots, no need to debounce
    if (this.isBotConnectedForPanel(panelId)) return;

    // Debounce offline notification per-panel
    const existingTimer = this.disconnectTimers.get(panelId);
    if (existingTimer) clearTimeout(existingTimer);

    this.disconnectTimers.set(
      panelId,
      setTimeout(() => {
        this.disconnectTimers.delete(panelId);
        if (!this.isBotConnectedForPanel(panelId)) {
          this.logger.warn(`Bot offline confirmed for panel ${panelId}`);
          this.emitBotStatusToOperators(panelId, false, client.id);

          // Emit offline heartbeat to operators
          const offlineHealth = {
            extensionId: panelId,
            type: 'automation',
            status: 'offline',
            panelId,
            receivedAt: new Date().toISOString(),
          };
          this.extensionHealth.set(panelId, offlineHealth);
          const opGw = this.getOperatorGateway();
          if (opGw) {
            opGw.emitToAll('extension:heartbeat', offlineHealth);
          }

          // Telegram alert
          try {
            const {
              TelegramService,
            } = require('../notifications/telegram.service');
            const telegram = this.moduleRef.get(TelegramService, {
              strict: false,
            });
            telegram
              ?.alertBotDisconnected?.()
              .catch((e) =>
                this.logger.warn(
                  `Telegram bot disconnect alert failed: ${e.message}`,
                ),
              );
          } catch (err) {
            this.logger.warn(
              `Failed to send bot disconnect Telegram alert: ${err?.message || err}`,
            );
          }
        }
      }, BotGateway.DISCONNECT_DEBOUNCE_MS),
    );

    this.logger.log(
      `Panel ${panelId} disconnect debounced — waiting ${BotGateway.DISCONNECT_DEBOUNCE_MS / 1000}s`,
    );
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    this.logger.debug(`Heartbeat from bot ${client.id}`);
    client.emit('heartbeat_ack', { timestamp: new Date().toISOString() });

    // Store enriched heartbeat data
    const panelId = (client.handshake.query?.panelId as string) || 'unknown';
    const healthData = {
      extensionId: panelId,
      type: data?.type || 'automation',
      status: this.busyPanels.has(panelId) ? 'busy' : 'online',
      panelId,
      walletId: data?.walletId || null,
      tabStatus: data?.tabStatus || 'unknown',
      currentUrl: data?.currentUrl || '',
      sessionValid: data?.sessionValid ?? true,
      pendingJobs: data?.pendingJobs || 0,
      uptimeMinutes: data?.uptimeMinutes || 0,
      lastJobAt: data?.lastJobAt || null,
      consecutiveErrors: data?.consecutiveErrors || 0,
      version: data?.version || 'unknown',
      receivedAt: new Date().toISOString(),
      versionStatus: undefined as string | undefined,
    };
    this.extensionHealth.set(panelId, healthData);

    // Version tracking — warn operators if extension is outdated
    if (data?.version && data.version !== 'unknown') {
      healthData.versionStatus = 'current'; // default
      // TODO: compare against EXPECTED_EXTENSION_VERSION setting when available
    }

    // Emit to operators for real-time dashboard
    const opGateway = this.getOperatorGateway();
    if (opGateway) {
      opGateway.emitToAll('extension:heartbeat', healthData);
    }
  }

  getExtensionHealth(): any[] {
    return Array.from(this.extensionHealth.values());
  }

  // ==========================================
  // CIRCUIT BREAKER + LOG STREAMING
  // ==========================================

  @SubscribeMessage('extension:circuit_breaker')
  handleCircuitBreaker(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const panelId =
      (client.handshake.query?.panelId as string) || data?.panelId || 'unknown';
    this.logger.warn(
      `Circuit breaker activated for panel ${panelId}: ${data?.errors} errors`,
    );

    // Update extension health
    const health = this.extensionHealth.get(panelId);
    if (health) {
      health.status = 'error';
      health.circuitBreakerActive = true;
    }

    // Alert operators
    const opGateway = this.getOperatorGateway();
    if (opGateway) {
      opGateway.emitToAll('extension:circuit_breaker', {
        extensionId: panelId,
        active: data?.active,
        errors: data?.errors,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('extension:selector_health')
  handleSelectorHealth(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const panelId = (client.handshake.query?.panelId as string) || 'unknown';
    this.logger.log(
      `Selector health for ${panelId}: ${data?.matched}/${data?.total} OK, ${data?.failed} failed`,
    );

    // Update extension health with selector data
    const health = this.extensionHealth.get(panelId);
    if (health) {
      health.selectorHealth = {
        matched: data?.matched || 0,
        failed: data?.failed || 0,
        total: data?.total || 0,
        failedSelectors: data?.failedSelectors || [],
        checkedAt: data?.timestamp || new Date().toISOString(),
      };
    }

    // Alert operators
    const opGateway = this.getOperatorGateway();
    if (opGateway) {
      opGateway.emitToAll('extension:selector_health', {
        extensionId: panelId,
        ...data,
      });

      // Critical alert if selectors are broken
      if (data?.failed > 0) {
        opGateway.emitToAll('system_alert', {
          type: 'selector_failure',
          message: `Extension ${panelId}: ${data.failed} selectores rotos — ${(data.failedSelectors || []).slice(0, 3).join(', ')}`,
          severity: 'warning',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  @SubscribeMessage('extension:log')
  handleExtensionLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const panelId =
      (client.handshake.query?.panelId as string) ||
      data?.metadata?.panelId ||
      'unknown';
    // Forward to operators (no storage, just relay)
    const opGateway = this.getOperatorGateway();
    if (opGateway) {
      opGateway.emitToAll('extension:log', {
        extensionId: panelId,
        ...data,
      });
    }
  }

  /**
   * Reset circuit breaker for a specific panel's bot.
   * Called by OperatorGateway when an operator clicks "Reactivar".
   */
  resetCircuitBreakerForPanel(panelId: string): boolean {
    const panelBots = this.connectedBots.get(panelId);
    if (!panelBots || panelBots.size === 0) {
      this.logger.warn(
        `Cannot reset circuit breaker — no bot connected for panel ${panelId}`,
      );
      return false;
    }

    for (const [, bot] of panelBots) {
      if (bot.connected) {
        bot.emit('reset_circuit_breaker', { panelId });
        this.logger.log(`Sent reset_circuit_breaker to panel ${panelId}`);

        // Update health
        const health = this.extensionHealth.get(panelId);
        if (health) {
          health.circuitBreakerActive = false;
        }

        return true;
      }
    }
    return false;
  }

  @SubscribeMessage('job_status')
  handleJobStatus(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    this.logger.log(`Job status from bot ${client.id}:`, data);
    client.emit('job_status_ack', { received: true });
  }

  // ==========================================
  // JOB DISPATCH (per-panel)
  // ==========================================

  /**
   * Push job to bot for a specific panel.
   * Uses Socket.IO acknowledgement to confirm the bot received the job.
   * If no ACK within timeout, returns false so the job can be requeued.
   */
  async pushJobToPanel(panelId: string, job: any): Promise<boolean> {
    const ACK_TIMEOUT_MS = 5000;
    this.logger.log(`Pushing job ${job.id} to panel ${panelId}`);

    const panelBots = this.connectedBots.get(panelId);
    if (!panelBots || panelBots.size === 0) {
      this.logger.warn(`No bot connected for panel ${panelId}`);
      return false;
    }

    // Re-validate the panel before dispatching. The bot may have connected when
    // the panel was active and then the panel got disabled — we don't want jobs
    // landing on a panel an operator just marked inactive.
    try {
      const panelsService = this.moduleRef.get(PanelsService, {
        strict: false,
      });
      const stillValid = await panelsService.validatePanelId(panelId);
      if (!stillValid) {
        this.logger.warn(
          `Panel ${panelId} is inactive at dispatch time — refusing job ${job.id}`,
        );
        return false;
      }
    } catch (e: any) {
      this.logger.error(
        `pushJobToPanel: validate failed for ${panelId}: ${e.message}`,
      );
      // Graceful degradation: if the panel service is down, fall through and try to dispatch.
    }

    // Emit to ONE connected bot only (first connected).
    // Sending to multiple bots would cause duplicate execution on the panel.
    for (const [botId, bot] of panelBots) {
      if (bot.connected) {
        this.logger.log(
          `Pushing job ${job.id} to bot ${botId} (panel ${panelId}), waiting for ACK...`,
        );
        try {
          const ackResult = await new Promise<{
            acked: boolean;
            rejected?: boolean;
            reason?: string;
          }>((resolve) => {
            const timer = setTimeout(() => {
              this.logger.warn(
                `Job ${job.id} ACK timeout from bot ${botId} after ${ACK_TIMEOUT_MS}ms`,
              );
              resolve({ acked: false });
            }, ACK_TIMEOUT_MS);

            bot.emit('new_job', job, (ack: any) => {
              clearTimeout(timer);
              this.logger.log(
                `Job ${job.id} ACKed by bot ${botId}: ${JSON.stringify(ack)}`,
              );
              // Bot can reject in the ACK (busy/cooldown/wrong panel) so the
              // job reverts to QUEUED instead of dying as a 5min-stuck job.
              // Legacy bots don't send `accepted` — absence means accepted.
              if (ack && ack.accepted === false) {
                resolve({ acked: true, rejected: true, reason: ack.reason });
              } else {
                resolve({ acked: true });
              }
            });
          });

          if (ackResult.rejected) {
            this.logger.warn(
              `Job ${job.id} rejected by bot ${botId} (${ackResult.reason || 'no reason'}) — will re-queue`,
            );
            return false;
          }

          if (ackResult.acked) {
            this.markPanelBusy(panelId);
            return true;
          }
          // ACK timeout — bot may have disconnected, try next bot
          this.logger.warn(
            `Bot ${botId} did not ACK job ${job.id}, trying next bot...`,
          );
        } catch (err) {
          this.logger.error(
            `Error pushing job ${job.id} to bot ${botId}: ${err.message}`,
          );
        }
      }
    }

    this.logger.warn(
      `All bots for panel ${panelId} failed to ACK job ${job.id}`,
    );
    return false;
  }

  /**
   * Legacy compatibility — push to any connected bot (used during transition)
   */
  async pushJobToBot(job: any): Promise<boolean> {
    // If job has panelId, use panel-specific dispatch
    if (job.panelId) {
      return this.pushJobToPanel(job.panelId, job);
    }
    // Fallback: push to first available bot from any panel
    for (const [panelId, panelBots] of this.connectedBots) {
      if (panelBots.size > 0) {
        return this.pushJobToPanel(panelId, job);
      }
    }
    this.logger.warn('No bots connected to push job to');
    return false;
  }

  // ==========================================
  // DISCOVERY (search user across panels)
  // ==========================================

  /**
   * Send search_user to all IDLE panel bots.
   * Returns list of panelIds that received the request.
   * If excludePanelId is given (e.g. re-discovery after a panel reported NOT_FOUND),
   * that panel is skipped to avoid asking it again.
   */
  pushDiscoveryToIdlePanels(
    taskId: string,
    targetUsername: string,
    excludePanelId?: string,
  ): string[] {
    const sentTo: string[] = [];

    for (const [panelId, panelBots] of this.connectedBots) {
      if (panelBots.size === 0) continue;

      if (excludePanelId && panelId === excludePanelId) {
        this.logger.log(
          `Skipping discovery for panel ${panelId} — excluded (already reported NOT_FOUND)`,
        );
        continue;
      }

      // Skip busy panels — don't interrupt active jobs
      if (this.busyPanels.has(panelId)) {
        this.logger.log(
          `Skipping discovery for panel ${panelId} — bot is busy`,
        );
        continue;
      }

      // Find first CONNECTED socket (cleanup zombies)
      let bot: any = null;
      const deadSocketIds: string[] = [];
      for (const [socketId, socket] of panelBots) {
        if (socket.connected) {
          bot = socket;
          break;
        } else {
          deadSocketIds.push(socketId);
        }
      }
      for (const deadId of deadSocketIds) {
        panelBots.delete(deadId);
        this.logger.warn(
          `Cleaned up zombie socket ${deadId} for panel ${panelId} during discovery`,
        );
      }
      if (!bot) {
        this.logger.warn(
          `No live sockets for panel ${panelId} after zombie cleanup`,
        );
        continue;
      }

      bot.emit('search_user', { taskId, targetUsername });
      sentTo.push(panelId);
      this.logger.log(
        `Sent search_user to panel ${panelId} for "${targetUsername}" (task ${taskId})`,
      );
    }

    if (sentTo.length === 0) {
      this.logger.warn(
        `No idle bots available for discovery of "${targetUsername}"`,
      );
    }

    return sentTo;
  }

  // ==========================================
  // USER CREATION (auto-create on panel)
  // ==========================================

  /**
   * Send create_user command to a specific panel's bot.
   * Used when discovery finds user doesn't exist on any panel.
   */
  pushCreateUserToPanel(
    panelId: string,
    data: { taskId: string; targetUsername: string },
  ): boolean {
    const panelBots = this.connectedBots.get(panelId);
    if (!panelBots || panelBots.size === 0) {
      this.logger.warn(
        `No bot connected for panel ${panelId} — cannot create user`,
      );
      return false;
    }

    // Skip if panel is busy
    if (this.busyPanels.has(panelId)) {
      this.logger.warn(`Panel ${panelId} is busy — cannot create user now`);
      return false;
    }

    // Find first CONNECTED socket (cleanup zombies)
    let bot: any = null;
    const deadIds: string[] = [];
    for (const [socketId, socket] of panelBots) {
      if (socket.connected) {
        bot = socket;
        break;
      } else {
        deadIds.push(socketId);
      }
    }
    for (const deadId of deadIds) {
      panelBots.delete(deadId);
      this.logger.warn(
        `Cleaned up zombie socket ${deadId} for panel ${panelId} during create_user`,
      );
    }
    if (!bot) {
      this.logger.warn(
        `No live sockets for panel ${panelId} after zombie cleanup — cannot create user`,
      );
      return false;
    }

    bot.emit('create_user', data);
    this.logger.log(
      `Sent create_user to panel ${panelId} for "${data.targetUsername}" (task ${data.taskId})`,
    );
    return true;
  }

  /**
   * Get panel IDs that were not queried during discovery (were busy)
   */
  getUncheckedPanelIds(checkedPanelIds: string[]): string[] {
    const allActive: string[] = [];
    for (const [panelId, panelBots] of this.connectedBots) {
      if (panelBots.size > 0) allActive.push(panelId);
    }
    return allActive.filter((id) => !checkedPanelIds.includes(id));
  }

  // ==========================================
  // BALANCE CHECK (Telegram /fichas command)
  // ==========================================

  // Pending balance check resolvers (panelId → resolve function)
  private pendingBalanceChecks = new Map<
    string,
    {
      resolve: (balance: number | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * WebSocket fallback for discovery results (when HTTP endpoint fails).
   * Extension sends this when ApiClient.reportDiscoveryResult() returns null.
   */
  @SubscribeMessage('discovery_result')
  async handleDiscoveryResultWs(
    @MessageBody()
    data: {
      taskId: string;
      panelId?: string;
      found: boolean;
      error?: string;
      matched?: number;
      totalRows?: number;
      paginationVisible?: boolean;
      pageInfoText?: string;
      reason?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const panelId =
      data.panelId ||
      (client.handshake?.query?.panelId as string) ||
      (client.handshake?.auth?.panelId as string) ||
      'default';
    this.logger.log(
      `[WS Fallback] Discovery result from panel ${panelId}: found=${data.found} (task ${data.taskId})`,
    );

    try {
      const { DiscoveryService } = require('../discovery/discovery.service');
      const discoveryService = this.moduleRef.get(DiscoveryService, {
        strict: false,
      });
      await discoveryService.handleDiscoveryResult(
        data.taskId,
        panelId,
        data.found,
        false,
        data.error,
        {
          matched: data.matched,
          totalRows: data.totalRows,
          paginationVisible: data.paginationVisible,
          pageInfoText: data.pageInfoText,
          reason: data.reason,
        },
      );
    } catch (err: any) {
      this.logger.error(
        `[WS Fallback] Failed to process discovery result: ${err.message}`,
      );
    }
  }

  /**
   * WebSocket fallback for user creation results (when HTTP endpoint fails).
   */
  @SubscribeMessage('create_user_result')
  async handleCreateUserResultWs(
    @MessageBody()
    data: {
      taskId: string;
      panelId?: string;
      success: boolean;
      targetUsername?: string;
      password?: string;
      error?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const panelId =
      data.panelId ||
      (client.handshake?.query?.panelId as string) ||
      (client.handshake?.auth?.panelId as string) ||
      'default';
    this.logger.log(
      `[WS Fallback] Create user result from panel ${panelId}: success=${data.success} (task ${data.taskId})`,
    );

    try {
      const { DiscoveryService } = require('../discovery/discovery.service');
      const discoveryService = this.moduleRef.get(DiscoveryService, {
        strict: false,
      });
      await discoveryService.handleUserCreationResult(
        data.taskId,
        panelId,
        data.success,
        data.error,
      );
    } catch (err: any) {
      this.logger.error(
        `[WS Fallback] Failed to process create user result: ${err.message}`,
      );
    }
  }

  @SubscribeMessage('balance_result')
  handleBalanceResult(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const panelId =
      (client.handshake?.query?.panelId as string) ||
      (client.handshake?.auth?.panelId as string) ||
      data?.panelId ||
      'default';
    this.logger.log(`Balance result from panel ${panelId}: ${data?.balance}`);

    const pending = this.pendingBalanceChecks.get(panelId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingBalanceChecks.delete(panelId);
      pending.resolve(data?.balance ?? null);
    }
  }

  /**
   * Send check_balance to a specific panel's bot.
   * Returns a Promise that resolves with the balance or rejects on timeout.
   */
  checkPanelBalance(
    panelId: string,
    timeoutMs = 10000,
  ): Promise<number | null> {
    const panelBots = this.connectedBots.get(panelId);
    if (!panelBots || panelBots.size === 0) {
      return Promise.reject(new Error(`No bot connected for panel ${panelId}`));
    }

    const [, bot] = panelBots.entries().next().value!;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBalanceChecks.delete(panelId);
        reject(new Error('Balance check timed out'));
      }, timeoutMs);

      this.pendingBalanceChecks.set(panelId, { resolve, timer });
      bot.emit('check_balance', { panelId });
      this.logger.log(`Sent check_balance to panel ${panelId}`);
    });
  }

  /**
   * Get list of panel IDs with connected bots.
   */
  getConnectedPanelIds(): string[] {
    const ids: string[] = [];
    for (const [panelId, panelBots] of this.connectedBots) {
      if (panelBots.size > 0) ids.push(panelId);
    }
    return ids;
  }

  // ==========================================
  // KILL SWITCH
  // ==========================================

  /**
   * Broadcast kill switch — optionally per-panel
   */
  broadcastKillSwitch(reason: string, panelId?: string) {
    const payload = {
      active: true,
      reason,
      panelId: panelId || null,
      timestamp: new Date().toISOString(),
    };

    if (panelId) {
      // Per-panel kill switch
      const panelBots = this.connectedBots.get(panelId);
      if (panelBots) {
        this.logger.warn(`Broadcasting kill switch to panel ${panelId}`);
        panelBots.forEach((bot) => bot.emit('kill_switch', payload));
      }
    } else {
      // Global kill switch
      this.logger.warn('Broadcasting global kill switch to all bots');
      for (const [, panelBots] of this.connectedBots) {
        panelBots.forEach((bot) => bot.emit('kill_switch', payload));
      }
    }
  }

  // ==========================================
  // BUSY STATE TRACKING
  // ==========================================

  markPanelBusy(panelId: string) {
    this.busyPanels.add(panelId);
  }

  markPanelIdle(panelId: string) {
    this.busyPanels.delete(panelId);
  }

  isPanelBusy(panelId: string): boolean {
    return this.busyPanels.has(panelId);
  }

  // ==========================================
  // QUERY HELPERS
  // ==========================================

  getTotalBotCount(): number {
    let count = 0;
    for (const [, panelBots] of this.connectedBots) {
      count += panelBots.size;
    }
    return count;
  }

  isAnyBotConnected(): boolean {
    return this.getTotalBotCount() > 0;
  }

  isBotConnectedForPanel(panelId: string): boolean {
    const panelBots = this.connectedBots.get(panelId);
    if (!panelBots || panelBots.size === 0) return false;
    // Verify at least one socket is actually connected (not zombie)
    for (const [socketId, socket] of panelBots) {
      if (socket.connected) return true;
      // Cleanup zombie
      panelBots.delete(socketId);
      this.logger.warn(
        `Cleaned up zombie socket ${socketId} for panel ${panelId} in isBotConnectedForPanel`,
      );
    }
    return false;
  }

  getConnectedBotIds(): string[] {
    return Array.from(this.socketToPanelId.keys());
  }

  getConnectedCountPerPanel(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [panelId, panelBots] of this.connectedBots) {
      result[panelId] = panelBots.size;
    }
    return result;
  }

  getPanelIdForSocket(socketId: string): string | undefined {
    return this.socketToPanelId.get(socketId);
  }

  /** @deprecated Use getTotalBotCount() */
  getConnectedBotCount(): number {
    return this.getTotalBotCount();
  }
}
