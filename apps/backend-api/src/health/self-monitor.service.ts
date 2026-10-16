import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { SettingsService } from '../settings/settings.service';
import { BotGateway } from '../bot/bot.gateway';
import { OperatorGateway } from '../events/operator.gateway';

interface HealthStatus {
  db: boolean;
  botOnline: boolean;
  noStuckJobs: boolean;
  killSwitchOff: boolean;
  queueHealthy: boolean;
}

/**
 * Self-monitoring service that runs periodic health checks
 * and sends Telegram alerts when issues are detected.
 *
 * Runs every 5 minutes, 24/7, as long as the backend is up.
 */
@Injectable()
export class SelfMonitorService implements OnModuleInit {
  private readonly logger = new Logger(SelfMonitorService.name);
  private lastAlertedIssues = new Set<string>();
  private consecutiveFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly settings: SettingsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.logger.log('Self-monitor initialized — checks every 5 minutes');
    // Run first check after 30s to let everything initialize
    setTimeout(() => this.runHealthCheck(), 30000);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runHealthCheck() {
    try {
      const status = await this.checkAll();
      const issues = this.getIssues(status);

      if (issues.length > 0) {
        this.consecutiveFailures++;
        await this.handleIssues(issues);
      } else {
        // If we had issues before but now resolved, send recovery
        if (this.lastAlertedIssues.size > 0) {
          await this.sendRecoveryAlert();
        }
        this.consecutiveFailures = 0;
        this.lastAlertedIssues.clear();
      }
    } catch (error) {
      this.logger.error('Health check failed to execute:', error);
    }
  }

