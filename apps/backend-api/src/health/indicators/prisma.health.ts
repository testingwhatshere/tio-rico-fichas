import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * El healthcheck de Render (y cualquier monitor externo) pega en /api/health
   * cada pocos segundos: eran ~30.000 `SELECT 1` por dia contra Supabase, que
   * cobra cada viaje como egress. Un OK se reusa 60 s; un fallo nunca se cachea,
   * asi que una caida de la base se sigue viendo al instante.
   */
  private static readonly OK_TTL_MS = 60_000;
  private lastOkAt = 0;

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (Date.now() - this.lastOkAt < PrismaHealthIndicator.OK_TTL_MS) {
      return this.getStatus(key, true);
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      this.lastOkAt = Date.now();
      return this.getStatus(key, true);
    } catch (error) {
      this.lastOkAt = 0;
      throw new HealthCheckError(
        'Prisma health check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
