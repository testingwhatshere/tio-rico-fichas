import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { invalidateSettingsCache } from '../settings/settings-cache';
import { EventsGateway } from '../events/events.gateway';
import { BalanceService } from '../balance/balance.service';
import { BotGateway } from './bot.gateway';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../notifications/telegram.service';
import { PushService } from '../notifications/push.service';
import { JobStatus, RequestStatus, JobType } from '@prisma/client';
import {
  JobResultDto,
  JobProgressDto,
  BotStatusDto,
  HeartbeatDto,
} from './dto';
import {
  STALE_PROGRESS_MS,
  BOT_HEARTBEAT_TIMEOUT_MS,
  HEARTBEAT_PERSIST_INTERVAL_MS,
} from '../common/constants/timeouts';
import { PrizeClaimsService } from '../prize-claims/prize-claims.service';
import { ChatsService } from '../chats/chats.service';
import { MessagesService } from '../messages/messages.service';
import {
  AppEvent,
  JobCompletedEvent,
  JobFailedEvent,
  JobStartedEvent,
} from '../common/events/app-events';

// Bot state (in-memory, will be reset on server restart)
export interface BotState {
  status: 'online' | 'offline' | 'busy' | 'error' | 'unknown';
  lastHeartbeat: Date | null;
  lastJobId: string | null;
  version: string | null;
  uptime: number | null;
}

