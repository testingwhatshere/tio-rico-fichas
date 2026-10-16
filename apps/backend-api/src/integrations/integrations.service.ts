import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import {
  IntegrationAction,
  JobStatus,
  JobType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestsService } from '../requests/requests.service';
import { UsersService } from '../users/users.service';
import { JobsService } from '../jobs/jobs.service';
import { SettingsService } from '../settings/settings.service';
import { PrizeClaimsService } from '../prize-claims/prize-claims.service';
import { UploadsService } from '../uploads/uploads.service';
import { AppEvent } from '../common/events/app-events';
import { PANEL_USERNAME_REGEX } from '../common/validators/username';
import { CreateIntegrationActionDto } from './dto';

const SOURCE = 'tiorico-cargas';
/** Usuario operador con el que quedan aprobadas las cargas pedidas desde la app. */
const OPERATOR_NAME = 'tiorico-cargas';
/** Contraseña inicial de los usuarios creados en el panel (la misma de siempre). */
const DEFAULT_PANEL_PASSWORD = '123casino';
/** Reintentos del webhook: espera creciente hasta 10 min, y se abandona a las 48 h. */
const CALLBACK_MAX_DELAY_MS = 10 * 60 * 1000;
const CALLBACK_GIVE_UP_MS = 48 * 60 * 60 * 1000;
const CALLBACK_TIMEOUT_MS = 10_000;

