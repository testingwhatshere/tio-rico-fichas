import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import {
  Logger,
  Inject,
  forwardRef,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { getCorsOrigin } from '../common/cors.config';
import { DashboardService } from '../dashboard/dashboard.service';
import { RequestsService } from '../requests/requests.service';
import { ChatsService } from '../chats/chats.service';
import { MessagesService } from '../messages/messages.service';
import { SettingsService } from '../settings/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { PaymentsService } from '../payments/payments.service';
import { UsersService } from '../users/users.service';
import { ChatsGateway } from './chats.gateway';
import { EventsGateway } from './events.gateway';
import { ValidatorGateway } from '../validator/validator.gateway';
import { BotGateway } from '../bot/bot.gateway';
import { BotService } from '../bot/bot.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { sanitizeError } from '../common/sanitize-error';

@WebSocketGateway({
  cors: {
    origin: getCorsOrigin(),
    credentials: true,
  },
  namespace: '/operator',
})
@UsePipes(new ValidationPipe({ whitelist: true }))
export class OperatorGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OperatorGateway.name);
  private connectedOperators: Map<string, Socket> = new Map();
  private initialDataLoading: Set<string> = new Set();
  private apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => DashboardService))
    private readonly dashboardService: DashboardService,
    @Inject(forwardRef(() => RequestsService))
    private readonly requestsService: RequestsService,
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => ChatsGateway))
    private readonly chatsGateway: ChatsGateway,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => ValidatorGateway))
    private readonly validatorGateway: ValidatorGateway,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    @Inject(forwardRef(() => BotService))
    private readonly botService: BotService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {
    const key = this.configService.get<string>('OPERATOR_API_KEY');
    if (!key) {
      throw new Error(
        'OPERATOR_API_KEY environment variable is required but not set.',
      );
    }
    this.apiKey = key;
  }

  afterInit() {
    this.logger.log('Operator Gateway initialized on /operator namespace');
  }

  async handleConnection(client: Socket) {
    const providedKey =
      client.handshake.auth?.apiKey || client.handshake.query?.apiKey;
    const operatorName =
      client.handshake.auth?.operatorName ||
      client.handshake.query?.operatorName ||
      'unknown';

    if (providedKey !== this.apiKey) {
      this.logger.warn(
        `Operator connection rejected: invalid API key from ${client.id}`,
      );
      client.emit('error', { message: 'Invalid API key' });
      client.disconnect();
      return;
    }

    // Store operator identity on the socket
    client.data.operatorName = operatorName;

    // Resolve operator name to a User ID, auto-creating if needed (anonymous operators)
    try {
      const user = await this.usersService.findOrCreateOperator(operatorName);
      client.data.userId = user.id;
      this.logger.log(`Resolved operator "${operatorName}" to user ${user.id}`);
    } catch (err) {
      this.logger.error(
        `Failed to resolve/create operator user: ${err.message}`,
      );
      client.emit('auth_warning', {
        message: `No se pudo crear el usuario operador. Algunas acciones pueden fallar.`,
        operatorName,
      });
    }

    this.connectedOperators.set(client.id, client);
    this.logger.log(
      `Operator panel connected: ${client.id} (operator: ${operatorName})`,
    );

    // Send initial data
    try {
      const initialData = await this.getInitialData();
      client.emit('initial_data', initialData);
    } catch (error) {
      this.logger.error(`Failed to send initial data: ${error.message}`);
      client.emit('error', { message: 'Failed to load initial data' });
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedOperators.delete(client.id);
    this.logger.log(`Operator panel disconnected: ${client.id}`);
  }

  private getOperatorId(client: Socket): string {
    // Prefer resolved User ID (set during handleConnection) for FK compatibility
    return (
      client.data.userId ||
      client.data.operatorName ||
      `operator-${client.id.substring(0, 8)}`
    );
  }

  /**
   * Check if operator has required role (ADMIN or SENIOR_OPERATOR).
   * Returns the user role or null if not authorized.
   */
  private async checkOperatorRole(
    client: Socket,
    requiredRoles: string[],
  ): Promise<string | null> {
    const userId = client.data.userId;
    if (!userId) return null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user || !requiredRoles.includes(user.role)) return null;
      return user.role;
    } catch {
      return null;
    }
  }

  /**
   * Get authenticated operator ID or throw. Use for actions that require a real user ID.
   */
  private requireOperatorId(client: Socket): string {
    if (!client.data.userId) {
      const err: any = new Error(
        'Sesión expirada o sin autenticar — volvé a iniciar sesión',
      );
      err.code = 'OPERATOR_SESSION_REQUIRED';
      throw err;
    }
    return client.data.userId;
  }

  // ==========================================
  // INITIAL DATA
  // ==========================================

  private async getInitialData() {
    // Fetch prize claims in parallel with other data. If this fails we surface
    // the failure to the client (loadErrors.prizeClaims) so the renderer can
    // show "couldn't load" instead of an empty list that looks like real state.
    let prizeClaims: any[] = [];
    let prizeClaimsError: string | null = null;
    try {
      const {
        PrizeClaimsService,
      } = require('../prize-claims/prize-claims.service');
      const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
        strict: false,
      });
      prizeClaims = await prizeClaimsService.findPending();
    } catch (err: any) {
      prizeClaimsError = err?.message || String(err);
      this.logger.warn(
        `Failed to load prize claims for initial data: ${prizeClaimsError}`,
      );
    }

    // Use allSettled so one failing service doesn't crash everything
    const labels = [
      'stats',
      'failures',
      'jobs',
      'chats',
      'settings',
      'killSwitch',
      'wallets',
      'trends',
    ];
    const results = await Promise.allSettled([
      this.dashboardService.getDashboardStats(),
      this.dashboardService.getFailureQueue(),
      this.jobsService.getRecentJobs(20),
      this.chatsService.listChats({ status: 'OPEN' as any }),
      this.settingsService.getSystemSettings(),
      this.settingsService.getKillSwitch(),
      this.paymentsService.getAllWallets(),
      this.dashboardService.getRequestTrends(7),
    ]);

    // Extract values, logging any failures
    const values: any[] = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      this.logger.error(
        `getInitialData: "${labels[i]}" failed: ${r.reason?.message || r.reason}`,
      );
      return null;
    });

    const [
      stats,
      failures,
      jobs,
      chats,
      settings,
      killSwitch,
      wallets,
      trends,
    ] = values;

    // Fetch panels with bot status
    let panels: any[] = [];
    try {
      const { PanelsService } = require('../panels/panels.service');
      const panelsService = this.moduleRef.get(PanelsService, {
        strict: false,
      });
      const allPanels = await panelsService.findAll();
      const connectedPanelIds = this.botGateway.getConnectedPanelIds();
      panels = allPanels.map((p: any) => ({
        ...p,
        botConnected: connectedPanelIds.includes(p.id),
      }));
    } catch (err) {
      this.logger.warn(
        `Failed to load panels for initial data: ${err?.message || err}`,
      );
    }

    // Fetch outbound payments
    let outboundPayments: any[] = [];
    try {
      const {
        OutboundPaymentsService,
      } = require('../outbound-payments/outbound-payments.service');
      const outboundService = this.moduleRef.get(OutboundPaymentsService, {
        strict: false,
      });
      outboundPayments = await outboundService.findPending();
    } catch (err) {
      this.logger.warn(
        `Failed to load outbound payments: ${err?.message || err}`,
      );
    }

    return {
      stats: stats || {},
      failures: failures
        ? failures.validationFailures.concat(failures.jobFailures)
        : [],
      jobs: jobs || [],
      chats: chats || [],
      settings: settings || {},
      killSwitch: killSwitch ? killSwitch.active : false,
      wallets: wallets || [],
      trends: trends || [],
      prizeClaims,
      panels,
      outboundPayments,
      validatorStatus: this.validatorGateway.getStatus(),
      botStatus: {
        status: this.botGateway.isAnyBotConnected() ? 'online' : 'offline',
        connected: this.botGateway.isAnyBotConnected(),
        connectedBots: this.botGateway.getTotalBotCount(),
        connectedPanels: this.botGateway.getConnectedPanelIds(),
        connectedPerPanel: this.botGateway.getConnectedCountPerPanel(),
      },
      timestamp: new Date().toISOString(),
      loadErrors: prizeClaimsError
        ? { prizeClaims: prizeClaimsError }
        : undefined,
    };
  }

  @SubscribeMessage('get_initial_data')
  async handleGetInitialData(@ConnectedSocket() client: Socket) {
    if (this.initialDataLoading.has(client.id)) {
      return { success: false, error: 'Initial data already loading' };
    }
    this.initialDataLoading.add(client.id);
    try {
      const data = await this.getInitialData();
      return { success: true, data };
    } catch (error) {
      this.logger.error(`Failed to get initial data: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    } finally {
      this.initialDataLoading.delete(client.id);
    }
  }

  // ==========================================
  // FAILURE HANDLING
  // ==========================================

  @SubscribeMessage('approve_failure')
  async handleApproveFailure(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { failureId: string; note?: string; approvedAmount?: number },
  ) {
    try {
      if (!data.failureId || typeof data.failureId !== 'string') {
        return { success: false, error: 'failureId es requerido' };
      }

      this.logger.log(`Approving failure ${data.failureId}`);

      // Fix 10: Require authenticated operator for approval actions
      const operatorId = this.requireOperatorId(client);

      await this.requestsService.approve(data.failureId, operatorId, {
        note: data.note,
        approvedAmount: data.approvedAmount,
      });

      // Job creation is now handled inside approve() itself (Fix 15)

      // Broadcast update to all connected operators
      this.emitToAll('failure_resolved', {
        failureId: data.failureId,
        action: 'approved',
        operatorId,
        timestamp: new Date().toISOString(),
      });

      // Send updated stats
      const stats = await this.dashboardService.getDashboardStats();
      this.emitToAll('stats_update', stats);

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to approve failure: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('reject_failure')
  async handleRejectFailure(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { failureId: string; reason: string },
  ) {
    try {
      if (!data.failureId || typeof data.failureId !== 'string') {
        return { success: false, error: 'failureId es requerido' };
      }

      this.logger.log(`Rejecting failure ${data.failureId}: ${data.reason}`);

      // Fix 10: Require authenticated operator for rejection actions
      const operatorId = this.requireOperatorId(client);

      await this.requestsService.reject(data.failureId, operatorId, {
        reason: data.reason,
      });

      this.emitToAll('failure_resolved', {
        failureId: data.failureId,
        action: 'rejected',
        operatorId,
        reason: data.reason,
        timestamp: new Date().toISOString(),
      });

      const stats = await this.dashboardService.getDashboardStats();
      this.emitToAll('stats_update', stats);

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to reject failure: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // CHAT HANDLING
  // ==========================================

  @SubscribeMessage('get_chats')
  async handleGetChats(@ConnectedSocket() client: Socket) {
    try {
      const openChats = await this.chatsService.listChats({
        status: 'OPEN' as any,
      });
      const assignedChats = await this.chatsService.listChats({
        status: 'ASSIGNED' as any,
      });
      return {
        success: true,
        data: { open: openChats, assigned: assignedChats },
      };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('get_pending_summary')
  async handleGetPendingSummary(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    try {
      this.requireOperatorId(client);
      if (!data?.chatId) return { success: false, error: 'chatId requerido' };
      const summary = await this.chatsService.getPendingSummary(data.chatId);
      return { success: true, data: summary };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('get_chat_messages')
  async handleGetChatMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string; cursor?: string },
  ) {
    try {
      const operatorId = this.requireOperatorId(client);
      const messages = await this.messagesService.getMessages(
        data.chatId,
        operatorId,
        'OPERATOR',
        { cursor: data.cursor, limit: 50 },
      );
      return { success: true, data: messages };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string; content: string; imageUrl?: string },
  ) {
    try {
      const operatorId = this.requireOperatorId(client);
      const message = await this.messagesService.sendMessage(
        operatorId,
        {
          chatId: data.chatId,
          content: data.content,
          ...(data.imageUrl && { imageUrl: data.imageUrl }),
        },
        'OPERATOR',
      );

      return { success: true, data: message };
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    try {
      await this.messagesService.markAsRead(
        data.chatId,
        this.getOperatorId(client),
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('close_chat')
  async handleCloseChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string; reason?: string },
  ) {
    try {
      await this.chatsService.closeChat(
        data.chatId,
        this.getOperatorId(client),
        data.reason,
      );

      this.emitToAll('chat_closed', {
        chatId: data.chatId,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // KILL SWITCH
  // ==========================================

  @SubscribeMessage('set_kill_switch')
  async handleSetKillSwitch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { active: boolean; reason?: string },
  ) {
    try {
      const operatorId = this.getOperatorId(client);

      // Kill switch requires ADMIN or SENIOR_OPERATOR role
      const role = await this.checkOperatorRole(client, [
        'ADMIN',
        'SENIOR_OPERATOR',
      ]);
      if (!role) {
        this.logger.warn(
          `Operator ${operatorId} attempted kill switch without required role`,
        );
        return {
          success: false,
          error:
            'Insufficient permissions. Only ADMIN or SENIOR_OPERATOR can toggle kill switch.',
        };
      }
      if (data.active) {
        await this.settingsService.activateKillSwitch(operatorId, data.reason);
      } else {
        await this.settingsService.deactivateKillSwitch(operatorId);
      }

      this.emitToAll('kill_switch', {
        active: data.active,
        reason: data.reason,
        timestamp: new Date().toISOString(),
      });

      // Broadcast kill switch to bots
      if (data.active) {
        try {
          this.botGateway.broadcastKillSwitch(
            data.reason || 'Kill switch activated by operator',
          );
        } catch (err) {
          this.logger.error(
            `Failed to broadcast kill switch to bots: ${err.message}`,
          );
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to set kill switch: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // CIRCUIT BREAKER RESET
  // ==========================================

  @SubscribeMessage('reset_circuit_breaker')
  async handleResetCircuitBreaker(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { extensionId: string },
  ) {
    try {
      const operatorId = this.getOperatorId(client);
      if (!data?.extensionId) {
        return { success: false, error: 'extensionId is required' };
      }

      this.logger.log(
        `Operator ${operatorId} resetting circuit breaker for ${data.extensionId}`,
      );

      const sent = this.botGateway.resetCircuitBreakerForPanel(
        data.extensionId,
      );
      if (!sent) {
        return {
          success: false,
          error: `No bot connected for panel ${data.extensionId}`,
        };
      }

      // Notify all operators
      this.emitToAll('extension:circuit_breaker', {
        extensionId: data.extensionId,
        active: false,
        resetBy: operatorId,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to reset circuit breaker: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // PROMOTIONAL BROADCASTS
  // ==========================================

  @SubscribeMessage('broadcast_promo')
  async handleBroadcastPromo(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { title: string; message: string },
  ) {
    try {
      const operatorId = this.getOperatorId(client);

      // Only ADMIN or SENIOR_OPERATOR can broadcast
      const role = await this.checkOperatorRole(client, [
        'ADMIN',
        'SENIOR_OPERATOR',
      ]);
      if (!role) {
        return {
          success: false,
          error: 'Permisos insuficientes para enviar promos.',
        };
      }

      if (!data.title?.trim() || !data.message?.trim()) {
        return { success: false, error: 'Titulo y mensaje son requeridos.' };
      }

      const count = await this.notificationsService.broadcastPromo(
        data.title.trim(),
        data.message.trim(),
      );

      this.logger.log(
        `Promo broadcast by ${operatorId}: "${data.title}" → ${count} push recipients`,
      );

      return { success: true, pushRecipients: count };
    } catch (error) {
      this.logger.error(`Failed to broadcast promo: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // APP UPDATE MANAGEMENT
  // ==========================================

  @SubscribeMessage('publish_app_update')
  async handlePublishAppUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { version: string; apkUrl: string; changelog?: string },
  ) {
    try {
      const role = await this.checkOperatorRole(client, ['ADMIN']);
      if (!role) {
        return {
          success: false,
          error: 'Solo ADMIN puede publicar actualizaciones.',
        };
      }

      if (!data.version?.trim() || !data.apkUrl?.trim()) {
        return {
          success: false,
          error: 'Version y URL del APK son requeridos.',
        };
      }

      // Save version info to settings
      await this.settingsService.setSetting(
        'APP_VERSION_CHAT',
        data.version.trim(),
      );
      await this.settingsService.setSetting(
        'APP_APK_URL_CHAT',
        data.apkUrl.trim(),
      );
      if (data.changelog) {
        await this.settingsService.setSetting(
          'APP_CHANGELOG_CHAT',
          data.changelog.trim(),
        );
      }

      // Notify all users via push that a new version is available
      const count = await this.notificationsService.broadcastPromo(
        'Nueva version disponible',
        `Actualiza a la version ${data.version} para tener las ultimas mejoras.`,
        { type: 'APP_UPDATE', version: data.version },
      );

      this.logger.log(
        `App update published: v${data.version} by ${this.getOperatorId(client)}, ${count} users notified`,
      );

      return { success: true, notifiedUsers: count };
    } catch (error) {
      this.logger.error(`Failed to publish app update: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('update_system_settings')
  async handleUpdateSystemSettings(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const role = await this.checkOperatorRole(client, [
        'ADMIN',
        'SENIOR_OPERATOR',
      ]);
      if (!role)
        return {
          success: false,
          error:
            'No tienes permisos para modificar la configuración del sistema',
        };

      const operatorId = this.requireOperatorId(client);
      const updated = await this.settingsService.updateSystemSettings(
        data,
        operatorId,
      );

      this.emitToAll('settings_updated', {
        settings: updated,
        timestamp: new Date().toISOString(),
      });

      return { success: true, data: updated };
    } catch (error) {
      this.logger.error(`Failed to update system settings: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // RETRY FAILED REQUEST (discovery + auto-creation)
  // ==========================================

  @SubscribeMessage('retry_failed_request')
  async handleRetryFailedRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId: string },
  ) {
    try {
      const role = await this.checkOperatorRole(client, [
        'ADMIN',
        'SENIOR_OPERATOR',
      ]);
      if (!role)
        return {
          success: false,
          error: 'No tienes permisos para reintentar solicitudes',
        };

      if (!data?.requestId)
        return { success: false, error: 'requestId requerido' };

      const { DiscoveryService } = require('../discovery/discovery.service');
      const discoveryService = this.moduleRef.get(DiscoveryService, {
        strict: false,
      });
      const result = await discoveryService.retryDiscoveryForRequest(
        data.requestId,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to retry failed request: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // PANELS
  // ==========================================

  @SubscribeMessage('get_panels')
  async handleGetPanels(@ConnectedSocket() client: Socket) {
    try {
      const { PanelsService } = require('../panels/panels.service');
      const panelsService = this.moduleRef.get(PanelsService, {
        strict: false,
      });
      const allPanels = await panelsService.findAll();
      const connectedPanelIds = this.botGateway.getConnectedPanelIds();
      const panels = allPanels.map((p: any) => ({
        ...p,
        botConnected: connectedPanelIds.includes(p.id),
      }));
      return { success: true, panels };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('create_panel')
  async handleCreatePanel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { name: string },
  ) {
    try {
      this.requireOperatorId(client);
      const { PanelsService } = require('../panels/panels.service');
      const panelsService = this.moduleRef.get(PanelsService, {
        strict: false,
      });
      const panel = await panelsService.create({ name: data.name });
      this.emitToAll('panel_created', panel);
      return { success: true, panel };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('update_panel')
  async handleUpdatePanel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { id: string; name?: string; isActive?: boolean },
  ) {
    try {
      this.requireOperatorId(client);
      const { PanelsService } = require('../panels/panels.service');
      const panelsService = this.moduleRef.get(PanelsService, {
        strict: false,
      });
      const panel = await panelsService.update(data.id, {
        name: data.name,
        isActive: data.isActive,
      });
      this.emitToAll('panel_updated', panel);
      return { success: true, panel };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('delete_panel')
  async handleDeletePanel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { id: string },
  ) {
    try {
      this.requireOperatorId(client);
      const { PanelsService } = require('../panels/panels.service');
      const panelsService = this.moduleRef.get(PanelsService, {
        strict: false,
      });
      const panel = await panelsService.remove(data.id);
      this.emitToAll('panel_deleted', { id: data.id });
      return { success: true, panel };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==========================================
  // JOBS
  // ==========================================

  @SubscribeMessage('get_jobs')
  async handleGetJobs(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { status?: string; limit?: number },
  ) {
    try {
      const jobs = await this.jobsService.getRecentJobs(data?.limit || 50);
      return { success: true, data: jobs };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('retry_job')
  async handleRetryJob(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { jobId: string },
  ) {
    try {
      await this.jobsService.retryJob(data.jobId);

      this.emitToAll('job_retried', {
        jobId: data.jobId,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to retry job: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // WALLET MANAGEMENT
  // ==========================================

  @SubscribeMessage('get_wallets')
  async handleGetWallets(@ConnectedSocket() client: Socket) {
    try {
      const wallets = await this.paymentsService.getAllWallets();
      return { success: true, data: wallets };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('create_wallet')
  async handleCreateWallet(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      type: 'MERCADOPAGO' | 'CBU' | 'CVU';
      label: string;
      holderName: string;
      holderDni?: string;
      holderLegalName?: string;
      details: Record<string, string>;
      amountLimit?: number;
    },
  ) {
    try {
      const wallet = await this.paymentsService.createWallet(data);

      // Broadcast to all operators
      this.emitToAll('wallet_created', wallet);

      return { success: true, data: wallet };
    } catch (error) {
      this.logger.error(`Failed to create wallet: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('update_wallet')
  async handleUpdateWallet(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      id: string;
      label?: string;
      holderName?: string;
      holderDni?: string;
      holderLegalName?: string;
      details?: Record<string, string>;
      amountLimit?: number | null;
      requiresVerification?: boolean;
    },
  ) {
    try {
      const { id, ...updateData } = data;
      const wallet = await this.paymentsService.updateWallet(id, updateData);

      // Broadcast to all operators
      this.emitToAll('wallet_updated', wallet);

      return { success: true, data: wallet };
    } catch (error) {
      this.logger.error(`Failed to update wallet: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('select_wallet')
  async handleSelectWallet(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { id: string },
  ) {
    try {
      const wallet = await this.paymentsService.selectWallet(data.id);

      // Broadcast to all operators - wallet selection changed
      this.emitToAll('wallet_selected', {
        wallet,
        timestamp: new Date().toISOString(),
      });

      return { success: true, data: wallet };
    } catch (error) {
      this.logger.error(`Failed to select wallet: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('delete_wallet')
  async handleDeleteWallet(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { id: string },
  ) {
    try {
      await this.paymentsService.deleteWallet(data.id);

      // Broadcast to all operators
      this.emitToAll('wallet_deleted', {
        id: data.id,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete wallet: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('empty_wallet')
  async handleEmptyWallet(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { id: string },
  ) {
    try {
      const userId = this.getOperatorId(client);
      if (!userId) return { success: false, error: 'Not authenticated' };

      const wallet = await this.paymentsService.markWalletAsEmpty(data.id);

      this.emitToAll('wallet_updated', wallet);
      this.emitToAll('wallet_emptied', {
        wallet,
        timestamp: new Date().toISOString(),
      });

      return { success: true, data: wallet };
    } catch (error) {
      this.logger.error(`Failed to empty wallet: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ==========================================
  // PANEL BALANCE ALERTS
  // ==========================================

  @SubscribeMessage('mute_panel_balance_alert')
  async handleMutePanelBalanceAlert(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { panelId?: string; mute: boolean },
  ) {
    const userId = this.getOperatorId(client);
    if (!userId) return { success: false, error: 'Not authenticated' };

    const key = data.panelId || 'default';
    this.botService.mutePanelBalanceAlert(key, data.mute);

    this.emitToAll('panel_balance_alert_muted', {
      panelId: key,
      muted: data.mute,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  // ==========================================
  // USER MANAGEMENT
  // ==========================================

  @SubscribeMessage('update_username')
  async handleUpdateUsername(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; username: string },
  ) {
    try {
      const result = await this.usersService.updateUsername(
        data.userId,
        data.username,
      );

      // Broadcast to all operators (use user_updated which operator panel already listens for)
      this.emitToAll('user_updated', result.user);

      return { success: true, data: result };
    } catch (error) {
      this.logger.error(`Failed to update username: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('get_activity_log')
  async handleGetActivityLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { limit?: number },
  ) {
    try {
      const activity = await this.dashboardService.getRecentActivity(
        data?.limit || 50,
      );
      return { success: true, data: activity };
    } catch (error) {
      this.logger.error(`Failed to get activity log: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('get_requests')
  async handleGetRequests(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { status?: string; limit?: number; offset?: number },
  ) {
    try {
      const userId = this.getOperatorId(client);
      if (!userId) return { success: false, error: 'Not authenticated' };

      const requests = await this.requestsService.findAll({
        status: data?.status as any,
        limit: data?.limit || 50,
        offset: data?.offset || 0,
      });
      return { success: true, data: requests };
    } catch (error) {
      this.logger.error(`Failed to get requests: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  @SubscribeMessage('get_clients')
  async handleGetClients(@ConnectedSocket() client: Socket) {
    try {
      const userId = this.getOperatorId(client);
      if (!userId) return { success: false, error: 'Not authenticated' };

      const clients = await this.usersService.getAllClients();
      return { success: true, data: clients };
    } catch (error) {
      this.logger.error(`Failed to get clients: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('toggle_user_active')
  async handleToggleUserActive(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; isActive: boolean },
  ) {
    try {
      const operatorId = this.getOperatorId(client);
      if (!operatorId) return { success: false, error: 'Not authenticated' };

      const user = await this.usersService.toggleUserActive(
        data.userId,
        data.isActive,
        operatorId,
      );

      this.emitToAll('user_updated', user);

      return { success: true, data: user };
    } catch (error) {
      this.logger.error(`Failed to toggle user active: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('create_panel_user')
  async handleCreatePanelUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUsername: string },
  ) {
    try {
      const operatorId = this.getOperatorId(client);
      if (!operatorId) return { success: false, error: 'Not authenticated' };

      const result = await this.usersService.requestCreateUser(
        data.targetUsername,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to create panel user: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ==========================================
  // TYPING INDICATOR
  // ==========================================

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const operatorId = this.getOperatorId(client);
    const operatorName = client.data.operatorName || 'Operador';

    // Emit operator typing to the /chats namespace (where chat app users are)
    const typingData = {
      chatId: data.chatId,
      userId: operatorId,
      operatorName,
      isTyping: true,
    };
    this.chatsGateway.emitToChatRoom(
      data.chatId,
      'operator_typing',
      typingData,
    );
    // Also emit to user room in case chat app hasn't joined the chat room
    this.eventsGateway.emitToChatRoom(
      data.chatId,
      'operator_typing',
      typingData,
    );

    return { success: true };
  }

  // ==========================================
  // BOT AI ACTIONS — REMOVED
  // ==========================================
  // The conversational AI in the operator panel was removed. Handlers that
  // were only used by that AI (bot:reply, bot:create_request, bot:process_proof,
  // bot:get_user_context, bot:save_username, bot:create_prize_claim,
  // bot:set_prize_payment, bot:show_card) have been deleted. The chat-app no
  // longer emits them (the user only uploads proofs). If a future feature needs
  // any of these patterns, restore from git history rather than reusing a
  // half-removed copy.

  /**
   * Operator processes a prize claim (VERIFIED → PROCESSING, triggers chip withdrawal)
   */
  @SubscribeMessage('operator:process_prize_claim')
  async handleProcessPrizeClaim(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { claimId: string },
  ) {
    try {
      if (!data.claimId) {
        return { success: false, error: 'claimId is required' };
      }
      const operatorId = this.requireOperatorId(client);
      const {
        PrizeClaimsService,
      } = require('../prize-claims/prize-claims.service');
      const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
        strict: false,
      });
      const result = await prizeClaimsService.process(data.claimId, operatorId);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error(
        `operator:process_prize_claim failed: ${error.message}`,
      );
      return { success: false, error: sanitizeError(error) };
    }
  }

  /**
   * Operator marks prize claim as paid (CHIPS_WITHDRAWN → COMPLETED)
   */
  @SubscribeMessage('operator:complete_prize_claim')
  async handleCompletePrizeClaim(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { claimId: string; proofUrl: string; proofType?: 'image' | 'pdf' },
  ) {
    try {
      if (!data.claimId) {
        return { success: false, error: 'claimId is required' };
      }
      if (!data.proofUrl) {
        return {
          success: false,
          error:
            'Adjuntá el comprobante de la transferencia (imagen o PDF) antes de marcar como pagado.',
        };
      }
      const operatorId = this.requireOperatorId(client);
      const {
        PrizeClaimsService,
      } = require('../prize-claims/prize-claims.service');
      const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
        strict: false,
      });
      const result = await prizeClaimsService.complete(
        data.claimId,
        operatorId,
        { proofUrl: data.proofUrl, proofType: data.proofType },
      );
      return { success: true, data: result };
    } catch (error) {
      this.logger.error(
        `operator:complete_prize_claim failed: ${error.message}`,
      );
      return { success: false, error: sanitizeError(error) };
    }
  }

  /**
   * Operator changes a user's saved panel-game username (support flow: when
   * auto-creation failed because the chosen name was already taken on the panel).
   * Backend resets the user's panelId binding and auto-retries the latest FAILED
   * request via DiscoveryService.
   */
  @SubscribeMessage('operator:set_user_target_username')
  async handleSetUserTargetUsername(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; savedTargetUsername: string },
  ) {
    try {
      if (!data?.userId || !data?.savedTargetUsername) {
        return {
          success: false,
          error: 'userId y savedTargetUsername son requeridos',
        };
      }
      this.requireOperatorId(client);
      const { UsersService } = require('../users/users.service');
      const usersService = this.moduleRef.get(UsersService, { strict: false });
      const result = await usersService.changeSavedTargetUsernameWithRetry(
        data.userId,
        data.savedTargetUsername,
      );
      return { success: true, data: result };
    } catch (error) {
      this.logger.error(
        `operator:set_user_target_username failed: ${error.message}`,
      );
      return { success: false, error: sanitizeError(error) };
    }
  }

  /**
   * Operator fetches panel-game credentials for a user (for support).
   * Every read is audited inside UsersService.getPanelInfoForOperator.
   */
  @SubscribeMessage('operator:get_user_panel_info')
  async handleGetUserPanelInfo(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    try {
      if (!data?.userId) {
        return { success: false, error: 'userId is required' };
      }
      const operatorId = this.requireOperatorId(client);
      const { UsersService } = require('../users/users.service');
      const usersService = this.moduleRef.get(UsersService, { strict: false });
      const result = await usersService.getPanelInfoForOperator(
        data.userId,
        operatorId,
      );
      return { success: true, data: result };
    } catch (error) {
      this.logger.error(
        `operator:get_user_panel_info failed: ${error.message}`,
      );
      return { success: false, error: sanitizeError(error) };
    }
  }

  /**
   * Operator rejects a prize claim
   */
  @SubscribeMessage('operator:reject_prize_claim')
  async handleRejectPrizeClaim(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { claimId: string; reason: string },
  ) {
    try {
      if (!data.claimId) {
        return { success: false, error: 'claimId is required' };
      }
      const operatorId = this.requireOperatorId(client);
      const {
        PrizeClaimsService,
      } = require('../prize-claims/prize-claims.service');
      const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
        strict: false,
      });
      const result = await prizeClaimsService.reject(data.claimId, operatorId, {
        reason: data.reason || 'Rechazado por operador',
      });
      return { success: true, data: result };
    } catch (error) {
      this.logger.error(`operator:reject_prize_claim failed: ${error.message}`);
      return { success: false, error: sanitizeError(error) };
    }
  }

  /**
   * Get prize claims list (for operator initial data)
   */
  @SubscribeMessage('get_prize_claims')
  async handleGetPrizeClaims(@ConnectedSocket() client: Socket) {
    try {
      const {
        PrizeClaimsService,
      } = require('../prize-claims/prize-claims.service');
      const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
        strict: false,
      });
      const claims = await prizeClaimsService.findPending();
      return { success: true, data: claims };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  // ==========================================
  // OUTBOUND PAYMENTS
  // ==========================================

  @SubscribeMessage('confirm_outbound_payment')
  async handleConfirmOutboundPayment(
    @MessageBody() data: { paymentId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data?.userId;
    if (!userId) return { success: false, error: 'Auth required' };
    try {
      const {
        OutboundPaymentsService,
      } = require('../outbound-payments/outbound-payments.service');
      const service = this.moduleRef.get(OutboundPaymentsService, {
        strict: false,
      });
      const result = await service.confirm(data.paymentId, userId);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  @SubscribeMessage('cancel_outbound_payment')
  async handleCancelOutboundPayment(
    @MessageBody() data: { paymentId: string; reason: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data?.userId;
    if (!userId) return { success: false, error: 'Auth required' };
    try {
      const {
        OutboundPaymentsService,
      } = require('../outbound-payments/outbound-payments.service');
      const service = this.moduleRef.get(OutboundPaymentsService, {
        strict: false,
      });
      const result = await service.cancel(
        data.paymentId,
        userId,
        data.reason || 'Cancelled by operator',
      );
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  @SubscribeMessage('retry_outbound_payment')
  async handleRetryOutboundPayment(
    @MessageBody() data: { paymentId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data?.userId;
    if (!userId) return { success: false, error: 'Auth required' };
    try {
      const {
        OutboundPaymentsService,
      } = require('../outbound-payments/outbound-payments.service');
      const service = this.moduleRef.get(OutboundPaymentsService, {
        strict: false,
      });
      const result = await service.retry(data.paymentId, userId);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  @SubscribeMessage('buy_crypto')
  async handleBuyCrypto(
    @MessageBody() data: { walletId: string; amount: number },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data?.userId;
    if (!userId) return { success: false, error: 'Auth required' };
    try {
      const {
        OutboundPaymentsService,
      } = require('../outbound-payments/outbound-payments.service');
      const service = this.moduleRef.get(OutboundPaymentsService, {
        strict: false,
      });
      const result = await service.buyCrypto(data, userId);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Event listeners for outbound payment status changes
  @OnEvent('outbound_payment.created')
  onOutboundPaymentCreated(payment: any) {
    this.emitToAll('outbound_payment_created', payment);
  }

  @OnEvent('outbound_payment.confirmed')
  onOutboundPaymentConfirmed(payment: any) {
    this.emitToAll('outbound_payment_updated', payment);
  }

  @OnEvent('outbound_payment.completed')
  onOutboundPaymentCompleted(data: any) {
    this.emitToAll('outbound_payment_completed', data);
    // Notify user via chat
    if (data.userId) {
      const msg = data.operationNumber
        ? `Tu premio fue pagado! Nro de operacion: ${data.operationNumber}`
        : 'Tu premio fue pagado!';
      try {
        this.eventsGateway.emitToUser(data.userId, 'prize_claim:payment_sent', {
          prizeClaimId: data.prizeClaimId,
          operationNumber: data.operationNumber,
          message: msg,
        });
      } catch {}
    }
  }

  @OnEvent('outbound_payment.failed')
  onOutboundPaymentFailed(data: any) {
    this.emitToAll('outbound_payment_failed', data);
  }

  @OnEvent('outbound_payment.cancelled')
  onOutboundPaymentCancelled(data: any) {
    this.emitToAll('outbound_payment_updated', data);
  }

  // ==========================================
  // EMIT METHODS (called by other services via EventsGateway bridge)
  // ==========================================

  emitToAll(event: string, data: any) {
    this.server?.emit(event, data);
  }

  emitValidationFailed(data: any) {
    this.emitToAll('validation_failed', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  emitJobFailed(data: any) {
    this.emitToAll('job_failed', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  emitJobStatus(data: any) {
    this.emitToAll('job_status', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  emitNewMessage(data: any) {
    this.emitToAll('new_message', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  emitHelpRequested(data: {
    chatId: string;
    userId: string;
    context: string;
    message: string;
    requestedAt: string;
    username: string;
  }) {
    this.emitToAll('chat:help_requested', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  emitNewChat(data: any) {
    this.emitToAll('chat:new', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  emitStatsUpdate(data: any) {
    this.emitToAll('stats_update', data);
  }

  emitProofUploaded(data: any) {
    this.emitToAll('proof:uploaded', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  emitDispatchBlocked(data: {
    jobId: string;
    reason: string;
    timestamp: string;
  }) {
    this.emitToAll('dispatch_blocked', data);
  }

  emitSystemAlert(data: {
    type: string;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    details?: any;
  }) {
    this.emitToAll('system_alert', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  getConnectedCount(): number {
    return this.connectedOperators.size;
  }
}
