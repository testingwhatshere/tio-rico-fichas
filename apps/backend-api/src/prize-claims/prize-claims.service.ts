import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { MessageTemplatesService } from '../message-templates/message-templates.service';
import { EventsGateway } from '../events/events.gateway';
import { BotGateway } from '../bot/bot.gateway';
import { TelegramService } from '../notifications/telegram.service';
import { PushService } from '../notifications/push.service';
import { SetPrizePaymentDto, RejectPrizeClaimDto } from './dto';
import { PrizeClaimStatus } from '@prisma/client';

const MIN_PRIZE_CLAIM_AMOUNT = 3_000;

/**
 * Días que un premio trabado sigue apareciendo como pendiente.
 *
 * Configurable por env para poder aflojarlo o apretarlo sin rebuild. No aplica
 * a `CHIPS_WITHDRAWN`: ese estado significa que las fichas ya salieron del
 * panel y el usuario espera su plata, así que nunca se archiva solo.
 */
const STALE_PRIZE_DAYS = Number(process.env.PRIZE_STALE_DAYS) > 0
  ? Number(process.env.PRIZE_STALE_DAYS)
  : 7;

/**
 * Los `VERIFICATION_FAILED` se archivan mucho antes.
 *
 * No son premios trabados sino fallas del verificador leyendo el saldo del
 * panel: el usuario vuelve a pedir el cobro y se genera un claim nuevo, así que
 * el viejo no se trabaja nunca. Con la ventana de 7 días eran 33 de los 37
 * "pendientes" — ruido puro que enseñaba a ignorar la pantalla. Un día alcanza
 * para que el operador vea el de hoy y pueda procesarlo a mano si quiere.
 */
/**
 * Cuánto tiempo un premio "en verificación" sigue mostrándose en el tablero.
 *
 * Es un estado que dura minutos: si lleva más que esto, o el barrido ya lo pasó
 * a VERIFICATION_FAILED o quedó huérfano de un reinicio y no hay nada que hacer
 * con él en la pantalla del día.
 */
const IN_FLIGHT_PRIZE_HOURS = 6;

const STALE_VERIFY_ERROR_DAYS =
  Number(process.env.PRIZE_VERIFY_ERROR_STALE_DAYS) > 0
    ? Number(process.env.PRIZE_VERIFY_ERROR_STALE_DAYS)
    : 1;

/**
 * No hay tope de monto para cobrar un premio: si el usuario ganó, se le paga.
 * Lo que sí puede haber son varios comprobantes, porque un premio grande se
 * transfiere desde varias cuentas para no pasar los límites de cada billetera.
 */
export type PayoutProofInput = { url: string; type?: string; name?: string };
export type PayoutProof = { url: string; type: 'image' | 'pdf'; name?: string };

/** Tope defensivo: 20 transferencias para un mismo premio ya es rarísimo. */
const MAX_PAYOUT_PROOFS = 20;

/**
 * Acepta el formato viejo (`proofUrl` suelto) y el nuevo (`proofs[]`), y
 * devuelve siempre una lista validada. Los duplicados exactos se descartan:
 * subir dos veces el mismo archivo no agrega evidencia y confunde al usuario,
 * que recibe un comprobante repetido por chat.
 */
