import { Injectable, Logger, Inject, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { BotGateway } from '../bot/bot.gateway';
import { EventsGateway } from '../events/events.gateway';

interface DiscoveryState {
  taskId: string;            // requestId (request discovery) or userId (user discovery)
  requestId?: string;        // Only present for request-based discovery
  targetUsername: string;
  userId: string;
  sentTo: string[];          // panelIds that received search_user
  responses: Record<string, boolean>;  // panelId → found
  busyPanels: string[];      // panels that were busy (need retry)
  status: 'IN_PROGRESS' | 'FOUND' | 'NOT_FOUND' | 'FAILED' | 'CREATING_USER';
  foundPanelId?: string;
  pendingCreationPanelId?: string;  // Panel where creation should retry when idle
  timeoutTimer: ReturnType<typeof setTimeout>;
  createdAt: Date;
}

const DISCOVERY_TIMEOUT_MS = 60_000; // 60 seconds

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  // In-memory discovery state (taskId → state)
  // taskId = requestId (request discovery) or userId (user discovery)
  // If server restarts during discovery, request stays APPROVED and operator can re-trigger
  private discoveries: Map<string, DiscoveryState> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Start discovery for a request that has no panelId.
   * Sends search_user to all idle panel bots.
   */
  async startDiscovery(requestId: string, targetUsername: string, userId: string): Promise<void> {
    const taskId = requestId;
    // Check if discovery already in progress for this request
    if (this.discoveries.has(taskId)) {
      this.logger.warn(`Discovery already in progress for request ${requestId}`);
      return;
    }

    // Check if another discovery is already running for the same username (prevents user-level vs request-level race)
    const existingDiscovery = Array.from(this.discoveries.values()).find(
      d => d.targetUsername.toLowerCase() === targetUsername.toLowerCase() &&
           (d.status === 'IN_PROGRESS' || d.status === 'CREATING_USER'),
    );
    if (existingDiscovery) {
      this.logger.log(
        `Discovery already in progress for "${targetUsername}" (task ${existingDiscovery.taskId}), ` +
        `attaching request ${requestId} to existing discovery`,
      );
      // Attach this request to the existing discovery so it gets the job when resolved
      if (!existingDiscovery.requestId) {
        existingDiscovery.requestId = requestId;
      }
      return;
    }

    this.logger.log(`Starting discovery for "${targetUsername}" (request ${requestId})`);

    // Send search to idle panels
    const sentTo = this.botGateway.pushDiscoveryToIdlePanels(taskId, targetUsername);

    // Track which panels were busy (for retry later)
    const allConnected = this.botGateway.getConnectedPanelIds();
    const busyPanels = allConnected.filter(id => !sentTo.includes(id));

    if (sentTo.length === 0 && busyPanels.length === 0) {
      this.logger.error(`No bots connected for discovery of "${targetUsername}"`);
      this.eventsGateway.emitToOperators('discovery_failed', {
        requestId,
        targetUsername,
        reason: 'No bots connected',
      });
      // Notify user
      this.eventsGateway.emitRequestUpdated(userId, {
        requestId,
        status: 'APPROVED',
        discoveryStatus: 'NO_BOTS',
        message: 'No hay servidores disponibles para buscar tu perfil. Un operador te va a ayudar.',
      });
      return;
    }

    // Set timeout
    const timeoutTimer = setTimeout(() => {
      this.handleDiscoveryTimeout(taskId);
    }, DISCOVERY_TIMEOUT_MS);

    // Store state
    this.discoveries.set(taskId, {
      taskId,
      requestId,
      targetUsername,
      userId,
      sentTo,
      responses: {},
      busyPanels,
      status: 'IN_PROGRESS',
      timeoutTimer,
      createdAt: new Date(),
    });

    // Notify operators
    this.eventsGateway.emitToOperators('discovery_started', {
      requestId,
      targetUsername,
      queriedPanels: sentTo,
      busyPanels,
    });

    // Notify user — "looking for your profile"
    this.eventsGateway.emitRequestUpdated(userId, {
      requestId,
      status: 'APPROVED',
      discoveryStatus: 'SEARCHING',
      message: 'Buscando tu perfil en los servidores...',
    });

    this.logger.log(`Discovery sent to ${sentTo.length} panel(s), ${busyPanels.length} busy panel(s) pending`);
  }

  /**
   * Discover which panel a user belongs to (triggered when savedTargetUsername is set).
   * Lightweight version of startDiscovery — no request needed.
   * If user not found on any panel, auto-creates on DEFAULT_NEW_USER_PANEL_ID.
   */
  async discoverUser(userId: string, targetUsername: string): Promise<void> {
    const taskId = `user-${userId}`;

    // Check if user already has a panel
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { panelId: true },
    });
    if (user?.panelId) {
      this.logger.log(`User ${userId} already has panelId ${user.panelId}, skipping discovery`);
      return;
    }

    // Check if discovery already in progress for this user
    if (this.discoveries.has(taskId)) {
      this.logger.warn(`Discovery already in progress for user ${userId}`);
      return;
    }

    this.logger.log(`Starting user discovery for "${targetUsername}" (user ${userId})`);

    const sentTo = this.botGateway.pushDiscoveryToIdlePanels(taskId, targetUsername);
    const allConnected = this.botGateway.getConnectedPanelIds();
    const busyPanels = allConnected.filter(id => !sentTo.includes(id));

    if (sentTo.length === 0 && busyPanels.length === 0) {
      this.logger.error(`No bots connected for user discovery of "${targetUsername}"`);
      this.eventsGateway.emitToOperators('discovery_failed', {
        targetUsername,
        userId,
        reason: 'No hay bots conectados para verificar el usuario en el panel',
      });
      return;
    }

    const timeoutTimer = setTimeout(() => {
      this.handleDiscoveryTimeout(taskId);
    }, DISCOVERY_TIMEOUT_MS);

    this.discoveries.set(taskId, {
      taskId,
      // No requestId — this is a user-level discovery
      targetUsername,
      userId,
      sentTo,
      responses: {},
      busyPanels,
      status: 'IN_PROGRESS',
      timeoutTimer,
      createdAt: new Date(),
    });

    this.eventsGateway.emitToOperators('discovery_started', {
      taskId,
      targetUsername,
      queriedPanels: sentTo,
      busyPanels,
      type: 'user_discovery',
    });

    this.logger.log(`User discovery sent to ${sentTo.length} panel(s), ${busyPanels.length} busy`);
  }

  /**
   * Handle discovery result from an extension.
   * Called via POST /bot/discovery/:taskId/result
   */
  async handleDiscoveryResult(
    taskId: string,
    panelId: string,
    found: boolean,
    busy?: boolean,
    error?: string,
  ): Promise<{ success: boolean; message: string }> {
    const state = this.discoveries.get(taskId);
    if (!state) {
      this.logger.warn(`Discovery result for unknown task ${taskId} (panel ${panelId})`);
      return { success: false, message: 'Discovery task not found or already completed' };
    }

    if (state.status !== 'IN_PROGRESS') {
      this.logger.warn(`Discovery ${taskId} already resolved (${state.status}), ignoring result from ${panelId}`);
      return { success: true, message: 'Discovery already resolved' };
    }

    // If bot was busy, add to busy list for retry
    if (busy) {
      if (!state.busyPanels.includes(panelId)) {
        state.busyPanels.push(panelId);
      }
      this.logger.log(`Panel ${panelId} reported busy for discovery ${taskId}`);
      return { success: true, message: 'Noted as busy' };
    }

    // Record response
    state.responses[panelId] = found;

    if (error) {
      this.logger.warn(`Panel ${panelId} error during discovery: ${error}`);
    }

    if (found) {
      // FOUND — first responder wins
      return this.resolveDiscovery(state, panelId);
    }

    // Check if all queried panels have responded
    const allResponded = state.sentTo.every(id => id in state.responses);

    if (allResponded) {
      // All queried panels responded NOT_FOUND
      if (state.busyPanels.length > 0) {
        // There are still busy panels to check — wait for timeout or retry
        this.logger.log(`All queried panels returned NOT_FOUND, ${state.busyPanels.length} busy panel(s) pending retry`);
        return { success: true, message: 'Waiting for busy panels to become available' };
      }

      // All panels checked, none found
      return this.failDiscovery(state, 'Username not found on any panel');
    }

    return { success: true, message: 'Response recorded, waiting for other panels' };
  }

  /**
   * Retry discovery for panels that were busy when originally requested.
   * Called when a panel finishes its job and becomes idle.
   */
  async retryPendingDiscoveries(nowIdlePanelId: string): Promise<void> {
    for (const [taskId, state] of this.discoveries) {
      // Retry pending searches (IN_PROGRESS with busy panels)
      if (state.status === 'IN_PROGRESS' && state.busyPanels.includes(nowIdlePanelId) && state.responses[nowIdlePanelId] === undefined) {
        this.logger.log(`Retrying discovery ${taskId} with now-idle panel ${nowIdlePanelId}`);

        const sent = this.botGateway.pushDiscoveryToIdlePanels(taskId, state.targetUsername);
        if (sent.includes(nowIdlePanelId)) {
          state.busyPanels = state.busyPanels.filter(id => id !== nowIdlePanelId);
          if (!state.sentTo.includes(nowIdlePanelId)) {
            state.sentTo.push(nowIdlePanelId);
          }
          this.logger.log(`Discovery ${taskId} retry sent to panel ${nowIdlePanelId}`);
        }
      }

      // Retry pending user creations (CREATING_USER with busy panel)
      if (state.status === 'CREATING_USER' && state.pendingCreationPanelId === nowIdlePanelId) {
        this.logger.log(`Retrying user creation for "${state.targetUsername}" on now-idle panel ${nowIdlePanelId}`);
        state.pendingCreationPanelId = undefined;

        const sent = this.botGateway.pushCreateUserToPanel(nowIdlePanelId, {
          taskId: state.taskId,
          targetUsername: state.targetUsername,
        });

        if (sent) {
          this.logger.log(`User creation retry sent to panel ${nowIdlePanelId}`);
        } else {
          // Still can't send — re-mark for next retry
          state.pendingCreationPanelId = nowIdlePanelId;
          this.logger.warn(`Panel ${nowIdlePanelId} still unavailable for create_user retry`);
        }
      }
    }
  }

  /**
   * Handle discovery timeout
   */
  private async handleDiscoveryTimeout(taskId: string): Promise<void> {
    const state = this.discoveries.get(taskId);
    if (!state || state.status !== 'IN_PROGRESS') return;

    this.logger.warn(`Discovery ${taskId} timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s`);

    // Check if there are unchecked panels
    const unchecked = state.busyPanels.filter(id => !(id in state.responses));
    if (unchecked.length > 0) {
      this.logger.warn(`${unchecked.length} panel(s) were never checked: ${unchecked.join(', ')}`);
    }

    await this.failDiscovery(state, `Discovery timed out — ${Object.keys(state.responses).length} panel(s) checked, ${unchecked.length} unchecked`);
  }

  /**
   * Resolve discovery — user found on a panel
   */
  private async resolveDiscovery(state: DiscoveryState, foundPanelId: string): Promise<{ success: boolean; message: string }> {
    // Optimistic lock — only update if still IN_PROGRESS
    if (state.status !== 'IN_PROGRESS') {
      return { success: true, message: 'Discovery already resolved' };
    }

    state.status = 'FOUND';
    state.foundPanelId = foundPanelId;
    clearTimeout(state.timeoutTimer);

    this.logger.log(`Discovery resolved: "${state.targetUsername}" found on panel ${foundPanelId}`);

    // Update User.panelId (cache for future requests)
    await this.prisma.user.update({
      where: { id: state.userId },
      data: { panelId: foundPanelId },
    });

    // If this is a request-based discovery, also update Request and create Job
    if (state.requestId) {
      await this.prisma.request.update({
        where: { id: state.requestId },
        data: { panelId: foundPanelId },
      });

      // Create the job via JobsService (lazy-loaded via ModuleRef to avoid circular dep)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { JobsService } = require('../jobs/jobs.service');
        const jobsService = this.moduleRef.get(JobsService, { strict: false });
        await jobsService.createJobForRequest(state.requestId);
        this.logger.log(`Job created for request ${state.requestId} after discovery (panel ${foundPanelId})`);
      } catch (error: any) {
        this.logger.error(`Failed to create job after discovery: ${error.message}`);
        this.eventsGateway.emitToOperators('discovery_job_creation_failed', {
          requestId: state.requestId,
          panelId: foundPanelId,
          error: error.message,
        });
      }

      // Notify user about request progress
      this.eventsGateway.emitRequestUpdated(state.userId, {
        requestId: state.requestId,
        status: 'APPROVED',
        discoveryStatus: 'FOUND',
        message: '¡Perfil encontrado! Preparando carga de fichas...',
      });
    }

    // Notify operators
    this.eventsGateway.emitToOperators('discovery_completed', {
      taskId: state.taskId,
      requestId: state.requestId,
      targetUsername: state.targetUsername,
      foundPanelId,
    });

    // Clean up after a delay
    setTimeout(() => this.discoveries.delete(state.taskId), 30_000);

    return { success: true, message: `User found on panel ${foundPanelId}` };
  }

  /**
   * Fail discovery — user not found on any panel.
   * Before actually failing, attempts auto-creation if DEFAULT_NEW_USER_PANEL_ID is configured.
   */
  private async failDiscovery(state: DiscoveryState, reason: string): Promise<{ success: boolean; message: string }> {
    clearTimeout(state.timeoutTimer);

    // Check if another discovery already resolved this user (DB check prevents duplicates)
    try {
      const freshUser = await this.prisma.user.findUnique({
        where: { id: state.userId },
        select: { panelId: true },
      });
      if (freshUser?.panelId) {
        this.logger.log(`User "${state.targetUsername}" already has panelId ${freshUser.panelId} (resolved by another discovery)`);
        return this.resolveDiscovery(state, freshUser.panelId);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to check user panelId: ${err.message}`);
    }

    // Check if auto-creation is enabled
    let autoCreationReason: string | undefined;
    try {
      const { SettingsService } = require('../settings/settings.service');
      const settingsService = this.moduleRef.get(SettingsService, { strict: false });
      const newUserPanelId = await settingsService.getSetting('DEFAULT_NEW_USER_PANEL_ID');
      if (newUserPanelId) {
        // Check that the designated panel has a connected bot
        const botConnected = this.botGateway.isBotConnectedForPanel(newUserPanelId);
        if (botConnected) {
          // Check for duplicate creation attempts (same username already being created)
          const alreadyCreating = Array.from(this.discoveries.values()).some(
            d => d.status === 'CREATING_USER' &&
                 d.targetUsername.toLowerCase() === state.targetUsername.toLowerCase() &&
                 d.taskId !== state.taskId,
          );
          if (!alreadyCreating) {
            return this.triggerUserCreation(state, newUserPanelId);
          }
          autoCreationReason = 'already_creating';
          this.logger.warn(`User creation already in progress for "${state.targetUsername}", falling through to fail`);
        } else {
          autoCreationReason = 'bot_disconnected';
          this.logger.warn(`Designated panel ${newUserPanelId} has no bot connected — cannot auto-create user`);
        }
      } else {
        autoCreationReason = 'not_configured';
        this.logger.warn(
          `DEFAULT_NEW_USER_PANEL_ID is not configured — auto-creation disabled. ` +
          `Set it in Settings to enable auto-creation for new users.`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`Failed to check auto-creation setting: ${error.message}`);
    }

    // Actual failure path
    state.status = 'NOT_FOUND';

    this.logger.warn(`Discovery failed for "${state.targetUsername}": ${reason}`);

    // Update request status to FAILED (only if request-based discovery)
    if (state.requestId) {
      try {
        await this.prisma.request.update({
          where: { id: state.requestId },
          data: { status: 'FAILED' },
        });

        await this.prisma.requestStatusHistory.create({
          data: {
            requestId: state.requestId,
            status: 'FAILED',
            changedBy: 'system-discovery',
            metadata: {
              reason,
              checkedPanels: Object.keys(state.responses),
              busyPanels: state.busyPanels,
            },
          },
        });
      } catch (error: any) {
        this.logger.error(`Failed to update request status after discovery failure: ${error.message}`);
      }

      // Notify user about request failure
      this.eventsGateway.emitRequestUpdated(state.userId, {
        requestId: state.requestId,
        status: 'FAILED',
        discoveryStatus: 'NOT_FOUND',
        message: 'No pudimos encontrar tu perfil en los servidores. Un operador va a revisar tu solicitud.',
      });
    }

    // Notify operators (include auto-creation skip reason for debugging)
    this.eventsGateway.emitToOperators('discovery_failed', {
      taskId: state.taskId,
      requestId: state.requestId,
      targetUsername: state.targetUsername,
      reason,
      checkedPanels: state.responses,
      autoCreationSkipped: true,
      autoCreationReason,
    });

    // Clean up
    setTimeout(() => this.discoveries.delete(state.taskId), 30_000);

    return { success: true, message: reason };
  }

  // ==========================================
  // RETRY FAILED REQUEST (operator action)
  // ==========================================

  /**
   * Retry discovery for a FAILED request.
   * If user already has a panelId, re-queues the job directly.
   * Otherwise restarts discovery (which will auto-create if configured).
   */
  async retryDiscoveryForRequest(requestId: string): Promise<{ success: boolean; message: string }> {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { id: true, panelId: true } } },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'FAILED') {
      throw new BadRequestException('Solo se pueden reintentar solicitudes en estado FAILED');
    }

    const targetUsername = request.targetUsername;
    const userId = request.userId;

    // If user already has a panelId (maybe operator created them manually), just re-queue
    if (request.user?.panelId) {
      await this.prisma.request.update({
        where: { id: requestId },
        data: { status: 'APPROVED', panelId: request.user.panelId },
      });
      const { JobsService } = require('../jobs/jobs.service');
      const jobsService = this.moduleRef.get(JobsService, { strict: false });
      await jobsService.createJobForRequest(requestId);
      return { success: true, message: 'Usuario ya tiene panel asignado, job re-encolado' };
    }

    // Reset request to APPROVED so discovery can re-process it
    await this.prisma.request.update({
      where: { id: requestId },
      data: { status: 'APPROVED' },
    });

    // Start discovery (which will auto-create if DEFAULT_NEW_USER_PANEL_ID is configured)
    await this.startDiscovery(requestId, targetUsername, userId);
    return { success: true, message: 'Discovery reiniciado para la solicitud' };
  }

  // ==========================================
  // USER AUTO-CREATION (when not found on any panel)
  // ==========================================

  /**
   * Trigger user creation on the designated panel.
   * Called from failDiscovery when DEFAULT_NEW_USER_PANEL_ID is configured.
   */
  private async triggerUserCreation(state: DiscoveryState, panelId: string): Promise<{ success: boolean; message: string }> {
    state.status = 'CREATING_USER';

    this.logger.log(`Triggering user creation for "${state.targetUsername}" on panel ${panelId}`);

    const sent = this.botGateway.pushCreateUserToPanel(panelId, {
      taskId: state.taskId,
      targetUsername: state.targetUsername,
    });

    if (!sent) {
      // Panel is busy or disconnected — mark for retry when panel becomes idle
      this.logger.warn(`Panel ${panelId} unavailable for create_user, will retry when idle`);
      state.pendingCreationPanelId = panelId;
      // Keep status as CREATING_USER and let timeout handle if retry never happens
      return { success: true, message: `Panel busy, will retry create_user when idle` };
    }

    // Set creation timeout (60s)
    state.timeoutTimer = setTimeout(() => {
      this.handleCreationTimeout(state.taskId);
    }, DISCOVERY_TIMEOUT_MS);

    // Notify operators
    this.eventsGateway.emitToOperators('discovery_creating_user', {
      taskId: state.taskId,
      requestId: state.requestId,
      targetUsername: state.targetUsername,
      panelId,
    });

    // Notify user (only if request-based)
    if (state.requestId) {
      this.eventsGateway.emitRequestUpdated(state.userId, {
        requestId: state.requestId,
        status: 'APPROVED',
        discoveryStatus: 'CREATING_USER',
        message: 'Creando tu cuenta en el servidor...',
      });
    }

    return { success: true, message: `Creating user on panel ${panelId}` };
  }

  /**
   * Handle creation timeout
   */
  private async handleCreationTimeout(taskId: string): Promise<void> {
    const state = this.discoveries.get(taskId);
    if (!state || state.status !== 'CREATING_USER') return;

    this.logger.warn(`User creation timed out for "${state.targetUsername}"`);

    state.status = 'NOT_FOUND';
    clearTimeout(state.timeoutTimer);

    // Update request status to FAILED (only if request-based)
    if (state.requestId) {
      try {
        await this.prisma.request.update({
          where: { id: state.requestId },
          data: { status: 'FAILED' },
        });
      } catch (err) {
        this.logger.error(`Failed to update request ${state.requestId} status to FAILED: ${err?.message || err}`);
      }

      this.eventsGateway.emitRequestUpdated(state.userId, {
        requestId: state.requestId,
        status: 'FAILED',
        discoveryStatus: 'CREATION_TIMEOUT',
        message: 'No se pudo crear tu cuenta. Un operador va a revisar tu solicitud.',
      });
    }

    this.eventsGateway.emitToOperators('discovery_failed', {
      taskId: state.taskId,
      requestId: state.requestId,
      targetUsername: state.targetUsername,
      reason: 'User creation timed out',
    });

    setTimeout(() => this.discoveries.delete(state.taskId), 30_000);
  }

  /**
   * Handle user creation result from the extension.
   * Called via POST /bot/create-user/:taskId/result
   */
  async handleUserCreationResult(
    taskId: string,
    panelId: string,
    success: boolean,
    error?: string,
  ): Promise<{ success: boolean; message: string }> {
    const state = this.discoveries.get(taskId);
    if (!state) {
      this.logger.warn(`Creation result for unknown task ${taskId}`);
      return { success: false, message: 'Task not found' };
    }

    if (state.status !== 'CREATING_USER') {
      this.logger.warn(`Task ${taskId} not in CREATING_USER state (${state.status})`);
      return { success: true, message: 'Task already resolved' };
    }

    clearTimeout(state.timeoutTimer);

    if (!success) {
      this.logger.error(`User creation failed for "${state.targetUsername}": ${error}`);

      state.status = 'NOT_FOUND';

      if (state.requestId) {
        try {
          await this.prisma.request.update({
            where: { id: state.requestId },
            data: { status: 'FAILED' },
          });
        } catch (err) {
          this.logger.error(`Failed to update request ${state.requestId} status to FAILED: ${err?.message || err}`);
        }

        this.eventsGateway.emitRequestUpdated(state.userId, {
          requestId: state.requestId,
          status: 'FAILED',
          discoveryStatus: 'CREATION_FAILED',
          message: 'No se pudo crear tu cuenta. Un operador va a revisar tu solicitud.',
        });
      }

      this.eventsGateway.emitToOperators('discovery_failed', {
        taskId: state.taskId,
        requestId: state.requestId,
        targetUsername: state.targetUsername,
        reason: `User creation failed: ${error}`,
      });

      setTimeout(() => this.discoveries.delete(state.taskId), 30_000);
      return { success: true, message: `Creation failed: ${error}` };
    }

    // SUCCESS — user created on panel
    this.logger.log(`User "${state.targetUsername}" created successfully on panel ${panelId}`);

    state.status = 'FOUND';
    state.foundPanelId = panelId;

    // Update User.panelId
    await this.prisma.user.update({
      where: { id: state.userId },
      data: { panelId },
    });

    // Always notify user that their account was created (user-level or request-level)
    try {
      await this.sendWelcomeMessage(state.userId);
    } catch (welcomeError: any) {
      this.logger.warn(`Failed to send welcome message: ${welcomeError.message}`);
    }

    // If request-based discovery, also update Request and create Job
    if (state.requestId) {
      await this.prisma.request.update({
        where: { id: state.requestId },
        data: { panelId },
      });

      // Create LOAD_CREDITS job
      try {
        const { JobsService } = require('../jobs/jobs.service');
        const jobsService = this.moduleRef.get(JobsService, { strict: false });
        await jobsService.createJobForRequest(state.requestId);
        this.logger.log(`Job created for request ${state.requestId} after user creation (panel ${panelId})`);
      } catch (jobError: any) {
        this.logger.error(`Failed to create job after user creation: ${jobError.message}`);
        this.eventsGateway.emitToOperators('discovery_job_creation_failed', {
          requestId: state.requestId,
          panelId,
          error: jobError.message,
        });
      }

      this.eventsGateway.emitRequestUpdated(state.userId, {
        requestId: state.requestId,
        status: 'APPROVED',
        discoveryStatus: 'CREATED',
        message: '¡Cuenta creada! Preparando carga de fichas...',
      });
    }

    // Notify operators
    this.eventsGateway.emitToOperators('discovery_user_created', {
      taskId: state.taskId,
      requestId: state.requestId,
      targetUsername: state.targetUsername,
      panelId,
    });

    setTimeout(() => this.discoveries.delete(state.taskId), 30_000);

    return { success: true, message: `User created on panel ${panelId}` };
  }

  /**
   * Send password message to user's chat after account creation.
   */
  private async sendPasswordMessage(userId: string, requestId: string): Promise<void> {
    const PASSWORD = '123casino';
    const messageContent = `Tu cuenta fue creada exitosamente!\n\nTu contrasena es: ${PASSWORD}\n\nGuardala en un lugar seguro.`;

    // Find the chat for this request
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { chat: true },
    });

    if (!request?.chat?.id) {
      this.logger.warn(`No chat found for request ${requestId} — cannot send password message`);
      return;
    }

    // Use MessagesService.sendSystemMessage for consistency
    try {
      const { MessagesService } = require('../messages/messages.service');
      const messagesService = this.moduleRef.get(MessagesService, { strict: false });
      await messagesService.sendSystemMessage(request.chat.id, messageContent, requestId);
    } catch (error: any) {
      this.logger.error(`Failed to send password message via MessagesService: ${error.message}`);
    }

    this.logger.log(`Password message sent to user ${userId} for request ${requestId}`);
  }

  /**
   * Send welcome message when a new user's casino account is created.
   * Works without requestId — finds or creates the user's chat directly.
   */
  private async sendWelcomeMessage(userId: string): Promise<void> {
    const PASSWORD = '123casino';
    const content = `Bienvenido! Tu cuenta fue creada en el casino.\n\nTu contrasena es: ${PASSWORD}\nGuardala en un lugar seguro.\n\nYa podes cargar fichas y empezar a jugar!`;

    // Find or create chat for user
    let chat = await this.prisma.chat.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (!chat) {
      chat = await this.prisma.chat.create({
        data: { userId, status: 'OPEN' },
        select: { id: true },
      });
    }

    try {
      const { MessagesService } = require('../messages/messages.service');
      const messagesService = this.moduleRef.get(MessagesService, { strict: false });
      await messagesService.sendSystemMessage(chat.id, content);
    } catch (error: any) {
      this.logger.error(`Failed to send welcome message via MessagesService: ${error.message}`);
    }

    this.logger.log(`Welcome message sent to user ${userId}`);
  }

  /**
   * Get active discovery tasks (for monitoring)
   */
  getActiveDiscoveries(): Array<{
    requestId: string;
    targetUsername: string;
    status: string;
    sentTo: string[];
    responses: Record<string, boolean>;
    busyPanels: string[];
    age: number;
  }> {
    return Array.from(this.discoveries.values())
      .filter(d => d.status === 'IN_PROGRESS')
      .map(d => ({
        requestId: d.requestId ?? '',
        targetUsername: d.targetUsername,
        status: d.status,
        sentTo: d.sentTo,
        responses: d.responses,
        busyPanels: d.busyPanels,
        age: Date.now() - d.createdAt.getTime(),
      }));
  }
}
