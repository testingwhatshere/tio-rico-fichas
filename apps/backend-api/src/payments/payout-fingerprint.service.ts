import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { ProofValidationService } from './proof-validation.service';

/**
 * Ventana en la que un comprobante de premio todavía podría usarse como carga:
 * pasado el `VALIDATION_DATE_WINDOW_DAYS` (7) el comprobante ya se rechaza por
 * viejo. Un día de margen.
 */
const FINGERPRINT_WINDOW_DAYS = 8;
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
/** Comprobantes por barrido: el validador es uno solo y atiende cargas primero. */
const SWEEP_BATCH = 3;
const BOOT_DELAY_MS = 2 * 60 * 1000;
/** Intentos por comprobante antes de darlo por ilegible. */
const MAX_ATTEMPTS = 3;

type StoredPayoutProof = {
  url: string;
  type?: string;
  name?: string;
  /** Número de operación leído por el validador (null si no se pudo leer). */
  transactionId?: string | null;
  amountRead?: number | null;
  fingerprintedAt?: string;
  fingerprintAttempts?: number;
};

/**
 * Registra el número de operación de cada comprobante de premio que pagamos.
 *
 * Ese comprobante le llega al ganador por el chat. Si lo sube como comprobante de
 * una carga, `PaymentsService` encuentra su número de operación acá y la frena
 * (`PAYOUT_PROOF_REUSED`). Es la segunda defensa: la primera es reconocer en el
 * texto que nuestra cuenta es la que paga (`OUR_WALLET_AS_SENDER`), que no
 * alcanza cuando el formato no marca quién paga y quién cobra.
 *
 * El validador se usa sólo cuando está libre: leer un premio nunca demora una carga.
 */
@Injectable()
export class PayoutFingerprintService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PayoutFingerprintService.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly proofValidation: ProofValidationService,
  ) {}

  onApplicationBootstrap() {
    // El primer barrido espera a que el validador se reconecte después del deploy.
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.interval = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
      void this.sweep();
    }, BOOT_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.interval) clearInterval(this.interval);
    this.bootTimer = null;
    this.interval = null;
  }

  /** Lee ya los comprobantes de un premio recién pagado (si el validador está libre). */
  async fingerprintClaim(claimId: string): Promise<void> {
    await this.runExclusive(() => this.processClaim(claimId, SWEEP_BATCH));
  }

  /** Premios pagados en la ventana con algún comprobante sin leer. */
  async sweep(): Promise<void> {
    await this.runExclusive(async () => {
      const since = new Date(
        Date.now() - FINGERPRINT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const claims = await this.prisma.prizeClaim.findMany({
        where: {
          status: 'COMPLETED',
          updatedAt: { gte: since },
          payoutProofs: { not: Prisma.AnyNull },
        },
        select: { id: true, payoutProofs: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      let budget = SWEEP_BATCH;
      for (const claim of claims) {
        if (budget <= 0) break;
        const proofs = (claim.payoutProofs as StoredPayoutProof[]) || [];
        if (!proofs.some((p) => !p.fingerprintedAt)) continue;
        budget -= await this.processClaim(claim.id, budget);
      }
    });
  }

  private async runExclusive(fn: () => Promise<unknown>) {
    if (this.running) return;
    this.running = true;
    try {
      await fn();
    } catch (err: any) {
      this.logger.warn(
        `Lectura de comprobantes de premios: ${err?.message || err}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Lee hasta `max` comprobantes pendientes del premio. Devuelve cuántos pedidos le
   * hizo al validador (salgan bien o mal): eso es lo que se descuenta del tope.
   */
  private async processClaim(claimId: string, max: number): Promise<number> {
    const claim = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
      select: { payoutProofs: true, amount: true },
    });
    const proofs = [...((claim?.payoutProofs as StoredPayoutProof[]) || [])];
    // El validador exige un monto esperado positivo (rechaza 0 sin leer nada). El
    // del premio sirve: acá sólo interesa el número de operación.
    const expectedAmount = Math.max(Number(claim?.amount) || 0, 1);
    let attempts = 0;
    for (let i = 0; i < proofs.length && attempts < max; i++) {
      const proof = proofs[i];
      if (proof.fingerprintedAt) continue;
      if (!this.proofValidation.isIdle()) break;

      const mimeType = proof.type === 'pdf' ? 'application/pdf' : 'image/jpeg';
      const url = this.uploads.toDeliverableUrl(proof.url, mimeType);
      attempts++;
      const result = await this.proofValidation.validateProof(
        url,
        // Cloudinary entrega los PDF convertidos a JPG (f_jpg,pg_1).
        url.includes('/f_jpg') ? 'image/jpeg' : mimeType,
        expectedAmount,
        `payout:${claimId}:${i}`,
        null,
      );

      const failed = result.flags?.includes('REQUIRES_MANUAL_REVIEW');
      const tries = (proof.fingerprintAttempts ?? 0) + 1;
      // Un comprobante que el validador no puede leer no se reintenta para siempre.
      const giveUp = failed && tries >= MAX_ATTEMPTS;
      proofs[i] =
        failed && !giveUp
          ? { ...proof, fingerprintAttempts: tries }
          : {
              ...proof,
              fingerprintAttempts: tries,
              transactionId: failed ? null : (result.transactionId ?? null),
              amountRead: failed ? null : (result.extractedAmount ?? null),
              fingerprintedAt: new Date().toISOString(),
            };
      // Se relee y se escribe sólo esta entrada: el operador puede haber tocado
      // el premio mientras el validador leía.
      await this.saveProof(claimId, i, proofs[i]);
      this.logger.log(
        failed
          ? `Premio ${claimId}: comprobante ${i + 1}/${proofs.length} sin leer (intento ${tries}/${MAX_ATTEMPTS}): ${result.reasoning}`
          : `Premio ${claimId}: comprobante ${i + 1}/${proofs.length} registrado ` +
              `(operación ${proofs[i].transactionId ?? 'sin leer'})`,
      );
      // Si el validador falla, no se insiste con más comprobantes en este barrido.
      if (failed) return max;
    }
    return attempts;
  }

  private async saveProof(
    claimId: string,
    index: number,
    proof: StoredPayoutProof,
  ) {
    const current = await this.prisma.prizeClaim.findUnique({
      where: { id: claimId },
      select: { payoutProofs: true },
    });
    const list = [...((current?.payoutProofs as StoredPayoutProof[]) || [])];
    if (!list[index] || list[index].url !== proof.url) return;
    list[index] = proof;
    // SQL directo para no tocar `updatedAt`: el tablero de premios ordena por esa
    // fecha y un premio ya pagado no tiene que volver a subir.
    await this.prisma.$executeRaw`
      UPDATE "PrizeClaim" SET "payoutProofs" = ${JSON.stringify(list)}::jsonb
      WHERE id = ${claimId}
    `;
  }
}