function normalizePayoutProofs(payout: {
  proofUrl?: string;
  proofType?: string;
  proofs?: PayoutProofInput[];
}): PayoutProof[] {
  const raw: PayoutProofInput[] =
    Array.isArray(payout?.proofs) && payout.proofs.length
      ? payout.proofs
      : payout?.proofUrl
        ? [{ url: payout.proofUrl, type: payout.proofType }]
        : [];

  if (!raw.length) {
    throw new BadRequestException(
      'Adjuntá el comprobante de la transferencia (imagen o PDF) para poder marcar el premio como pagado.',
    );
  }
  if (raw.length > MAX_PAYOUT_PROOFS) {
    throw new BadRequestException(
      `No se pueden adjuntar más de ${MAX_PAYOUT_PROOFS} comprobantes en un mismo premio.`,
    );
  }

  const seen = new Set<string>();
  const out: PayoutProof[] = [];
  for (const item of raw) {
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    if (!url) {
      throw new BadRequestException(
        'Uno de los comprobantes llegó sin archivo. Volvé a adjuntarlo.',
      );
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException(
        'URL de comprobante invalida — usá el endpoint /uploads/operator/payout-proof',
      );
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const name =
      typeof item?.name === 'string' && item.name.trim()
        ? item.name.trim().slice(0, 120)
        : undefined;
    out.push({
      url,
      type: item?.type === 'pdf' ? 'pdf' : 'image',
      ...(name ? { name } : {}),
    });
  }
  return out;
}
// La verificación va por la cola de jobs, así que el reloj tiene que cubrir la espera
// además de la ejecución: una carga por delante tarda 60-90s y el cooldown entre jobs
// suma otros 30s. Con 60s (el valor de cuando se emitía directo al bot) la verificación
// se daba por perdida mientras todavía estaba haciendo fila. 5 minutos cubre dos o tres
// jobs por delante y sigue por debajo del barrido de reclamos trabados (10 min).
const VERIFY_CHIPS_TIMEOUT_MS = 5 * 60_000;
/**
 * Cuánto se espera una verificación que el bot ya empezó.
 *
 * Una carga entera tarda 25 segundos y un retiro 16; leer un saldo no puede
 * tardar más que eso. Si en 90 segundos no volvió, no va a volver.
 */
const VERIFY_CHIPS_RUNNING_TIMEOUT_MS = 90_000;
// Retry when the extension reports "bot busy" — a transient condition that
// shouldn't burn the claim into VERIFICATION_FAILED (manual operator work).
// Tuned 2026-06-16: bumped to 5×60s so a normal load (60-90s) doesn't push the
// verification through all retries before the bot frees up.
const BUSY_RETRY_DELAY_MS = 60_000;
const MAX_BUSY_RETRIES = 5;
/**
 * Reintentos cuando el bot SÍ tomó la verificación y no contestó.
 *
 * Uno solo. El 2026-08-28, con las verificaciones muriendo sistemáticamente
 * después de que el bot las tomaba, los cinco reintentos dejaban al cliente
 * media hora esperando para terminar igual en revisión manual. Un reintento
 * cubre el caso puntual (el bot se cayó justo) sin hacerle perder la tarde a
 * nadie: si vuelve a fallar, va derecho al operador, que lo resuelve en diez
 * segundos con "Ya vi que tiene las fichas".
 */
const VERIFY_RETRIES_AFTER_PICKUP = 1;

/**
 * ¿Se le pide al bot que lea el saldo antes de que el operador vea el premio?
 *
 * Apagado por defecto desde el 2026-08-28: ese paso no vuelve nunca y lo único
 * que lograba era demorar media hora cada cobro. Encender con
 * `CHIP_VERIFICATION=on` en el entorno cuando la extensión lo soporte de nuevo.
 */
const CHIP_VERIFICATION_ENABLED =
  (process.env.CHIP_VERIFICATION || '').toLowerCase() === 'on';
// One extra retry for non-busy errors (selector flake, slow SPA render). After
// this single retry, the claim falls into VERIFICATION_FAILED for operator review.
const NON_BUSY_RETRY_DELAY_MS = 30_000;
const MAX_NON_BUSY_RETRIES = 1;
// Verification timers live in memory; a server restart orphans claims in
// VERIFYING_CHIPS/PENDING_VERIFICATION. The sweeper fails them so operators see them.
const STUCK_VERIFICATION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const STUCK_VERIFICATION_CUTOFF_MS = 10 * 60 * 1000;

interface VerificationState {
  claimId: string;
  targetUsername: string;
  userId: string;
  panelId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE';
  timeoutTimer: ReturnType<typeof setTimeout>;
  /** Job VERIFY_CHIPS despachado, si la verificación va por la cola. Permite
   *  distinguir "el bot lo tomó y no volvió" de "todavía está haciendo fila". */
  verifyJobId?: string;
}

@Injectable()
export class PrizeClaimsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrizeClaimsService.name);

  // In-memory verification tracking (claimId → state)
  private verifications: Map<string, VerificationState> = new Map();

  // Busy-retry attempts per claim (claimId → count)
  private verifyRetries: Map<string, number> = new Map();

  // Non-busy retry attempts per claim (claimId → count). One shot only — covers
  // transient flakes like a slow SPA render or a panel still loading the user list.
  private verifyNonBusyRetries: Map<string, number> = new Map();

  private stuckVerificationInterval: ReturnType<typeof setInterval> | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    private readonly telegramService: TelegramService,
    private readonly moduleRef: ModuleRef,
    private readonly pushService: PushService,
    private readonly templates: MessageTemplatesService,
  ) {}

  onModuleInit() {
    this.stuckVerificationInterval = setInterval(() => {
      this.sweepStuckVerifications().catch((err) =>
        this.logger.error(`Stuck verification sweep failed: ${err.message}`),
      );
    }, STUCK_VERIFICATION_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.stuckVerificationInterval) {
      clearInterval(this.stuckVerificationInterval);
      this.stuckVerificationInterval = null;
    }
  }

  /**
   * new_prize_claim must reach both the root namespace (legacy listeners) and
   * the /operator namespace, where operator-panel and operator-mobile actually
   * connect — emitting only via EventsGateway leaves operators blind until
   * their next full refresh.
   */
  /** Update a operadores por los dos namespaces, igual que `new_prize_claim`. */
  private emitClaimUpdateToOperators(payload: any) {
    this.events.emitToOperators('prize_claim_updated', payload);
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('prize_claim_updated', payload);
    } catch (err: any) {
      this.logger.warn(
        `Failed to emit prize_claim_updated: ${err?.message || err}`,
      );
    }
  }

  private emitNewPrizeClaimToOperators(formattedClaim: any) {
    this.events.emitToOperators('new_prize_claim', formattedClaim);
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('new_prize_claim', formattedClaim);
    } catch (err: any) {
      this.logger.warn(
        `Failed to emit new_prize_claim to /operator: ${err?.message || err}`,
      );
    }
  }

  /**
   * A chip verification failed with an *error* (timeout, no bot, discovery miss,
   * hard error) — the claim needs manual operator review. Surfaces it on the
   * panel (WS) AND pings Telegram, because the panel alert only reaches an
   * operator with the app open; Telegram is the cross-device backstop so failed
   * verifications aren't stranded when nobody is watching the panel.
   *
   * Do NOT use this for insufficient-balance failures — those already told the
   * user to gather more chips and don't need operator action.
   */
  private notifyOperatorsVerificationFailed(claim: any, reason: string) {
    // El motivo se persiste, no sólo se emite: el aviso por WS llega al operador que
    // tenga el panel abierto en ese instante, y el de Telegram se pierde en el hilo.
    // Sin esto el reclamo aparece en la cola sin ninguna explicación de por qué falló
    // — los 12 VERIFICATION_FAILED de los últimos 30 días tienen rejectionReason vacío.
    this.prisma.prizeClaim
      .update({ where: { id: claim.id }, data: { rejectionReason: reason } })
      .catch((err) =>
        this.logger.warn(
          `No se pudo guardar el motivo del fallo del reclamo ${claim.id}: ${err.message}`,
        ),
      );

    this.emitNewPrizeClaimToOperators(
      this.formatClaimForOperator({
        ...claim,
        status: 'VERIFICATION_FAILED',
        rejectionReason: reason,
      }),
    );
    this.telegramService
      .alertPrizeVerificationFailed(
        claim.targetUsername,
        Number(claim.amount),
        reason,
      )
      .catch(() => {});
  }

  /**
   * Fail claims stuck mid-verification with no in-flight timer (e.g. the
   * server restarted and the in-memory verification state was lost). Without
   * this they sit in VERIFYING_CHIPS/PENDING_VERIFICATION forever and the
   * user keeps seeing "Verificando tus fichas...".
   */
  private async sweepStuckVerifications(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_VERIFICATION_CUTOFF_MS);
    const stuck = await this.prisma.prizeClaim.findMany({
      where: {
        status: { in: ['PENDING_VERIFICATION', 'VERIFYING_CHIPS'] },
        updatedAt: { lt: cutoff },
      },
    });

    for (const claim of stuck) {
      // An in-flight verification or scheduled busy-retry will resolve it
      if (this.verifications.has(claim.id)) continue;

      this.logger.warn(
        `Prize claim ${claim.id} stuck in ${claim.status} (no in-flight verification) — marking VERIFICATION_FAILED`,
      );
      this.verifyRetries.delete(claim.id);

      await this.prisma.prizeClaim.update({
        where: { id: claim.id },
        data: { status: 'VERIFICATION_FAILED' },
      });

      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId: claim.id,
        status: 'VERIFICATION_FAILED',
        message:
          'No pudimos verificar tus fichas a tiempo. Un operador va a revisar tu solicitud.',
      });
      this.notifyOperatorsVerificationFailed(
        claim,
        'La verificacion quedó colgada (servidor reiniciado o sin respuesta).',
      );
    }

    if (stuck.length > 0) this.events.emitDashboardUpdate();
  }

  // ==========================================
  // CREATE
  // ==========================================

  async create(userId: string, data: { amount: number; chatId?: string }) {
    if (!Number.isInteger(data.amount)) {
      throw new BadRequestException(
        'El monto debe ser un número entero (sin centavos)',
      );
    }
    if (data.amount < MIN_PRIZE_CLAIM_AMOUNT) {
      throw new BadRequestException(
        `El monto mínimo para cobrar es $${MIN_PRIZE_CLAIM_AMOUNT.toLocaleString('es-AR')}`,
      );
    }

    // Validate user has a gaming username
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTargetUsername: true, panelId: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.savedTargetUsername) {
      throw new BadRequestException(
        'No tenés un usuario de juego configurado. Decile tu nombre de usuario primero.',
      );
    }

    // Check no active prize claim
    const activeClaim = await this.findActiveForUser(userId);
    if (activeClaim) {
      throw new BadRequestException(
        `Ya tenés un cobro de premio en proceso (${activeClaim.status}). Esperá a que se resuelva.`,
      );
    }

    // 24h cooldown: reject if the user already collected a prize in the last 24 hours.
    await this.assertNoRecentPaidClaim(userId);

    const claim = await this.prisma.prizeClaim.create({
      data: {
        userId,
        targetUsername: user.savedTargetUsername,
        amount: data.amount,
        status: 'PENDING_PAYMENT_DETAILS',
        panelId: user.panelId,
        chatId: data.chatId,
      },
    });

    this.logger.log(
      `Prize claim ${claim.id} created: ${user.savedTargetUsername} wants $${data.amount}`,
    );

    // Surface the new claim to operators immediately (audible alert in the panel),
    // independent of chip verification — otherwise a stuck verification means the
    // operator never sees the prize. The panel dedups by id, so the later
    // post-verification emit won't re-alert.
    this.emitNewPrizeClaimToOperators(this.formatClaimForOperator(claim));

    return claim;
  }

  // ==========================================
  // CREATE WITH PAYMENT (UNIFIED FLOW)
  // ==========================================

  async createWithPayment(
    userId: string,
    data: {
      amount: number;
      chatId?: string;
      paymentMethod: string;
      paymentDetails: { cbu?: string; alias?: string; accountHolder: string };
    },
  ) {
    // Validate amount
    if (!Number.isInteger(data.amount)) {
      throw new BadRequestException(
        'El monto debe ser un número entero (sin centavos)',
      );
    }
    if (data.amount < MIN_PRIZE_CLAIM_AMOUNT) {
      throw new BadRequestException(
        `El monto mínimo para cobrar es $${MIN_PRIZE_CLAIM_AMOUNT.toLocaleString('es-AR')}`,
      );
    }

    // Validate user has a gaming username
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTargetUsername: true, panelId: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.savedTargetUsername) {
      throw new BadRequestException(
        'No tenés un usuario de juego configurado. Decile tu nombre de usuario primero.',
      );
    }

    // Check no active prize claim
    const activeClaim = await this.findActiveForUser(userId);
    if (activeClaim) {
      throw new BadRequestException(
        `Ya tenés un cobro de premio en proceso (${activeClaim.status}). Esperá a que se resuelva.`,
      );
    }

    // 24h cooldown: reject if the user already collected a prize in the last 24 hours.
    await this.assertNoRecentPaidClaim(userId);

    // Validate payment details
    if (data.paymentMethod === 'CBU') {
      const cbu = data.paymentDetails.cbu?.replace(/\s/g, '');
      if (!cbu || cbu.length !== 22) {
        throw new BadRequestException('El CBU debe tener 22 dígitos');
      }
    } else if (data.paymentMethod === 'ALIAS') {
      const alias = data.paymentDetails.alias;
      if (!alias || alias.length < 6) {
        throw new BadRequestException(
          'El alias debe tener al menos 6 caracteres',
        );
      }
    } else {
      throw new BadRequestException('Método de pago inválido');
    }

    if (!data.paymentDetails.accountHolder) {
      throw new BadRequestException('El titular de la cuenta es obligatorio');
    }

    // Create claim with payment details already set → skip PENDING_PAYMENT_DETAILS
    const claim = await this.prisma.prizeClaim.create({
      data: {
        userId,
        targetUsername: user.savedTargetUsername,
        amount: data.amount,
        status: 'PENDING_VERIFICATION',
        panelId: user.panelId,
        chatId: data.chatId,
        paymentMethod: data.paymentMethod,
        paymentDetails: data.paymentDetails as any,
      },
    });

    this.logger.log(
      `Prize claim ${claim.id} created (unified): ${user.savedTargetUsername} wants $${data.amount} → PENDING_VERIFICATION`,
    );

    // Emit status to user
    this.events.emitToUser(userId, 'prize_claim:status_update', {
      claimId: claim.id,
      status: 'PENDING_VERIFICATION',
      message: 'Datos recibidos. Verificando tus fichas en el panel...',
    });

    // Alert operators immediately (audible in the panel) so the prize is visible
    // even if chip verification later stalls. Panel dedups by id.
    this.emitNewPrizeClaimToOperators(this.formatClaimForOperator(claim));

    // Trigger chip verification immediately
    await this.triggerVerification(claim);

    return claim;
  }

  // ==========================================
  // SET PAYMENT DETAILS + TRIGGER VERIFICATION
  // ==========================================

  async setPaymentDetails(
    claimId: string,
    userId: string,
    dto: SetPrizePaymentDto,
  ) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');
    if (claim.userId !== userId) throw new BadRequestException('No autorizado');
    if (claim.status !== 'PENDING_PAYMENT_DETAILS') {
      throw new BadRequestException('Los datos de pago ya fueron enviados');
    }

    // Validate payment details
    if (dto.paymentMethod === 'CBU') {
      const cbu = (dto.paymentDetails as any).cbu?.replace(/\s/g, '');
      if (!cbu || cbu.length !== 22) {
        throw new BadRequestException('El CBU debe tener 22 dígitos');
      }
    } else if (dto.paymentMethod === 'ALIAS') {
      const alias = (dto.paymentDetails as any).alias;
      if (!alias || alias.length < 6) {
        throw new BadRequestException(
          'El alias debe tener al menos 6 caracteres',
        );
      }
    }

    if (!(dto.paymentDetails as any).accountHolder) {
      throw new BadRequestException('El titular de la cuenta es obligatorio');
    }

    const updated = await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        paymentMethod: dto.paymentMethod,
        paymentDetails: dto.paymentDetails as any,
        status: 'PENDING_VERIFICATION',
      },
    });

    this.logger.log(
      `Prize claim ${claimId}: payment details set, triggering verification`,
    );

    // Emit status to user
    this.events.emitToUser(userId, 'prize_claim:status_update', {
      claimId,
      status: 'PENDING_VERIFICATION',
      message: 'Datos de pago recibidos. Verificando tus fichas en el panel...',
    });

    // Trigger chip verification
    await this.triggerVerification(updated);

    return updated;
  }

  // ==========================================
  // CHIP VERIFICATION
  // ==========================================

  private async triggerVerification(claim: any) {
    const panelId = claim.panelId;

    // Sin verificación automática: el premio va derecho a manos del operador.
    //
    // La lectura del saldo por el bot no vuelve nunca (5 de 5 el 2026-08-28: el
    // bot toma el trabajo, busca al usuario y no reporta). Mientras tanto el
    // premio quedaba colgado media hora en un estado sin acciones, el cliente
    // esperando y la cola tapada por reintentos que fallaban igual.
    //
    // Como la aprobación del retiro siempre fue del operador —y el saldo lo
    // termina mirando él en el panel—, saltear la verificación no le saca
    // ninguna información: le saca la espera. El claim queda VERIFIED **sin**
    // `verifiedBalance`, y el panel muestra explícitamente que el saldo no está
    // confirmado para que nadie lo confunda con una verificación real.
    //
    // Se apaga con CHIP_VERIFICATION=on cuando la extensión vuelva a responder.
    if (!CHIP_VERIFICATION_ENABLED) {
      await this.skipVerification(claim);
      return;
    }

    if (!panelId) {
      // Need discovery first — use discovery service
      this.logger.log(
        `Prize claim ${claim.id}: no panelId, starting discovery`,
      );
      await this.startDiscoveryForPrizeClaim(claim);
      return;
    }

    // Check if bot is connected for this panel
    if (!this.botGateway.isBotConnectedForPanel(panelId)) {
      this.logger.warn(
        `Prize claim ${claim.id}: no bot connected for panel ${panelId}`,
      );
      await this.prisma.prizeClaim.update({
        where: { id: claim.id },
        data: { status: 'VERIFICATION_FAILED' },
      });
      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId: claim.id,
        status: 'VERIFICATION_FAILED',
        message:
          'No hay conexión con el servidor de juego. Un operador va a revisar tu solicitud.',
      });
      this.notifyOperatorsVerificationFailed(
        claim,
        'No hay bot conectado para el panel del usuario.',
      );
      return;
    }

    // Update status to VERIFYING_CHIPS
    await this.prisma.prizeClaim.update({
      where: { id: claim.id },
      data: { status: 'VERIFYING_CHIPS' },
    });

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId: claim.id,
      status: 'VERIFYING_CHIPS',
      message: 'Verificando tus fichas en el panel de juego...',
    });

    // Encolar la verificación como job (espera su turno en vez de chocar con la carga
    // en curso). Se aguarda para que un fallo al crear el job no quede silenciado.
    await this.pushVerifyChipsTask(panelId, claim.id, claim.targetUsername);

    // Set timeout
    const timeoutTimer = setTimeout(() => {
      this.handleVerificationTimeout(claim.id);
    }, VERIFY_CHIPS_TIMEOUT_MS);

    this.verifications.set(claim.id, {
      claimId: claim.id,
      targetUsername: claim.targetUsername,
      userId: claim.userId,
      panelId,
      status: 'IN_PROGRESS',
      timeoutTimer,
    });
  }

  /**
   * Encola la verificación de fichas como un job más.
   *
   * Antes se emitía directo al bot por WebSocket, fuera de la cola. Como el bot procesa
   * un job a la vez, la verificación le llegaba en medio de una carga y no la podía
   * atender: los 6 fallos técnicos de los últimos 30 días fueron exactamente eso
   * (silencio y timeout a los 60s). Yendo por la cola espera su turno en vez de chocar,
   * igual que el WITHDRAW_CHIPS del mismo flujo.
   *
   * El jobId queda guardado en el reclamo para poder correlacionarlo con el resultado.
   */
  private async pushVerifyChipsTask(
    panelId: string,
    claimId: string,
    targetUsername: string,
  ) {
    // Interruptor de despliegue: una extensión que no conozca VERIFY_CHIPS cae al
    // último else de su ruteo, que es CARGAR CRÉDITOS — con amount null. Hasta que
    // esté distribuida la versión nueva, se sigue usando el envío directo de siempre.
    // Encender con: UPDATE "Setting" SET value='true' WHERE key='VERIFY_CHIPS_AS_JOB'
    const flag = await this.prisma.setting.findUnique({
      where: { key: 'VERIFY_CHIPS_AS_JOB' },
    });
    if (flag?.value !== 'true') {
      this.emitVerifyChipsDirect(panelId, claimId, targetUsername);
      return;
    }

    const job = await this.prisma.job.create({
      data: {
        type: 'VERIFY_CHIPS',
        status: 'QUEUED',
        panelId,
        targetUsername,
      },
    });

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: { jobId: job.id },
    });

    const tracked = this.verifications.get(claimId);
    if (tracked) tracked.verifyJobId = job.id;

    this.logger.log(
      `Prize claim ${claimId}: job VERIFY_CHIPS ${job.id} encolado para "${targetUsername}" (panel ${panelId})`,
    );

    // Despachar si el bot está libre; si no, queda en la cola y sale con el resto.
    try {
      const { JobsService } = require('../jobs/jobs.service');
      const jobsService = this.moduleRef.get(JobsService, { strict: false });
      await jobsService?.tryDispatchNextJob?.(panelId);
    } catch (err: any) {
      this.logger.warn(
        `No se pudo despachar el job de verificación ${job.id}: ${err.message}`,
      );
    }
  }

  /**
   * Camino anterior: emitir la verificación directo al bot por WebSocket.
   *
   * Choca con la carga en curso (el bot hace un job a la vez), que es de donde salían
   * los timeouts. Se conserva sólo mientras haya extensiones sin soporte de
   * VERIFY_CHIPS dando vueltas; una vez actualizadas todas, se puede borrar junto con
   * el setting.
   */
  private emitVerifyChipsDirect(
    panelId: string,
    taskId: string,
    targetUsername: string,
  ) {
    const panelBots = (this.botGateway as any).connectedBots?.get(panelId);
    if (!panelBots || panelBots.size === 0) {
      this.logger.warn(`No bot connected for panel ${panelId} to verify chips`);
      return;
    }

    const [, bot] = panelBots.entries().next().value!;
    bot.emit('verify_chips', { taskId, targetUsername });
    this.logger.log(
      `Sent verify_chips to panel ${panelId} for "${targetUsername}" (task ${taskId})`,
    );
  }

  private async startDiscoveryForPrizeClaim(claim: any) {
    // Use discovery service to find the user's panel
    try {
      const { DiscoveryService } = require('../discovery/discovery.service');
      const discoveryService = this.moduleRef.get(DiscoveryService, {
        strict: false,
      });

      // We need to create a temporary request-like entry for discovery
      // Instead, we'll directly search — discovery service works with requestId
      // Let's use the claim.id as the taskId for discovery
      const sentTo = this.botGateway.pushDiscoveryToIdlePanels(
        claim.id,
        claim.targetUsername,
      );

      if (sentTo.length === 0) {
        this.logger.warn(`No idle bots for prize claim discovery: ${claim.id}`);
        await this.prisma.prizeClaim.update({
          where: { id: claim.id },
          data: { status: 'VERIFICATION_FAILED' },
        });
        this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
          claimId: claim.id,
          status: 'VERIFICATION_FAILED',
          message:
            'No pudimos encontrar tu perfil. Un operador va a revisar tu solicitud.',
        });
        this.notifyOperatorsVerificationFailed(
          claim,
          'No hay bots libres para buscar al usuario (discovery).',
        );
      } else {
        this.logger.log(
          `Prize claim ${claim.id}: discovery sent to ${sentTo.length} panels`,
        );
        // The discovery result will come back via handleDiscoveryResultForPrizeClaim
        // Set a timeout
        const timeoutTimer = setTimeout(() => {
          this.handleVerificationTimeout(claim.id);
        }, VERIFY_CHIPS_TIMEOUT_MS);

        this.verifications.set(claim.id, {
          claimId: claim.id,
          targetUsername: claim.targetUsername,
          userId: claim.userId,
          panelId: '',
          status: 'PENDING',
          timeoutTimer,
        });
      }
    } catch (error: any) {
      this.logger.error(
        `Discovery for prize claim ${claim.id} failed: ${error.message}`,
      );
      await this.prisma.prizeClaim.update({
        where: { id: claim.id },
        data: { status: 'VERIFICATION_FAILED' },
      });
    }
  }

  /**
   * Handle discovery result for a prize claim (user found on a panel).
   * Called by the discovery result handler when the taskId matches a prize claim.
   */
  async handleDiscoveryResultForPrizeClaim(
    claimId: string,
    panelId: string,
    found: boolean,
  ) {
    const verification = this.verifications.get(claimId);
    if (!verification) return;

    if (found) {
      clearTimeout(verification.timeoutTimer);
      this.verifications.delete(claimId);

      // Update claim and user with panelId
      const claim = await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { panelId },
      });
      await this.prisma.user.update({
        where: { id: claim.userId },
        data: { panelId },
      });

      // Now trigger chip verification on the found panel
      await this.triggerVerification(claim);
    }
    // If not found, wait for other panels or timeout
  }

  private async handleVerificationTimeout(claimId: string) {
    const verification = this.verifications.get(claimId);
    if (!verification || verification.status === 'DONE') return;

    this.verifications.delete(claimId);
    this.logger.warn(`Verification timed out for prize claim ${claimId}`);

    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });
    if (
      !claim ||
      claim.status === 'VERIFIED' ||
      claim.status === 'VERIFICATION_FAILED'
    )
      return;

    // Que el bot no conteste en 60s casi siempre significa lo mismo que un "bot busy"
    // explícito: está en medio de una carga (que tarda 60-90s) o su service worker
    // estaba dormido. La diferencia es sólo si llegó a avisarlo. Hasta ahora el
    // silencio quemaba el reclamo en VERIFICATION_FAILED sin reintentar, mientras que
    // el "busy" tenía 5 intentos — de los 6 fallos técnicos de los últimos 30 días,
    // los 6 fueron por este camino.
    // ¿El bot llegó a tomar el trabajo? Si arrancó y no volvió, reintentar es
    // repetir lo mismo: cada vuelta son seis minutos más de espera para el
    // cliente y el resultado viene siendo siempre el mismo. Si en cambio sigue
    // en la cola, hay que esperarlo — ahí el reintento sí sirve.
    let botTookIt = false;
    if (verification.verifyJobId) {
      const verifyJob = await this.prisma.job
        .findUnique({
          where: { id: verification.verifyJobId },
          select: { startedAt: true, status: true },
        })
        .catch(() => null);
      botTookIt = Boolean(verifyJob?.startedAt) || verifyJob?.status === 'PROCESSING';
    }

    const maxTimeoutRetries = botTookIt ? VERIFY_RETRIES_AFTER_PICKUP : MAX_BUSY_RETRIES;
    const timeoutRetries = this.verifyRetries.get(claimId) || 0;
    if (timeoutRetries < maxTimeoutRetries) {
      this.verifyRetries.set(claimId, timeoutRetries + 1);
      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { status: 'PENDING_VERIFICATION' },
      });
      this.logger.log(
        `Prize claim ${claimId}: sin respuesta del bot, reintentando en ${BUSY_RETRY_DELAY_MS / 1000}s (intento ${timeoutRetries + 1}/${maxTimeoutRetries}${botTookIt ? ', el bot lo había tomado' : ', seguía en la cola'})`,
      );
      // Que el operador vea que está reintentando y cuántas quedan. Hasta ahora
      // el premio decía "en curso" durante media hora sin una sola señal.
      this.emitClaimUpdateToOperators({
        id: claimId,
        status: 'PENDING_VERIFICATION',
        verifyAttempt: timeoutRetries + 1,
        verifyMaxAttempts: maxTimeoutRetries,
      });
      setTimeout(() => {
        this.triggerVerification({
          ...claim,
          status: 'PENDING_VERIFICATION',
        }).catch((err: any) =>
          this.logger.error(
            `Timeout-retry verification failed for claim ${claimId}: ${err.message}`,
          ),
        );
      }, BUSY_RETRY_DELAY_MS);
      return;
    }

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: { status: 'VERIFICATION_FAILED' },
    });

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'VERIFICATION_FAILED',
      message:
        'No pudimos verificar tus fichas a tiempo. Un operador va a revisar tu solicitud.',
    });
    this.notifyOperatorsVerificationFailed(
      claim,
      'Timeout: el bot no respondió la verificación a tiempo.',
    );
  }

  // ==========================================
  // HANDLE VERIFICATION RESULT FROM EXTENSION
  // ==========================================

  async handleVerificationResult(
    claimId: string,
    result: { success: boolean; balance?: number; error?: string },
  ) {
    const verification = this.verifications.get(claimId);
    if (verification) {
      clearTimeout(verification.timeoutTimer);
      verification.status = 'DONE';
      this.verifications.delete(claimId);
    }

    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      this.logger.warn(`Verification result for unknown claim: ${claimId}`);
      return;
    }

    // Idempotency: skip if already in a final-ish state
    if (!['PENDING_VERIFICATION', 'VERIFYING_CHIPS'].includes(claim.status)) {
      this.logger.warn(
        `Claim ${claimId} already in ${claim.status}, ignoring verification result`,
      );
      return;
    }

    if (result.success && result.balance != null) {
      this.verifyRetries.delete(claimId);
      this.verifyNonBusyRetries.delete(claimId);
      const hasEnough = result.balance >= Number(claim.amount);

      if (hasEnough) {
        await this.prisma.prizeClaim.update({
          where: { id: claimId },
          data: {
            status: 'VERIFIED',
            verifiedBalance: result.balance,
            verifiedAt: new Date(),
          },
        });

        this.logger.log(
          `Prize claim ${claimId} VERIFIED: user has ${result.balance} chips, claimed ${claim.amount}`,
        );

        this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
          claimId,
          status: 'VERIFIED',
          message: `¡Fichas verificadas! Tenés ${result.balance.toLocaleString('es-AR')} fichas. Un operador va a procesar tu premio de $${Number(claim.amount).toLocaleString('es-AR')}.`,
        });

        const formattedClaim = this.formatClaimForOperator({
          ...claim,
          verifiedBalance: result.balance,
          status: 'VERIFIED',
        });
        this.emitNewPrizeClaimToOperators(formattedClaim);

        // Telegram alert
        this.telegramService
          .alertNewPrizeClaim(
            claim.targetUsername,
            Number(claim.amount),
            result.balance,
          )
          .catch(() => {});

        this.events.emitDashboardUpdate();
      } else {
        await this.prisma.prizeClaim.update({
          where: { id: claimId },
          data: {
            status: 'VERIFICATION_FAILED',
            verifiedBalance: result.balance,
            verifiedAt: new Date(),
          },
        });

        this.logger.log(
          `Prize claim ${claimId} FAILED: user has ${result.balance} chips but claimed ${claim.amount}`,
        );

        const balanceStr = result.balance.toLocaleString('es-AR');
        const claimedStr = Number(claim.amount).toLocaleString('es-AR');
        const minStr = MIN_PRIZE_CLAIM_AMOUNT.toLocaleString('es-AR');
        const userMessage =
          result.balance < MIN_PRIZE_CLAIM_AMOUNT
            ? `No tenés suficientes fichas para cobrar. Tenés ${balanceStr} y el mínimo para cobrar un premio es $${minStr}. Cuando llegues a $${minStr} podés cobrar.`
            : `No tenés suficientes fichas. Tenés ${balanceStr} pero pediste $${claimedStr}. Probá con un monto menor o igual a ${balanceStr} (mínimo $${minStr}).`;

        this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
          claimId,
          status: 'VERIFICATION_FAILED',
          message: userMessage,
        });

        // Push so the user knows even with the app closed.
        this.pushService
          .sendToUser(claim.userId, '⚠️ Fichas insuficientes', userMessage, {
            claimId,
            type: 'prize_verification_insufficient',
          })
          .catch((err: any) =>
            this.logger.warn(
              `Push (prize_verification_insufficient) failed: ${err.message}`,
            ),
          );
      }
    } else {
      // Verification failed (error). "Bot busy" is transient (the extension
      // was mid-job/discovery) — retry instead of burning the claim into
      // VERIFICATION_FAILED. verify_chips is read-only, so retrying is safe.
      const errMsg = result.error || 'unknown';
      const isBusy = errMsg.toLowerCase().includes('busy');

      // Log the full error+context every time so we can diagnose recurring failures
      // in prod logs (Render). Cheap to add, expensive to miss if it regresses again.
      this.logger.warn(
        `Prize claim ${claimId} (user="${claim.targetUsername}") verification error: "${errMsg}" (isBusy=${isBusy})`,
      );

      const busyRetries = this.verifyRetries.get(claimId) || 0;
      if (isBusy && busyRetries < MAX_BUSY_RETRIES) {
        this.verifyRetries.set(claimId, busyRetries + 1);
        await this.prisma.prizeClaim.update({
          where: { id: claimId },
          data: { status: 'PENDING_VERIFICATION' },
        });
        this.logger.log(
          `Prize claim ${claimId}: bot busy, retrying verification in ${BUSY_RETRY_DELAY_MS / 1000}s (attempt ${busyRetries + 1}/${MAX_BUSY_RETRIES})`,
        );
        setTimeout(() => {
          this.triggerVerification({
            ...claim,
            status: 'PENDING_VERIFICATION',
          }).catch((err: any) =>
            this.logger.error(
              `Busy-retry verification failed for claim ${claimId}: ${err.message}`,
            ),
          );
        }, BUSY_RETRY_DELAY_MS);
        return;
      }

      // Non-busy error: try once more with a short delay before giving up. Covers
      // transient flakes (panel SPA still rendering, slow datatable load).
      const nonBusyRetries = this.verifyNonBusyRetries.get(claimId) || 0;
      if (!isBusy && nonBusyRetries < MAX_NON_BUSY_RETRIES) {
        this.verifyNonBusyRetries.set(claimId, nonBusyRetries + 1);
        await this.prisma.prizeClaim.update({
          where: { id: claimId },
          data: { status: 'PENDING_VERIFICATION' },
        });
        this.logger.log(
          `Prize claim ${claimId}: non-busy error, retrying once in ${NON_BUSY_RETRY_DELAY_MS / 1000}s`,
        );
        setTimeout(() => {
          this.triggerVerification({
            ...claim,
            status: 'PENDING_VERIFICATION',
          }).catch((err: any) =>
            this.logger.error(
              `Non-busy retry verification failed for claim ${claimId}: ${err.message}`,
            ),
          );
        }, NON_BUSY_RETRY_DELAY_MS);
        return;
      }

      this.verifyRetries.delete(claimId);
      this.verifyNonBusyRetries.delete(claimId);

      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { status: 'VERIFICATION_FAILED' },
      });

      this.logger.error(
        `Prize claim ${claimId} verification error (final): ${errMsg}`,
      );

      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId,
        status: 'VERIFICATION_FAILED',
        message:
          'Hubo un problema al verificar tus fichas. Un operador va a revisar tu solicitud.',
      });

      // Push so the user knows even with the app closed.
      this.pushService
        .sendToUser(
          claim.userId,
          '⚠️ Premio en revisión',
          'No pudimos verificar tus fichas automáticamente. Un operador revisará tu solicitud.',
          { claimId, type: 'prize_verification_error' },
        )
        .catch((err: any) =>
          this.logger.warn(
            `Push (prize_verification_error) failed: ${err.message}`,
          ),
        );

      this.notifyOperatorsVerificationFailed(
        claim,
        `Error de verificación: ${errMsg}`,
      );
    }
  }

  // ==========================================
  // OPERATOR ACTIONS
  // ==========================================

  /**
   * Operator triggers chip withdrawal (VERIFIED → PROCESSING).
   * Creates a WITHDRAW_CHIPS job for the extension.
   */
  async process(claimId: string, operatorId: string) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');
    // FAILED: operator manually retries a withdrawal that died (e.g. job
    // auto-failed while the extension was busy).
    // VERIFICATION_FAILED: automatic chip verification failed but the operator
    // checked the panel by hand and decided to withdraw anyway (same pattern
    // as manual APPROVE on requests with VALIDATION_FAILED).
    // PENDING_VERIFICATION / VERIFYING_CHIPS: el operador decide no esperar más.
    // La verificación automática puede tardar media hora cuando las extensiones
    // están flapeando (aceptan el job y se desconectan antes de contestar), y
    // mientras tanto el cliente ve "en curso" y nadie puede hacer nada. Sigue
    // siendo decisión de una persona: el bot no aprueba nada solo.
    const processableStatuses: PrizeClaimStatus[] = [
      'VERIFIED',
      'FAILED',
      'VERIFICATION_FAILED',
      'PENDING_VERIFICATION',
      'VERIFYING_CHIPS',
    ];
    if (!processableStatuses.includes(claim.status)) {
      throw new BadRequestException(
        `El premio debe estar verificado para procesarlo. Estado actual: ${claim.status}`,
      );
    }

    // Cortar la verificación en vuelo: si sigue viva, su timeout dispararía un
    // reintento sobre un premio que ya está retirándose. El resultado tardío,
    // si llega, lo descarta `handleVerificationResult` por el estado.
    const inFlight = this.verifications.get(claimId);
    if (inFlight) {
      clearTimeout(inFlight.timeoutTimer);
      this.verifications.delete(claimId);
      this.logger.log(
        `Prize claim ${claimId}: verificación cancelada — el operador ${operatorId} decidió procesar igual`,
      );
    }
    this.verifyRetries.delete(claimId);
    this.verifyNonBusyRetries.delete(claimId);

    // El claim se crea con el panel que tenía el usuario en ese momento. Si el
    // discovery lo resolvió medio segundo después —pasa con usuarios nuevos, que
    // piden el cobro apenas se registran— el claim queda sin panel y el retiro
    // moría acá con "no tiene panel asignado", justo cuando el operador quiere
    // destrabarlo a mano. El panel del usuario ya es el bueno: se toma y se
    // persiste en el premio.
    let panelId = claim.panelId;
    if (!panelId) {
      const user = await this.prisma.user.findUnique({
        where: { id: claim.userId },
        select: { panelId: true },
      });
      panelId = user?.panelId ?? null;
      if (!panelId) {
        throw new BadRequestException(
          'Todavía no sabemos en qué panel está este usuario. Asignáselo a mano y volvé a intentar.',
        );
      }
      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { panelId },
      });
      this.logger.log(
        `Prize claim ${claimId}: panel ${panelId} tomado del usuario al procesar`,
      );
    }

    // Create job + update claim atomically to prevent orphaned jobs
    const job = await this.prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: {
          type: 'WITHDRAW_CHIPS',
          status: 'QUEUED',
          panelId,
          targetUsername: claim.targetUsername,
          amount: claim.amount,
        },
      });

      await tx.prizeClaim.update({
        where: { id: claimId },
        data: {
          status: 'PROCESSING',
          processedBy: operatorId,
          jobId: newJob.id,
        },
      });

      return newJob;
    });

    this.logger.log(`Prize claim ${claimId} PROCESSING: job ${job.id} created`);

    // Emit events
    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'PROCESSING',
      message: 'Retirando tus fichas del panel de juego...',
    });
    this.events.emitToOperators('prize_claim_updated', {
      id: claimId,
      status: 'PROCESSING',
      jobId: job.id,
      processedBy: operatorId,
    });
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('prize_claim_updated', {
        id: claimId,
        status: 'PROCESSING',
        jobId: job.id,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit prize_claim_updated (PROCESSING): ${err?.message || err}`,
      );
    }

    // Dispatch the job to the bot
    try {
      const { JobsService } = require('../jobs/jobs.service');
      const jobsService = this.moduleRef.get(JobsService, { strict: false });
      await jobsService.tryDispatchNextJob(claim.panelId);
    } catch (error: any) {
      this.logger.error(
        `Failed to dispatch withdraw job ${job.id}: ${error.message}`,
      );
    }

    this.events.emitDashboardUpdate();

    return { success: true, jobId: job.id };
  }

  /**
   * Handle result from WITHDRAW_CHIPS job.
   * Called by BotService when a WITHDRAW_CHIPS job completes/fails.
   */
  async handleWithdrawalResult(
    claimId: string,
    success: boolean,
    error?: string,
  ) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      this.logger.warn(`Withdrawal result for unknown claim: ${claimId}`);
      return;
    }

    if (claim.status !== 'PROCESSING') {
      this.logger.warn(
        `Claim ${claimId} not in PROCESSING state, ignoring withdrawal result`,
      );
      return;
    }

    if (success) {
      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { status: 'CHIPS_WITHDRAWN' },
      });

      this.logger.log(`Prize claim ${claimId}: chips withdrawn successfully`);

      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId,
        status: 'CHIPS_WITHDRAWN',
        message: '¡Fichas retiradas! Un operador va a enviarte el pago.',
      });

      // Telegram: prize is ready to pay. The WS alert only reaches an operator
      // with the app open; Telegram is the cross-device backstop.
      this.telegramService
        .alertPrizeReadyToPay(claim.targetUsername, Number(claim.amount))
        .catch(() => {});

      const formattedClaim = this.formatClaimForOperator({
        ...claim,
        status: 'CHIPS_WITHDRAWN',
      });
      this.events.emitToOperators('prize_claim_updated', formattedClaim);
      try {
        const { OperatorGateway } = require('../events/operator.gateway');
        const opGateway = this.moduleRef.get(OperatorGateway, {
          strict: false,
        });
        opGateway?.emitToAll('prize_claim_updated', formattedClaim);
      } catch (err) {
        this.logger.warn(
          `Failed to emit prize_claim_updated (CHIPS_WITHDRAWN): ${err?.message || err}`,
        );
      }

      // Auto-create outbound payment (if auto-payment enabled)
      try {
        const {
          OutboundPaymentsService,
        } = require('../outbound-payments/outbound-payments.service');
        const outboundService = this.moduleRef.get(OutboundPaymentsService, {
          strict: false,
        });
        if (outboundService) {
          await outboundService.createFromPrizeClaim(claimId);
        }
      } catch (err: any) {
        this.logger.warn(
          `Auto-payment creation failed for prize ${claimId}: ${err?.message || err}`,
        );
      }
    } else {
      await this.prisma.prizeClaim.update({
        where: { id: claimId },
        data: { status: 'FAILED' },
      });

      this.logger.error(
        `Prize claim ${claimId}: chip withdrawal FAILED: ${error}`,
      );

      this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
        claimId,
        status: 'FAILED',
        message:
          'Hubo un problema al retirar tus fichas. Un operador va a revisarlo.',
      });

      // Push so the user knows even with the app closed.
      this.pushService
        .sendToUser(
          claim.userId,
          '⚠️ Premio en revisión',
          'No pudimos retirar las fichas del panel. Un operador lo revisará.',
          { claimId, type: 'prize_failed' },
        )
        .catch((err: any) =>
          this.logger.warn(`Push (prize_failed) failed: ${err.message}`),
        );

      this.events.emitToOperators('prize_claim_updated', {
        id: claimId,
        status: 'FAILED',
        error,
      });

      // Telegram alert
      this.telegramService
        .alertPrizeWithdrawalFailed(
          claim.targetUsername,
          error || 'Error desconocido',
        )
        .catch(() => {});
    }

    this.events.emitDashboardUpdate();
  }

  /**
   * Operator marks prize as paid (CHIPS_WITHDRAWN → COMPLETED).
   * Requiere que el operador adjunte el comprobante de la transferencia (imagen o PDF) ya
   * subido a Cloudinary vía POST /uploads/operator/payout-proof. Sin el comprobante no se
   * puede pasar a COMPLETED — es nuestra evidencia de que efectivamente le pagamos al usuario.
   */
  async complete(
    claimId: string,
    operatorId: string,
    payout: {
      proofUrl?: string;
      proofType?: 'image' | 'pdf' | string;
      /** Varios comprobantes: un premio grande se paga desde varias cuentas. */
      proofs?: PayoutProofInput[];
    },
  ) {
    const proofs = normalizePayoutProofs(payout);

    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
      include: { user: { select: { balance: true } } },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');
    if (claim.status !== 'CHIPS_WITHDRAWN') {
      throw new BadRequestException(
        `Solo se puede completar un premio con fichas ya retiradas. Estado actual: ${claim.status}`,
      );
    }

    // Create transaction record for audit trail
    const balanceBefore = Number(claim.user.balance);
    await this.prisma.transaction.create({
      data: {
        userId: claim.userId,
        type: 'WITHDRAWAL',
        amount: claim.amount,
        balanceBefore,
        balanceAfter: balanceBefore, // Balance doesn't change (chips were on panel, not internal)
        prizeClaimId: claimId,
        description: `Premio cobrado - ${claim.targetUsername} ($${Number(claim.amount).toLocaleString('es-AR')})`,
      },
    });

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        status: 'COMPLETED',
        completedBy: operatorId,
        // El primero también va en los campos viejos: el panel Electron y los
        // clientes que no se actualizaron todavía sólo leen esos dos.
        payoutProofUrl: proofs[0].url,
        payoutProofType: proofs[0].type,
        payoutProofs: proofs,
      },
    });

    this.logger.log(
      `Prize claim ${claimId} COMPLETED by operator ${operatorId}`,
    );

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'COMPLETED',
      message: `¡Listo! Tu premio de $${Number(claim.amount).toLocaleString('es-AR')} fue enviado. ¡Felicitaciones!`,
      payoutProofUrl: proofs[0].url,
      payoutProofType: proofs[0].type,
      payoutProofs: proofs,
    });

    // Persistimos un mensaje SYSTEM en el chat del usuario con el comprobante adjunto
    // (imagen inline o link a PDF) para que tenga evidencia visible y permanente del pago,
    // no solo el toast pasajero.
    try {
      // Los claims creados por HTTP desde el chat-app no traen chatId, así que
      // caemos al chat activo del usuario para no perder el comprobante.
      let proofChatId = claim.chatId;
      if (!proofChatId) {
        const chat = await this.prisma.chat.findFirst({
          where: { userId: claim.userId, status: { in: ['OPEN', 'ASSIGNED'] } },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        proofChatId = chat?.id ?? null;
      }
      if (proofChatId) {
        const { MessagesService } = require('../messages/messages.service');
        const messagesService = this.moduleRef.get(MessagesService, {
          strict: false,
        });
        if (messagesService) {
          // Normalize the proof URL so PDFs are delivered as a JPG of page 1
          // (the chat bubble renders message.imageUrl as <Image>; raw PDF URLs
          // would not render). uploadsService is optional-resolved via moduleRef
          // because PrizeClaimsService is not in PrizeClaim's imports yet.
          const { UploadsService } = require('../uploads/uploads.service');
          const uploadsService = this.moduleRef.get(UploadsService, {
            strict: false,
          });
          const amountStr = Number(claim.amount).toLocaleString('es-AR');
          const total = proofs.length;
          // La plantilla es lo que se puede editar desde el panel; el monto y
          // el "2 de 3" los pone el sistema, siempre igual, para que no se
          // pierdan si el operador reescribe el texto.
          const paidText = this.templates.pick('PRIZE_PAID');
          // Un mensaje por comprobante. Van de a uno y con su propio try porque
          // si el segundo falla el usuario tiene que quedarse igual con el
          // primero: perder los tres por un error de red sería peor.
          for (let i = 0; i < total; i++) {
            const proof = proofs[i];
            const displayUrl = uploadsService
              ? uploadsService.toDeliverableUrl(
                  proof.url,
                  proof.type === 'pdf' ? 'application/pdf' : undefined,
                )
              : proof.url;
            const content =
              i === 0
                ? [
                    paidText,
                    `Premio: $${amountStr}`,
                    total > 1
                      ? `Se envió desde varias cuentas: te mandamos los ${total} comprobantes (1 de ${total}).`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n\n')
                : `Comprobante ${i + 1} de ${total}.`;
            try {
              await messagesService.sendSystemMessage(
                proofChatId,
                content,
                undefined,
                displayUrl,
              );
            } catch (err: any) {
              this.logger.warn(
                `Failed to post payout proof ${i + 1}/${total} for claim ${claimId}: ${err?.message || err}`,
              );
            }
          }
        }
      } else {
        this.logger.warn(
          `No chat found for user ${claim.userId} — payout proof for claim ${claimId} not posted to chat`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to post payout-proof system message for claim ${claimId}: ${err?.message || err}`,
      );
    }

    // Telegram: confirm the payment landed so the operator sees the loop close.
    this.telegramService
      .alertPrizePaid(claim.targetUsername, Number(claim.amount))
      .catch(() => {});

    this.events.emitToOperators('prize_claim_updated', {
      id: claimId,
      status: 'COMPLETED',
      completedBy: operatorId,
      payoutProofUrl: proofs[0].url,
      payoutProofType: proofs[0].type,
      payoutProofs: proofs,
    });
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('prize_claim_updated', {
        id: claimId,
        status: 'COMPLETED',
        completedBy: operatorId,
        payoutProofUrl: proofs[0].url,
        payoutProofType: proofs[0].type,
        payoutProofs: proofs,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit prize_claim_updated (COMPLETED): ${err?.message || err}`,
      );
    }

    this.events.emitDashboardUpdate();

    return { success: true };
  }

  /**
   * Deja el premio listo para que lo resuelva un operador, sin pasar por el bot.
   */
  private async skipVerification(claim: any) {
    await this.prisma.prizeClaim.update({
      where: { id: claim.id },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });

    this.logger.log(
      `Prize claim ${claim.id}: verificación automática desactivada, va directo a revisión del operador (${claim.targetUsername}, $${Number(claim.amount)})`,
    );

    // Al usuario no se le promete que están las fichas: sólo que su pedido está
    // en curso. Lo confirma un operador.
    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId: claim.id,
      status: 'VERIFIED',
      message: 'Recibimos tu pedido. Un operador lo está revisando.',
    });

    this.emitNewPrizeClaimToOperators(
      this.formatClaimForOperator({ ...claim, status: 'VERIFIED' }),
    );
    this.emitClaimUpdateToOperators({
      id: claim.id,
      status: 'VERIFIED',
      verifiedBalance: null,
      verifyAttempt: null,
    });

    this.telegramService
      .alertNewPrizeClaim(claim.targetUsername, Number(claim.amount), 0)
      .catch(() => {});

    this.events.emitDashboardUpdate();
  }

  /**
   * El bot empezó a verificar. A partir de acá el reloj corre más rápido.
   *
   * Mientras el job hace fila, hay que darle aire (puede haber dos o tres
   * cargas por delante). Una vez que el bot lo tomó, no: leer un saldo lleva
   * segundos, y si en minuto y medio no volvió es que no vuelve. Lo llama
   * `BotService` al recibir el "started" de un VERIFY_CHIPS.
   */
  onVerifyChipsStarted(jobId: string) {
    for (const [claimId, verification] of this.verifications) {
      if (verification.verifyJobId !== jobId) continue;
      clearTimeout(verification.timeoutTimer);
      verification.status = 'IN_PROGRESS';
      verification.timeoutTimer = setTimeout(() => {
        this.handleVerificationTimeout(claimId);
      }, VERIFY_CHIPS_RUNNING_TIMEOUT_MS);
      this.logger.log(
        `Prize claim ${claimId}: el bot arrancó la verificación, se le dan ${VERIFY_CHIPS_RUNNING_TIMEOUT_MS / 1000}s`,
      );
      return;
    }
  }

  /**
   * El operador confirma a mano que el usuario tiene las fichas.
   *
   * La verificación automática puede quedarse sin respuesta —el bot busca al
   * usuario, se desconecta antes de reportar y el resultado nunca llega— aunque
   * en el panel se haya visto perfecto. Con esto el operador que ya lo miró
   * deja el premio listo para retirar, sin retirar nada todavía: el retiro
   * sigue siendo una segunda decisión suya.
   */
  async markVerifiedByOperator(
    claimId: string,
    operatorId: string,
    balance?: number,
  ) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new NotFoundException('Premio no encontrado');

    const allowed: PrizeClaimStatus[] = [
      'PENDING_VERIFICATION',
      'VERIFYING_CHIPS',
      'VERIFICATION_FAILED',
    ];
    if (!allowed.includes(claim.status)) {
      throw new BadRequestException(
        `Este premio no está esperando verificación. Estado actual: ${claim.status}`,
      );
    }

    // Cortar la verificación en vuelo: su timeout dispararía un reintento sobre
    // un premio que el operador ya dio por bueno.
    const inFlight = this.verifications.get(claimId);
    if (inFlight) {
      clearTimeout(inFlight.timeoutTimer);
      this.verifications.delete(claimId);
    }
    this.verifyRetries.delete(claimId);
    this.verifyNonBusyRetries.delete(claimId);

    const updated = await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        // Sólo si el operador informó el saldo. Sin dato, no se inventa.
        ...(balance != null ? { verifiedBalance: balance } : {}),
        // El motivo del fallo anterior ya no aplica y ensucia la tarjeta.
        rejectionReason: null,
      },
    });

    this.logger.log(
      `Prize claim ${claimId} marcado VERIFIED a mano por el operador ${operatorId}`,
    );

    // Al usuario no se le avisa nada: para él no cambió nada todavía. El aviso
    // llega cuando el premio se paga.
    this.emitClaimUpdateToOperators({
      id: claimId,
      status: 'VERIFIED',
      verifiedAt: updated.verifiedAt,
      verifiedBalance: updated.verifiedBalance,
      rejectionReason: null,
      verifyAttempt: null,
    });
    this.events.emitDashboardUpdate();

    return { success: true };
  }

  /**
   * El operador ya retiró las fichas a mano en el panel.
   *
   * Pasa cuando el bot no pudo —verificación colgada, panel raro, apuro— y la
   * persona lo resolvió sola. Sin esto el premio se quedaba trabado en un
   * estado intermedio y no había forma de llegar al pago sin que el bot
   * retirara de nuevo, que le sacaría las fichas dos veces al usuario.
   *
   * No crea ningún job: da por hecho lo que el operador dice que ya hizo.
   */
  async markChipsWithdrawnByOperator(claimId: string, operatorId: string) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new NotFoundException('Premio no encontrado');

    if (claim.status === 'CHIPS_WITHDRAWN') {
      return { success: true, alreadyWithdrawn: true };
    }
    const terminal: PrizeClaimStatus[] = ['COMPLETED', 'REJECTED'];
    if (terminal.includes(claim.status)) {
      throw new BadRequestException(
        `El premio ya está ${claim.status === 'COMPLETED' ? 'pagado' : 'rechazado'}.`,
      );
    }

    // Cortar cualquier verificación en vuelo: ya no hay nada que verificar.
    const inFlight = this.verifications.get(claimId);
    if (inFlight) {
      clearTimeout(inFlight.timeoutTimer);
      this.verifications.delete(claimId);
    }
    this.verifyRetries.delete(claimId);
    this.verifyNonBusyRetries.delete(claimId);

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        status: 'CHIPS_WITHDRAWN',
        processedBy: operatorId,
        rejectionReason: null,
      },
    });

    this.logger.log(
      `Prize claim ${claimId} marcado CHIPS_WITHDRAWN a mano por el operador ${operatorId} (retiro manual en el panel)`,
    );

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'CHIPS_WITHDRAWN',
      message: 'Ya retiramos tus fichas. Estamos haciendo la transferencia.',
    });

    this.emitClaimUpdateToOperators({
      id: claimId,
      status: 'CHIPS_WITHDRAWN',
      processedBy: operatorId,
      rejectionReason: null,
      verifyAttempt: null,
    });

    this.telegramService
      .alertPrizeReadyToPay(claim.targetUsername, Number(claim.amount))
      .catch(() => {});

    this.events.emitDashboardUpdate();

    return { success: true };
  }

  /**
   * Operator rejects prize claim
   */
  async reject(claimId: string, operatorId: string, dto: RejectPrizeClaimDto) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new NotFoundException('Premio no encontrado');

    const terminalStatuses: PrizeClaimStatus[] = ['COMPLETED', 'REJECTED'];
    if (terminalStatuses.includes(claim.status)) {
      throw new BadRequestException(`El premio ya está ${claim.status}`);
    }

    // Reason is mandatory and must be clear — the user needs to understand why.
    const trimmedReason = (dto.reason || '').trim();
    if (!trimmedReason || trimmedReason.length < 5) {
      throw new BadRequestException(
        'El motivo de rechazo es obligatorio y debe ser claro (mínimo 5 caracteres).',
      );
    }

    await this.prisma.prizeClaim.update({
      where: { id: claimId },
      data: {
        status: 'REJECTED',
        rejectedBy: operatorId,
        rejectionReason: trimmedReason,
      },
    });

    this.logger.log(
      `Prize claim ${claimId} REJECTED by ${operatorId}: ${trimmedReason}`,
    );

    const amountLabel = `$${Number(claim.amount).toLocaleString('es-AR')}`;
    // Texto editable arriba; el monto y el motivo los agrega el sistema, que es
    // lo que el usuario necesita sí o sí para entender qué pasó.
    const detailedMessage = this.templates.compose(
      'PRIZE_REJECTED',
      `Pedido: ${amountLabel}`,
      `Motivo: ${trimmedReason}`,
    );

    this.events.emitToUser(claim.userId, 'prize_claim:status_update', {
      claimId,
      status: 'REJECTED',
      reason: trimmedReason,
      amount: Number(claim.amount),
      message: detailedMessage,
    });

    // Native push so the user is notified even if app is closed.
    this.pushService
      .sendToUser(
        claim.userId,
        `❌ Premio de ${amountLabel} rechazado`,
        `Motivo: ${trimmedReason}`,
        { claimId, type: 'prize_rejected', reason: trimmedReason },
      )
      .catch((err: any) =>
        this.logger.warn(`Push (prize_rejected) failed: ${err.message}`),
      );

    this.events.emitToOperators('prize_claim_updated', {
      id: claimId,
      status: 'REJECTED',
      rejectedBy: operatorId,
      reason: dto.reason,
    });
    try {
      const { OperatorGateway } = require('../events/operator.gateway');
      const opGateway = this.moduleRef.get(OperatorGateway, { strict: false });
      opGateway?.emitToAll('prize_claim_updated', {
        id: claimId,
        status: 'REJECTED',
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit prize_claim_updated (REJECTED): ${err?.message || err}`,
      );
    }

    this.events.emitDashboardUpdate();

    return { success: true };
  }

  // ==========================================
  // QUERIES
  // ==========================================

  async findPending() {
    // Corte por antigüedad. Un premio trabado hace dos meses no se resuelve, se
    // archiva: quedaba para siempre en la pantalla del operador y enseñaba a
    // ignorar la lista entera (37 premios "pendientes" de los que ninguno lo
    // era). Los viejos siguen en la base y se ven en el historial.
    const cutoff = new Date(Date.now() - STALE_PRIZE_DAYS * 24 * 60 * 60 * 1000);
    const verifyCutoff = new Date(
      Date.now() - STALE_VERIFY_ERROR_DAYS * 24 * 60 * 60 * 1000,
    );
    const inFlightCutoff = new Date(Date.now() - IN_FLIGHT_PRIZE_HOURS * 3600_000);

    return this.prisma.prizeClaim.findMany({
      where: {
        OR: [
          // Fichas ya retiradas del panel: no se archiva NUNCA, por viejo que
          // sea. Es plata que salió del panel y todavía no llegó al usuario.
          { status: 'CHIPS_WITHDRAWN' },
          {
            status: { in: ['VERIFIED', 'PROCESSING', 'FAILED'] },
            createdAt: { gte: cutoff },
          },
          // Verification *errors* need operator review. Insufficient-balance
          // failures (verifiedBalance set) don't — the user was already told
          // to claim a lower amount and can create a new claim.
          {
            status: 'VERIFICATION_FAILED',
            verifiedBalance: null,
            createdAt: { gte: verifyCutoff },
          },
          // En verificación. No requieren acción —el sistema está trabajando—
          // pero tienen que verse: hasta ahora sólo llegaban al panel por el
          // evento en vivo, así que al recargar la página desaparecían y el
          // premio quedaba invisible hasta que la verificación se rendía, 10 a
          // 30 minutos después. El operador que quiera adelantarlo necesita
          // poder verlo. Ventana corta: son estados que duran minutos.
          {
            status: { in: ['PENDING_VERIFICATION', 'VERIFYING_CHIPS'] },
            createdAt: { gte: inFlightCutoff },
          },
        ],
      },
      include: {
        user: {
          select: { username: true, phone: true, savedTargetUsername: true },
        },
      },
      // Newest-first, igual que findAll. El panel hace unshift de los que
      // llegan por socket, asi que con 'asc' el orden quedaba mixto: los de
      // la sesion arriba y el historico invertido abajo.
      orderBy: { createdAt: 'desc' },
      // Sin cota, e incluyendo los FAILED historicos que nunca se purgan: la
      // lista crecia de forma monotona. `findAll`, abajo, ya usaba take: 100.
      take: 100,
    });
  }

  async findAll(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    return this.prisma.prizeClaim.findMany({
      where,
      include: {
        user: {
          select: { username: true, phone: true, savedTargetUsername: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id },
      include: {
        user: {
          select: { username: true, phone: true, savedTargetUsername: true },
        },
        job: {
          select: { id: true, status: true, error: true, screenshot: true },
        },
      },
    });
    if (!claim) throw new NotFoundException('Premio no encontrado');
    return claim;
  }

  async findActiveForUser(userId: string) {
    const terminalStatuses: PrizeClaimStatus[] = [
      'COMPLETED',
      'REJECTED',
      'VERIFICATION_FAILED',
      'FAILED',
    ];
    return this.prisma.prizeClaim.findFirst({
      where: {
        userId,
        status: { notIn: terminalStatuses },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Returns the user's active prize claim, or — if there's no active one — the
   * latest terminal claim within the last 6 hours. This lets the chat-app's home
   * banner keep showing "Premio pagado / rechazado" for a while after the final
   * status change, so the user actually sees the outcome before it disappears.
   */
  async findCurrentForUser(userId: string) {
    const active = await this.findActiveForUser(userId);
    if (active) return active;
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    return this.prisma.prizeClaim.findFirst({
      where: {
        userId,
        status: {
          in: ['COMPLETED', 'REJECTED', 'VERIFICATION_FAILED', 'FAILED'],
        },
        updatedAt: { gte: sixHoursAgo },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Reject the new claim if the user already had a paid prize in the last 24 hours.
   * Hard rate-limit to prevent quick successive cash-outs.
   *
   * Robustness: filters by `completedBy IS NOT NULL` so we only count claims that
   * were actually marked COMPLETED by an operator (defends against stray status
   * transitions). `updatedAt` is the timestamp of that final status change.
   */
  private async assertNoRecentPaidClaim(userId: string) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPaid = await this.prisma.prizeClaim.findFirst({
      where: {
        userId,
        status: 'COMPLETED',
        completedBy: { not: null },
        updatedAt: { gte: twentyFourHoursAgo },
      },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    if (recentPaid) {
      const nextAvailableAt = new Date(
        recentPaid.updatedAt.getTime() + 24 * 60 * 60 * 1000,
      );
      const elapsedHours =
        (Date.now() - recentPaid.updatedAt.getTime()) / (1000 * 60 * 60);
      const remainingHours = Math.max(0, 24 - elapsedHours);
      const remainingLabel =
        remainingHours >= 1
          ? `${Math.ceil(remainingHours)} hs`
          : `${Math.ceil(remainingHours * 60)} min`;
      // Render Argentine time (UTC-3) so users always see local time even if the
      // server is in a different TZ.
      const fmt = new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const nextAvailableLabel = fmt.format(nextAvailableAt);
      throw new BadRequestException(
        `Solo se puede cobrar un premio cada 24 hs. Ya cobraste uno hace poco. ` +
          `Vas a poder cobrar el próximo a partir del ${nextAvailableLabel} hs ` +
          `(en aproximadamente ${remainingLabel}).`,
      );
    }
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private formatClaimForOperator(claim: any) {
    return {
      id: claim.id,
      userId: claim.userId,
      targetUsername: claim.targetUsername,
      amount: Number(claim.amount),
      status: claim.status,
      paymentMethod: claim.paymentMethod,
      paymentDetails: claim.paymentDetails,
      verifiedBalance: claim.verifiedBalance
        ? Number(claim.verifiedBalance)
        : null,
      verifiedAt: claim.verifiedAt,
      panelId: claim.panelId,
      chatId: claim.chatId,
      createdAt: claim.createdAt,
      // Por qué falló la verificación, para que el operador lo vea en la cola sin
      // tener que reconstruirlo de los logs.
      rejectionReason: claim.rejectionReason ?? null,
    };
  }
}