// Job progress tracking (in-memory)
export interface JobProgress {
  step: string;
  progress: number;
  details?: Record<string, any>;
  updatedAt: Date;
}

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  // Per-panel bot states (panelId → BotState)
  private botStates: Map<string, BotState> = new Map();
  // Legacy single state (fallback for non-panel-aware callers)
  private botState: BotState = {
    status: 'unknown',
    lastHeartbeat: null,
    lastJobId: null,
    version: null,
    uptime: null,
  };
  private jobProgress: Map<string, JobProgress> = new Map();
  // Ultimo estado efectivamente escrito en Setting, para no repetir upserts identicos.
  private persistedState: {
    status?: BotState['status'];
    lastJobId?: string | null;
    version?: string | null;
  } = {};
  private lastHeartbeatPersistedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly balanceService: BalanceService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
    private readonly telegramService: TelegramService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Restore bot state from database on startup
   */
  async onModuleInit() {
    try {
      const keys = [
        'BOT_STATUS',
        'BOT_LAST_HEARTBEAT',
        'BOT_LAST_JOB_ID',
        'BOT_VERSION',
      ];
      const settings = await this.prisma.setting.findMany({
        where: { key: { in: keys } },
      });

      const map = new Map(settings.map((s) => [s.key, s.value]));

      if (map.has('BOT_STATUS')) {
        const status = map.get('BOT_STATUS') as BotState['status'];
        // If it was 'online' or 'busy' before restart, mark as unknown (needs heartbeat to confirm)
        this.botState.status =
          status === 'online' || status === 'busy' ? 'unknown' : status;
      }
      if (map.has('BOT_LAST_HEARTBEAT')) {
        this.botState.lastHeartbeat = new Date(map.get('BOT_LAST_HEARTBEAT')!);
      }
      if (map.has('BOT_LAST_JOB_ID')) {
        this.botState.lastJobId = map.get('BOT_LAST_JOB_ID')!;
      }
      if (map.has('BOT_VERSION')) {
        this.botState.version = map.get('BOT_VERSION')!;
      }

      // Arrancamos sabiendo qué hay escrito (los valores crudos, no los ya
      // reinterpretados arriba) para no reescribir lo mismo apenas levanta.
      this.persistedState = {
        status: map.get('BOT_STATUS') as BotState['status'] | undefined,
        lastJobId: map.get('BOT_LAST_JOB_ID') ?? null,
        version: map.get('BOT_VERSION') ?? null,
      };

      this.logger.log(
        `Bot state restored from DB: status=${this.botState.status}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to restore bot state from DB: ${error.message}`);
    }
  }

  /**
   * Persist bot state to database (fire-and-forget)
   *
   * Solo escribe lo que cambio. Antes hacia los 4 upserts en cada heartbeat: 33.478
   * llamadas y 409s de CPU de base en un mes, el 85% del tiempo total de queries del
   * servicio. Todo eso se lee una sola vez, en onModuleInit.
   */
  private async persistBotState() {
    try {
      const entries: { key: string; value: string }[] = [];

      if (this.botState.status !== this.persistedState.status) {
        entries.push({ key: 'BOT_STATUS', value: this.botState.status });
      }
      if (
        this.botState.lastJobId &&
        this.botState.lastJobId !== this.persistedState.lastJobId
      ) {
        entries.push({
          key: 'BOT_LAST_JOB_ID',
          value: this.botState.lastJobId,
        });
      }
      if (
        this.botState.version &&
        this.botState.version !== this.persistedState.version
      ) {
        entries.push({ key: 'BOT_VERSION', value: this.botState.version });
      }

      // El heartbeat cambia cada 20s pero al reiniciar el backend el proximo llega
      // enseguida, asi que refrescarlo cada 5 minutos alcanza. Si ya hay otra clave
      // para escribir, se aprovecha el mismo viaje y queda coherente.
      const now = Date.now();
      const heartbeatDue =
        now - this.lastHeartbeatPersistedAt >= HEARTBEAT_PERSIST_INTERVAL_MS;
      const writeHeartbeat =
        !!this.botState.lastHeartbeat && (heartbeatDue || entries.length > 0);
      if (writeHeartbeat) {
        entries.push({
          key: 'BOT_LAST_HEARTBEAT',
          value: this.botState.lastHeartbeat!.toISOString(),
        });
      }

      if (entries.length === 0) return;

      await this.prisma.$transaction(
        entries.map(({ key, value }) =>
          this.prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
          }),
        ),
      );
      invalidateSettingsCache();

      // Recien cuando la escritura salio bien: si falla, el proximo intento reintenta.
      this.persistedState = {
        status: this.botState.status,
        lastJobId: this.botState.lastJobId,
        version: this.botState.version,
      };
      if (writeHeartbeat) this.lastHeartbeatPersistedAt = now;
    } catch (error) {
      this.logger.warn(`Failed to persist bot state: ${error.message}`);
    }
  }

  /**
   * Handle job result from bot
   */
  /** `jobId:panelId` → instancia de la extensión que la empezó (ver handleJobStarted). */
  private readonly jobClaimants = new Map<
    string,
    { instanceId: string; at: number }
  >();
  private static readonly JOB_CLAIMANT_TTL_MS = 2 * 60 * 60 * 1000;

  private pruneJobClaimants() {
    const cutoff = Date.now() - BotService.JOB_CLAIMANT_TTL_MS;
    for (const [key, owner] of this.jobClaimants) {
      if (owner.at < cutoff) this.jobClaimants.delete(key);
    }
  }

  private releaseJobClaims(jobId: string) {
    for (const key of this.jobClaimants.keys()) {
      if (key.startsWith(`${jobId}:`)) this.jobClaimants.delete(key);
    }
  }

  async handleJobResult(jobId: string, dto: JobResultDto) {
    this.releaseJobClaims(jobId);
    this.logger.log(`Received job result for ${jobId}: success=${dto.success}`);

    // El bot ya contestó: si después se desconecta, este job no se reencola.
    try {
      const { BotGateway } = require('./bot.gateway');
      this.moduleRef
        .get(BotGateway, { strict: false })
        ?.releaseJobTracking?.(jobId);
    } catch {
      // El tracking es una optimización: sin él sólo se pierde el rescate rápido.
    }

    // Find the job
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { request: true, prizeClaim: true },
    });

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Fix 22: Idempotency guard — skip if job already has a final status
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      this.logger.warn(
        `Job ${jobId} already in final state ${job.status}, ignoring duplicate result`,
      );
      // Una confirmación de ÉXITO que llega tarde para un job que se dio por
      // fallido (corte de red, timeout, chequeo de trabados) significa que la
      // plata SÍ se movió en el panel. No se cambia el estado acá, pero el
      // operador tiene que saberlo antes de reintentar: reintentar sería cargar
      // dos veces (ver risk_load_indeterminate_after_aceptar).
      if (
        job.status === 'FAILED' &&
        dto.success &&
        (job.type === 'LOAD_CREDITS' || job.type === 'WITHDRAW_CHIPS')
      ) {
        const quien = job.targetUsername || job.request?.targetUsername || '?';
        const monto = job.amount ?? job.request?.amount ?? '?';
        this.logger.error(
          `LATE SUCCESS for FAILED job ${jobId} (${job.type} ${quien} $${monto}): the panel operation DID happen`,
        );
        try {
          this.eventsGateway.emitSystemAlert({
            type: 'LATE_SUCCESS_FOR_FAILED_JOB',
            severity: 'critical',
            title: 'Una carga marcada como fallida SÍ se hizo',
            message: `${job.type === 'WITHDRAW_CHIPS' ? 'El retiro' : 'La carga'} de $${monto} para ${quien} figuraba como fallida, pero el bot confirmó que se hizo en el panel. NO la reintentes: revisá el saldo del usuario en el panel.`,
            jobId,
            requestId: job.requestId,
          });
        } catch (err: any) {
          this.logger.warn(
            `No se pudo avisar el éxito tardío de ${jobId}: ${err.message}`,
          );
        }
      }
      return {
        success: true,
        message: 'Job result already processed (idempotent)',
      };
    }

    // Update job status
    const newStatus = dto.success ? JobStatus.COMPLETED : JobStatus.FAILED;

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: newStatus,
        completedAt: new Date(),
        result: dto.success ? { success: true } : undefined,
        error: dto.error || undefined,
        screenshot: dto.screenshotPath || undefined,
      },
    });

    // La verificación de fichas también viaja por la cola (antes se emitía directo al
    // bot y chocaba con la carga en curso). El resultado vuelve por el mismo canal que
    // cualquier job y se rutea al reclamo asociado mediante Job.prizeClaim.
    if (job.type === 'VERIFY_CHIPS') {
      // La lectura se guarda en el job: la consulta de saldo de TioRicoCargas
      // (integrations) la lee de acá. Antes sólo iba al reclamo de premio.
      const reading = ((dto as any)?.result ?? {}) as {
        success?: boolean;
        balance?: number;
        error?: string;
      };
      await this.prisma.job
        .update({
          where: { id: jobId },
          data: {
            result: {
              success: dto.success,
              reading: {
                success: reading.success ?? dto.success,
                balance: reading.balance ?? (dto as any)?.balance ?? null,
                error: reading.error ?? dto.error ?? null,
              },
            },
          },
        })
        .catch((e: Error) =>
          this.logger.warn(
            `No se pudo guardar la lectura de ${jobId}: ${e.message}`,
          ),
        );

      if (job.prizeClaim) {
        try {
          const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
            strict: false,
          });
          // Ojo con la diferencia: `dto.success` dice si el BOT pudo hacer su trabajo,
          // no si el usuario tiene fichas. La lectura del panel viaja en `result`, y
          // un "usuario no encontrado" llega como job exitoso con result.success=false.
          const verify = ((dto as any)?.result ?? {}) as {
            success?: boolean;
            balance?: number;
            error?: string;
          };
          await prizeClaimsService?.handleVerificationResult(
            job.prizeClaim.id,
            {
              success: verify.success ?? dto.success,
              balance: verify.balance ?? (dto as any)?.balance,
              error: verify.error ?? dto.error,
            },
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to handle chip verification result: ${error.message}`,
          );
        }
      } else {
        // Sin reclamo: es una consulta de saldo (TioRicoCargas); la lectura ya
        // quedó guardada arriba.
        this.logger.log(
          `VERIFY_CHIPS job ${jobId} sin reclamo: lectura guardada`,
        );
      }

      // Liberar el panel igual que cualquier otro job: sin esto queda marcado busy y
      // desaparece del discovery hasta reiniciar el backend.
      this.jobProgress.delete(jobId);
      this.botState.lastJobId = jobId;
      this.botState.status = 'online';
      this.persistBotState();
      if (job.panelId) {
        this.botGateway.markPanelIdle(job.panelId);
        this.updatePanelState(job.panelId, {
          status: 'online',
          lastJobId: jobId,
        });
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, {
          jobId,
          panelId: job.panelId,
        });
      }
      this.eventsGateway.emitDashboardUpdate();

      return { success: true, message: 'Chip verification result processed' };
    }

    // Handle WITHDRAW_CHIPS jobs (prize claims) separately
    if (job.type === 'WITHDRAW_CHIPS') {
      if (job.prizeClaim) {
        try {
          const prizeClaimsService = this.moduleRef.get(PrizeClaimsService, {
            strict: false,
          });
          if (!prizeClaimsService) {
            this.logger.error(
              `PrizeClaimsService not available — cannot process withdrawal result for job ${jobId}`,
            );
          } else {
            await prizeClaimsService.handleWithdrawalResult(
              job.prizeClaim.id,
              dto.success,
              dto.error,
            );
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to handle prize withdrawal result: ${error.message}`,
          );
        }
      } else {
        this.logger.error(
          `WITHDRAW_CHIPS job ${jobId} has no associated prize claim`,
        );
      }

      // Clear progress, update bot state, mark panel idle
      this.jobProgress.delete(jobId);
      this.botState.lastJobId = jobId;
      this.botState.status = 'online';
      this.persistBotState();
      if (job.panelId) {
        this.botGateway.markPanelIdle(job.panelId);
        this.updatePanelState(job.panelId, {
          status: 'online',
          lastJobId: jobId,
        });
      }
      this.eventsGateway.emitDashboardUpdate();

      // Try dispatch next job
      if (job.panelId) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, {
          jobId,
          panelId: job.panelId,
        });
      }

      return { success: true, message: 'Withdrawal job result recorded' };
    }

    // Handle CHANGE_PASSWORD jobs
    if (job.type === 'CHANGE_PASSWORD') {
      // On success, persist the new password on the user so operators can see it
      // for support (plaintext — it's the panel-game password, not auth). Done
      // BEFORE the cleanup so we don't lose it.
      if (dto.success && job.requestingUserId && job.newPassword) {
        try {
          await this.prisma.user.update({
            where: { id: job.requestingUserId },
            data: {
              panelPassword: job.newPassword,
              panelPasswordUpdatedAt: new Date(),
            },
          });
        } catch (err: any) {
          this.logger.warn(
            `Failed to persist panelPassword after CHANGE_PASSWORD: ${err.message}`,
          );
        }
      }

      // Clear newPassword from the Job row (it was for transport only).
      await this.prisma.job.update({
        where: { id: jobId },
        data: { newPassword: null },
      });

      // Send system message to user's chat + native push notification.
      if (job.requestingUserId) {
        try {
          const chatsService = this.moduleRef.get(ChatsService, {
            strict: false,
          });
          const messagesService = this.moduleRef.get(MessagesService, {
            strict: false,
          });
          const chat = await chatsService.getOrCreateChat(job.requestingUserId);
          const msg = dto.success
            ? '✅ Tu contraseña fue cambiada con éxito. Ya podés usar la nueva contraseña para ingresar.'
            : `❌ No se pudo cambiar tu contraseña. ${dto.error || 'Contacta a soporte para más información.'}`;
          await messagesService.sendSystemMessage(chat.id, msg);
        } catch (err) {
          this.logger.warn(
            `Failed to send password change notification: ${err.message}`,
          );
        }
        try {
          // Push notification so the user sees it even if the chat-app is closed
          // or they're on the home screen (which doesn't open the chat to see msgs).
          const pushService = this.moduleRef.get(PushService, {
            strict: false,
          });
          if (pushService?.sendToUser) {
            const title = dto.success
              ? '✅ Contraseña cambiada'
              : '❌ Cambio de contraseña falló';
            const body = dto.success
              ? 'Ya podés usar la nueva contraseña para ingresar al panel.'
              : `${dto.error || 'Contactá a soporte.'}`;
            await pushService.sendToUser(job.requestingUserId, title, body, {
              type: 'password_change',
            });
          }
        } catch (err: any) {
          this.logger.warn(`Push for password change failed: ${err.message}`);
        }
        // Real-time socket event so the chat-app shows an in-app toast on
        // whichever screen the user happens to be on (home, chat, etc.).
        try {
          this.eventsGateway.emitToUser(
            job.requestingUserId,
            'password:changed',
            {
              success: !!dto.success,
              error: dto.error || null,
              jobId,
              timestamp: new Date().toISOString(),
            },
          );
        } catch (err: any) {
          this.logger.warn(
            `Socket emit password:changed failed: ${err.message}`,
          );
        }
      }

      // Clear progress, update bot state, mark panel idle
      this.jobProgress.delete(jobId);
      this.botState.lastJobId = jobId;
      this.botState.status = 'online';
      this.persistBotState();
      if (job.panelId) {
        this.botGateway.markPanelIdle(job.panelId);
        this.updatePanelState(job.panelId, {
          status: 'online',
          lastJobId: jobId,
        });
      }
      this.eventsGateway.emitDashboardUpdate();

      if (job.panelId) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, {
          jobId,
          panelId: job.panelId,
        });
      }

      return { success: true, message: 'Password change job result recorded' };
    }

    // Handle CREATE_USER jobs
    if (job.type === 'CREATE_USER') {
      // On success: persist the default panel password ('123casino') for the
      // matching user so operators can see it in support. On failure: emit a
      // dedicated event so the operator panel can show a clear toast (instead
      // of only logging).
      if (dto.success && job.targetUsername) {
        try {
          await this.prisma.user.updateMany({
            where: {
              savedTargetUsername: job.targetUsername,
              panelPassword: null,
            },
            data: {
              panelPassword: '123casino',
              panelPasswordUpdatedAt: new Date(),
            },
          });
        } catch (err: any) {
          this.logger.warn(
            `Failed to persist default panelPassword after CREATE_USER: ${err.message}`,
          );
        }

        // Avisar que salió bien.
        //
        // Antes sólo se emitía el fallo: cuando la creación funcionaba, el
        // operador se quedaba con el "en proceso" del principio y nunca sabía
        // si había terminado. Volvía a apretar el botón o preguntaba.
        try {
          this.eventsGateway.emitToOperators('create_user_succeeded', {
            jobId,
            targetUsername: job.targetUsername,
            panelId: job.panelId,
          });
        } catch (err: any) {
          this.logger.warn(
            `Failed to emit create_user_succeeded: ${err.message}`,
          );
        }
      } else if (!dto.success) {
        try {
          this.eventsGateway.emitToOperators('create_user_failed', {
            jobId,
            targetUsername: job.targetUsername,
            panelId: job.panelId,
            error: dto.error || 'Error desconocido',
          });
        } catch (err: any) {
          this.logger.warn(`Failed to emit create_user_failed: ${err.message}`);
        }
      }

      // Clear newPassword from DB immediately (security)
      await this.prisma.job.update({
        where: { id: jobId },
        data: { newPassword: null },
      });

      // Notify operators (log only)
      try {
        const msg = dto.success
          ? `Usuario "${job.targetUsername}" creado en el panel con contraseña 123casino.`
          : `Error al crear usuario "${job.targetUsername}": ${dto.error || 'Error desconocido'}`;
        this.logger.log(msg);
      } catch (err) {
        this.logger.warn(
          `Failed to send create user notification: ${err.message}`,
        );
      }

      // Clear progress, update bot state, mark panel idle
      this.jobProgress.delete(jobId);
      this.botState.lastJobId = jobId;
      this.botState.status = 'online';
      this.persistBotState();
      if (job.panelId) {
        this.botGateway.markPanelIdle(job.panelId);
        this.updatePanelState(job.panelId, {
          status: 'online',
          lastJobId: jobId,
        });
      }
      this.eventsGateway.emitDashboardUpdate();

      if (job.panelId) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, {
          jobId,
          panelId: job.panelId,
        });
      }

      return { success: true, message: 'Create user job result recorded' };
    }

    // Update request status directly (critical path — must not be lost)
    if (!job.requestId) {
      this.logger.error(
        `Job ${jobId} has no requestId — cannot update request status`,
      );
      return { success: true, message: 'Job result recorded (no request)' };
    }
    const requestStatus: RequestStatus = dto.success ? 'COMPLETED' : 'FAILED';
    await this.prisma.request.update({
      where: { id: job.requestId },
      data: { status: requestStatus },
    });

    // Internal balance tracking removed. The real balance lives on the gaming
    // panel and is read on-demand by the chrome extension during prize-claim
    // verification — so we don't accumulate a parallel number here that would
    // drift from reality. The Transaction model + Request history remain as
    // audit logs of what we charged / loaded, but they no longer mutate
    // User.balance.
    if (dto.success && !job.request) {
      this.logger.warn(
        `Job ${jobId} completed but request is missing — skipping audit log`,
      );
    }

    // Clear progress tracking
    this.jobProgress.delete(jobId);

    // Update bot state and persist
    this.botState.lastJobId = jobId;
    this.botState.status = 'online';
    this.persistBotState();

    // Mark panel as idle (job finished)
    if (job.panelId) {
      this.botGateway.markPanelIdle(job.panelId);
      this.updatePanelState(job.panelId, {
        status: 'online',
        lastJobId: jobId,
      });
    }

    this.logger.log(
      `Job ${jobId} ${dto.success ? 'completed successfully' : 'failed'}: ${dto.error || 'No error'}`,
    );

    // Emit real-time events (guard against deleted request)
    if (job.request) {
      const eventData = {
        jobId,
        requestId: job.requestId,
        targetUsername: job.request.targetUsername,
        amount: Number(job.request.amount),
        error: dto.error,
      };

      if (dto.success) {
        this.eventsGateway.emitJobCompleted(job.request.userId, eventData);
        this.eventsGateway.emitRequestCompleted(job.request.userId, {
          requestId: job.requestId,
          status: 'COMPLETED',
        });
      } else {
        this.eventsGateway.emitJobFailed(job.request.userId, eventData);
        this.telegramService
          .alertJobFailed(
            jobId,
            dto.error || 'Unknown error',
            job.request?.targetUsername,
          )
          .catch((e) =>
            this.logger.warn(`Telegram alert failed: ${e.message}`),
          );
      }
    } else {
      this.logger.error(
        `Job ${jobId} completed but request relation is missing — skipping event emission`,
      );
    }

    this.eventsGateway.emitDashboardUpdate();

    // Emit event for side effects (request history, next job dispatch, push notifications)
    if (job.request) {
      if (dto.success) {
        this.eventEmitter.emit(AppEvent.JOB_COMPLETED, {
          jobId,
          requestId: job.requestId,
          userId: job.request.userId,
          targetUsername: job.request.targetUsername,
          amount: Number(job.request.amount),
        } satisfies JobCompletedEvent);
      } else {
        this.eventEmitter.emit(AppEvent.JOB_FAILED, {
          jobId,
          requestId: job.requestId,
          userId: job.request.userId,
          targetUsername: job.request.targetUsername,
          amount: Number(job.request.amount),
          error: dto.error,
        } satisfies JobFailedEvent);
      }
    }

    return { success: true, message: 'Job result recorded' };
  }

  /**
   * Handle job started notification from bot
   */
  async handleJobStarted(
    jobId: string,
    startedAt?: string,
    instanceId?: string,
    panelId?: string,
  ) {
    this.logger.log(`Job ${jobId} started`);

    // Una carga la ejecuta UNA sola instancia de la extensión. Si se perdió el
    // ACK en un corte, el dispatcher puede habérsela pasado a otro socket; si ese
    // socket es OTRA instancia (otro Chrome con el mismo panel), las dos
    // avisarían "empecé" y las dos cargarían. La primera instancia que avisa se
    // queda con la carga; cualquier otra recibe alreadyClaimed y aborta.
    // (Chequeo y registro síncronos, antes de cualquier await: sin carreras.)
    // Extensiones viejas no mandan instanceId: comportamiento de siempre.
    // La clave incluye el panel: una carga revivida en OTRO panel (re-discovery)
    // conserva el id y la toma otra instancia legítimamente.
    const claimKey = `${jobId}:${panelId || '-'}`;
    if (instanceId) {
      this.pruneJobClaimants();
      const owner = this.jobClaimants.get(claimKey);
      if (owner && owner.instanceId !== instanceId) {
        this.logger.warn(
          `Job ${jobId} already started by instance ${owner.instanceId}; rejecting start from ${instanceId}`,
        );
        return {
          success: true,
          message: 'Job already started by another bot instance',
          alreadyClaimed: true,
        };
      }
      if (!owner) {
        this.jobClaimants.set(claimKey, { instanceId, at: Date.now() });
      }
    }

    // Atomic claim: only update if still QUEUED (prevents two bots from both claiming)
    const claimed = await this.prisma.job.updateMany({
      where: { id: jobId, status: JobStatus.QUEUED },
      data: {
        status: JobStatus.PROCESSING,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
      },
    });

    if (claimed.count === 0) {
      // Either job doesn't exist or was already moved to PROCESSING by the dispatcher
      const existingJob = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!existingJob) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }
      // If already PROCESSING, this is the same bot confirming start (dispatcher already set PROCESSING)
      // Only flag alreadyClaimed if job is in a terminal state (COMPLETED/FAILED) — meaning another bot finished it
      if (existingJob.status === 'PROCESSING') {
        this.logger.log(
          `Job ${jobId} already PROCESSING (set by dispatcher), confirming start`,
        );
        // Update startedAt if not set
        await this.prisma.job
          .update({
            where: { id: jobId },
            data: { startedAt: startedAt ? new Date(startedAt) : new Date() },
          })
          .catch(() => {});
        // Fall through to emit events below — do NOT return alreadyClaimed
      } else {
        this.logger.warn(
          `Job ${jobId} in terminal state ${existingJob.status}, another bot already handled it`,
        );
        return {
          success: true,
          message: 'Job already completed/failed by another bot',
          alreadyClaimed: true,
        };
      }
    }

    // Update request status
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        type: true,
        panelId: true,
        request: { select: { id: true, userId: true } },
      },
    });

    if (job?.request) {
      // Update request status directly (critical path)
      await this.prisma.request.update({
        where: { id: job.request.id },
        data: { status: 'PROCESSING' },
      });

      // Emit job started event (include userId so users receive it)
      this.eventsGateway.emitJobStarted(
        {
          jobId,
          requestId: job.request.id,
        },
        job.request.userId,
      );

      // Emit event for side effects (request history, push notifications)
      this.eventEmitter.emit(AppEvent.JOB_STARTED, {
        jobId,
        requestId: job.request.id,
        userId: job.request.userId,
      } satisfies JobStartedEvent);
    } else if (job?.type === 'WITHDRAW_CHIPS') {
      // WITHDRAW_CHIPS jobs don't have a request — prize claim tracks its own status
      this.logger.log(`WITHDRAW_CHIPS job ${jobId} started`);
    } else if (job?.type === 'VERIFY_CHIPS') {
      // El bot dejó de hacer fila y se puso a leer el saldo: a partir de acá el
      // reclamo espera minuto y medio, no cinco minutos.
      try {
        const {
          PrizeClaimsService,
        } = require('../prize-claims/prize-claims.service');
        this.moduleRef
          .get(PrizeClaimsService, { strict: false })
          ?.onVerifyChipsStarted?.(jobId);
      } catch {
        // Si no se puede avisar, el timeout largo sigue cubriendo el caso.
      }
    }

    // Update bot state
    this.botState.status = 'busy';
    this.botState.lastJobId = jobId;

    // Mark panel as busy
    const fullJob = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { panelId: true },
    });
    if (fullJob?.panelId) {
      this.botGateway.markPanelBusy(fullJob.panelId);
      this.updatePanelState(fullJob.panelId, {
        status: 'busy',
        lastJobId: jobId,
      });
    }

    // Initialize progress tracking
    this.jobProgress.set(jobId, {
      step: 'starting',
      progress: 0,
      updatedAt: new Date(),
    });

    this.eventsGateway.emitDashboardUpdate();

    return { success: true, message: 'Job start acknowledged' };
  }

  /**
   * Handle job progress update from bot
   */
  async handleJobProgress(jobId: string, dto: JobProgressDto) {
    this.logger.debug(`Job ${jobId} progress: ${dto.step} (${dto.progress}%)`);

    // Store progress in memory
    this.jobProgress.set(jobId, {
      step: dto.step,
      progress: dto.progress,
      details: dto.details,
      updatedAt: new Date(),
    });

    // Look up userId so progress events reach end users
    let userId: string | undefined;
    try {
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        include: { request: { select: { userId: true } } },
      });
      userId = job?.request?.userId;
    } catch (error) {
      this.logger.warn(
        `Failed to look up userId for job progress ${jobId}: ${error.message}`,
      );
    }

    // Emit real-time progress update (to operators and user)
    this.eventsGateway.emitJobProgress(
      {
        jobId,
        step: dto.step,
        progress: dto.progress,
        details: dto.details,
      },
      userId,
    );

    return { success: true };
  }

  /**
   * Get current progress for a job
   */
  getJobProgress(jobId: string): JobProgress | null {
    return this.jobProgress.get(jobId) || null;
  }

  /**
   * List available panels (for extension options dropdown)
   */
  async listPanels() {
    return this.prisma.panel.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Handle heartbeat from bot — optionally panel-aware
   */
  async handleHeartbeat(dto: HeartbeatDto, panelId?: string) {
    this.logger.debug(
      `Bot heartbeat received${panelId ? ` (panel ${panelId})` : ''}`,
    );

    this.botState.lastHeartbeat = new Date();

    // El heartbeat prueba que el bot está VIVO, no que esté libre. Antes esto
    // hacía `status = 'online'` a secas, lo cual pisaba 'busy' y —peor— 'error'.
    //
    // Nunca se notó porque el heartbeat HTTP venía rebotando con 400 y este
    // método no corría nunca. Al arreglar el DTO se despertó: con el heartbeat
    // cada 24s, un bot que reportó 'error' (service-worker.js:1377) volvía solo
    // a 'online' en menos de medio minuto y el operador no veía la falla. Eso
    // rompe la regla de "si falla, STOP y esperar revisión manual".
    //
    // Un heartbeat solo puede levantar un bot que dábamos por muerto o del que
    // no sabíamos nada. 'unknown' es el estado inicial tras reiniciar el backend
    // sin nada persistido: dejarlo así hacía que el bot figurara 'unknown' para
    // siempre, porque el heartbeat ya no lo pisa. Mismo criterio que la rama por
    // panel de acá abajo.
    if (
      this.botState.status === 'offline' ||
      this.botState.status === 'unknown'
    ) {
      this.botState.status = 'online';
    }

    if (dto.version) this.botState.version = dto.version;
    // La extensión manda `uptimeMinutes`; `uptime` es el nombre viejo. Antes solo
    // se leía `uptime`, así que el uptime del bot figuraba siempre en blanco.
    const uptime = dto.uptime ?? dto.uptimeMinutes;
    if (uptime) this.botState.uptime = uptime;
    this.persistBotState();

    // Update per-panel state — mismo criterio: no pisar el status del panel.
    if (panelId) {
      const previo = this.getPanelState(panelId);
      const status =
        !previo || previo.status === 'offline' || previo.status === 'unknown'
          ? ('online' as const)
          : previo.status;
      this.updatePanelState(panelId, {
        status,
        lastHeartbeat: new Date(),
        version: dto.version || null,
        uptime: uptime || null,
      });
    }

    // Clean up stale progress entries (bot crash recovery)
    const now = Date.now();
    for (const [jobId, progress] of this.jobProgress.entries()) {
      if (now - progress.updatedAt.getTime() > STALE_PROGRESS_MS) {
        this.logger.warn(
          `Cleaning stale job progress: ${jobId} (last update: ${progress.updatedAt.toISOString()})`,
        );
        this.jobProgress.delete(jobId);
      }
    }

    return {
      success: true,
      message: 'Heartbeat acknowledged',
      serverTime: new Date().toISOString(),
    };
  }

  // Track last alert time per panel to avoid spamming (5 min cooldown)
  private panelBalanceAlertCooldowns = new Map<string, number>();
  private panelBalanceAlertMuted = new Set<string>();

  /**
   * Handle panel balance report from extension.
   * Compares with configurable threshold and emits alert to operators.
   */
  async handlePanelBalance(balance: number, panelId?: string) {
    const key = panelId || 'default';

    // Persist last known balance so /fichas command can show it
    try {
      await this.settingsService.setSetting(
        `PANEL_BALANCE_${key.toUpperCase()}`,
        String(balance),
      );
      await this.settingsService.setSetting(
        `PANEL_BALANCE_UPDATED_AT`,
        new Date().toISOString(),
      );
    } catch (err) {
      this.logger.warn(`Failed to persist panel balance: ${err.message}`);
    }

    // Skip if muted by operator
    if (this.panelBalanceAlertMuted.has(key)) {
      return { success: true, message: 'Alert muted' };
    }

    // Get threshold from settings (default 1000)
    let threshold = 1000;
    try {
      const val = await this.settingsService.getSetting(
        'PANEL_BALANCE_THRESHOLD',
      );
      if (val) threshold = parseFloat(val);
    } catch (err) {
      this.logger.warn(
        `Failed to read balance threshold setting: ${err.message}`,
      );
    }

    if (balance > threshold) {
      return { success: true, message: 'Balance OK' };
    }

    // Cooldown: don't alert more than once every 5 minutes per panel
    const lastAlert = this.panelBalanceAlertCooldowns.get(key) || 0;
    if (Date.now() - lastAlert < 5 * 60 * 1000) {
      return { success: true, message: 'Alert cooldown active' };
    }

    this.panelBalanceAlertCooldowns.set(key, Date.now());

    const severity = balance <= threshold * 0.2 ? 'critical' : 'warning';

    this.eventsGateway.emitSystemAlert({
      type: 'low_panel_balance',
      severity,
      message: `Fichas bajas en el panel${panelId ? ` (${panelId})` : ''}: $${balance.toLocaleString('es-AR')}`,
      details: {
        panelId: key,
        balance,
        threshold,
      },
    });

    this.logger.warn(
      `Low panel balance alert: $${balance} (threshold: $${threshold}, panel: ${key})`,
    );
    this.telegramService
      .alertLowPanelBalance(balance, threshold, panelId)
      .catch((e) =>
        this.logger.warn(`Telegram low balance alert failed: ${e.message}`),
      );

    return { success: true, message: 'Alert sent' };
  }

  /**
   * Mute/unmute panel balance alerts for a specific panel
   */
  mutePanelBalanceAlert(panelId: string, mute: boolean) {
    if (mute) {
      this.panelBalanceAlertMuted.add(panelId);
    } else {
      this.panelBalanceAlertMuted.delete(panelId);
    }
  }

  /**
   * Handle bot status change
   */
  async handleStatusChange(dto: BotStatusDto, panelId?: string) {
    this.logger.log(
      `Bot status changed to: ${dto.status} (panelId=${panelId || 'unknown'})`,
    );

    this.botState.status = dto.status;
    this.botState.lastHeartbeat = new Date();
    this.persistBotState();

    // Update per-panel state
    if (panelId) {
      this.updatePanelState(panelId, {
        status: dto.status,
        lastHeartbeat: new Date(),
      });
    }

    // Notify operators of status change
    try {
      this.eventsGateway.emitBotStatus({
        status: dto.status,
        panelId: panelId || 'default',
        // Cantidad de sockets vivos por panel, igual que el resto de los
        // emisores de bot_status. Antes iban los BotState completos y la web de
        // operadores (que hace `count > 0`) marcaba todos los paneles offline.
        connectedPerPanel: this.botGateway.getConnectedCountPerPanel(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit bot status to operators: ${err.message}`,
      );
    }

    return { success: true, message: 'Status updated' };
  }

  /**
   * Get pending jobs for bot polling mode.
   * When panelId is provided, only returns jobs for that panel.
   */
  async getPendingJobs(panelId?: string) {
    this.logger.log(
      `getPendingJobs called (polling, panelId=${panelId || 'any'})`,
    );

    // A poller that doesn't identify its panel must NEVER receive
    // panel-assigned jobs: an unconfigured/outdated extension instance would
    // claim them and (e.g. with its circuit breaker tripped) insta-fail them,
    // while the properly configured bot for that panel never sees the job.
    const whereClause: any = {
      status: JobStatus.QUEUED,
      panelId: panelId ?? null,
    };

    const jobs = await this.prisma.job.findMany({
      where: whereClause,
      include: {
        request: {
          select: {
            id: true,
            targetUsername: true,
            amount: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });

    if (jobs.length === 0) {
      this.logger.debug('getPendingJobs: no queued jobs found');
      return { job: null };
    }

    const job = jobs[0];
    const targetUsername =
      job.targetUsername || job.request?.targetUsername || '?';
    const amount = job.amount
      ? Number(job.amount)
      : job.request
        ? Number(job.request.amount)
        : 0;
    this.logger.log(
      `getPendingJobs: returning job ${job.id} (${job.type}) for ${targetUsername} ($${amount})`,
    );
    const jobData: any = {
      id: job.id,
      type: job.type,
      requestId: job.request?.id,
      targetUsername,
      amount,
      panelId: job.panelId,
    };

    // Include newPassword only for CHANGE_PASSWORD jobs
    if (job.type === 'CHANGE_PASSWORD' && job.newPassword) {
      jobData.newPassword = job.newPassword;
    }

    return { job: jobData };
  }

  /**
   * Check if kill switch is active (delegates to SettingsService for consistent format)
   */
  async checkKillSwitch(
    panelId?: string,
  ): Promise<{ active: boolean; reason?: string }> {
    return this.settingsService.getKillSwitch();
  }

  /**
   * Set kill switch status (delegates to SettingsService for consistent format)
   */
  async setKillSwitch(active: boolean, reason?: string) {
    if (active) {
      await this.settingsService.activateKillSwitch('system-bot', reason);
    } else {
      await this.settingsService.deactivateKillSwitch('system-bot');
    }

    return { success: true, active, reason };
  }

  /**
   * Check if within allowed activity window (delegates to SettingsService for consistent keys)
   */
  async checkActivityWindow(
    panelId?: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    return this.settingsService.isWithinActivityWindow();
  }

  /**
   * Get current bot state
   */
  getBotState(): BotState {
    // Check if bot is online (heartbeat within threshold)
    if (
      this.botState.lastHeartbeat &&
      Date.now() - this.botState.lastHeartbeat.getTime() >
        BOT_HEARTBEAT_TIMEOUT_MS
    ) {
      this.botState.status = 'offline';
    }

    return { ...this.botState };
  }

  /**
   * Check if bot is healthy
   */
  isBotHealthy(): boolean {
    const state = this.getBotState();
    return state.status === 'online' || state.status === 'busy';
  }

  /**
   * Get full dispatch diagnostic status — shows why jobs may not be dispatching
   */
  async getDispatchStatus() {
    const cooldownMs = this.configService.get<number>(
      'QUEUE_COOLDOWN_MS',
      30000,
    );

    const [
      queuedCount,
      processingJobs,
      killSwitch,
      activityWindow,
      lastCompletedJob,
    ] = await Promise.all([
      this.prisma.job.count({ where: { status: 'QUEUED' } }),
      this.prisma.job.findMany({
        where: { status: 'PROCESSING' },
        select: { id: true, requestId: true, startedAt: true, panelId: true },
      }),
      this.checkKillSwitch(),
      this.checkActivityWindow(),
      this.prisma.job.findFirst({
        where: {
          status: { in: ['COMPLETED', 'FAILED'] },
          completedAt: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);

    const elapsed = lastCompletedJob?.completedAt
      ? Date.now() - lastCompletedJob.completedAt.getTime()
      : Infinity;
    const remainingMs = Math.max(0, cooldownMs - elapsed);
    const cooldown = { active: remainingMs > 0, remainingMs };

    return {
      queuedJobs: queuedCount,
      processingJobs,
      processingJob: processingJobs[0] || null, // backward compat
      killSwitch,
      activityWindow,
      cooldown,
      botConnected: this.botGateway.isAnyBotConnected(),
      connectedPanels: this.botGateway.getConnectedPanelIds(),
      connectedPerPanel: this.botGateway.getConnectedCountPerPanel(),
      botState: this.getBotState(),
      panelStates: Object.fromEntries(this.botStates),
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================
  // PER-PANEL STATE MANAGEMENT
  // ==========================================

  private updatePanelState(panelId: string, partial: Partial<BotState>) {
    const existing = this.botStates.get(panelId) || {
      status: 'unknown' as const,
      lastHeartbeat: null,
      lastJobId: null,
      version: null,
      uptime: null,
    };
    this.botStates.set(panelId, { ...existing, ...partial });
  }

  getPanelState(panelId: string): BotState | null {
    return this.botStates.get(panelId) || null;
  }

  getAllPanelStates(): Record<string, BotState> {
    return Object.fromEntries(this.botStates);
  }

  /**
   * Get job statistics for extension popup
   */
  async getJobStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [queued, processing, completed, failed, todayCompleted] =
      await Promise.all([
        this.prisma.job.count({ where: { status: JobStatus.QUEUED } }),
        this.prisma.job.count({ where: { status: JobStatus.PROCESSING } }),
        this.prisma.job.count({ where: { status: JobStatus.COMPLETED } }),
        this.prisma.job.count({ where: { status: JobStatus.FAILED } }),
        this.prisma.job.count({
          where: {
            status: JobStatus.COMPLETED,
            completedAt: { gte: today },
          },
        }),
      ]);

    return {
      queued,
      processing,
      completed,
      failed,
      todayCompleted,
    };
  }

  /**
   * Handle selector health check result from extension.
   * Stores the result and alerts if selectors are broken.
   */
  async handleSelectorCheckResult(result: {
    total: number;
    matched: number;
    failed: string[];
    checkedAt?: string;
  }) {
    // Store last check in settings
    await this.prisma.setting.upsert({
      where: { key: 'SELECTOR_CHECK_LAST' },
      update: { value: JSON.stringify(result) },
      create: { key: 'SELECTOR_CHECK_LAST', value: JSON.stringify(result) },
    });
    invalidateSettingsCache();

    // Alert via Telegram if required selectors are broken
    if (result.failed.length > 0) {
      try {
        const telegram = this.moduleRef.get('TelegramService', {
          strict: false,
        });
        if (telegram?.send) {
          await telegram.send(
            `⚠️ <b>SELECTORES ROTOS</b>\n\n` +
              `${result.matched}/${result.total} selectores OK\n` +
              `<b>${result.failed.length} fallaron:</b>\n` +
              result.failed.map((s) => `  • <code>${s}</code>`).join('\n') +
              `\n\n<i>El casino puede haber cambiado su UI. Revisar perfil de selectores.</i>`,
          );
        }
      } catch (e) {
        this.logger.warn(
          'Could not send selector alert via Telegram:',
          e.message,
        );
      }
    }
  }
}
