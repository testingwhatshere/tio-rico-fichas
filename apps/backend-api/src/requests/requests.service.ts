import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { OperatorGateway } from '../events/operator.gateway';
import { SettingsService } from '../settings/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { MessagesService } from '../messages/messages.service';
import { Prisma, RequestStatus } from '@prisma/client';
import { CreateRequestDto, ApproveRequestDto, RejectRequestDto } from './dto';
import { PaymentsService } from '../payments/payments.service';
import { PushService } from '../notifications/push.service';
import {
  MessageTemplatesService,
  TemplateKey,
} from '../message-templates/message-templates.service';
import { ChatsService } from '../chats/chats.service';
import {
  fetchSlimStatusHistory,
  fetchValidationSummaries,
} from '../common/utils/validation-summary';
import { VALID_TRANSITIONS } from '../common/constants/statuses';
import {
  PENDING_PROOF_TTL_MS,
  OVERPAID_OFFER_TTL_MS,
} from '../common/constants/timeouts';
import {
  AppEvent,
  PaymentProofUploadedEvent,
} from '../common/events/app-events';
import {
  toDeliverableProofUrlOrNull,
  proofWasPurged,
} from '../common/utils/proof-url';
import { attachProofTwins } from '../common/utils/proof-twins';

/**
 * Todas las columnas de Request menos `validationDetails`. Para listas: ese
 * JSON pesa mas que el resto de la fila y viajaba entero desde Supabase.
 */
