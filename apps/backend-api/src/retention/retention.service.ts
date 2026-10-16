import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { cloudinaryPublicIdFromUrl } from '../common/utils/proof-url';

/**
 * Vencimiento de lo que se acumula sin que nadie lo borre.
 *
 * Nada en el sistema borraba nada, y el volumen se multiplicó: los comprobantes
 * crecen ~1,4 GB por mes en Cloudinary y los logs ~40.000 filas por mes en la
 * base. Sin un vencimiento, las dos cuentas crecen para siempre y el problema
 * aparece el día que el plan se agota.
 *
 * Plazos decididos por el dueño (2026-09-20):
 * - Comprobantes: 6 meses, y sólo de cargas COMPLETED. Una carga que no terminó
 *   bien puede estar en revisión, y ahí el comprobante es la única evidencia.
 * - Logs del bot y del validador: 30 días.
 *
 * La fila de la carga NO se borra nunca: queda el monto, el estado y el
 * historial. Lo que se borra es el archivo.
 *
 * No hace falta una columna para marcar el vencimiento: una carga COMPLETED con
 * `proofUploadedAt` y sin `proofUrl` sólo puede ser una purgada. (Al pedir un
 * comprobante nuevo también se limpia `proofUrl`, pero eso deja la carga en
 * PENDING_PROOF, nunca en COMPLETED.) Ver `proofWasPurged` en
 * `common/utils/proof-url.ts`.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  /** 6 meses. */
  private readonly PROOF_RETENTION_DAYS = 180;
  /** 30 días. */
  private readonly LOG_RETENTION_DAYS = 30;
  /** Tope por corrida: si un día hay mucho para borrar, se reparte en varias. */
  private readonly BATCH = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  private daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async run() {
    await this.purgeOldProofs();
    await this.purgeOldLogs();
  }

  /**
   * Borra de Cloudinary el archivo de las cargas completadas hace más de 6
   * meses y deja marcado el vencimiento.
   */
  async purgeOldProofs(): Promise<number> {
    const cutoff = this.daysAgo(this.PROOF_RETENTION_DAYS);

    const rows = await this.prisma.request.findMany({
      where: {
        status: 'COMPLETED',
        proofUrl: { not: null },
        createdAt: { lt: cutoff },
      },
      select: { id: true, proofUrl: true },
      orderBy: { createdAt: 'asc' },
      take: this.BATCH,
    });
    if (rows.length === 0) return 0;

    let borrados = 0;
    for (const r of rows) {
      const publicId = cloudinaryPublicIdFromUrl(r.proofUrl);
      if (!publicId) {
        // No se pudo interpretar la URL: se deja como está en vez de adivinar.
        this.logger.warn(
          `Retención: no pude derivar el archivo de la carga ${r.id}, la salteo`,
        );
        continue;
      }
      try {
        await this.uploads.deleteByPublicId(publicId);
        await this.prisma.request.update({
          where: { id: r.id },
          data: { proofUrl: null },
        });
        borrados++;
      } catch (error: any) {
        // Que falle uno no puede cortar la tanda.
        this.logger.warn(
          `Retención: falló el borrado de ${publicId} (carga ${r.id}): ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Retención de comprobantes: ${borrados} archivos borrados ` +
        `(cargas completadas antes del ${cutoff.toISOString().slice(0, 10)})`,
    );
    return borrados;
  }

  /** Borra los logs del bot y del validador de más de 30 días. */
  async purgeOldLogs(): Promise<{ bot: number; validator: number }> {
    const cutoff = this.daysAgo(this.LOG_RETENTION_DAYS);

    const [bot, validator] = await Promise.all([
      this.prisma.botSessionLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
      this.prisma.validatorLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
    ]);

    if (bot.count || validator.count) {
      this.logger.log(
        `Retención de logs: ${bot.count} del bot y ${validator.count} del validador ` +
          `(anteriores al ${cutoff.toISOString().slice(0, 10)})`,
      );
    }
    return { bot: bot.count, validator: validator.count };
  }
}