  /**
   * "Entran cargas y no sale ninguna": en los últimos 30 min hubo al menos 3
   * cargas que fallaron y ninguna que el bot completara. Cubre el freno de la
   * extensión y cualquier otra causa que todavía no conocemos. Avisa por
   * Telegram (una vez por hora mientras dure) y con un aviso en la web.
   *
   * Nace del 2026-10-15: el bot estuvo frenado ~9 h y los operadores cargaron
   * todo a mano sin que nada avisara. Son dos COUNT por índice: barato.
   */
  private lastStalledWebAlertAt = 0;

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkBotStalled() {
    try {
      const since = new Date(Date.now() - 30 * 60 * 1000);
      const [failed, completed] = await Promise.all([
        this.prisma.job.count({
          where: { type: 'LOAD_CREDITS', status: 'FAILED', createdAt: { gte: since } },
        }),
        this.prisma.job.count({
          where: { type: 'LOAD_CREDITS', status: 'COMPLETED', createdAt: { gte: since } },
        }),
      ]);
      if (failed < 3 || completed > 0) return;

      const message =
        `En los últimos 30 minutos fallaron <b>${failed}</b> cargas y el bot no completó ninguna.\n\n` +
        `Los operadores están cargando a mano. Revisar las PCs del bot (sesión del panel, extensión pausada) y la cola de Fallos.`;
      this.logger.warn(`Bot stalled: ${failed} failed / 0 completed in 30 min`);
      await this.telegram.alertBotStalled('no-completions', message);
      if (Date.now() - this.lastStalledWebAlertAt < 30 * 60 * 1000) return;
      this.lastStalledWebAlertAt = Date.now();
      try {
        const op = this.moduleRef.get(OperatorGateway, { strict: false });
        op?.emitToAll('system_alert', {
          type: 'bot_stalled',
          severity: 'critical',
          message: `El bot no está cargando: ${failed} cargas fallaron en 30 min y ninguna salió. Revisar las PCs del bot.`,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* sin gateway: queda el Telegram */
      }
    } catch (error) {
      this.logger.error('Bot-stalled check failed:', error);
    }
  }

  private async checkAll(): Promise<HealthStatus> {
    const [db, botOnline, noStuckJobs, killSwitchOff, queueHealthy] =
      await Promise.allSettled([
        this.checkDatabase(),
        this.checkBotOnline(),
        this.checkNoStuckJobs(),
        this.checkKillSwitch(),
        this.checkQueueHealth(),
      ]);

    return {
      db: db.status === 'fulfilled' && db.value,
      botOnline: botOnline.status === 'fulfilled' && botOnline.value,
      noStuckJobs: noStuckJobs.status === 'fulfilled' && noStuckJobs.value,
      killSwitchOff:
        killSwitchOff.status === 'fulfilled' && killSwitchOff.value,
      queueHealthy: queueHealthy.status === 'fulfilled' && queueHealthy.value,
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ¿Hay alguna extensión conectada AHORA? Se mira el gateway en vivo.
   *
   * Antes se leían los Settings BOT_STATUS / BOT_LAST_HEARTBEAT, pero el
   * heartbeat se persiste como mucho cada 5 minutos (HEARTBEAT_PERSIST_INTERVAL_MS)
   * y el chequeo exigía uno de hace menos de 3: daba BOT_OFFLINE con el bot
   * andando (28 alertas falsas el 2026-10-13). Además eran 2 consultas a la base
   * cada 5 minutos. El gateway se busca con ModuleRef: el módulo de health no
   * importa el de bot.
   */
  private checkBotOnline(): Promise<boolean> {
    try {
      const gateway = this.moduleRef.get(BotGateway, { strict: false });
      return Promise.resolve(gateway.getTotalBotCount() > 0);
    } catch {
      return Promise.resolve(false);
    }
  }

  private async checkNoStuckJobs(): Promise<boolean> {
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const stuckJobs = await this.prisma.job.count({
        where: {
          status: 'PROCESSING',
          createdAt: { lt: fiveMinAgo },
        },
      });
      return stuckJobs === 0;
    } catch {
      return false;
    }
  }

  private async checkKillSwitch(): Promise<boolean> {
    try {
      const setting = await this.prisma.setting.findUnique({
        where: { key: 'KILL_SWITCH' },
      });
      return setting?.value !== 'true';
    } catch {
      return true; // Don't alert on check failure
    }
  }

  private async checkQueueHealth(): Promise<boolean> {
    try {
      // If more than 20 queued jobs, something might be wrong
      const queuedCount = await this.prisma.job.count({
        where: { status: 'QUEUED' },
      });
      return queuedCount < 20;
    } catch {
      return false;
    }
  }

  private getIssues(status: HealthStatus): string[] {
    const issues: string[] = [];
    if (!status.db) issues.push('DB_DOWN');
    if (!status.botOnline) issues.push('BOT_OFFLINE');
    if (!status.noStuckJobs) issues.push('STUCK_JOBS');
    if (!status.killSwitchOff) issues.push('KILL_SWITCH_ON');
    if (!status.queueHealthy) issues.push('QUEUE_OVERLOADED');
    return issues;
  }

  private async handleIssues(issues: string[]) {
    // Only alert on new issues (avoid spam)
    const newIssues = issues.filter((i) => !this.lastAlertedIssues.has(i));

    if (newIssues.length > 0 || this.consecutiveFailures % 12 === 0) {
      // Alert on new issues, or re-alert every hour (12 * 5min = 60min)
      const issueMessages = issues.map((i) => this.issueToMessage(i));
      const message =
        `🚨 <b>ALERTA DE SISTEMA</b>\n\n` +
        issueMessages.join('\n') +
        `\n\n<i>Check #${this.consecutiveFailures} — ${new Date().toLocaleString('es-AR')}</i>`;

      await this.telegram.send(message);
      this.logger.warn(`Health alert sent: ${issues.join(', ')}`);
    }

    issues.forEach((i) => this.lastAlertedIssues.add(i));
  }

  private async sendRecoveryAlert() {
    const resolved = Array.from(this.lastAlertedIssues).map((i) =>
      this.issueToMessage(i),
    );
    const message =
      `✅ <b>SISTEMA RECUPERADO</b>\n\n` +
      `Problemas resueltos:\n${resolved.join('\n')}\n\n` +
      `<i>${new Date().toLocaleString('es-AR')}</i>`;

    await this.telegram.send(message);
    this.logger.log('Recovery alert sent');
  }

  private issueToMessage(issue: string): string {
    const map: Record<string, string> = {
      DB_DOWN: '🔴 Base de datos no responde',
      BOT_OFFLINE: '🟡 Bot de automatizacion offline o sin heartbeat',
      STUCK_JOBS: '🟡 Hay jobs stuck en PROCESSING (>5min)',
      KILL_SWITCH_ON: '🔴 Kill switch esta ACTIVADO',
      QUEUE_OVERLOADED: '🟡 Cola sobrecargada (20+ jobs en espera)',
    };
    return map[issue] || `⚪ ${issue}`;
  }
}