const REQUEST_LIST_SCALARS = {
  id: true,
  userId: true,
  targetUsername: true,
  amount: true,
  status: true,
  proofUrl: true,
  proofHash: true,
  proofUploadedAt: true,
  validationScore: true,
  validationError: true,
  extractedTransactionId: true,
  manuallyApproved: true,
  approvedById: true,
  approvedAt: true,
  rejectionReason: true,
  assignedOperatorId: true,
  assignedAt: true,
  mpVerified: true,
  mpOperationNumber: true,
  mpVerifiedAt: true,
  mpVerifiedByWalletId: true,
  walletId: true,
  panelId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RequestSelect;

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);
  private static readonly VALID_TRANSITIONS = VALID_TRANSITIONS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
    @Inject(forwardRef(() => OperatorGateway))
    private readonly operatorGateway: OperatorGateway,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly settingsService: SettingsService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
    private readonly pushService: PushService,
    private readonly templates: MessageTemplatesService,
  ) {}

  /**
   * Send a system message to the user's persistent chat, tagged with the request.
   * Falls back to per-request chat for old data.
   */
  private async sendRequestSystemMessage(
    requestId: string,
    userId: string,
    content: string,
  ) {
    try {
      const userChat = await this.chatsService.getOrCreateChat(userId);
      return this.messagesService.sendSystemMessage(
        userChat.id,
        content,
        requestId,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send request system message for ${requestId}: ${err.message}`,
      );
    }
  }

  /**
   * Accumulate wallet amount on approval and check for auto-rotation.
   * Best-effort: never fails the approval.
   */
  private async handleWalletAccumulation(
    walletId: string | null,
    amount: number,
    requestId: string,
  ) {
    if (!walletId) return;

    // Guard against double-accumulation: check if this request was already accumulated
    const existing = await this.prisma.requestStatusHistory.findFirst({
      where: {
        requestId,
        metadata: { path: ['walletAccumulated'], equals: true },
      },
    });
    if (existing) {
      this.logger.warn(
        `Wallet already accumulated for request ${requestId}, skipping`,
      );
      return;
    }
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.paymentsService.accumulateAndCheckRotation(
          walletId,
          amount,
        );

        // Emit wallet_updated for the accumulated wallet
        const updatedWallet =
          await this.paymentsService.getWalletById(walletId);
        if (updatedWallet) {
          this.operatorGateway.emitToAll('wallet_updated', updatedWallet);
        }

        if (result.rotated) {
          this.operatorGateway.emitToAll('wallet_selected', {
            wallet: result.newWallet,
            reason: 'auto_rotation',
            previousWalletId: walletId,
            timestamp: new Date().toISOString(),
          });
        }

        if (result.allFull) {
          this.operatorGateway.emitToAll('wallets_all_full', {
            timestamp: new Date().toISOString(),
            message: 'Todas las billeteras superaron su límite',
          });
        }

        // Record that wallet was accumulated for this request (dedup marker)
        await this.prisma.requestStatusHistory
          .create({
            data: {
              requestId,
              status: 'APPROVED',
              changedBy: 'system-wallet',
              metadata: { walletAccumulated: true, walletId, amount },
            },
          })
          .catch((err) =>
            this.logger.error(
              `Failed to record wallet accumulation marker: ${err.message}`,
            ),
          );

        return;
      } catch (err: any) {
        if (err.code === 'P2034' && attempt < MAX_RETRIES) {
          this.logger.warn(
            `Wallet accumulation serialization conflict for request ${requestId}, retrying...`,
          );
          continue;
        }
        this.logger.error(
          `Wallet accumulation failed for request ${requestId}: ${err.message}`,
        );
        return;
      }
    }
  }

  // ==========================================
  // CLIENT ENDPOINTS
  // ==========================================

  /**
   * Qué se le dice al usuario que ya tiene una carga viva.
   *
   * El mensaje viaja tal cual al Alert de la app (`getErrorMessage` lo muestra
   * sin reescribirlo), así que es el único lugar donde se le puede explicar qué
   * hacer. El caso que importa es el de la carga sin comprobante: el usuario ve
   * "esperá a que se complete" para algo que no va a completarse solo, y
   * reintenta en loop en vez de subir el comprobante o cancelar.
   */
  private static activeLoadMessage(active: {
    amount: Prisma.Decimal | number;
    status: RequestStatus;
    proofUrl: string | null;
  }): string {
    const monto = `$${Number(active.amount).toLocaleString('es-AR')}`;

    if (active.status === 'PENDING_PROOF' && !active.proofUrl) {
      return (
        `Ya tenés una carga de ${monto} esperando el comprobante. ` +
        `Subilo en el chat, o tocá CANCELAR SOLICITUD para pedir otra.`
      );
    }

    return `Ya tenés una carga de ${monto} en proceso. Esperá a que se complete.`;
  }

  /** Motivo con el que se cierran las cargas que nunca recibieron comprobante. */
  private static readonly AUTO_EXPIRED_REASON =
    'Sin comprobante: caducó automáticamente';

  /**
   * Cierra las cargas que se quedaron esperando un comprobante que nunca llegó.
   *
   * El bloqueo de "una carga activa por usuario" no mira la antigüedad, así que
   * una solicitud sin comprobante lo dejaba trabado para siempre: la única
   * salida era que la cancelara él mismo desde el chat —cosa que no hace porque
   * ya se fue— o que un operador la cerrara. El 2026-09-04 había 27 fantasmas
   * vivas y 6 clientes reales sin poder cargar desde hacía 9 a 22 días.
   *
   * Sólo toca las que NO tienen comprobante: si ya lo subió, la carga está en
   * manos del validador o de un operador y no es un fantasma.
   *
   * @param userId Limita el barrido a un usuario (lo usa `create` para
   *   destrabarlo en el mismo intento). Sin él barre a todos.
   * @returns Cuántas cerró.
   */
  private async expireStalePendingProofs(userId?: string): Promise<number> {
    const cutoff = new Date(Date.now() - PENDING_PROOF_TTL_MS);

    const stale = await this.prisma.request.findMany({
      where: {
        status: 'PENDING_PROOF',
        proofUrl: null,
        createdAt: { lt: cutoff },
        ...(userId ? { userId } : {}),
      },
      select: { id: true, userId: true, targetUsername: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    if (stale.length === 0) return 0;

    let closed = 0;
    for (const request of stale) {
      // Condicionado al estado: entre el findMany y esta línea el usuario pudo
      // haber subido el comprobante, y ahí no hay nada que caducar.
      const { count } = await this.prisma.request.updateMany({
        where: { id: request.id, status: 'PENDING_PROOF', proofUrl: null },
        data: {
          status: 'CANCELLED',
          rejectionReason: RequestsService.AUTO_EXPIRED_REASON,
        },
      });
      if (count === 0) continue;

      closed++;

      await this.prisma.requestStatusHistory.create({
        data: {
          requestId: request.id,
          status: 'CANCELLED',
          metadata: {
            autoExpired: true,
            previousStatus: 'PENDING_PROOF',
            ageMinutes: Math.round(
              (Date.now() - request.createdAt.getTime()) / 60000,
            ),
          },
        },
      });

      // Al panel va por el gateway de /operator: `emitToOperators` publica en el
      // namespace raíz y no llega ahí (mismo motivo que en `cancelByOperator`).
      this.operatorGateway.emitToAll('load_cancelled', {
        requestId: request.id,
        status: 'CANCELLED',
        previousStatus: 'PENDING_PROOF',
        targetUsername: request.targetUsername,
        cancelledBy: null,
        autoExpired: true,
        updatedAt: new Date().toISOString(),
      });

      // Al usuario: la app mapea CANCELLED a IDLE y vuelve a ofrecerle cargar.
      this.events.emitRequestUpdated(request.userId, {
        requestId: request.id,
        status: 'CANCELLED',
      });
    }

    if (closed > 0) {
      this.logger.log(
        `Caducadas ${closed} carga(s) sin comprobante` +
          (userId ? ` del usuario ${userId}` : ''),
      );
      this.events.emitDashboardUpdate();
    }

    return closed;
  }

  /**
   * Barrido periódico: destraba también a quien no vuelve a intentar.
   *
   * `create` ya caduca las del usuario que está pidiendo, pero el que abandonó
   * la app nunca dispara ese camino y su carga quedaría viva en el tablero.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireStalePendingProofsCron() {
    try {
      await this.expireStalePendingProofs();
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Fallo el barrido de cargas sin comprobante: ${detalle}`,
      );
    }
  }

  async create(userId: string, dto: CreateRequestDto) {
    this.logger.log(`Creating request for user ${userId}`, dto);

    // Fetch user to get their username and panel assignment
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        savedTargetUsername: true,
        isActive: true,
        panelId: true,
      },
    });

    if (!user || !user.username) {
      throw new BadRequestException(
        'Tu cuenta no tiene un nombre de usuario configurado. Por favor, contacta a soporte.',
      );
    }

    // Blacklist check: banned users cannot create requests
    if (!user.isActive) {
      throw new ForbiddenException(
        'Tu cuenta ha sido deshabilitada. Contacta a soporte.',
      );
    }

    // Panel account name to load credits into. Normally equals username, but a
    // user whose username is taken on the casino's global namespace can be
    // re-mapped by an operator ("Cambiar usuario del panel"), which persists on
    // savedTargetUsername. Fall back to username when no alias is set.
    const targetUsername: string = user.savedTargetUsername ?? user.username;

    // Una carga sin comprobante de hace rato no es un pedido en curso, es un
    // fantasma que traba al usuario: se cierra sola antes de mirar si hay algo
    // activo. Ver `expireStalePendingProofs`.
    await this.expireStalePendingProofs(userId);

    // Fast-fail pre-check: reject early (before rate-limit/wallet lookups) when
    // the user already has an active load. The authoritative, race-safe check
    // runs again inside the Serializable transaction below.
    const activeLoad = await this.prisma.request.findFirst({
      where: {
        userId,
        status: {
          in: [
            'PENDING_PROOF',
            'VALIDATING',
            'PENDING_MP_VERIFICATION',
            'APPROVED',
            'PROCESSING',
          ],
        },
      },
      select: { amount: true, status: true, proofUrl: true },
      orderBy: { createdAt: 'desc' },
    });

    if (activeLoad) {
      throw new BadRequestException(
        RequestsService.activeLoadMessage(activeLoad),
      );
    }

    // Check rate limit (max requests per hour)
    const rateLimit = await this.settingsService.checkUserRateLimit(userId);
    if (!rateLimit.allowed) {
      const minutesUntilReset = Math.max(
        1,
        Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 60000),
      );
      throw new BadRequestException(
        `Límite de solicitudes excedido. Intenta de nuevo en ${minutesUntilReset} minutos.`,
      );
    }

    // Defense-in-depth: service-level amount guard
    // Allow amount=0 only when autoDetectAmount is true (AI will extract from proof)
    if (dto.amount <= 0 && !dto.autoDetectAmount) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Sin tope por solicitud. Decisión del dueño (2026-08-29): cuanto más carga
    // el usuario, mejor; el techo solo dejaba plata afuera. El único control que
    // queda es `amount > 0` acá arriba.
    //
    // Lo que SÍ sigue validando el monto es el comprobante: la carga no avanza
    // si el importe del comprobante no coincide (payments.service.ts).

    // La billetera que le toca a SU panel. Un usuario sin panel asignado recibe
    // la compartida, igual que siempre.
    const selectedWallet = await this.paymentsService.getSelectedWallet(
      user.panelId,
    );

    if (!selectedWallet) {
      throw new BadRequestException(
        'No hay billetera configurada. Contacte al operador.',
      );
    }

    // Create the request under a Serializable transaction so the
    // "one active load per user" check and the insert are atomic. Two
    // near-simultaneous POSTs (double-tap / app+web) would otherwise both
    // read pendingCount=0 and both insert, producing duplicate PENDING_PROOF
    // requests seconds apart. Serializable makes concurrent creators conflict.
    let request: Prisma.RequestGetPayload<{
      include: { user: { select: { id: true; username: true; email: true } } };
    }>;
    try {
      request = await this.prisma.$transaction(
        async (tx) => {
          // Race-safe re-check inside the Serializable tx: concurrent creators
          // conflict here instead of both seeing zero and inserting duplicates.
          const concurrentLoad = await tx.request.findFirst({
            where: {
              userId,
              status: {
                in: [
                  'PENDING_PROOF',
                  'VALIDATING',
                  'PENDING_MP_VERIFICATION',
                  'APPROVED',
                  'PROCESSING',
                ],
              },
            },
            select: { amount: true, status: true, proofUrl: true },
            orderBy: { createdAt: 'desc' },
          });

          if (concurrentLoad) {
            throw new BadRequestException(
              RequestsService.activeLoadMessage(concurrentLoad),
            );
          }

          const newRequest = await tx.request.create({
            data: {
              userId,
              targetUsername,
              amount: Math.floor(dto.amount),
              status: 'PENDING_PROOF',
              walletId: selectedWallet.id,
              panelId: user.panelId || null, // Copy from user (may be null until discovery)
            },
            include: {
              user: { select: { id: true, username: true, email: true } },
            },
          });

          // Record initial status in history
          await tx.requestStatusHistory.create({
            data: {
              requestId: newRequest.id,
              status: 'PENDING_PROOF',
              metadata: { initialRequest: true },
            },
          });

          return newRequest;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // A concurrent create won the race and Postgres aborted this tx with a
      // serialization failure (P2034). Functionally the user already has a
      // pending load, so surface the same friendly message instead of a 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        throw new BadRequestException(
          'Tu carga se creó recién. Mirá el chat para seguirla.',
        );
      }
      throw err;
    }

    // Get (or create) the user's persistent chat — all request messages go here
    const userChat = await this.chatsService.getOrCreateChat(userId);

    // Send initial system message tagged with the new requestId
    this.messagesService
      .sendSystemMessage(
        userChat.id,
        `Solicitud creada por $${Number(request.amount).toLocaleString('es-AR')}. Esperando comprobante de pago.`,
        request.id,
      )
      .catch((err) =>
        this.logger.error(`Initial system message failed: ${err.message}`),
      );

    this.events.emitRequestCreated(userId, {
      requestId: request.id,
      status: request.status,
      targetUsername: request.targetUsername,
      amount: Number(request.amount),
    });

    this.events.emitDashboardUpdate();

    return { ...request, chat: { id: userChat.id } };
  }

  async findAllByUser(userId: string) {
    const requests = await this.prisma.request.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      // Sin cota ni `select` devolvia todas las cargas del usuario con el JSON
      // del OCR de cada una. El chat-app no muestra historial: con las ultimas
      // 50 sobra para cualquier uso.
      take: 50,
      select: {
        ...REQUEST_LIST_SCALARS,
        job: { select: { id: true, status: true } },
        chat: {
          select: {
            id: true,
            _count: {
              select: {
                messages: {
                  where: { isRead: false, senderId: { not: userId } },
                },
              },
            },
          },
        },
      },
    });

    // La pregunta "transferiste de mas" pendiente: el chat la vuelve a mostrar
    // al abrirse. Solo se consulta si hay alguna carga validando.
    const validatingIds = requests
      .filter((r) => r.status === 'VALIDATING')
      .map((r) => r.id);
    const summaries =
      validatingIds.length > 0
        ? await fetchValidationSummaries(this.prisma, validatingIds)
        : new Map();

    return requests.map((r) => {
      const offer = summaries.get(r.id)?.overpaidOffer as
        { status?: string } | undefined;
      return {
        ...this.deliverableProof(r),
        unreadCount: r.chat?._count?.messages ?? 0,
        chat: r.chat ? { id: r.chat.id } : null,
        ...(offer?.status === 'PENDING' ? { overpaidOffer: offer } : {}),
      };
    });
  }

  /**
   * Find the user's current active request (if any)
   */
  async findActiveForUser(userId: string) {
    const found = await this.prisma.request.findFirst({
      where: {
        userId,
        status: {
          in: [
            'PENDING_PROOF',
            'VALIDATING',
            'PENDING_MP_VERIFICATION',
            'APPROVED',
            'PROCESSING',
          ],
        },
      },
      // El chat-app consulta esto en cada apertura del home: sin
      // `validationDetails` (el JSON del OCR, que ademas el usuario no usa).
      select: {
        ...REQUEST_LIST_SCALARS,
        chat: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!found) return found;

    // Si le estamos preguntando por una transferencia de mas, el chat tiene
    // que poder volver a mostrar la pregunta al reabrirse.
    if (found.status === 'VALIDATING') {
      const summary = (
        await fetchValidationSummaries(this.prisma, [found.id])
      ).get(found.id);
      const offer = summary?.overpaidOffer as { status?: string } | undefined;
      if (offer?.status === 'PENDING') {
        return { ...this.deliverableProof(found), overpaidOffer: offer };
      }
    }
    return this.deliverableProof(found);
  }

  /**
   * Active request OR the latest terminal one within the last 6 hours so the home banner
   * can show "Carga completada" / "Carga rechazada" / "Validación fallida" right after the
   * status changes. Mirrors the prize-claims `findCurrentForUser` pattern.
   */
  async findCurrentForUser(userId: string) {
    const active = await this.findActiveForUser(userId);
    if (active) return active;
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recent = await this.prisma.request.findFirst({
      where: {
        userId,
        status: {
          in: ['COMPLETED', 'REJECTED', 'VALIDATION_FAILED', 'FAILED'],
        },
        updatedAt: { gte: sixHoursAgo },
      },
      select: {
        ...REQUEST_LIST_SCALARS,
        chat: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return recent && this.deliverableProof(recent);
  }

  async findOne(id: string, userId?: string) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true } },
        job: true,
        chat: { select: { id: true } }, // Include chatId for message routing
      },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    // If userId provided, check ownership
    if (userId && request.userId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta solicitud');
    }

    return this.deliverableProof(request);
  }

  async uploadProof(
    requestId: string,
    userId: string,
    proofUrl: string,
    proofHash: string,
    canConfirmOverpaid = false,
  ) {
    // Fix 5: Use Serializable transaction to prevent concurrent proof uploads
    let updated: any;
    // Requests viejos del mismo usuario que quedaron cerrados por reusar este
    // comprobante. Se emiten DESPUES del commit para no notificar algo que
    // todavia puede hacer rollback.
    let supersededIds: string[] = [];
    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
            select: { id: true, status: true, userId: true },
          });

          if (!request) {
            throw new NotFoundException('Solicitud no encontrada');
          }

          if (request.userId !== userId) {
            throw new ForbiddenException('No tienes acceso a esta solicitud');
          }

          if (
            request.status !== 'PENDING_PROOF' &&
            request.status !== 'VALIDATION_FAILED'
          ) {
            throw new BadRequestException(
              'Esta solicitud ya tiene un comprobante',
            );
          }

          // Check for duplicate proof — block if used in a request que sigue viva
          // o que ya se acredito. Los estados de la lista de abajo son intentos
          // muertos: nunca se cargaron fichas, asi que el comprobante sigue siendo
          // del usuario y tiene que poder reusarlo. Si no, al usuario que le falla
          // la validacion le quemamos su unico comprobante real y queda trabado
          // para siempre (mismo criterio que uploads.service.ts al firmar).
          const DEAD_STATUSES = [
            'CANCELLED',
            'REJECTED',
            'VALIDATION_FAILED',
            'FAILED',
          ] as const;

          // Un FAILED cuyo job ya arranco en el bot NO es un intento muerto: el
          // bot pudo haber cargado las fichas antes de colgarse (2026-10-07,
          // nieva3: job colgado tras "started", el usuario reuso el comprobante
          // y se cargo otra vez). Eso lo resuelve un operador, no un reintento.
          const startedOnBot = {
            status: 'FAILED' as const,
            job: { is: { startedAt: { not: null } } },
          };

          const duplicate = await tx.request.findFirst({
            where: {
              proofHash,
              id: { not: requestId },
              OR: [
                // Mismo usuario: los intentos muertos liberan el comprobante.
                { userId, status: { notIn: [...DEAD_STATUSES] } },
                { userId, ...startedOnBot },
                // Otro usuario: criterio de siempre, sin aflojar. Reusar el
                // comprobante ajeno sigue bloqueado aunque aquel haya fallado.
                {
                  userId: { not: userId },
                  status: { notIn: ['CANCELLED', 'REJECTED'] },
                },
              ],
            },
            select: { id: true, status: true, userId: true, createdAt: true },
          });

          if (duplicate) {
            const isSameUser = duplicate.userId === userId;
            const alreadyCredited = [
              'APPROVED',
              'PROCESSING',
              'COMPLETED',
            ].includes(duplicate.status);
            this.logger.warn(
              `Duplicate proof detected: hash=${proofHash.slice(0, 16)}... ` +
                `original_request=${duplicate.id} status=${duplicate.status} ` +
                `same_user=${isSameUser}`,
            );
            throw new BadRequestException(
              isSameUser
                ? // Solo llega aca un FAILED si el bot ya habia empezado a cargar.
                  duplicate.status === 'FAILED'
                  ? 'Ya usaste este comprobante en otra solicitud y la está revisando un operador. Si hiciste otra transferencia, subí ese comprobante.'
                  : alreadyCredited
                    ? 'Este comprobante ya se usó en una carga que se acreditó. Subí uno diferente.'
                    : 'Ya usaste este comprobante en otra solicitud. Subí uno diferente.'
                : 'Este comprobante ya fue utilizado en otra solicitud. ' +
                    'Por favor, subí un comprobante diferente.',
            );
          }

          // Un request muerto puede RESUCITAR: approve() acepta VALIDATION_FAILED
          // y retryDiscoveryForRequest revive un FAILED hasta COMPLETED. Si
          // liberamos el comprobante y despues alguien resucita el original, el
          // usuario cobra dos veces por un solo pago. Los cerramos como CANCELLED
          // en la MISMA transaccion: CANCELLED no esta en el ALLOWED de approve()
          // ni pasa el chequeo `status !== 'FAILED'` del retry.
          const toSupersede = await tx.request.findMany({
            where: {
              proofHash,
              id: { not: requestId },
              userId,
              status: { in: ['VALIDATION_FAILED', 'FAILED'] },
              NOT: startedOnBot,
            },
            select: { id: true, status: true },
          });

          for (const dead of toSupersede) {
            await tx.request.update({
              where: { id: dead.id },
              data: {
                status: 'CANCELLED',
                rejectionReason: `Reemplazada: el comprobante se reuso en la solicitud ${requestId}`,
              },
            });
            await tx.requestStatusHistory.create({
              data: {
                requestId: dead.id,
                status: 'CANCELLED',
                changedBy: userId,
                metadata: {
                  reason: 'PROOF_REUSED_AFTER_FAILURE',
                  previousStatus: dead.status,
                  supersededBy: requestId,
                },
              },
            });
          }

          supersededIds = toSupersede.map((d) => d.id);

          return tx.request.update({
            where: { id: requestId },
            data: {
              proofUrl,
              proofHash,
              proofUploadedAt: new Date(),
              status: 'VALIDATING',
              // Se pisa con el resultado del validador; `setValidationResult`
              // lo lee antes para saber si puede preguntarle al jugador.
              validationDetails: canConfirmOverpaid
                ? { clientCanConfirmOverpaid: true }
                : Prisma.DbNull,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException(
          'Otra operación en curso. Reintentá en unos segundos.',
        );
      }
      throw error;
    }

    // Sacar del panel del operador los intentos que quedaron reemplazados, para
    // que no siga viendo una falla que el usuario ya resolvio reenviando.
    if (supersededIds.length > 0) {
      this.logger.log(
        `Proof reused after failure: hash=${proofHash.slice(0, 16)}... ` +
          `superseded ${supersededIds.length} dead request(s) [${supersededIds.join(', ')}] ` +
          `in favor of ${requestId} (user ${userId})`,
      );
      for (const deadId of supersededIds) {
        this.events.emitToOperators('request_status_update', {
          requestId: deadId,
          status: 'CANCELLED',
          updatedAt: new Date(),
        });
        // La web de operadores escucha /operator, no el namespace raíz: sin esto
        // la solicitud reemplazada seguía en la bandeja de fallos y la operadora
        // intentaba aprobarla o marcarla cargada (error "estado actual: CANCELLED").
        this.operatorGateway.emitToAll('failure_resolved', {
          failureId: deadId,
          action: 'superseded',
          supersededBy: requestId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.events.emitRequestUpdated(userId, {
      requestId: updated.id,
      status: updated.status,
    });

    this.events.emitDashboardUpdate();

    // Emit event for async validation (decoupled from PaymentsService via EventEmitter2)
    this.eventEmitter.emit(AppEvent.PAYMENT_PROOF_UPLOADED, {
      requestId,
    } satisfies PaymentProofUploadedEvent);

    return updated;
  }

  async cancel(requestId: string, userId: string) {
    const request = await this.findOne(requestId, userId);

    if (
      ![
        'PENDING_PROOF',
        'VALIDATING',
        'VALIDATION_FAILED',
        'PENDING_MP_VERIFICATION',
        'APPROVED',
        'CANCELLED',
      ].includes(request.status)
    ) {
      throw new BadRequestException(
        request.status === 'PROCESSING'
          ? 'La carga ya está en proceso, no se puede cancelar'
          : 'No se puede cancelar esta solicitud',
      );
    }

    // Already cancelled — idempotent
    if (request.status === 'CANCELLED') {
      return { success: true };
    }

    // If APPROVED, also cancel the associated QUEUED job (if any)
    if (request.status === 'APPROVED') {
      await this.prisma.job.updateMany({
        where: { requestId, status: 'QUEUED' },
        data: { status: 'FAILED', error: 'Cancelada por el usuario' },
      });
    }

    const updated = await this.prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        rejectionReason: 'Cancelada por el usuario',
      },
      include: { user: { select: { id: true, email: true } } },
    });

    // Notify operators in real-time
    this.events.emitToOperators('request_status_update', {
      requestId,
      status: 'CANCELLED',
      updatedAt: updated.updatedAt,
    });

    return { success: true };
  }

  /**
   * Estados en los que un operador puede cerrar una carga desde Seguimiento.
   *
   * `PROCESSING` NO está: el bot puede haber apretado Aceptar y no haber leído
   * la confirmación, así que cerrarla y reintentar después carga dos veces. Un
   * job realmente colgado lo levanta el detector de jobs trabados y termina en
   * FAILED, que sí es un estado cerrado.
   *
   * Los terminales tampoco: no hay nada que liberar.
   */
  private static readonly OPERATOR_CANCELLABLE: RequestStatus[] = [
    'PENDING_PROOF',
    'VALIDATING',
    'VALIDATION_FAILED',
    'APPROVED',
  ];

  /**
   * Cierra una carga que quedó colgada, desde el panel del operador.
   *
   * El caso que lo motiva: el usuario pide una carga y nunca sube el
   * comprobante. Esa solicitud queda en `PENDING_PROOF` para siempre y —esto es
   * lo importante— **le bloquea el pedido siguiente**, porque `create` rechaza
   * con "Ya tenés una carga en proceso" mientras haya una activa. Hasta ahora la
   * única salida era que el propio usuario la cancelara desde la app, cosa que
   * no hace porque ya se fue.
   *
   * No toca saldo, no acredita nada y no le manda ningún mensaje al usuario:
   * `CANCELLED` no tiene mensaje de sistema. Lo único que hace es soltar el
   * bloqueo y sacar la carga del tablero.
   */
  async cancelByOperator(
    requestId: string,
    operatorId: string,
    reason?: string,
  ) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, userId: true, targetUsername: true },
    });
    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }
    if (request.status === 'CANCELLED') {
      return { requestId, status: 'CANCELLED', alreadyCancelled: true };
    }
    if (!RequestsService.OPERATOR_CANCELLABLE.includes(request.status)) {
      throw new BadRequestException(
        request.status === 'PROCESSING'
          ? 'El bot ya está cargando: cerrarla ahora puede terminar en una carga doble. Esperá a que termine o falle.'
          : `La carga ya está cerrada (${request.status}), no hay nada que liberar.`,
      );
    }

    let previousStatus = request.status;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Se relee adentro: entre el chequeo de arriba y esta línea el
          // despachador pudo haberle dado el job al bot.
          const current = await tx.request.findUnique({
            where: { id: requestId },
            select: { status: true },
          });
          if (!current) throw new NotFoundException('Solicitud no encontrada');
          if (current.status === 'CANCELLED') return;
          if (!RequestsService.OPERATOR_CANCELLABLE.includes(current.status)) {
            throw new BadRequestException(
              'La carga cambió de estado mientras la cerrabas. Mirá cómo quedó antes de volver a intentar.',
            );
          }
          previousStatus = current.status;

          // Sólo los que siguen en cola: si el bot ya lo tomó, el estado de
          // arriba no sería APPROVED y no llegamos hasta acá.
          await tx.job.updateMany({
            where: { requestId, status: 'QUEUED' },
            data: {
              status: 'FAILED',
              error: 'Carga cerrada por un operador',
              completedAt: new Date(),
            },
          });

          await tx.request.update({
            where: { id: requestId },
            data: {
              status: 'CANCELLED',
              rejectionReason: reason?.trim() || 'Cerrada por un operador',
            },
          });

          await tx.requestStatusHistory.create({
            data: {
              requestId,
              status: 'CANCELLED',
              changedBy: operatorId,
              metadata: {
                operatorCancelled: true,
                previousStatus,
                reason: reason?.trim() || null,
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err: any) {
      // P2034: el despachador estaba tomando el mismo job. Reintentar a ciegas
      // sería justo lo que no queremos, así que se le devuelve al operador.
      if (err?.code === 'P2034') {
        throw new BadRequestException(
          'El bot tomó la carga justo ahora. Refrescá y fijate cómo quedó.',
        );
      }
      throw err;
    }

    this.logger.log(
      `Request ${requestId} (${request.targetUsername}) cerrada por el operador ${operatorId} desde ${previousStatus}`,
    );

    // Al panel: `emitToOperators` de EventsGateway va al namespace raíz y NO
    // llega a /operator, así que el aviso se manda derecho por el gateway del
    // panel. Sin esto, el resto de los operadores sigue viendo la carga viva.
    this.operatorGateway.emitToAll('load_cancelled', {
      requestId,
      status: 'CANCELLED',
      previousStatus,
      targetUsername: request.targetUsername,
      cancelledBy: operatorId,
      updatedAt: new Date().toISOString(),
    });

    // Al usuario: su pantalla de inicio sólo re-consulta las tarjetas de estado
    // con este evento. No hay alerta ni mensaje en el chat.
    this.events.emitRequestUpdated(request.userId, {
      requestId,
      status: 'CANCELLED',
    });
    this.events.emitDashboardUpdate();

    return { requestId, status: 'CANCELLED', previousStatus };
  }

  // ==========================================
  // OPERATOR ENDPOINTS
  // ==========================================

  async findPending() {
    const rows = await this.prisma.request.findMany({
      where: {
        status: { in: ['PENDING_PROOF', 'VALIDATING', 'APPROVED'] },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        ...REQUEST_LIST_SCALARS,
        user: { select: { id: true, email: true } },
        job: { select: { id: true, status: true } },
      },
    });
    return this.withValidationSummary(rows);
  }

  async findFailedValidation() {
    const rows = await this.prisma.request.findMany({
      where: { status: 'VALIDATION_FAILED' },
      orderBy: { createdAt: 'asc' },
      select: {
        ...REQUEST_LIST_SCALARS,
        user: { select: { id: true, email: true } },
      },
    });
    return this.withValidationSummary(rows);
  }

  async findAll(options?: {
    status?: RequestStatus;
    limit?: number;
    offset?: number;
  }) {
    const rows = await this.prisma.request.findMany({
      where: options?.status ? { status: options.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
      select: {
        ...REQUEST_LIST_SCALARS,
        user: { select: { id: true, email: true } },
        job: { select: { id: true, status: true } },
        approvedBy: { select: { id: true, email: true } },
      },
    });
    return this.withValidationSummary(rows);
  }

  /**
   * Las listas no traen `validationDetails` (el JSON del OCR, lo mas pesado de
   * la fila): se reemplaza por un resumen con las claves que la UI usa, armado
   * por Postgres. Ver `common/utils/validation-summary.ts`.
   */
  private async withValidationSummary<
    T extends { id: string; proofUrl?: string | null },
  >(rows: T[]) {
    const summaries = await fetchValidationSummaries(
      this.prisma,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      ...this.deliverableProof(r),
      validationDetails: summaries.get(r.id) ?? null,
    }));
  }

  /**
   * Deja el `proofUrl` listo para mostrarse. Se aplica en todo finder que salga
   * del backend: un PDF crudo de Cloudinary devuelve 401 y el visor (operador o
   * app) queda en blanco sin decir nada.
   */
  private deliverableProof<T extends { proofUrl?: string | null }>(row: T): T {
    if (!row || row.proofUrl === undefined) return row;
    return { ...row, proofUrl: toDeliverableProofUrlOrNull(row.proofUrl) };
  }

  /**
   * Cargas en curso con su recorrido completo, para el seguimiento del panel.
   *
   * `findAll` no sirve acá: devuelve la foto (el estado de ahora) y lo que el
   * operador necesita es la película — por qué paso va cada carga y hace cuánto
   * que no se mueve. Eso sólo está en `RequestStatusHistory`.
   *
   * Por defecto NO trae las cerradas. Una carga completada, fallada, rechazada o
   * cancelada ya no espera nada de nadie: en un tablero de seguimiento sólo
   * agrega ruido y empuja hacia abajo lo que sí está pasando. Se piden aparte
   * (`includeSettled`) cuando el operador quiere ir a mirar qué pasó.
   */
  async findActiveWithHistory(options?: {
    /** Antigüedad máxima. Una carga sin comprobante de hace tres días está
     *  abandonada, no trabada: no es trabajo pendiente de nadie. */
    windowMs?: number;
    /** Sumar las que ya terminaron, dentro de la misma ventana. */
    includeSettled?: boolean;
    limit?: number;
  }) {
    const since = new Date(
      Date.now() - (options?.windowMs ?? 24 * 60 * 60 * 1000),
    );

    // PENDING_MP_VERIFICATION queda afuera a propósito: sigue en el enum pero
    // ese tramo del flujo se eliminó.
    const IN_FLIGHT: RequestStatus[] = [
      'PENDING_PROOF',
      'VALIDATING',
      'VALIDATION_FAILED',
      'APPROVED',
      'PROCESSING',
    ];
    const SETTLED: RequestStatus[] = [
      'COMPLETED',
      'FAILED',
      'REJECTED',
      'CANCELLED',
    ];

    const rows = await this.prisma.request.findMany({
      where: {
        createdAt: { gte: since },
        status: {
          in: options?.includeSettled ? [...IN_FLIGHT, ...SETTLED] : IN_FLIGHT,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 60,
      // `select` y no `include`: la fila entera arrastraba `validationDetails`
      // (el JSON del OCR) y el historial con su `metadata` completo, en cada
      // refresco de Seguimiento de cada operador. Eso viajaba desde Supabase
      // y era la segunda fuente de egress. Lo poco que se usa de esos dos JSON
      // se pide aparte, ya recortado por Postgres.
      select: {
        id: true,
        userId: true,
        targetUsername: true,
        amount: true,
        status: true,
        proofUrl: true,
        proofHash: true,
        proofUploadedAt: true,
        extractedTransactionId: true,
        validationScore: true,
        validationError: true,
        panelId: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true, phone: true } },
        panel: { select: { id: true, name: true } },
        job: {
          select: {
            id: true,
            status: true,
            error: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
          },
        },
      },
    });

    const ids = rows.map((r) => r.id);
    const [summaries, histories] = await Promise.all([
      fetchValidationSummaries(this.prisma, ids),
      fetchSlimStatusHistory(this.prisma, ids),
    ]);

    // El comprobante sale ya entregable: un PDF crudo de Cloudinary da 401 y en
    // el panel queda un recuadro vacio, sin aviso.
    const withProof = rows.map((r) => ({
      ...r,
      validationDetails: summaries.get(r.id) ?? null,
      statusHistory: histories.get(r.id) ?? [],
      proofUrl: toDeliverableProofUrlOrNull(r.proofUrl),
    }));
    return attachProofTwins(this.prisma, withProof);
  }

  /**
   * Categorías del historial.
   *
   * El mapa vive acá y no en el cliente: así el panel manda una categoría y no
   * una lista de estados arbitraria, y nadie puede pedir una consulta que no
   * previmos. El panel tiene el mismo mapa sólo para dibujar los botones.
   */
  private static readonly HISTORY_CATEGORIES: Record<string, RequestStatus[]> =
    {
      completed: ['COMPLETED'],
      failed: ['FAILED', 'VALIDATION_FAILED'],
      closed: ['REJECTED', 'CANCELLED'],
      inflight: ['PENDING_PROOF', 'VALIDATING', 'APPROVED', 'PROCESSING'],
    };

  /**
   * Una página del historial de cargas.
   *
   * Tres decisiones para no castigar a la base, que es de producción y tiene
   * años de solicitudes:
   *
   * 1. **Paginación por keyset**, no por `skip`. Con OFFSET, la página 40 hace
   *    que Postgres cuente y descarte 400 filas antes de devolver 10; con
   *    `(createdAt, id) < (cursor)` entra por el índice `[createdAt]` y lee
   *    exactamente lo que devuelve, cueste lo que cueste la profundidad.
   * 2. **`select` acotado**. Un `Request` entero arrastra `validationDetails`,
   *    que es un JSON con el detalle del OCR y pesa más que todo el resto de la
   *    fila junta. En una lista no se usa para nada.
   * 3. **Sin `count()`**. Saber que hay 14.302 solicitudes no cambia ninguna
   *    decisión del operador, y ese conteo recorre la tabla en cada página.
   *    En vez de eso se piden `limit + 1` filas: si vuelve la de más, hay más.
   */
  async findHistoryPage(options?: {
    category?: string;
    /** Corte por antigüedad. Siempre hay uno: acota el índice que se recorre. */
    windowMs?: number;
    /** Busca por usuario del panel. */
    search?: string;
    /** Última fila de la página anterior. */
    cursor?: { createdAt: string; id: string };
    limit?: number;
  }) {
    const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
    const since = new Date(
      Date.now() - (options?.windowMs ?? 7 * 24 * 60 * 60 * 1000),
    );

    const statuses = options?.category
      ? RequestsService.HISTORY_CATEGORIES[options.category]
      : undefined;

    const search = options?.search?.trim();

    const where: Prisma.RequestWhereInput = {
      createdAt: { gte: since },
      ...(statuses ? { status: { in: statuses } } : {}),
      // Menos de dos letras no filtra nada útil y hace recorrer la ventana
      // entera comparando texto.
      ...(search && search.length >= 2
        ? {
            targetUsername: { contains: search, mode: 'insensitive' as const },
          }
        : {}),
    };

    const cursor = options?.cursor;
    if (cursor) {
      const at = new Date(cursor.createdAt);
      // Comparación compuesta: `createdAt` sola no alcanza porque dos
      // solicitudes pueden compartir el milisegundo y una se perdería entre
      // páginas (o se repetiría).
      where.AND = [
        {
          OR: [
            { createdAt: { lt: at } },
            { createdAt: at, id: { lt: cursor.id } },
          ],
        },
      ];
    }

    const rows = await this.prisma.request.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        userId: true,
        targetUsername: true,
        amount: true,
        status: true,
        proofUrl: true,
        // Para distinguir "nunca tuvo comprobante" de "el comprobante venció".
        proofUploadedAt: true,
        // Para marcar "comprobante repetido" sin que el operador compare a ojo.
        proofHash: true,
        extractedTransactionId: true,
        validationScore: true,
        validationError: true,
        rejectionReason: true,
        manuallyApproved: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true } },
        panel: { select: { name: true } },
        job: { select: { status: true, error: true, completedAt: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    // Mismo criterio que el seguimiento: PDF entregable + repetidos marcados.
    // `overpaidOffer`: transfirio de mas y lo decidio el jugador.
    const summaries = await fetchValidationSummaries(
      this.prisma,
      page.map((r) => r.id),
    );
    const items = await attachProofTwins(
      this.prisma,
      page.map((r) => ({
        ...r,
        proofUrl: toDeliverableProofUrlOrNull(r.proofUrl),
        proofPurged: proofWasPurged(r),
        overpaidOffer: summaries.get(r.id)?.overpaidOffer ?? null,
      })),
    );

    return {
      items,
      hasMore,
      nextCursor: last
        ? { createdAt: last.createdAt.toISOString(), id: last.id }
        : null,
    };
  }

  async approve(
    requestId: string,
    operatorId: string,
    dto?: ApproveRequestDto,
  ) {
    // Fix 33: Use Serializable transaction to prevent two operators approving simultaneously
    let updated: any;
    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
            include: { job: { select: { id: true, status: true } } },
          });

          if (!request) {
            throw new NotFoundException('Solicitud no encontrada');
          }

          const ALLOWED = [
            'VALIDATING',
            'VALIDATION_FAILED',
            'PENDING_MP_VERIFICATION',
          ];
          // Also allow re-approve for the "APPROVED but no job" inconsistency that
          // can happen when JobsService.createJobForRequest fails silently. Without
          // this, the operator gets "Esta solicitud no puede ser aprobada" with no
          // way to recover. We detect it as: status APPROVED and no Job row exists.
          const isApprovedWithoutJob =
            request.status === 'APPROVED' && !request.job;
          // Idem para las cargas que quedaron FAILED sin Job: son fallos de discovery
          // (nunca se resolvio un panel, el bot nunca se despacho). Aprobarlas vuelve a
          // crear el job, que re-dispara discovery. Sin Job no hay riesgo de carga doble:
          // los FAILED que SI tienen Job quedan excluidos a proposito.
          const isFailedWithoutJob =
            request.status === 'FAILED' && !request.job;
          if (
            !ALLOWED.includes(request.status) &&
            !isApprovedWithoutJob &&
            !isFailedWithoutJob
          ) {
            throw new BadRequestException(
              `Esta solicitud no puede ser aprobada (estado actual: ${request.status})`,
            );
          }

          // If operator approved with a different (extracted) amount, update it
          const originalAmount = Number(request.amount);
          const useApprovedAmount =
            dto?.approvedAmount !== undefined &&
            dto.approvedAmount > 0 &&
            dto.approvedAmount !== originalAmount;

          // Cuanto puede aprobar el operador.
          //
          // Antes el tope era el monto pedido, sin excepcion. Eso hacia
          // imposible el caso mas comun de todos: el usuario pide $1.000 y
          // transfiere $1.035. La plata entro, pero no habia forma de
          // acreditarsela — ni automatica ni a mano.
          //
          // El tope ahora es **lo que dice el comprobante**. Se puede aprobar
          // por mas de lo pedido, nunca por mas de lo que efectivamente se
          // transfirio, que es el unico numero respaldado por evidencia.
          //
          // Cuando el operador marca `amountOverride` el techo del comprobante
          // deja de aplicar. Es lo que destraba el caso que no tenia salida: el
          // OCR no leyo el monto (o leyo mal) y la plata igual entro. El techo
          // servia para el camino automatico; a un humano que esta mirando el
          // comprobante lo dejaba sin ninguna forma de acreditar lo transferido.
          // Queda el tope duro por carga y el registro de quien lo decidio.
          let overrideInfo: Record<string, unknown> | null = null;
          if (useApprovedAmount) {
            const approvedAmt = dto.approvedAmount!;
            const extracted = Number(
              (request.validationDetails as any)?.extractedAmount ?? 0,
            );
            // Un peso de tolerancia: los comprobantes traen centavos.
            const techo =
              extracted > 0
                ? Math.max(originalAmount, extracted)
                : originalAmount;

            if (dto?.amountOverride) {
              // Sin tope por carga (decisión del dueño, 2026-08-29). El monto lo
              // decide el operador y nada lo limita por arriba.
              if (approvedAmt > techo + 1) {
                overrideInfo = {
                  amountOverride: true,
                  techoOriginal: techo,
                  extractedAmount: extracted > 0 ? extracted : null,
                  overrideReason: dto.overrideReason ?? null,
                };
                this.logger.warn(
                  `Request ${requestId}: ${operatorId} carga $${approvedAmt} por encima de lo respaldado ` +
                    `($${techo}; comprobante=${extracted || 'ilegible'}). Motivo: ${dto.overrideReason ?? 'sin motivo'}`,
                );
              }
            } else if (approvedAmt > techo + 1) {
              throw new BadRequestException(
                extracted > 0 && techo === extracted
                  ? `El monto aprobado ($${approvedAmt}) no puede superar lo que dice el comprobante ($${extracted})`
                  : `El monto aprobado ($${approvedAmt}) no puede superar el monto solicitado ($${originalAmount})`,
              );
            }
          }

          // Si el operador aprueba una carga cuyo destinatario no se pudo verificar
          // contra nuestras billeteras, queda asentado quién y con qué flags. No se
          // bloquea: el operador ve el comprobante y decide.
          const fraudFlags: string[] =
            ((request.validationDetails as any)?.fraudFlags as string[]) ?? [];
          const unverifiedRecipient = fraudFlags.filter((f) =>
            [
              'RECIPIENT_ACCOUNT_MISMATCH',
              'RECIPIENT_MISMATCH',
              'RECIPIENT_UNVERIFIABLE',
            ].includes(f),
          );
          if (unverifiedRecipient.length > 0) {
            this.logger.warn(
              `Request ${requestId} aprobado manualmente por ${operatorId} con destinatario ` +
                `sin verificar: ${unverifiedRecipient.join(', ')}`,
            );
          }

          // Atomically update status + approval fields + record history
          const updatedRequest = await tx.request.update({
            where: { id: requestId },
            data: {
              status: 'APPROVED',
              manuallyApproved: true,
              approvedById: operatorId,
              approvedAt: new Date(),
              ...(useApprovedAmount ? { amount: dto.approvedAmount } : {}),
            },
          });

          await tx.requestStatusHistory.create({
            data: {
              requestId,
              status: 'APPROVED',
              changedBy: operatorId,
              metadata: {
                manualApproval: true,
                note: dto?.note,
                ...(useApprovedAmount
                  ? { originalAmount, approvedAmount: dto.approvedAmount }
                  : {}),
                ...(overrideInfo ?? {}),
                ...(unverifiedRecipient.length > 0
                  ? { unverifiedRecipient }
                  : {}),
              },
            },
          });

          return updatedRequest;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException(
          'Esta solicitud fue modificada por otro operador. Reintentá.',
        );
      }
      throw error;
    }

    this.logger.log(`Request ${requestId} approved by operator ${operatorId}`);

    // Send system message to chat
    // Send system message to user's persistent chat
    this.sendRequestSystemMessage(
      requestId,
      updated.userId,
      'Pago aprobado manualmente por un operador. Procesando carga de fichas...',
    );

    // After commit: emit events, send notification, create job

    this.events.emitRequestUpdated(updated.userId, {
      requestId: updated.id,
      status: 'APPROVED',
    });

    this.events.emitDashboardUpdate();

    // Accumulate wallet amount and check for auto-rotation
    try {
      await this.handleWalletAccumulation(
        updated.walletId,
        Number(updated.amount),
        requestId,
      );
    } catch (walletError) {
      this.logger.error(
        `Wallet accumulation failed for request ${requestId}: ${walletError.message}`,
      );
      this.operatorGateway.emitToAll('wallet_accumulation_failed', {
        requestId,
        walletId: updated.walletId,
        amount: Number(updated.amount),
        error: walletError.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Auto-create job for the approved request (Fix 15)
    try {
      await this.jobsService.createJobForRequest(requestId);
      this.logger.log(`Job auto-created for approved request ${requestId}`);
    } catch (jobError: any) {
      // Request is APPROVED but no Job exists — inconsistent state. Operator must intervene.
      this.logger.error(
        `CRITICAL: Approved request ${requestId} but job creation failed: ${jobError.message}. Request remains APPROVED — operator must retry or reject manually.`,
      );
      // Use the standard system:alert channel (same as JobsService.handleValidationCompleted)
      // so operator-panel surfaces this in its alerts queue, not as a one-off event.
      this.operatorGateway.emitToAll('system:alert', {
        type: 'JOB_CREATION_FAILED',
        severity: 'critical',
        requestId,
        userId: updated.userId,
        amount: Number(updated.amount),
        error: jobError.message,
        message: `Aprobación ${requestId.slice(0, 8)} sin job — intervención manual requerida`,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  async reject(requestId: string, operatorId: string, dto: RejectRequestDto) {
    // Fix 33: Use Serializable transaction to prevent concurrent approve+reject
    let updated: any;
    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
            include: { job: { select: { id: true } } },
          });

          if (!request) {
            throw new NotFoundException('Solicitud no encontrada');
          }

          // FAILED sin Job = fallo de discovery: el bot nunca se despacho, asi que
          // rebotar a PENDING_PROOF para que el usuario re-suba el comprobante es
          // seguro. Los FAILED CON Job quedan fuera: ahi el bot si toco el panel.
          const isFailedWithoutJob =
            request.status === 'FAILED' && !request.job;
          if (
            !['VALIDATING', 'VALIDATION_FAILED', 'APPROVED'].includes(
              request.status,
            ) &&
            !isFailedWithoutJob
          ) {
            throw new BadRequestException('Esta solicitud ya fue procesada');
          }

          const wasApproved = request.status === 'APPROVED';

          // "Rechazar" NO es terminal: rebota la solicitud a PENDING_PROOF para que
          // el usuario re-suba el comprobante del MISMO pago (no vuelve a pagar).
          // Limpiamos el comprobante viejo + resultados de validación para que la app,
          // al ver PENDING_PROOF sin proofUrl, muestre de nuevo el uploader.
          const updatedRequest = await tx.request.update({
            where: { id: requestId },
            data: {
              status: 'PENDING_PROOF',
              proofUrl: null,
              proofHash: null,
              proofUploadedAt: null,
              validationScore: null,
              validationError: null,
              validationDetails: undefined,
              extractedTransactionId: null,
              rejectionReason: null,
              approvedById: null,
              approvedAt: null,
              assignedOperatorId: null,
              assignedAt: null,
            },
          });

          await tx.requestStatusHistory.create({
            data: {
              requestId,
              status: 'PENDING_PROOF',
              changedBy: operatorId,
              metadata: {
                reopenedFromFailure: true,
                reason: dto.reason,
                wasApproved,
              },
            },
          });

          // Attach wasApproved + walletId for post-commit wallet decrement
          (updatedRequest as any)._wasApproved = wasApproved;
          (updatedRequest as any)._walletId = request.walletId;
          (updatedRequest as any)._amount = Number(request.amount);

          return updatedRequest;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException(
          'Esta solicitud fue modificada por otro operador. Reintentá.',
        );
      }
      throw error;
    }

    this.logger.log(
      `Request ${requestId} bounced back to PENDING_PROOF by operator ${operatorId} (re-upload requested): ${dto.reason}`,
    );

    // Pedimos al usuario que suba de nuevo el comprobante. NO es un rechazo terminal:
    // el pago ya lo hizo, sólo el comprobante no sirvió.
    const reuploadMsg = this.templates.compose(
      'PROOF_REUPLOAD',
      dto.reason ? `Motivo: ${dto.reason}` : null,
    );
    this.sendRequestSystemMessage(requestId, updated.userId, reuploadMsg);

    // After commit: emit events, send notification

    // La app ya sabe: al ver PENDING_PROOF sin proofUrl, muestra el uploader.
    this.events.emitRequestUpdated(updated.userId, {
      requestId: updated.id,
      status: 'PENDING_PROOF',
      reason: dto.reason,
    });

    // Native push notification — works even when the app is closed.
    this.pushService
      .sendToUser(
        updated.userId,
        'Subí el comprobante de nuevo',
        dto.reason
          ? `${dto.reason}. Abrí la app para volver a subir el comprobante.`
          : 'Tu comprobante no se pudo validar. Abrí la app para volver a subirlo.',
        { requestId: updated.id, type: 'proof_reupload_requested' },
      )
      .catch((err: any) =>
        this.logger.warn(
          `Push (reject) failed for user ${updated.userId}: ${err.message}`,
        ),
      );

    this.events.emitDashboardUpdate();

    // Fix 9: Reverse wallet accumulation if request was previously APPROVED
    if (updated._wasApproved && updated._walletId) {
      try {
        await this.paymentsService.decrementWalletAmount(
          updated._walletId,
          updated._amount,
        );
        const wallet = await this.paymentsService.getWalletById(
          updated._walletId,
        );
        if (wallet) {
          this.operatorGateway.emitToAll('wallet_updated', wallet);
        }
        this.logger.log(
          `Wallet amount decremented for rejected request ${requestId}`,
        );
      } catch (walletError) {
        this.logger.error(
          `Failed to decrement wallet for rejected request ${requestId}: ${walletError.message}`,
        );
      }
    }

    return updated;
  }

  /**
   * Carga de fichas decidida por un operador, sin que exista un pedido del
   * usuario esperando.
   *
   * Hasta ahora la unica forma de que el bot cargara fichas era aprobar una
   * Request existente, y el monto salia de esa Request. Si el pedido ya se
   * habia cerrado —o nunca existio, porque la persona pago y escribio por
   * chat— no habia ningun camino: ni el panel ni la API podian crear una carga.
   *
   * Se crea una Request sintetica ya aprobada en vez de un Job suelto a
   * proposito: todo lo que viene despues (el bot, el mensaje "fichas cargadas"
   * al usuario, el Seguimiento, el Historial, el reintento) esta colgado del
   * Request. Un Job sin `requestId` se ejecuta pero muere sin avisarle a nadie
   * (`bot.service.ts`: "cannot update request status").
   *
   * `walletId` queda en null: no entro plata por una billetera nuestra en este
   * acto, y acumularla falsearia la rotacion.
   */
  async createManualLoad(params: {
    userId: string;
    amount: number;
    operatorId: string;
    note?: string;
  }) {
    const { userId, operatorId } = params;
    const amount = Math.floor(Number(params.amount));

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    // Sin tope acá tampoco: el operador decide el monto y no le ponemos techo.

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        savedTargetUsername: true,
        panelId: true,
      },
    });

    if (!user || !user.username) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Mismo alias que usa `create()`: el nombre en el panel puede diferir del
    // nombre en la app.
    const targetUsername = user.savedTargetUsername ?? user.username;

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.request.create({
        data: {
          userId,
          targetUsername,
          amount,
          status: 'APPROVED',
          manuallyApproved: true,
          approvedById: operatorId,
          approvedAt: new Date(),
          walletId: null,
          panelId: user.panelId || null,
        },
      });

      await tx.requestStatusHistory.create({
        data: {
          requestId: created.id,
          status: 'APPROVED',
          changedBy: operatorId,
          metadata: {
            manualApproval: true,
            manualLoad: true,
            note: params.note ?? null,
            approvedAmount: amount,
          },
        },
      });

      return created;
    });

    this.logger.log(
      `Carga manual: ${operatorId} carga $${amount} a ${targetUsername} (request ${request.id})`,
    );

    this.events.emitDashboardUpdate();
    this.operatorGateway.emitToAll('manual_load_created', {
      requestId: request.id,
      targetUsername,
      amount,
      operatorId,
      timestamp: new Date().toISOString(),
    });

    // Igual que en `approve()`: si la creacion del job falla, el Request queda
    // APPROVED sin Job y se puede recuperar desde el panel (el guard de
    // `approve` acepta ese estado justamente para esto).
    try {
      await this.jobsService.createJobForRequest(request.id);
    } catch (jobError: any) {
      this.logger.error(
        `Carga manual ${request.id} quedo sin job: ${jobError.message}`,
      );
      this.operatorGateway.emitToAll('system:alert', {
        type: 'JOB_CREATION_FAILED',
        severity: 'critical',
        requestId: request.id,
        message: `La carga manual de ${targetUsername} quedo aprobada pero sin job: ${jobError.message}`,
        timestamp: new Date().toISOString(),
      });
      throw new BadRequestException(
        `Se aprobo la carga pero no se pudo encolar al bot: ${jobError.message}`,
      );
    }

    return {
      requestId: request.id,
      targetUsername,
      amount,
    };
  }

  /**
   * Operator manually marks a failed/stuck request as loaded (COMPLETED) —
   * WITHOUT dispatching a bot job. Used when the operator already loaded the
   * chips by hand (e.g. the validator timed out or bounced the proof, but the
   * payment was verified manually). Previously the only way to close such an
   * orphaned VALIDATION_FAILED/FAILED request was direct DB surgery.
   *
   * Deliberately does NOT create a Job (the chips are already loaded — a job
   * would double-load) and does NOT accumulate the wallet (rotation accounting
   * is handled separately; avoiding a double-count is safer here).
   */
  async markLoadedManually(
    requestId: string,
    operatorId: string,
    note?: string,
  ) {
    let updated: any;
    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
            select: { id: true, status: true, userId: true },
          });

          if (!request) {
            throw new NotFoundException('Solicitud no encontrada');
          }

          // Idempotent: already completed → treat as success (another operator
          // may have closed it first).
          if (request.status === 'COMPLETED') {
            return { ...request, _alreadyCompleted: true };
          }

          const ALLOWED = [
            'VALIDATION_FAILED',
            'FAILED',
            'PENDING_MP_VERIFICATION',
          ];
          if (!ALLOWED.includes(request.status)) {
            throw new BadRequestException(
              `Esta solicitud no puede marcarse como cargada (estado actual: ${request.status})`,
            );
          }

          const updatedRequest = await tx.request.update({
            where: { id: requestId },
            data: {
              status: 'COMPLETED',
              manuallyApproved: true,
              approvedById: operatorId,
              approvedAt: new Date(),
            },
          });

          await tx.requestStatusHistory.create({
            data: {
              requestId,
              status: 'COMPLETED',
              changedBy: operatorId,
              metadata: {
                manualLoad: true,
                note: note || null,
                previousStatus: request.status,
              },
            },
          });

          return updatedRequest;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException(
          'Esta solicitud fue modificada por otro operador. Reintentá.',
        );
      }
      throw error;
    }

    if (updated._alreadyCompleted) {
      return updated;
    }

    this.logger.log(
      `Request ${requestId} marked as manually loaded (COMPLETED, no job) by operator ${operatorId}`,
    );

    // Tell the user their chips are loaded — same message as the automatic path.
    this.sendRequestSystemMessage(
      requestId,
      updated.userId,
      this.templates.pick('CHIPS_LOADED'),
    );

    this.events.emitRequestUpdated(updated.userId, {
      requestId: updated.id,
      status: 'COMPLETED',
    });
    this.events.emitDashboardUpdate();

    return updated;
  }

  // ==========================================
  // VALIDATION RESULT (called by payments service)
  // ==========================================

  async setValidationResult(
    requestId: string,
    result: {
      valid: boolean;
      score: number;
      error?: string;
      details?: any;
    },
  ) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'VALIDATING') {
      this.logger.warn(
        `setValidationResult called for request ${requestId} in status ${request.status} — skipping (already processed)`,
      );
      return request;
    }

    // Un comprobante validado va derecho a APPROVED. La verificación de acreditación
    // estilo MP no existe: no hay extensión que la alimente y PENDING_MP_VERIFICATION
    // es un pozo sin fondo (la tabla MpVerification nunca registró una sola fila).
    // La prueba de que el dinero llegó a una cuenta nuestra la da el comprobante, en
    // PaymentsService.verifyRecipient, y es bloqueante.
    const approvedStatus: RequestStatus = 'APPROVED';

    // Auto-detect amount: if request was created with amount=0, fill it from AI extraction
    const isAutoDetect = Number(request.amount) === 0;
    let autoDetectedAmount: number | undefined;

    if (isAutoDetect && result.valid) {
      const extracted = result.details?.extractedAmount;
      if (extracted && extracted > 0) {
        autoDetectedAmount = Math.floor(extracted);
        this.logger.log(
          `Auto-detect: extracted amount $${autoDetectedAmount} for request ${requestId}`,
        );
      } else {
        // AI couldn't extract amount — mark as failed so operator can review
        result.valid = false;
        result.error =
          'No se pudo detectar el monto del comprobante. Intentá cargando manualmente.';
        this.logger.warn(
          `Auto-detect: could not extract amount for request ${requestId}`,
        );
      }
    }

    // Transferir de mas NO se acredita solo: `AMOUNT_OVERPAID` es bloqueante y
    // la carga queda esperando que un operador la acepte con un boton, ya con el
    // monto del comprobante cargado. Decision del dueño: no confiar en que un
    // monto mayor leido por OCR sea siempre real.
    const amountToLoad = autoDetectedAmount;

    // Transfirio otro monto (de mas o de menos), el monto esta bien leido y el
    // chat web del jugador sabe preguntarle: la carga sigue en VALIDATING (no
    // entra a la Bandeja) y el jugador decide si carga lo transferido. Si
    // rechaza o no contesta en OVERPAID_OFFER_TTL_MS, va al operador.
    const clientCanConfirm =
      (request.validationDetails as any)?.clientCanConfirmOverpaid === true;
    const extractedForOffer = Math.floor(
      Number(result.details?.extractedAmount ?? 0),
    );
    if (
      !result.valid &&
      result.details?.overpaidOfferable === true &&
      clientCanConfirm &&
      !isAutoDetect &&
      extractedForOffer > 0 &&
      Math.abs(extractedForOffer - Number(request.amount)) > 1
    ) {
      return this.offerOverpaidToUser(request, result, extractedForOffer);
    }

    const newStatus: RequestStatus = result.valid
      ? approvedStatus
      : 'VALIDATION_FAILED';
    const isApproved = newStatus === 'APPROVED';

    // Merge status update + validation fields + history record in a single transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.request.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          validationScore: result.score,
          validationError: result.error,
          validationDetails: result.details,
          extractedTransactionId: result.details?.transactionId || null,
          approvedAt: isApproved ? new Date() : undefined,
          ...(amountToLoad ? { amount: amountToLoad } : {}),
        },
      });

      await tx.requestStatusHistory.create({
        data: {
          requestId,
          status: newStatus,
          changedBy: 'system-validator',
          metadata: {
            validationScore: result.score,
            validationError: result.error,
            autoValidation: true,
          },
        },
      });

      return updatedRequest;
    });

    // Post-commit: send system message to chat
    // Send status message to user's persistent chat
    const statusMsg = this.getStatusSystemMessage(newStatus);
    if (statusMsg) {
      this.sendRequestSystemMessage(requestId, request.userId, statusMsg);
    }

    this.events.emitRequestUpdated(request.userId, {
      requestId: updated.id,
      status: newStatus,
      validationScore: result.score,
    });

    this.events.emitDashboardUpdate();

    // Wallet accumulation: solo cuando la carga quedó aprobada
    if (isApproved) {
      // Lo que de verdad entro a la billetera, no lo que el usuario habia pedido:
      // si no, el tope de la billetera se queda corto y rota tarde.
      this.handleWalletAccumulation(
        request.walletId,
        amountToLoad ?? Number(request.amount),
        requestId,
      );
    }

    return updated;
  }

  // ==========================================
  // TRANSFERENCIA DE MAS: LO DECIDE EL JUGADOR
  // ==========================================

  /**
   * Guarda el resultado del validador dejando la carga en VALIDATING y le
   * pregunta al jugador si quiere cargar lo que transfirio. No entra a la
   * Bandeja: si rechaza o no contesta, `sendOverpaidToOperator` la manda.
   */
  private async offerOverpaidToUser(
    request: { id: string; userId: string; amount: unknown },
    result: { valid: boolean; score: number; error?: string; details?: any },
    offeredAmount: number,
  ) {
    const requestedAmount = Number(request.amount);
    const offer = {
      status: 'PENDING' as const,
      requestedAmount,
      offeredAmount,
      offeredAt: new Date().toISOString(),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.request.update({
        where: { id: request.id },
        data: {
          validationScore: result.score,
          validationError: result.error,
          validationDetails: {
            ...(result.details ?? {}),
            overpaidOffer: offer,
          },
          extractedTransactionId: result.details?.transactionId || null,
        },
      });
      await tx.requestStatusHistory.create({
        data: {
          requestId: request.id,
          status: 'VALIDATING',
          changedBy: 'system-validator',
          metadata: {
            validationScore: result.score,
            note: `Transfirio $${offeredAmount} (pidio $${requestedAmount}): se le pregunta al jugador`,
            overpaidOffer: offer,
          },
        },
      });
      return updatedRequest;
    });

    this.logger.log(
      `Request ${request.id}: transfirio $${offeredAmount} (pidio $${requestedAmount}), ` +
        `se le pregunta al jugador`,
    );

    this.events.emitRequestUpdated(request.userId, {
      requestId: request.id,
      status: 'VALIDATING',
      overpaidOffer: offer,
    });

    return updated;
  }

  /** El jugador contesta la pregunta de la transferencia de mas. */
  async respondOverpaidOffer(
    requestId: string,
    userId: string,
    accept: boolean,
  ) {
    const decidedAt = new Date().toISOString();
    let result: { request: any; offer: any };
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id: requestId },
          });
          if (!request) throw new NotFoundException('Solicitud no encontrada');
          if (request.userId !== userId) {
            throw new ForbiddenException('No tienes acceso a esta solicitud');
          }
          const details = (request.validationDetails ?? {}) as any;
          const pending = details.overpaidOffer;
          if (
            request.status !== 'VALIDATING' ||
            pending?.status !== 'PENDING'
          ) {
            throw new BadRequestException(
              'Esta carga ya no está esperando tu respuesta.',
            );
          }

          const offer = {
            ...pending,
            status: accept ? 'ACCEPTED' : 'REJECTED',
            decidedAt,
          };
          const updatedRequest = await tx.request.update({
            where: { id: requestId },
            data: accept
              ? {
                  status: 'APPROVED',
                  approvedAt: new Date(),
                  amount: offer.offeredAmount,
                  validationDetails: { ...details, overpaidOffer: offer },
                }
              : {
                  status: 'VALIDATION_FAILED',
                  validationDetails: { ...details, overpaidOffer: offer },
                },
          });
          await tx.requestStatusHistory.create({
            data: {
              requestId,
              status: accept ? 'APPROVED' : 'VALIDATION_FAILED',
              changedBy: userId,
              metadata: accept
                ? {
                    note: `El jugador acepto cargar $${offer.offeredAmount} (habia pedido $${offer.requestedAmount})`,
                    originalAmount: offer.requestedAmount,
                    approvedAmount: offer.offeredAmount,
                    overpaidOffer: offer,
                  }
                : {
                    note: `El jugador no quiso cargar los $${offer.offeredAmount} transferidos (habia pedido $${offer.requestedAmount})`,
                    overpaidOffer: offer,
                  },
            },
          });
          return { request: updatedRequest, offer };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException('Otra operación en curso. Reintentá.');
      }
      throw error;
    }

    if (accept) {
      await this.finishOverpaidAccepted(result.request, result.offer);
    } else {
      await this.sendOverpaidToOperator(result.request);
    }
    return { requestId, status: result.request.status };
  }

  private async finishOverpaidAccepted(request: any, offer: any) {
    this.logger.log(
      `Request ${request.id}: el jugador acepto cargar $${offer.offeredAmount} ` +
        `(pidio $${offer.requestedAmount})`,
    );
    this.sendRequestSystemMessage(
      request.id,
      request.userId,
      `Listo, cargamos los $${Number(offer.offeredAmount).toLocaleString('es-AR')} que transferiste. Procesando carga de fichas...`,
    );
    this.events.emitRequestUpdated(request.userId, {
      requestId: request.id,
      status: 'APPROVED',
    });
    this.events.emitDashboardUpdate();

    try {
      await this.handleWalletAccumulation(
        request.walletId,
        Number(offer.offeredAmount),
        request.id,
      );
    } catch (walletError: any) {
      this.logger.error(
        `Wallet accumulation failed for request ${request.id}: ${walletError.message}`,
      );
    }

    try {
      await this.jobsService.createJobForRequest(request.id);
    } catch (jobError: any) {
      // Mismo caso que approve(): APPROVED sin job, el operador lo reintenta.
      this.logger.error(
        `CRITICAL: Overpaid-accepted request ${request.id} but job creation failed: ${jobError.message}`,
      );
      this.operatorGateway.emitToAll('system:alert', {
        type: 'JOB_CREATION_FAILED',
        severity: 'critical',
        requestId: request.id,
        userId: request.userId,
        amount: Number(offer.offeredAmount),
        error: jobError.message,
        message: `Aprobación ${request.id.slice(0, 8)} sin job — intervención manual requerida`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Rechazo o sin respuesta: a la Bandeja, igual que antes de esta mejora. */
  private async sendOverpaidToOperator(request: any) {
    const statusMsg = this.getStatusSystemMessage('VALIDATION_FAILED');
    if (statusMsg) {
      this.sendRequestSystemMessage(request.id, request.userId, statusMsg);
    }
    this.events.emitRequestUpdated(request.userId, {
      requestId: request.id,
      status: 'VALIDATION_FAILED',
    });
    this.events.emitDashboardUpdate();
    await this.paymentsService
      .notifyValidationFailed(request, {
        valid: false,
        score: Number(request.validationScore ?? 0),
        error: request.validationError ?? undefined,
        details: request.validationDetails ?? undefined,
      })
      .catch((err: any) =>
        this.logger.error(
          `No se pudo avisar la transferencia de mas de ${request.id}: ${err.message}`,
        ),
      );
  }

  /** Las preguntas sin contestar en OVERPAID_OFFER_TTL_MS van al operador. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverpaidOffers() {
    try {
      const candidates = await this.prisma.request.findMany({
        where: {
          status: 'VALIDATING',
          validationDetails: {
            path: ['overpaidOffer', 'status'],
            equals: 'PENDING',
          },
        },
        select: { id: true, validationDetails: true },
        take: 50,
      });
      const cutoff = Date.now() - OVERPAID_OFFER_TTL_MS;
      for (const c of candidates) {
        const offer = (c.validationDetails as any)?.overpaidOffer;
        if (!offer?.offeredAt || Date.parse(offer.offeredAt) > cutoff) continue;

        const expired = {
          ...offer,
          status: 'EXPIRED',
          decidedAt: new Date().toISOString(),
        };
        const { count } = await this.prisma.request.updateMany({
          where: {
            id: c.id,
            status: 'VALIDATING',
            validationDetails: {
              path: ['overpaidOffer', 'status'],
              equals: 'PENDING',
            },
          },
          data: {
            status: 'VALIDATION_FAILED',
            validationDetails: {
              ...((c.validationDetails as object) ?? {}),
              overpaidOffer: expired,
            },
          },
        });
        if (count === 0) continue; // contesto justo ahora

        await this.prisma.requestStatusHistory.create({
          data: {
            requestId: c.id,
            status: 'VALIDATION_FAILED',
            changedBy: 'system-overpaid-offer-expired',
            metadata: {
              note: `El jugador no contesto si cargaba los $${offer.offeredAmount} transferidos`,
              overpaidOffer: expired,
            },
          },
        });
        const request = await this.prisma.request.findUnique({
          where: { id: c.id },
        });
        this.logger.log(
          `Request ${c.id}: el jugador no contesto la transferencia de mas, va al operador`,
        );
        if (request) await this.sendOverpaidToOperator(request);
      }
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Fallo el vencimiento de transferencias de mas: ${detalle}`,
      );
    }
  }

  // ==========================================
  // OPERATOR ASSIGNMENT
  // ==========================================

  async assignOperator(requestId: string, operatorId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (!['VALIDATION_FAILED', 'FAILED'].includes(request.status)) {
      throw new BadRequestException(
        'Solo se pueden asignar solicitudes fallidas',
      );
    }

    const updated = await this.prisma.request.update({
      where: { id: requestId },
      data: {
        assignedOperatorId: operatorId,
        assignedAt: new Date(),
      },
      include: {
        user: { select: { id: true, email: true } },
      },
    });

    this.logger.log(`Request ${requestId} assigned to operator ${operatorId}`);

    this.events.emitToOperators('request:assigned', {
      requestId,
      operatorId,
    });

    this.events.emitDashboardUpdate();

    return updated;
  }

  async unassignOperator(requestId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    const updated = await this.prisma.request.update({
      where: { id: requestId },
      data: {
        assignedOperatorId: null,
        assignedAt: null,
      },
    });

    this.logger.log(`Request ${requestId} unassigned`);

    this.events.emitToOperators('request:unassigned', {
      requestId,
    });

    this.events.emitDashboardUpdate();

    return updated;
  }

  async getAssignedToOperator(operatorId: string) {
    const rows = await this.prisma.request.findMany({
      where: {
        assignedOperatorId: operatorId,
        status: { in: ['VALIDATION_FAILED', 'FAILED'] },
      },
      orderBy: { assignedAt: 'asc' },
      include: {
        user: { select: { id: true, email: true } },
        job: {
          select: { id: true, status: true, error: true, screenshot: true },
        },
      },
    });
    return rows.map((r) => this.deliverableProof(r));
  }

  async getUnassignedFailures() {
    const rows = await this.prisma.request.findMany({
      where: {
        status: { in: ['VALIDATION_FAILED', 'FAILED'] },
        assignedOperatorId: null,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, email: true } },
        job: {
          select: { id: true, status: true, error: true, screenshot: true },
        },
      },
    });
    return rows.map((r) => this.deliverableProof(r));
  }

  // ==========================================
  // STATISTICS
  // ==========================================

  async getStats() {
    const [
      pending,
      validating,
      validationFailed,
      approved,
      processing,
      completed,
      failed,
      rejected,
      todayCompleted,
    ] = await Promise.all([
      this.prisma.request.count({ where: { status: 'PENDING_PROOF' } }),
      this.prisma.request.count({ where: { status: 'VALIDATING' } }),
      this.prisma.request.count({ where: { status: 'VALIDATION_FAILED' } }),
      this.prisma.request.count({ where: { status: 'APPROVED' } }),
      this.prisma.request.count({ where: { status: 'PROCESSING' } }),
      this.prisma.request.count({ where: { status: 'COMPLETED' } }),
      this.prisma.request.count({ where: { status: 'FAILED' } }),
      this.prisma.request.count({ where: { status: 'REJECTED' } }),
      this.prisma.request.count({
        where: {
          status: 'COMPLETED',
          updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return {
      pending,
      validating,
      validationFailed,
      approved,
      processing,
      completed,
      failed,
      rejected,
      todayCompleted,
    };
  }

  // ==========================================
  // REQUEST-CONTEXTUAL CHAT
  // ==========================================

  /**
   * Get or create a chat associated with a request
   * Returns the chat ID for message operations
   */
  async getOrCreateRequestChat(
    requestId: string,
    userId: string,
    userRole: string,
  ): Promise<string> {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { chat: true },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    // Check access: user must be owner or operator
    const isOwner = request.userId === userId;
    const isOperator = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(
      userRole,
    );

    if (!isOwner && !isOperator) {
      throw new ForbiddenException('No tienes acceso a esta solicitud');
    }

    // If request already has a dedicated per-request chat (old data), return it
    if (request.chat) {
      return request.chat.id;
    }

    // For new requests (unified chat model), return the user's persistent chat
    const userChat = await this.chatsService.getOrCreateChat(request.userId);
    return userChat.id;
  }

  // ==========================================
  // STATUS → SYSTEM MESSAGE MAPPING
  // ==========================================

  private getStatusSystemMessage(status: RequestStatus): string | null {
    // Los cuatro estados que el usuario más ve salen de plantillas editables
    // desde el panel (con variantes, para no sonar a robot). Los intermedios
    // siguen fijos: son puro trámite y nadie los va a querer redactar.
    const fromTemplate: Partial<Record<RequestStatus, TemplateKey>> = {
      COMPLETED: 'CHIPS_LOADED',
      FAILED: 'LOAD_FAILED',
      VALIDATION_FAILED: 'PROOF_INVALID',
      REJECTED: 'REQUEST_REJECTED',
    };
    const key = fromTemplate[status];
    if (key) return this.templates.pick(key);

    const map: Partial<Record<RequestStatus, string>> = {
      VALIDATING: 'Validando comprobante de pago...',
      PENDING_MP_VERIFICATION:
        'Comprobante validado. Verificando recepción del pago...',
      APPROVED: 'Pago verificado. Procesando carga de fichas...',
      PROCESSING: 'Cargando fichas en tu cuenta...',
    };
    return map[status] || null;
  }

  // ==========================================
  // STATUS HISTORY & TIMELINE
  // ==========================================

  /**
   * Update request status and record in history
   * Use this helper method for all status changes to ensure history is tracked
   */
  async updateRequestStatus(
    requestId: string,
    newStatus: RequestStatus,
    changedBy?: string,
    metadata?: any,
  ) {
    // Validate status transition
    const currentRequest = await this.prisma.request.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    if (currentRequest) {
      // Idempotent no-op: the same event can fire more than once for a request
      // (dispatcher sets PROCESSING then the bot confirms start and re-emits
      // job.started; duplicate/retry jobs re-emit job.completed). A same-state
      // transition is a no-op, not an error — skip silently instead of throwing
      // and spamming the error log + re-sending the user system message.
      if (currentRequest.status === newStatus) {
        this.logger.debug(
          `Request ${requestId} already in ${newStatus}, skipping duplicate transition`,
        );
        return this.prisma.request.findUnique({ where: { id: requestId } });
      }
      const allowedTransitions =
        RequestsService.VALID_TRANSITIONS[currentRequest.status] || [];
      if (!allowedTransitions.includes(newStatus)) {
        this.logger.warn(
          `Invalid status transition for request ${requestId}: ${currentRequest.status} → ${newStatus}. Allowed: ${allowedTransitions.join(', ')}`,
        );
        throw new BadRequestException(
          `Transición de estado inválida: ${currentRequest.status} → ${newStatus}`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update request status
      const updatedRequest = await tx.request.update({
        where: { id: requestId },
        data: { status: newStatus },
      });

      // Record status change in history
      await tx.requestStatusHistory.create({
        data: {
          requestId,
          status: newStatus,
          changedBy,
          metadata,
        },
      });

      return updatedRequest;
    });

    // Send system message to user's persistent chat
    const statusMsg2 = this.getStatusSystemMessage(newStatus);
    if (statusMsg2) {
      this.sendRequestSystemMessage(requestId, updated.userId, statusMsg2);
    }

    return updated;
  }

  /**
   * Get status change timeline for a request
   */
  async getRequestTimeline(requestId: string, userId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      select: { userId: true },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    // Only allow owner to view timeline
    if (request.userId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta solicitud');
    }

    const timeline = await this.prisma.requestStatusHistory.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
    });

    return timeline;
  }

  // ==========================================
  // EVENT LISTENERS (decoupled from bot.service)
  // ==========================================

  @OnEvent(AppEvent.JOB_STARTED)
  async onJobStarted(event: {
    jobId: string;
    requestId: string;
    userId: string;
  }) {
    this.logger.log(
      `[Event] job.started — requestId=${event.requestId}, jobId=${event.jobId}`,
    );
    try {
      await this.updateRequestStatus(
        event.requestId,
        'PROCESSING',
        'system-bot',
        {
          jobId: event.jobId,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update request ${event.requestId} to PROCESSING: ${error.message}`,
      );
    }
  }

  @OnEvent(AppEvent.JOB_COMPLETED)
  async onJobCompleted(event: { requestId: string; jobId: string }) {
    // Jobs sin request (CHANGE_PASSWORD, WITHDRAW_CHIPS, CREATE_USER) emiten
    // este evento solo para disparar el próximo despacho.
    if (!event.requestId) return;
    this.logger.log(
      `[Event] job.completed — requestId=${event.requestId}, jobId=${event.jobId}`,
    );
    try {
      await this.updateRequestStatus(
        event.requestId,
        'COMPLETED',
        'system-bot',
        {
          jobId: event.jobId,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update request ${event.requestId} to COMPLETED: ${error.message}`,
      );
    }
  }

  @OnEvent(AppEvent.JOB_FAILED)
  async onJobFailed(event: {
    requestId: string;
    jobId: string;
    error?: string;
  }) {
    this.logger.log(
      `[Event] job.failed — requestId=${event.requestId}, jobId=${event.jobId}`,
    );
    try {
      await this.updateRequestStatus(event.requestId, 'FAILED', 'system-bot', {
        jobId: event.jobId,
        error: event.error,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update request ${event.requestId} to FAILED: ${error.message}`,
      );
    }
  }
}
