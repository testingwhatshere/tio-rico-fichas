import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { BotGateway } from '../bot/bot.gateway';
import { EventsGateway } from '../events/events.gateway';

interface DiscoveryState {
  taskId: string; // requestId (request discovery) or userId (user discovery)
  requestId?: string; // Only present for request-based discovery
  targetUsername: string;
  userId: string;
  sentTo: string[]; // panelIds that received search_user
  responses: Record<string, boolean>; // panelId → found
  busyPanels: string[]; // panels that were busy (need retry)
  status: 'IN_PROGRESS' | 'FOUND' | 'NOT_FOUND' | 'FAILED' | 'CREATING_USER';
  foundPanelId?: string;
  pendingCreationPanelId?: string; // Panel where creation should retry when idle
  timeoutTimer: ReturnType<typeof setTimeout>;
  createdAt: Date;
}

const DISCOVERY_TIMEOUT_MS = 180_000; // 180s — gives margin for panels busy with long jobs

/**
 * Marker stored in Job.error when a job was failed because the user wasn't on the
 * assigned panel and re-discovery was triggered. JobsService.createJobForRequest
 * detects this marker and revives the job (instead of returning the stale FAILED row)
 * once re-discovery resolves to a new panel.
 */
export const REDISCOVERY_PENDING_MARKER = 'USER_NOT_FOUND_REDISCOVERY_PENDING';

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
   * discovery_failed must reach /operator (operator-panel + operator-mobile
   * connect there); emitToOperators alone only covers the root namespace.
   */
  private emitDiscoveryFailed(payload: Record<string, any>) {
    this.eventsGateway.emitToOperators('discovery_failed', payload);
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('discovery_failed', payload);
    } catch (err: any) {
      this.logger.warn(
        `Failed to emit discovery_failed to /operator: ${err?.message || err}`,
      );
    }
  }

  /**
   * Start discovery for a request that has no panelId.
   * Sends search_user to all idle panel bots.
   * If excludePanelId is given (re-discovery after a panel reported NOT_FOUND for a user
   * whose stale panelId pointed there), that panel is excluded from the search.
   */
  async startDiscovery(
    requestId: string,
    targetUsername: string,
    userId: string,
    excludePanelId?: string,
  ): Promise<void> {
    const taskId = requestId;
    // Check if discovery already in progress for this request
    if (this.discoveries.has(taskId)) {
      this.logger.warn(
        `Discovery already in progress for request ${requestId}`,
      );
      return;
    }

    // Check if another discovery is already running for the same username (prevents user-level vs request-level race)
    const existingDiscovery = Array.from(this.discoveries.values()).find(
      (d) =>
        d.targetUsername.toLowerCase() === targetUsername.toLowerCase() &&
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

    this.logger.log(
      `Starting discovery for "${targetUsername}" (request ${requestId})` +
        (excludePanelId ? ` — excluding panel ${excludePanelId}` : ''),
    );

    // Send search to idle panels (optionally excluding the stale panel)
    const sentTo = this.botGateway.pushDiscoveryToIdlePanels(
      taskId,
      targetUsername,
      excludePanelId,
    );

    // Track which panels were busy (for retry later) — also exclude the stale panel
    const allConnected = this.botGateway
      .getConnectedPanelIds()
      .filter((id) => id !== excludePanelId);
    const busyPanels = allConnected.filter((id) => !sentTo.includes(id));

    if (sentTo.length === 0 && busyPanels.length === 0) {
      this.logger.error(
        `No bots connected for discovery of "${targetUsername}"`,
      );
      // Seamless UX: do NOT notify the user. Alert operators only; they will
      // bring bots online or process the request manually. User keeps seeing the
      // last known state ("Pago verificado / Preparando la carga...") until resolution.
      this.emitDiscoveryFailed({
        requestId,
        targetUsername,
        reason: 'No bots connected',
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

    // Seamless UX: no user-facing message during discovery — the chat-app keeps showing
    // "Pago verificado / Preparando la carga de fichas..." until the job actually starts.

    this.logger.log(
      `Discovery sent to ${sentTo.length} panel(s), ${busyPanels.length} busy panel(s) pending`,
    );

    // Non-blocking coverage warning: if there are active panels with no bot connected,
    // emit an alert to operators so they know a panel is offline during discovery.
    // Does NOT block the flow — discovery continues with whatever is reachable.
    this.checkPanelCoverage(taskId, targetUsername, requestId).catch((err) => {
      this.logger.warn(`Panel coverage check failed: ${err?.message || err}`);
    });
  }

  /**
   * Fire-and-forget check that compares active panels in DB against currently connected
   * bots. If any active panel has no bot online, emit a warning to operators (the user
   * UX is unaffected — discovery still resolves with whatever panels did respond).
   */
  private async checkPanelCoverage(
    taskId: string,
    targetUsername: string,
    requestId?: string,
  ): Promise<void> {
    const activePanels = await this.prisma.panel.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    const connectedIds = new Set(this.botGateway.getConnectedPanelIds());
    const offline = activePanels.filter((p) => !connectedIds.has(p.id));
    if (offline.length === 0) return;

    this.logger.warn(
      `Discovery for "${targetUsername}" started with ${offline.length} panel(s) offline: ` +
        offline.map((p) => p.name).join(', '),
    );
    this.eventsGateway.emitToOperators('discovery_panel_offline_warning', {
      taskId,
      requestId,
      targetUsername,
      offlinePanels: offline.map((p) => ({ id: p.id, name: p.name })),
      onlinePanelCount: connectedIds.size,
      activePanelCount: activePanels.length,
    });
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
      this.logger.log(
        `User ${userId} already has panelId ${user.panelId}, skipping discovery`,
      );
      return;
    }

    // Check if discovery already in progress for this user
    if (this.discoveries.has(taskId)) {
      this.logger.warn(`Discovery already in progress for user ${userId}`);
      return;
    }

    // Same cross-check as startDiscovery: a request-level discovery for this
    // username may already be running. Without this, login + request could
    // run two discoveries in parallel and auto-create the user on TWO panels.
    const existingDiscovery = Array.from(this.discoveries.values()).find(
      (d) =>
        d.targetUsername.toLowerCase() === targetUsername.toLowerCase() &&
        (d.status === 'IN_PROGRESS' || d.status === 'CREATING_USER'),
    );
    if (existingDiscovery) {
      this.logger.log(
        `Discovery already in progress for "${targetUsername}" (task ${existingDiscovery.taskId}), skipping user-level discovery`,
      );
      return;
    }

    this.logger.log(
      `Starting user discovery for "${targetUsername}" (user ${userId})`,
    );

    const sentTo = this.botGateway.pushDiscoveryToIdlePanels(
      taskId,
      targetUsername,
    );
    const allConnected = this.botGateway.getConnectedPanelIds();
    const busyPanels = allConnected.filter((id) => !sentTo.includes(id));

    if (sentTo.length === 0 && busyPanels.length === 0) {
      this.logger.error(
        `No bots connected for user discovery of "${targetUsername}"`,
      );
      this.emitDiscoveryFailed({
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

    this.logger.log(
      `User discovery sent to ${sentTo.length} panel(s), ${busyPanels.length} busy`,
    );
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
    metadata?: {
      matched?: number;
      totalRows?: number;
      paginationVisible?: boolean;
      pageInfoText?: string;
      reason?: string;
    },
  ): Promise<{ success: boolean; message: string }> {
    const state = this.discoveries.get(taskId);
    if (!state) {
      this.logger.warn(
        `Discovery result for unknown task ${taskId} (panel ${panelId})`,
      );
      return {
        success: false,
        message: 'Discovery task not found or already completed',
      };
    }

    if (state.status !== 'IN_PROGRESS') {
      this.logger.warn(
        `Discovery ${taskId} already resolved (${state.status}), ignoring result from ${panelId}`,
      );
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

    // Log metadata for debugging (paginated tables, etc. — helps explain false-negatives)
    if (metadata) {
      this.logger.log(
        `Panel ${panelId} discovery details: found=${found}, matched=${metadata.matched}, ` +
          `rows=${metadata.totalRows}, paginated=${metadata.paginationVisible}, reason=${metadata.reason}, ` +
          `pageInfo="${metadata.pageInfoText || ''}"`,
      );
      // Surface paginated-table warning to operators: if a NOT_FOUND comes back from
      // a panel showing pagination, the user MIGHT be on another page — don't trust it
      // 100%. The autocreate coverage guard already prevents bad creates, but we want
      // operators to see this signal.
      if (!found && metadata.paginationVisible) {
        this.eventsGateway.emitToOperators('discovery_pagination_warning', {
          taskId,
          panelId,
          targetUsername: state.targetUsername,
          pageInfoText: metadata.pageInfoText,
        });
      }
    }

    if (found) {
      // FOUND — first responder wins
      return this.resolveDiscovery(state, panelId);
    }

    // Check if all queried panels have responded
    const allResponded = state.sentTo.every((id) => id in state.responses);

    if (allResponded) {
      // All queried panels responded NOT_FOUND
      if (state.busyPanels.length > 0) {
        // There are still busy panels to check — wait for timeout or retry
        this.logger.log(
          `All queried panels returned NOT_FOUND, ${state.busyPanels.length} busy panel(s) pending retry`,
        );
        return {
          success: true,
          message: 'Waiting for busy panels to become available',
        };
      }

      // All panels checked, none found
      return this.failDiscovery(state, 'Username not found on any panel');
    }

    return {
      success: true,
      message: 'Response recorded, waiting for other panels',
    };
  }

  /**
   * Retry discovery for panels that were busy when originally requested.
   * Called when a panel finishes its job and becomes idle.
   */
  async retryPendingDiscoveries(nowIdlePanelId: string): Promise<void> {
    for (const [taskId, state] of this.discoveries) {
      // Retry pending searches (IN_PROGRESS with busy panels)
      if (
        state.status === 'IN_PROGRESS' &&
        state.busyPanels.includes(nowIdlePanelId) &&
        state.responses[nowIdlePanelId] === undefined
      ) {
        this.logger.log(
          `Retrying discovery ${taskId} with now-idle panel ${nowIdlePanelId}`,
        );

        const sent = this.botGateway.pushDiscoveryToIdlePanels(
          taskId,
          state.targetUsername,
        );
        if (sent.includes(nowIdlePanelId)) {
          state.busyPanels = state.busyPanels.filter(
            (id) => id !== nowIdlePanelId,
          );
          if (!state.sentTo.includes(nowIdlePanelId)) {
            state.sentTo.push(nowIdlePanelId);
          }
          this.logger.log(
            `Discovery ${taskId} retry sent to panel ${nowIdlePanelId}`,
          );
        }
      }

      // Retry pending user creations (CREATING_USER with busy panel)
      if (
        state.status === 'CREATING_USER' &&
        state.pendingCreationPanelId === nowIdlePanelId
      ) {
        this.logger.log(
          `Retrying user creation for "${state.targetUsername}" on now-idle panel ${nowIdlePanelId}`,
        );
        state.pendingCreationPanelId = undefined;

        const sent = this.botGateway.pushCreateUserToPanel(nowIdlePanelId, {
          taskId: state.taskId,
          targetUsername: state.targetUsername,
        });

        if (sent) {
          this.logger.log(
            `User creation retry sent to panel ${nowIdlePanelId}`,
          );
        } else {
          // Still can't send — re-mark for next retry
          state.pendingCreationPanelId = nowIdlePanelId;
          this.logger.warn(
            `Panel ${nowIdlePanelId} still unavailable for create_user retry`,
          );
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

    this.logger.warn(
      `Discovery ${taskId} timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s`,
    );

    // Check if there are unchecked panels
    const unchecked = state.busyPanels.filter((id) => !(id in state.responses));
    if (unchecked.length > 0) {
      this.logger.warn(
        `${unchecked.length} panel(s) were never checked: ${unchecked.join(', ')}`,
      );
    }

    await this.failDiscovery(
      state,
      `Discovery timed out — ${Object.keys(state.responses).length} panel(s) checked, ${unchecked.length} unchecked`,
    );
  }

  /**
   * Resolve discovery — user found on a panel
   */
  private async resolveDiscovery(
    state: DiscoveryState,
    foundPanelId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Optimistic lock — only update if still IN_PROGRESS
    if (state.status !== 'IN_PROGRESS') {
      return { success: true, message: 'Discovery already resolved' };
    }

    state.status = 'FOUND';
    state.foundPanelId = foundPanelId;
    clearTimeout(state.timeoutTimer);

    this.logger.log(
      `Discovery resolved: "${state.targetUsername}" found on panel ${foundPanelId}`,
    );

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
        const { JobsService } = require('../jobs/jobs.service');
        const jobsService = this.moduleRef.get(JobsService, { strict: false });
        await jobsService.createJobForRequest(state.requestId);
        this.logger.log(
          `Job created for request ${state.requestId} after discovery (panel ${foundPanelId})`,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to create job after discovery: ${error.message}`,
        );
        this.eventsGateway.emitToOperators('discovery_job_creation_failed', {
          requestId: state.requestId,
          panelId: foundPanelId,
          error: error.message,
        });
      }

      // Seamless UX: no extra "FOUND" message — the chat-app will transition to
      // PROCESSING when the job starts, which is the next meaningful event for the user.
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
   *
   * Safety guard: if any connected panel hasn't responded yet (busy/slow/disconnected mid-search),
   * we DO NOT auto-create. Racing a slow panel that's actually where the user exists is what
   * caused the "created in panel 2 while user was in panel 3" incident. Mark FAILED and let the
   * operator review manually instead.
   */
  private async failDiscovery(
    state: DiscoveryState,
    reason: string,
  ): Promise<{ success: boolean; message: string }> {
    clearTimeout(state.timeoutTimer);

    // Check if another discovery already resolved this user (DB check prevents duplicates)
    try {
      const freshUser = await this.prisma.user.findUnique({
        where: { id: state.userId },
        select: { panelId: true },
      });
      if (freshUser?.panelId) {
        this.logger.log(
          `User "${state.targetUsername}" already has panelId ${freshUser.panelId} (resolved by another discovery)`,
        );
        return this.resolveDiscovery(state, freshUser.panelId);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to check user panelId: ${err.message}`);
    }

    // ----- COVERAGE GUARD: do not auto-create if any panel is still unanswered -----
    // A NOT_FOUND from N panels is only authoritative if EVERY connected panel responded.
    // If a busy panel never reported back (job still running, socket flapped, etc.) we
    // could auto-create on the wrong panel while the user actually exists where we never
    // looked. Always require full coverage before autocreate.
    const connectedPanels = this.botGateway.getConnectedPanelIds();
    const respondedPanels = new Set(Object.keys(state.responses));
    const unanswered = connectedPanels.filter((p) => !respondedPanels.has(p));

    let autoCreationReason: string | undefined;

    if (unanswered.length > 0) {
      autoCreationReason = 'panels_unanswered';
      this.logger.warn(
        `Discovery "${state.targetUsername}" failing with ${unanswered.length} panel(s) ` +
          `unanswered (${unanswered.join(', ')}) — skipping auto-create to avoid wrong-panel duplicate. ` +
          `Operator must review manually.`,
      );
    } else {
      // Full coverage: try auto-creation if configured
      try {
        const { SettingsService } = require('../settings/settings.service');
        const settingsService = this.moduleRef.get(SettingsService, {
          strict: false,
        });
        const newUserPanelId = await settingsService.getSetting(
          'DEFAULT_NEW_USER_PANEL_ID',
        );
        if (newUserPanelId) {
          // Check that the designated panel has a connected bot
          const botConnected =
            this.botGateway.isBotConnectedForPanel(newUserPanelId);
          if (botConnected) {
            // Check for duplicate creation attempts (same username already being created)
            const alreadyCreating = Array.from(this.discoveries.values()).some(
              (d) =>
                d.status === 'CREATING_USER' &&
                d.targetUsername.toLowerCase() ===
                  state.targetUsername.toLowerCase() &&
                d.taskId !== state.taskId,
            );
            if (!alreadyCreating) {
              return this.triggerUserCreation(state, newUserPanelId);
            }
            autoCreationReason = 'already_creating';
            this.logger.warn(
              `User creation already in progress for "${state.targetUsername}", falling through to fail`,
            );
          } else {
            autoCreationReason = 'bot_disconnected';
            this.logger.warn(
              `Designated panel ${newUserPanelId} has no bot connected — cannot auto-create user`,
            );
          }
        } else {
          autoCreationReason = 'not_configured';
          this.logger.warn(
            `DEFAULT_NEW_USER_PANEL_ID is not configured — auto-creation disabled. ` +
              `Set it in Settings to enable auto-creation for new users.`,
          );
        }
      } catch (error: any) {
        this.logger.warn(
          `Failed to check auto-creation setting: ${error.message}`,
        );
      }
    }

    // Actual failure path
    state.status = 'NOT_FOUND';

    this.logger.warn(
      `Discovery failed for "${state.targetUsername}": ${reason}`,
    );

    // Mark request FAILED in DB so the operator panel queue picks it up. Seamless UX:
    // we do NOT emit the FAILED transition to the user — the chat-app keeps the previous
    // "Pago verificado" state. When the operator resolves manually, the resulting event
    // will move the chat-app forward (e.g. job:started → PROCESSING → COMPLETED).
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
        this.logger.error(
          `Failed to update request status after discovery failure: ${error.message}`,
        );
      }
    }

    // Notify operators (include auto-creation skip reason for debugging)
    this.emitDiscoveryFailed({
      taskId: state.taskId,
      requestId: state.requestId,
      targetUsername: state.targetUsername,
      reason,
      checkedPanels: state.responses,
      unansweredPanels: unanswered,
      busyPanels: state.busyPanels,
      autoCreationSkipped: true,
      autoCreationReason,
    });

    // Clean up
    setTimeout(() => this.discoveries.delete(state.taskId), 30_000);

    return { success: true, message: reason };
  }

  // ==========================================
  // RE-DISCOVERY (user not found on assigned panel)
  // ==========================================

  /**
   * Called when the extension reports that the target username does not exist on
   * the panel the job was dispatched to. This happens when User.panelId is stale
   * (e.g. CSV preload picked a default panel, or a previous auto-creation landed
   * on the wrong one). We invalidate the stale panelId and re-run discovery on
   * every other connected panel — if the user actually exists somewhere, we find
   * it instead of creating a duplicate.
   */
  async handleUserNotFoundOnAssignedPanel(
    jobId: string,
    reportingPanelId: string,
  ): Promise<{ success: boolean; message: string }> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        request: {
          include: { user: { select: { id: true, panelId: true } } },
        },
      },
    });

    if (!job) {
      this.logger.warn(`user-not-found report for unknown job ${jobId}`);
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (!job.requestId || !job.request) {
      this.logger.warn(
        `user-not-found report for job ${jobId} without a request (type=${job.type}) — ignoring`,
      );
      return {
        success: false,
        message: 'Job has no request — re-discovery not applicable',
      };
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      this.logger.warn(
        `user-not-found report for job ${jobId} already in final state ${job.status} — ignoring`,
      );
      return { success: true, message: 'Job already in final state' };
    }

    const request = job.request;
    const userId = request.userId;
    const targetUsername = request.targetUsername;
    const stalePanelId = job.panelId;

    if (stalePanelId && stalePanelId !== reportingPanelId) {
      this.logger.warn(
        `Panel mismatch on user-not-found: job ${jobId} assigned to ${stalePanelId} but ` +
          `report came from ${reportingPanelId}. Trusting reporter.`,
      );
    }

    this.logger.log(
      `User "${targetUsername}" not found on panel ${reportingPanelId} (job ${jobId}) — ` +
        `invalidating stale panelId and re-running discovery on other panels`,
    );

    // 1. Mark the current job FAILED with the rediscovery marker. This satisfies the
    //    idempotency guard in BotService.handleJobResult so the bot's subsequent
    //    success=false report is silently ignored.
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: REDISCOVERY_PENDING_MARKER,
        completedAt: new Date(),
      },
    });

    // 2. Clear stale panelId on user and request so discovery doesn't loop right back here.
    if (request.user?.panelId === reportingPanelId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { panelId: null },
      });
    }
    await this.prisma.request.update({
      where: { id: request.id },
      data: { panelId: null, status: 'APPROVED' },
    });

    // 3. Record audit trail.
    try {
      await this.prisma.requestStatusHistory.create({
        data: {
          requestId: request.id,
          status: 'APPROVED',
          changedBy: 'system-rediscovery',
          metadata: {
            reason: 'user_not_found_on_assigned_panel',
            reportedBy: reportingPanelId,
            previousPanelId: stalePanelId,
            jobId,
          },
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to write rediscovery status history: ${err.message}`,
      );
    }

    // 4. Notify operators only. Seamless UX: the user keeps seeing the previous state
    //    (no "buscando en otros servidores" message that would reveal a problem).
    this.eventsGateway.emitToOperators('discovery_rediscovery_started', {
      requestId: request.id,
      jobId,
      targetUsername,
      excludedPanelId: reportingPanelId,
    });

    // 5. Fire discovery excluding the panel that already reported NOT_FOUND.
    await this.startDiscovery(
      request.id,
      targetUsername,
      userId,
      reportingPanelId,
    );

    return { success: true, message: 'Re-discovery triggered on other panels' };
  }

  // ==========================================
  // RETRY FAILED REQUEST (operator action)
  // ==========================================

  /**
   * Retry discovery for a FAILED request.
   * If user already has a panelId, re-queues the job directly.
   * Otherwise restarts discovery (which will auto-create if configured).
   */
  async retryDiscoveryForRequest(
    requestId: string,
  ): Promise<{ success: boolean; message: string }> {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { id: true, panelId: true } } },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'FAILED') {
      throw new BadRequestException(
        'Solo se pueden reintentar solicitudes en estado FAILED',
      );
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
      return {
        success: true,
        message: 'Usuario ya tiene panel asignado, job re-encolado',
      };
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
  private async triggerUserCreation(
    state: DiscoveryState,
    panelId: string,
  ): Promise<{ success: boolean; message: string }> {
    state.status = 'CREATING_USER';

    this.logger.log(
      `Triggering user creation for "${state.targetUsername}" on panel ${panelId}`,
    );

    const sent = this.botGateway.pushCreateUserToPanel(panelId, {
      taskId: state.taskId,
      targetUsername: state.targetUsername,
    });

    if (!sent) {
      // Panel is busy or disconnected — mark for retry when panel becomes idle
      this.logger.warn(
        `Panel ${panelId} unavailable for create_user, will retry when idle`,
      );
      state.pendingCreationPanelId = panelId;
      // Keep status as CREATING_USER and let timeout handle if retry never happens
      return {
        success: true,
        message: `Panel busy, will retry create_user when idle`,
      };
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

    // Seamless UX: do NOT tell the user we're creating their account. The chat-app
    // stays on "Pago verificado / Preparando la carga..." until the job actually starts.

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

    // Mark request FAILED in DB for the operator queue, but seamless UX: do NOT
    // surface the failure to the user. Operator will resolve manually.
    if (state.requestId) {
      try {
        await this.prisma.request.update({
          where: { id: state.requestId },
          data: { status: 'FAILED' },
        });
      } catch (err) {
        this.logger.error(
          `Failed to update request ${state.requestId} status to FAILED: ${err?.message || err}`,
        );
      }
    }

    this.emitDiscoveryFailed({
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
      this.logger.warn(
        `Task ${taskId} not in CREATING_USER state (${state.status})`,
      );
      return { success: true, message: 'Task already resolved' };
    }

    clearTimeout(state.timeoutTimer);

    if (!success) {
      this.logger.error(
        `User creation failed for "${state.targetUsername}": ${error}`,
      );

      state.status = 'NOT_FOUND';

      if (state.requestId) {
        try {
          await this.prisma.request.update({
            where: { id: state.requestId },
            data: { status: 'FAILED' },
          });
        } catch (err) {
          this.logger.error(
            `Failed to update request ${state.requestId} status to FAILED: ${err?.message || err}`,
          );
        }
      }

      // Detect "username already exists on the panel" — this is the one creation
      // failure mode the user can actually fix (by choosing a different name), so
      // we break the seamless-UX rule and surface a specific actionable message.
      const errLower = (error || '').toLowerCase();
      const isAlreadyExists =
        /ya existe|repetido|duplic|tomado|en uso|already (exists|in use|taken)|exists/.test(
          errLower,
        );

      if (isAlreadyExists) {
        this.eventsGateway.emitToUser(
          state.userId,
          'user_target_username_taken',
          {
            requestId: state.requestId,
            attemptedUsername: state.targetUsername,
            message:
              `El nombre "${state.targetUsername}" ya está usado por otro jugador en el panel. ` +
              `Elegí otro nombre para tu cuenta.`,
          },
        );
      }

      // Always notify operators
      this.emitDiscoveryFailed({
        taskId: state.taskId,
        requestId: state.requestId,
        targetUsername: state.targetUsername,
        reason: `User creation failed: ${error}`,
        userActionable: isAlreadyExists,
      });

      setTimeout(() => this.discoveries.delete(state.taskId), 30_000);
      return { success: true, message: `Creation failed: ${error}` };
    }

    // SUCCESS — user created on panel
    this.logger.log(
      `User "${state.targetUsername}" created successfully on panel ${panelId}`,
    );

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
      this.logger.warn(
        `Failed to send welcome message: ${welcomeError.message}`,
      );
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
        this.logger.log(
          `Job created for request ${state.requestId} after user creation (panel ${panelId})`,
        );
      } catch (jobError: any) {
        this.logger.error(
          `Failed to create job after user creation: ${jobError.message}`,
        );
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
  private async sendPasswordMessage(
    userId: string,
    requestId: string,
  ): Promise<void> {
    const PASSWORD = '123casino';
    const messageContent = `Tu cuenta fue creada exitosamente!\n\nTu contrasena es: ${PASSWORD}\n\nGuardala en un lugar seguro.`;

    // Find the chat for this request
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { chat: true },
    });

    if (!request?.chat?.id) {
      this.logger.warn(
        `No chat found for request ${requestId} — cannot send password message`,
      );
      return;
    }

    // Use MessagesService.sendSystemMessage for consistency
    try {
      const { MessagesService } = require('../messages/messages.service');
      const messagesService = this.moduleRef.get(MessagesService, {
        strict: false,
      });
      await messagesService.sendSystemMessage(
        request.chat.id,
        messageContent,
        requestId,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send password message via MessagesService: ${error.message}`,
      );
    }

    this.logger.log(
      `Password message sent to user ${userId} for request ${requestId}`,
    );
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
      const messagesService = this.moduleRef.get(MessagesService, {
        strict: false,
      });
      await messagesService.sendSystemMessage(chat.id, content);
    } catch (error: any) {
      this.logger.error(
        `Failed to send welcome message via MessagesService: ${error.message}`,
      );
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
      .filter((d) => d.status === 'IN_PROGRESS')
      .map((d) => ({
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