export type IntegrationActionView = {
  actionId: string;
  externalId: string;
  type: IntegrationAction['type'];
  status: IntegrationAction['status'];
  /** WITHDRAW_PRIZE en curso: VERIFYING (leyendo saldo) o WITHDRAWING (retirando). */
  phase: string | null;
  username: string;
  amount: number | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * Acciones que pide TioRicoCargas (la app de chat del equipo) y que ejecuta la
 * extensión en el panel: cargar fichas, ver saldo, crear usuario y cambiar
 * contraseña.
 *
 * Cada pedido reusa el camino que ya existe en la plataforma (carga manual del
 * operador, jobs del bot), así que valen todas las reglas del bot: una carga a
 * la vez, nunca reintentar una carga automáticamente.
 *
 * El seguimiento es por sondeo (reconcile): mira el Request/Job de cada acción
 * en curso. Cubre así todos los finales — el bot, el chequeo de trabadas, un
 * discovery fallido — sin depender de que cada camino emita un evento.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private reconciling = false;
  private delivering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly config: ConfigService,
  ) {}

  private get requests() {
    return this.moduleRef.get(RequestsService, { strict: false });
  }
  private get users() {
    return this.moduleRef.get(UsersService, { strict: false });
  }
  private get jobs() {
    return this.moduleRef.get(JobsService, { strict: false });
  }
  private get settings() {
    return this.moduleRef.get(SettingsService, { strict: false });
  }
  private get prizes() {
    return this.moduleRef.get(PrizeClaimsService, { strict: false });
  }

  private get uploads() {
    return this.moduleRef.get(UploadsService, { strict: false });
  }

  // ==========================================
  // ALTA
  // ==========================================

  async submit(
    dto: CreateIntegrationActionDto,
  ): Promise<IntegrationActionView> {
    const existing = await this.prisma.integrationAction.findUnique({
      where: {
        source_externalId: { source: SOURCE, externalId: dto.externalId },
      },
    });
    if (existing) return this.view(existing);

    this.validate(dto);

    let action: IntegrationAction;
    try {
      action = await this.prisma.integrationAction.create({
        data: {
          source: SOURCE,
          externalId: dto.externalId,
          type: dto.type,
          username: dto.username.trim().toLowerCase(),
          amount:
            dto.type === 'LOAD_CREDITS' || dto.type === 'WITHDRAW_PRIZE'
              ? Math.floor(dto.amount!)
              : null,
          requestedBy: dto.requestedBy ?? null,
        },
      });
    } catch (err) {
      // Mismo externalId en paralelo: gana el primero, el otro devuelve ese.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const again = await this.prisma.integrationAction.findUnique({
          where: {
            source_externalId: { source: SOURCE, externalId: dto.externalId },
          },
        });
        if (again) return this.view(again);
      }
      throw err;
    }

    this.logger.log(
      `Acción ${action.type} ${action.username} pedida por ${action.requestedBy ?? '?'} (${action.id})`,
    );

    try {
      const started = await this.start(action, dto);
      action = await this.prisma.integrationAction.update({
        where: { id: action.id },
        data: started,
      });
    } catch (err) {
      action = await this.finish(
        action.id,
        'FAILED',
        null,
        (err as Error)?.message || 'Error',
      );
    }
    return this.view(action);
  }

  async get(externalId: string): Promise<IntegrationActionView> {
    const action = await this.prisma.integrationAction.findUnique({
      where: { source_externalId: { source: SOURCE, externalId } },
    });
    if (!action) throw new NotFoundException('Acción no encontrada');
    return this.view(action);
  }

  private validate(dto: CreateIntegrationActionDto) {
    if (
      (dto.type === 'LOAD_CREDITS' || dto.type === 'WITHDRAW_PRIZE') &&
      !(Number(dto.amount) >= 1)
    ) {
      throw new BadRequestException('Falta el monto');
    }
    if (dto.type === 'CHANGE_PASSWORD' && !dto.newPassword) {
      throw new BadRequestException('Falta la contraseña nueva');
    }
    if (
      dto.type === 'CREATE_USER' &&
      !PANEL_USERNAME_REGEX.test(dto.username)
    ) {
      throw new BadRequestException(
        'El usuario del panel sólo puede tener letras, números y guión bajo',
      );
    }
  }

  /** Arranca la acción y devuelve los ids a guardar. Tira error con mensaje para el equipo. */
  private async start(
    action: IntegrationAction,
    dto: CreateIntegrationActionDto,
  ): Promise<Prisma.IntegrationActionUpdateInput> {
    const username = action.username;

    switch (action.type) {
      case 'LOAD_CREDITS': {
        const user = await this.findOrCreateUser(username);
        const operator = await this.users.findOrCreateOperator(OPERATOR_NAME);
        const res = await this.requests.createManualLoad({
          userId: user.id,
          amount: Number(action.amount),
          operatorId: operator.id,
          note: `TioRicoCargas · ${action.requestedBy ?? 'equipo'}`,
        });
        return { requestId: res.requestId, userId: user.id };
      }

      case 'CHECK_BALANCE': {
        const user = await this.findUser(username);
        if (!user?.panelId) {
          throw new BadRequestException(
            'Todavía no sé en qué panel está este usuario. Hacele una carga o creá el usuario primero.',
          );
        }
        const job = await this.prisma.job.create({
          data: {
            type: JobType.VERIFY_CHIPS,
            status: JobStatus.QUEUED,
            panelId: user.panelId,
            targetUsername: user.savedTargetUsername ?? username,
          },
        });
        this.dispatch(user.panelId);
        return { jobId: job.id, userId: user.id };
      }

      case 'CREATE_USER': {
        const panelId = await this.settings.getSetting(
          'DEFAULT_NEW_USER_PANEL_ID',
        );
        if (!panelId) {
          throw new BadRequestException(
            'No hay panel por defecto para usuarios nuevos (DEFAULT_NEW_USER_PANEL_ID)',
          );
        }
        const known = await this.findUser(username);
        if (known?.panelId) {
          throw new BadRequestException('Ese usuario ya existe en un panel');
        }
        const inFlight = await this.prisma.job.findFirst({
          where: {
            type: JobType.CREATE_USER,
            targetUsername: username,
            status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING] },
          },
          select: { id: true },
        });
        if (inFlight) {
          throw new BadRequestException(
            'Ya hay una creación en curso para ese usuario',
          );
        }
        const user = known ?? (await this.findOrCreateUser(username));
        const job = await this.prisma.job.create({
          data: {
            type: JobType.CREATE_USER,
            status: JobStatus.QUEUED,
            targetUsername: username,
            newPassword: DEFAULT_PANEL_PASSWORD,
            panelId,
          },
        });
        this.dispatch(panelId);
        return { jobId: job.id, userId: user.id };
      }

      case 'WITHDRAW_PRIZE': {
        // Primero se lee el saldo: si no le alcanza no se retira nada.
        const user = await this.findUser(username);
        if (!user?.panelId) {
          throw new BadRequestException(
            'Todavía no sé en qué panel está este usuario. Hacele una carga o creá el usuario primero.',
          );
        }
        const inFlight = await this.prisma.integrationAction.findFirst({
          where: {
            type: 'WITHDRAW_PRIZE',
            userId: user.id,
            status: 'RUNNING',
            id: { not: action.id },
          },
          select: { id: true },
        });
        if (inFlight) {
          throw new BadRequestException(
            'Ya hay un premio en curso para este usuario',
          );
        }
        const job = await this.prisma.job.create({
          data: {
            type: JobType.VERIFY_CHIPS,
            status: JobStatus.QUEUED,
            panelId: user.panelId,
            targetUsername: user.savedTargetUsername ?? username,
          },
        });
        this.dispatch(user.panelId);
        return { jobId: job.id, userId: user.id, phase: 'VERIFYING' };
      }

      case 'CHANGE_PASSWORD': {
        const user = await this.findUser(username);
        if (!user?.panelId) {
          throw new BadRequestException(
            'Todavía no sé en qué panel está este usuario. Hacele una carga o creá el usuario primero.',
          );
        }
        const inFlight = await this.prisma.job.findFirst({
          where: {
            type: JobType.CHANGE_PASSWORD,
            requestingUserId: user.id,
            status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING] },
          },
          select: { id: true },
        });
        if (inFlight) {
          throw new BadRequestException(
            'Ya hay un cambio de contraseña en curso',
          );
        }
        const job = await this.prisma.job.create({
          data: {
            type: JobType.CHANGE_PASSWORD,
            status: JobStatus.QUEUED,
            targetUsername: user.savedTargetUsername ?? username,
            newPassword: dto.newPassword!,
            requestingUserId: user.id,
            panelId: user.panelId,
          },
        });
        this.dispatch(user.panelId);
        return { jobId: job.id, userId: user.id };
      }
    }
  }

  /** Despacha sin esperar: la acción queda registrada aunque el bot esté ocupado. */
  private dispatch(panelId: string) {
    this.jobs
      .tryDispatchNextJob(panelId)
      .catch((e: Error) =>
        this.logger.warn(`Dispatch tras acción falló: ${e.message}`),
      );
  }

  /** Usuario de la plataforma cuyo usuario de panel es `username`. */
  private async findUser(username: string) {
    const select = {
      id: true,
      username: true,
      savedTargetUsername: true,
      panelId: true,
    } as const;
    return (
      (await this.prisma.user.findFirst({
        where: {
          savedTargetUsername: { equals: username, mode: 'insensitive' },
          role: UserRole.CLIENT,
        },
        select,
      })) ??
      (await this.prisma.user.findFirst({
        where: {
          username: { equals: username, mode: 'insensitive' },
          role: UserRole.CLIENT,
        },
        select,
      }))
    );
  }

  /**
   * En TioRicoCargas el usuario es el mismo nombre que en el panel. Si la
   * plataforma no lo conoce todavía se crea como cliente (sin teléfono): la carga
   * lo busca en los paneles igual que a cualquier usuario nuevo.
   */
  private async findOrCreateUser(username: string) {
    const found = await this.findUser(username);
    if (found) return found;
    try {
      return await this.prisma.user.create({
        data: {
          username,
          savedTargetUsername: username,
          role: UserRole.CLIENT,
        },
        select: {
          id: true,
          username: true,
          savedTargetUsername: true,
          panelId: true,
        },
      });
    } catch (err) {
      // Existe con ese username pero no como cliente (p. ej. un operador).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Ese nombre ya lo usa otra cuenta de la plataforma que no es un cliente',
        );
      }
      throw err;
    }
  }

  // ==========================================
  // SEGUIMIENTO
  // ==========================================

  // Que el resultado llegue al chat sin esperar al próximo sondeo.
  @OnEvent(AppEvent.JOB_COMPLETED)
  onJobCompleted() {
    setTimeout(() => void this.reconcile(), 1500);
  }

  @OnEvent(AppEvent.JOB_FAILED)
  onJobFailed() {
    setTimeout(() => void this.reconcile(), 1500);
  }

  @Interval(10_000)
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const running = await this.prisma.integrationAction.findMany({
        where: { status: 'RUNNING' },
        take: 50,
      });
      for (const action of running) {
        try {
          await this.reconcileOne(action);
        } catch (err) {
          this.logger.warn(
            `Seguimiento de ${action.id} falló: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOne(action: IntegrationAction) {
    if (action.type === 'LOAD_CREDITS') {
      if (!action.requestId) return;
      const req = await this.prisma.request.findUnique({
        where: { id: action.requestId },
        select: {
          status: true,
          amount: true,
          validationError: true,
          job: { select: { error: true } },
        },
      });
      if (!req) {
        await this.finish(action.id, 'FAILED', null, 'La carga ya no existe');
      } else if (req.status === 'COMPLETED') {
        await this.finish(action.id, 'COMPLETED', {
          amount: Number(req.amount),
        });
      } else if (['FAILED', 'REJECTED', 'CANCELLED'].includes(req.status)) {
        await this.finish(
          action.id,
          'FAILED',
          null,
          req.job?.error ||
            req.validationError ||
            `La carga terminó como ${req.status}`,
        );
      }
      return;
    }

    if (action.type === 'WITHDRAW_PRIZE') {
      await this.reconcilePrize(action);
      return;
    }

    if (!action.jobId) return;
    const job = await this.prisma.job.findUnique({
      where: { id: action.jobId },
      select: { status: true, error: true, result: true, panelId: true },
    });
    if (!job) {
      await this.finish(action.id, 'FAILED', null, 'El trabajo ya no existe');
      return;
    }
    if (job.status === JobStatus.FAILED) {
      await this.finish(
        action.id,
        'FAILED',
        null,
        job.error || 'El bot no pudo hacerlo',
      );
      return;
    }
    if (job.status !== JobStatus.COMPLETED) return;

    switch (action.type) {
      case 'CHECK_BALANCE': {
        // El bot pudo leer el panel; si el usuario no estaba, success=false acá.
        const reading = ((job.result as { reading?: unknown } | null)
          ?.reading ?? {}) as {
          success?: boolean;
          balance?: number;
          error?: string;
        };
        if (reading.success === false || typeof reading.balance !== 'number') {
          await this.finish(
            action.id,
            'FAILED',
            null,
            reading.error || 'No se pudo leer el saldo',
          );
        } else {
          await this.finish(action.id, 'COMPLETED', {
            balance: reading.balance,
          });
        }
        return;
      }
      case 'CREATE_USER': {
        // El resultado del bot ya guarda la contraseña; acá falta fijar el panel,
        // así las cargas siguientes no tienen que buscarlo.
        if (action.userId && job.panelId) {
          await this.prisma.user.update({
            where: { id: action.userId },
            data: { panelId: job.panelId },
          });
        }
        await this.finish(action.id, 'COMPLETED', {
          password: DEFAULT_PANEL_PASSWORD,
        });
        return;
      }
      case 'CHANGE_PASSWORD':
        await this.finish(action.id, 'COMPLETED', {});
        return;
    }
  }

  /**
   * Premio en dos etapas. VERIFYING: el bot lee el saldo; si no alcanza, termina
   * acá (sin premio). Si alcanza, se registra el premio como verificado por el
   * equipo y arranca el retiro (el mismo camino que el botón de la web).
   * WITHDRAWING: se sigue el premio hasta "fichas retiradas" (falta pagar).
   */
  private async reconcilePrize(action: IntegrationAction) {
    if (action.phase === 'VERIFYING') {
      if (!action.jobId) return;
      const job = await this.prisma.job.findUnique({
        where: { id: action.jobId },
        select: { status: true, error: true, result: true },
      });
      if (!job) {
        await this.finish(action.id, 'FAILED', null, 'El trabajo ya no existe');
        return;
      }
      if (job.status === JobStatus.FAILED) {
        await this.finish(
          action.id,
          'FAILED',
          null,
          job.error || 'No se pudo leer el saldo del usuario',
        );
        return;
      }
      if (job.status !== JobStatus.COMPLETED) return;

      const reading = ((job.result as { reading?: unknown } | null)?.reading ??
        {}) as { success?: boolean; balance?: number; error?: string };
      if (reading.success === false || typeof reading.balance !== 'number') {
        await this.finish(
          action.id,
          'FAILED',
          null,
          reading.error || 'No se pudo leer el saldo del usuario',
        );
        return;
      }
      const amount = Number(action.amount);
      if (reading.balance < amount) {
        await this.finish(
          action.id,
          'FAILED',
          {
            reason: 'INSUFFICIENT_CHIPS',
            balance: reading.balance,
            amount,
          },
          `No le alcanzan las fichas: tiene $${reading.balance.toLocaleString('es-AR')} y el premio es de $${amount.toLocaleString('es-AR')}`,
        );
        return;
      }

      // Le alcanza: premio registrado y retiro en marcha.
      const user = action.userId
        ? await this.prisma.user.findUnique({
            where: { id: action.userId },
            select: { id: true, panelId: true, savedTargetUsername: true },
          })
        : null;
      if (!user?.panelId) {
        await this.finish(
          action.id,
          'FAILED',
          null,
          'El usuario perdió su panel',
        );
        return;
      }
      const claim = await this.prisma.prizeClaim.create({
        data: {
          userId: user.id,
          targetUsername: user.savedTargetUsername ?? action.username,
          amount,
          status: 'VERIFIED',
          verifiedBalance: reading.balance,
          verifiedAt: new Date(),
          panelId: user.panelId,
        },
      });
      const operator = await this.users.findOrCreateOperator(OPERATOR_NAME);
      const processed = await this.prizes.process(claim.id, operator.id);
      const updated = await this.prisma.integrationAction.update({
        where: { id: action.id },
        data: {
          prizeClaimId: claim.id,
          jobId: processed.jobId,
          phase: 'WITHDRAWING',
          result: { balance: reading.balance, amount, claimId: claim.id },
          // Avance intermedio: la app avisa al usuario que se están retirando.
          callbackStatus: this.callbackUrl() ? 'PENDING' : 'NONE',
          callbackNextAt: new Date(),
        },
      });
      this.logger.log(
        `Premio ${updated.username} $${amount}: saldo $${reading.balance}, retiro en marcha (claim ${claim.id})`,
      );
      setTimeout(() => void this.deliverCallbacks(), 200);
      return;
    }

    if (action.phase === 'WITHDRAWING' && action.prizeClaimId) {
      const claim = await this.prisma.prizeClaim.findUnique({
        where: { id: action.prizeClaimId },
        select: { status: true, amount: true },
      });
      if (!claim) {
        await this.finish(action.id, 'FAILED', null, 'El premio ya no existe');
        return;
      }
      const prev = (action.result ?? {}) as Record<string, unknown>;
      if (claim.status === 'CHIPS_WITHDRAWN' || claim.status === 'COMPLETED') {
        await this.finish(action.id, 'COMPLETED', {
          ...prev,
          paid: claim.status === 'COMPLETED',
        });
      } else if (claim.status === 'FAILED' || claim.status === 'REJECTED') {
        await this.finish(
          action.id,
          'FAILED',
          prev,
          claim.status === 'FAILED'
            ? 'El bot no pudo retirar las fichas'
            : 'El premio fue rechazado',
        );
      }
    }
  }

  private async finish(
    id: string,
    status: 'COMPLETED' | 'FAILED',
    result: Record<string, unknown> | null,
    error?: string,
  ) {
    const updated = await this.prisma.integrationAction.update({
      where: { id },
      data: {
        status,
        result: (result ?? undefined) as Prisma.InputJsonValue | undefined,
        error: error ?? null,
        completedAt: new Date(),
        callbackStatus: this.callbackUrl() ? 'PENDING' : 'NONE',
        callbackNextAt: new Date(),
      },
    });
    this.logger.log(
      `Acción ${updated.type} ${updated.username} → ${status}${error ? ` (${error})` : ''}`,
    );
    setTimeout(() => void this.deliverCallbacks(), 200);
    return updated;
  }

  // ==========================================
  // WEBHOOK A LA APP
  // ==========================================

  private callbackUrl() {
    return this.config.get<string>('TRC_CALLBACK_URL') || '';
  }

  @Interval(15_000)
  async deliverCallbacks(): Promise<void> {
    const url = this.callbackUrl();
    const secret = this.config.get<string>('TRC_WEBHOOK_SECRET') || '';
    if (!url || !secret || this.delivering) return;
    this.delivering = true;
    try {
      const due = await this.prisma.integrationAction.findMany({
        where: {
          callbackStatus: 'PENDING',
          callbackNextAt: { lte: new Date() },
        },
        orderBy: { completedAt: 'asc' },
        take: 20,
      });
      for (const action of due) {
        await this.deliverOne(action, url, secret);
      }
    } finally {
      this.delivering = false;
    }
  }

  private async deliverOne(
    action: IntegrationAction,
    url: string,
    secret: string,
  ) {
    const body = JSON.stringify({
      event: 'action.finished',
      action: this.view(action),
    });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Platform-Timestamp': timestamp,
          'X-Platform-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.prisma.integrationAction.update({
        where: { id: action.id },
        data: {
          callbackStatus: 'DELIVERED',
          callbackDeliveredAt: new Date(),
          callbackAttempts: { increment: 1 },
          callbackLastError: null,
        },
      });
    } catch (err) {
      const attempts = action.callbackAttempts + 1;
      const age = Date.now() - (action.completedAt?.getTime() ?? Date.now());
      const giveUp = age > CALLBACK_GIVE_UP_MS;
      const delay = Math.min(
        5_000 * 2 ** Math.min(attempts, 10),
        CALLBACK_MAX_DELAY_MS,
      );
      await this.prisma.integrationAction.update({
        where: { id: action.id },
        data: {
          callbackStatus: giveUp ? 'GAVE_UP' : 'PENDING',
          callbackAttempts: attempts,
          callbackNextAt: new Date(Date.now() + delay),
          callbackLastError: String((err as Error)?.message || err).slice(
            0,
            300,
          ),
        },
      });
      if (attempts === 1 || giveUp) {
        this.logger.warn(
          `Webhook de la acción ${action.id} falló (${(err as Error)?.message})${giveUp ? ' — se abandona' : ''}`,
        );
      }
    }
  }

  /**
   * Premio ya retirado por el bot: el operador pagó y manda el comprobante.
   * Idempotente: si el premio ya figura pagado, devuelve la acción como está.
   */
  async payout(
    externalId: string,
    proofs: { url: string; type: 'image' | 'pdf'; name?: string }[],
  ): Promise<IntegrationActionView> {
    const action = await this.prisma.integrationAction.findUnique({
      where: { source_externalId: { source: SOURCE, externalId } },
    });
    if (!action) throw new NotFoundException('Acción no encontrada');
    if (
      action.type !== 'WITHDRAW_PRIZE' ||
      action.status !== 'COMPLETED' ||
      !action.prizeClaimId
    ) {
      throw new BadRequestException(
        'Solo se puede registrar el pago de un premio con las fichas ya retiradas',
      );
    }
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: action.prizeClaimId },
      select: { status: true },
    });
    if (!claim) throw new NotFoundException('El premio ya no existe');

    if (claim.status !== 'COMPLETED') {
      // Copia propia: los adjuntos de la app se borran a los 7 días y acá el
      // comprobante se guarda 6 meses.
      const kept: typeof proofs = [];
      for (const p of proofs) kept.push({ ...p, url: await this.keepCopy(p) });
      const operator = await this.users.findOrCreateOperator(OPERATOR_NAME);
      await this.prizes.complete(action.prizeClaimId, operator.id, {
        proofs: kept,
      });
    }

    const prev = (action.result ?? {}) as Record<string, unknown>;
    const updated = await this.prisma.integrationAction.update({
      where: { id: action.id },
      data: {
        result: { ...prev, paid: true, paidAt: new Date().toISOString() },
      },
    });
    this.logger.log(
      `Premio ${updated.username} $${Number(updated.amount)} marcado pagado (claim ${action.prizeClaimId})`,
    );
    return this.view(updated);
  }

  private async keepCopy(p: {
    url: string;
    type: 'image' | 'pdf';
    name?: string;
  }): Promise<string> {
    try {
      const buffer = await this.uploads.getFileBuffer(p.url);
      const mimetype = p.type === 'pdf' ? 'application/pdf' : 'image/jpeg';
      const file = {
        buffer,
        size: buffer.length,
        mimetype,
        originalname:
          p.name ?? (p.type === 'pdf' ? 'comprobante.pdf' : 'comprobante.jpg'),
      } as Express.Multer.File;
      const up = await this.uploads.uploadFile(file, OPERATOR_NAME);
      return up.cloudinaryUrl;
    } catch (e) {
      // Sin copia queda el link original: el pago se registra igual.
      this.logger.warn(
        `No se pudo copiar el comprobante ${p.url}: ${(e as Error).message}`,
      );
      return p.url;
    }
  }

  private view(a: IntegrationAction): IntegrationActionView {
    return {
      actionId: a.id,
      externalId: a.externalId,
      type: a.type,
      status: a.status,
      phase: a.phase,
      username: a.username,
      amount: a.amount == null ? null : Number(a.amount),
      result: a.result ?? null,
      error: a.error,
      createdAt: a.createdAt.toISOString(),
      completedAt: a.completedAt?.toISOString() ?? null,
    };
  }
}
