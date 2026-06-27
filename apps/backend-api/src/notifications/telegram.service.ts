import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BotGateway } from '../bot/bot.gateway';
import { NotificationsService } from './notifications.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private botToken: string | null = null;
  private chatIds: Set<string> = new Set();
  private enabled = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastUpdateId = 0;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.botToken =
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') || null;
    this.enabled = !!this.botToken;

    if (!this.enabled) {
      this.logger.warn(
        'Telegram notifications disabled (TELEGRAM_BOT_TOKEN missing)',
      );
    }
  }

  async onModuleInit() {
    if (!this.enabled) return;

    await this.loadChatIds();

    // Also add legacy env var chat ID if present
    const envChatId = this.configService.get<string>('TELEGRAM_CHAT_ID');
    if (envChatId) this.chatIds.add(envChatId);

    this.logger.log(`Telegram enabled — ${this.chatIds.size} subscriber(s)`);

    // Register bot commands with Telegram
    this.registerCommands();

    // Poll for messages every 30s
    this.pollInterval = setInterval(() => this.pollUpdates(), 30000);
    this.pollUpdates();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ==========================================
  // CHAT ID PERSISTENCE
  // ==========================================

  private async loadChatIds() {
    try {
      const setting = await this.prisma.setting.findUnique({
        where: { key: 'TELEGRAM_CHAT_IDS' },
      });
      if (setting?.value) {
        setting.value
          .split(',')
          .filter(Boolean)
          .forEach((id) => this.chatIds.add(id.trim()));
      }
    } catch (e) {
      this.logger.warn('Could not load Telegram chat IDs:', e.message);
    }
  }

  private async saveChatIds() {
    try {
      const value = Array.from(this.chatIds).join(',');
      await this.prisma.setting.upsert({
        where: { key: 'TELEGRAM_CHAT_IDS' },
        update: { value },
        create: { key: 'TELEGRAM_CHAT_IDS', value },
      });
    } catch (e) {
      this.logger.warn('Could not save Telegram chat IDs:', e.message);
    }
  }

  // ==========================================
  // BOT COMMANDS REGISTRATION
  // ==========================================

  private async registerCommands() {
    try {
      await fetch(
        `https://api.telegram.org/bot${this.botToken}/setMyCommands`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commands: [
              { command: 'start', description: 'Suscribirse a alertas' },
              { command: 'stop', description: 'Dejar de recibir alertas' },
              { command: 'status', description: 'Estado general del sistema' },
              {
                command: 'fichas',
                description: 'Fichas disponibles en el panel',
              },
              {
                command: 'billeteras',
                description: 'Estado de las billeteras',
              },
              { command: 'jobs', description: 'Ultimos jobs (hoy)' },
              {
                command: 'fallos',
                description: 'Fallos pendientes de revision',
              },
              {
                command: 'premios',
                description: 'Premios pendientes de cobro',
              },
              {
                command: 'promo',
                description: 'Enviar promo a todos los usuarios',
              },
              {
                command: 'update',
                description: 'Publicar nueva version del APK',
              },
              { command: 'help', description: 'Ayuda' },
            ],
          }),
        },
      );
    } catch {}
  }

  // ==========================================
  // POLL & COMMAND HANDLING
  // ==========================================

  private async pollUpdates() {
    if (!this.botToken) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=0`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.ok || !data.result?.length) return;

      let subscribersChanged = false;

      for (const update of data.result) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

        // Handle inline button callbacks (e.g., panel selection from /fichas)
        if (update.callback_query) {
          await this.handleCallbackQuery(update.callback_query);
          continue;
        }

        const msg = update.message;
        if (!msg?.chat?.id) continue;

        const chatId = String(msg.chat.id);
        const text = (msg.text || '').trim().toLowerCase();
        const name = msg.from?.first_name || 'Operador';

        // Auto-subscribe on any message if not subscribed
        if (!this.chatIds.has(chatId) && text !== '/stop') {
          this.chatIds.add(chatId);
          subscribersChanged = true;
          this.logger.log(`New Telegram subscriber: ${name} (${chatId})`);
        }

        if (text === '/start' || text === 'hola') {
          await this.sendTo(
            chatId,
            `👋 <b>Hola ${name}!</b>\n\n` +
              `Vas a recibir alertas del sistema.\n` +
              `Usa /help para ver los comandos disponibles.`,
          );
        } else if (text === '/stop') {
          this.chatIds.delete(chatId);
          subscribersChanged = true;
          await this.sendTo(
            chatId,
            '✅ Ya no recibiras alertas. Envia /start para volver.',
          );
        } else if (text === '/help') {
          await this.sendTo(
            chatId,
            `📋 <b>Comandos disponibles</b>\n\n` +
              `/status — Estado general del sistema\n` +
              `/fichas — Fichas disponibles en el panel\n` +
              `/billeteras — Estado de las billeteras\n` +
              `/jobs — Resumen de jobs de hoy\n` +
              `/fallos — Fallos pendientes de revision\n` +
              `/premios — Premios pendientes de cobro\n` +
              `/promo &lt;mensaje&gt; — Enviar promo a todos los usuarios\n` +
              `/update &lt;version&gt; — Publicar nueva version del APK\n` +
              `/stop — Dejar de recibir alertas`,
          );
        } else if (text === '/status') {
          await this.handleStatusCommand(chatId);
        } else if (text === '/fichas') {
          await this.handleFichasCommand(chatId);
        } else if (text === '/billeteras') {
          await this.handleBilleterasCommand(chatId);
        } else if (text === '/jobs') {
          await this.handleJobsCommand(chatId);
        } else if (text === '/fallos') {
          await this.handleFallosCommand(chatId);
        } else if (text === '/premios') {
          await this.handlePremiosCommand(chatId);
        } else if (text.startsWith('/promo ')) {
          await this.handlePromoCommand(chatId, text.substring(7).trim());
        } else if (text === '/promo') {
          await this.sendTo(
            chatId,
            '📢 Uso: /promo <mensaje>\n\nEjemplo: /promo HOY 10% extra en cargas de +$10.000!',
          );
        } else if (text.startsWith('/update ')) {
          await this.handleUpdateCommand(chatId, text.substring(8).trim());
        } else if (text === '/update') {
          await this.sendTo(
            chatId,
            '📦 Uso: /update <version>\n\nEjemplo: /update 1.2.0\n\nSe usara el APK de la landing page.',
          );
        }
      }

      if (subscribersChanged) {
        await this.saveChatIds();
      }
    } catch (error: any) {
      this.logger.error(`Telegram poll error: ${error.message}`);
    }
  }

  // ==========================================
  // COMMAND HANDLERS
  // ==========================================

  private async handleStatusCommand(chatId: string) {
    try {
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );

      const [
        todayRequests,
        todayCompleted,
        todayFailed,
        processingJobs,
        queuedJobs,
        activeWallets,
        botSetting,
      ] = await Promise.all([
        this.prisma.request.count({
          where: { createdAt: { gte: startOfDay } },
        }),
        this.prisma.request.count({
          where: { createdAt: { gte: startOfDay }, status: 'COMPLETED' },
        }),
        this.prisma.request.count({
          where: { createdAt: { gte: startOfDay }, status: 'FAILED' },
        }),
        this.prisma.job.count({ where: { status: 'PROCESSING' } }),
        this.prisma.job.count({ where: { status: 'QUEUED' } }),
        this.prisma.paymentConfig.count({ where: { isActive: true } }),
        this.prisma.setting.findUnique({ where: { key: 'BOT_STATUS' } }),
      ]);

      const botStatus = botSetting?.value || 'desconocido';
      const successRate =
        todayRequests > 0
          ? Math.round((todayCompleted / todayRequests) * 100)
          : 0;

      await this.sendTo(
        chatId,
        `📊 <b>Estado del Sistema</b>\n\n` +
          `<b>Hoy:</b>\n` +
          `• Solicitudes: ${todayRequests}\n` +
          `• Completadas: ${todayCompleted} ✅\n` +
          `• Fallidas: ${todayFailed} ❌\n` +
          `• Tasa exito: ${successRate}%\n\n` +
          `<b>Ahora:</b>\n` +
          `• Bot: ${botStatus === 'online' ? '🟢 Online' : '🔴 ' + botStatus}\n` +
          `• En cola: ${queuedJobs}\n` +
          `• Procesando: ${processingJobs}\n` +
          `• Billeteras activas: ${activeWallets}`,
      );
    } catch (e) {
      await this.sendTo(chatId, '❌ Error al obtener estado: ' + e.message);
    }
  }

  private async handleFichasCommand(chatId: string) {
    try {
      // Get panels from DB
      const panels = await this.prisma.panel.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });

      if (panels.length === 0) {
        await this.sendTo(chatId, '🎰 No hay paneles configurados.');
        return;
      }

      // Show inline keyboard with panel buttons
      const keyboard = panels.map((p) => [
        {
          text: `🎰 ${p.name}`,
          callback_data: `fichas:${p.id}`,
        },
      ]);

      await this.sendWithKeyboard(
        chatId,
        '🎰 <b>Fichas del Panel</b>\n\n¿Qué panel querés revisar?',
        keyboard,
      );
    } catch (e) {
      await this.sendTo(chatId, '❌ Error: ' + e.message);
    }
  }

  private async handleCallbackQuery(query: any) {
    const chatId = String(query.message?.chat?.id);
    const data = query.data || '';
    const callbackQueryId = query.id;

    // Acknowledge the callback to remove "loading" spinner
    try {
      await fetch(
        `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQueryId }),
        },
      );
    } catch {}

    if (data.startsWith('fichas:')) {
      const panelId = data.substring(7);
      await this.handleFichasForPanel(chatId, panelId);
    }
  }

  private async handleFichasForPanel(chatId: string, panelId: string) {
    try {
      const panel = await this.prisma.panel.findUnique({
        where: { id: panelId },
      });
      if (!panel) {
        await this.sendTo(chatId, '❌ Panel no encontrado.');
        return;
      }

      await this.sendTo(
        chatId,
        `⏳ Consultando fichas de <b>${panel.name}</b>...`,
      );

      // Ask the extension to read the balance from the panel DOM
      const balance = await this.botGateway.checkPanelBalance(panelId);

      if (balance === null) {
        await this.sendTo(
          chatId,
          `❓ No se pudo leer el balance de <b>${panel.name}</b>. La pestaña del panel puede estar cerrada.`,
        );
        return;
      }

      const setting = await this.prisma.setting.findUnique({
        where: { key: 'PANEL_BALANCE_THRESHOLD' },
      });
      const threshold = setting?.value ? parseFloat(setting.value) : 1000;

      const statusEmoji =
        balance <= threshold * 0.2 ? '🔴' : balance <= threshold ? '🟡' : '🟢';

      await this.sendTo(
        chatId,
        `🎰 <b>${panel.name}</b>\n\n` +
          `${statusEmoji} Fichas: <b>$${balance.toLocaleString('es-AR')}</b>\n` +
          `Umbral de alerta: $${threshold.toLocaleString('es-AR')}`,
      );
    } catch (e) {
      const msg = e.message || 'Error desconocido';
      if (msg.includes('No bot connected')) {
        await this.sendTo(
          chatId,
          '🔴 La extensión no está conectada para este panel.',
        );
      } else if (msg.includes('timed out')) {
        await this.sendTo(
          chatId,
          '⏰ La extensión tardó demasiado en responder. Intentá de nuevo.',
        );
      } else {
        await this.sendTo(chatId, '❌ Error: ' + msg);
      }
    }
  }

  private async sendWithKeyboard(
    chatId: string,
    text: string,
    keyboard: any[][],
  ) {
    if (!this.botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        }),
      });
    } catch (e) {
      this.logger.error(
        `Failed to send keyboard message to ${chatId}: ${e.message}`,
      );
    }
  }

  private async handleBilleterasCommand(chatId: string) {
    try {
      const wallets = await this.prisma.paymentConfig.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      if (wallets.length === 0) {
        await this.sendTo(chatId, '💳 No hay billeteras activas.');
        return;
      }

      const lines = wallets.map((w) => {
        const selected = w.isSelected ? ' 👈 ACTIVA' : '';
        const acc = Number(w.accumulatedAmount);
        const limit = w.amountLimit ? Number(w.amountLimit) : null;
        const pct = limit ? Math.round((acc / limit) * 100) : null;
        const bar = pct != null ? ` (${pct}%)` : '';
        const full = limit && acc >= limit ? ' ⚠️ LLENA' : '';

        return (
          `• <b>${w.label || w.holderName}</b>${selected}\n` +
          `  Acumulado: $${acc.toLocaleString('es-AR')}${limit ? ` / $${limit.toLocaleString('es-AR')}` : ' (sin limite)'}${bar}${full}`
        );
      });

      await this.sendTo(
        chatId,
        `💳 <b>Billeteras</b> (${wallets.length})\n\n${lines.join('\n\n')}`,
      );
    } catch (e) {
      await this.sendTo(chatId, '❌ Error: ' + e.message);
    }
  }

  private async handleJobsCommand(chatId: string) {
    try {
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );

      const [queued, processing, completed, failed, recentJobs] =
        await Promise.all([
          this.prisma.job.count({
            where: { createdAt: { gte: startOfDay }, status: 'QUEUED' },
          }),
          this.prisma.job.count({
            where: { createdAt: { gte: startOfDay }, status: 'PROCESSING' },
          }),
          this.prisma.job.count({
            where: { createdAt: { gte: startOfDay }, status: 'COMPLETED' },
          }),
          this.prisma.job.count({
            where: { createdAt: { gte: startOfDay }, status: 'FAILED' },
          }),
          this.prisma.job.findMany({
            where: { createdAt: { gte: startOfDay } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              request: { select: { targetUsername: true, amount: true } },
            },
          }),
        ]);

      const total = queued + processing + completed + failed;

      let msg =
        `🔧 <b>Jobs de Hoy</b> (${total})\n\n` +
        `⏳ En cola: ${queued}\n` +
        `⚙️ Procesando: ${processing}\n` +
        `✅ Completados: ${completed}\n` +
        `❌ Fallidos: ${failed}\n`;

      if (recentJobs.length > 0) {
        msg += `\n<b>Ultimos 5:</b>\n`;
        for (const job of recentJobs) {
          const status =
            job.status === 'COMPLETED'
              ? '✅'
              : job.status === 'FAILED'
                ? '❌'
                : job.status === 'PROCESSING'
                  ? '⚙️'
                  : '⏳';
          const user = job.request?.targetUsername || '?';
          const amount = job.request?.amount
            ? `$${Number(job.request.amount).toLocaleString('es-AR')}`
            : '';
          const time = new Date(job.createdAt).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          });
          msg += `${status} ${time} — ${user} ${amount}\n`;
        }
      }

      await this.sendTo(chatId, msg);
    } catch (e) {
      await this.sendTo(chatId, '❌ Error: ' + e.message);
    }
  }

  private async handleFallosCommand(chatId: string) {
    try {
      const [validationFailed, jobFailed] = await Promise.all([
        this.prisma.request.findMany({
          where: { status: 'VALIDATION_FAILED' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            targetUsername: true,
            amount: true,
            createdAt: true,
            validationError: true,
          },
        }),
        this.prisma.job.findMany({
          where: { status: 'FAILED' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            request: { select: { targetUsername: true, amount: true } },
          },
        }),
      ]);

      const total = validationFailed.length + jobFailed.length;

      if (total === 0) {
        await this.sendTo(chatId, '✅ <b>No hay fallos pendientes!</b>');
        return;
      }

      let msg = `⚠️ <b>Fallos Pendientes</b>\n\n`;

      if (validationFailed.length > 0) {
        msg += `<b>Validaciones fallidas (${validationFailed.length}):</b>\n`;
        for (const r of validationFailed) {
          const time = new Date(r.createdAt).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          });
          msg += `• ${time} — ${r.targetUsername || '?'} $${Number(r.amount).toLocaleString('es-AR')}`;
          if (r.validationError) msg += ` (${r.validationError.slice(0, 40)})`;
          msg += '\n';
        }
      }

      if (jobFailed.length > 0) {
        msg += `\n<b>Jobs fallidos (${jobFailed.length}):</b>\n`;
        for (const j of jobFailed) {
          const time = new Date(j.createdAt).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          });
          const user = j.request?.targetUsername || '?';
          msg += `• ${time} — ${user}`;
          if (j.error) msg += ` (${j.error.slice(0, 40)})`;
          msg += '\n';
        }
      }

      await this.sendTo(chatId, msg);
    } catch (e) {
      await this.sendTo(chatId, '❌ Error: ' + e.message);
    }
  }

  // ==========================================
  // SEND METHODS
  // ==========================================

  private async sendTo(chatId: string, message: string): Promise<boolean> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 || data.error_code === 403) {
          this.chatIds.delete(chatId);
          this.saveChatIds().catch(() => {});
        }
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async send(message: string): Promise<boolean> {
    if (!this.enabled) return false;

    // Lazy-reload chat IDs if empty (may have failed at startup)
    if (this.chatIds.size === 0) {
      await this.loadChatIds();
      if (this.chatIds.size === 0) return false;
    }

    const results = await Promise.allSettled(
      Array.from(this.chatIds).map((id) => this.sendTo(id, message)),
    );
    return results.some((r) => r.status === 'fulfilled' && r.value);
  }

  // ==========================================
  // ALERT METHODS
  // ==========================================

  async alertLowPanelBalance(
    balance: number,
    threshold: number,
    panelId?: string,
  ) {
    const panel = panelId ? ` (${panelId})` : '';
    await this.send(
      `🔴 <b>FICHAS BAJAS${panel}</b>\n\n` +
        `Balance: <b>$${balance.toLocaleString('es-AR')}</b>\n` +
        `Umbral: $${threshold.toLocaleString('es-AR')}\n\n` +
        `Se necesita recargar fichas en el panel.`,
    );
  }

  async alertJobFailed(jobId: string, error: string, targetUsername?: string) {
    await this.send(
      `❌ <b>JOB FALLIDO</b>\n\n` +
        `Job: <code>${jobId.slice(0, 8)}</code>\n` +
        (targetUsername ? `Usuario: ${targetUsername}\n` : '') +
        `Error: ${error}`,
    );
  }

  async alertValidationFailed(requestId: string, reason?: string) {
    await this.send(
      `⚠️ <b>VALIDACION FALLIDA</b>\n\n` +
        `Request: <code>${requestId.slice(0, 8)}</code>\n` +
        (reason ? `Razon: ${reason}\n` : '') +
        `Requiere revision manual.`,
    );
  }

  async alertWalletsAllFull() {
    await this.send(
      `🟠 <b>BILLETERAS LLENAS</b>\n\n` +
        `Todas las billeteras alcanzaron su limite.\n` +
        `Se necesita vaciar o agregar una nueva.`,
    );
  }

  async alertSystemCritical(message: string) {
    await this.send(`🚨 <b>ALERTA CRITICA</b>\n\n${message}`);
  }

  private lastBotDisconnectAlert = 0;
  private static readonly BOT_DISCONNECT_ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown

  async alertBotDisconnected() {
    // Don't spam — only alert once every 5 minutes (Chrome SW suspensions cause frequent disconnect/reconnect cycles)
    const now = Date.now();
    if (
      now - this.lastBotDisconnectAlert <
      TelegramService.BOT_DISCONNECT_ALERT_COOLDOWN_MS
    ) {
      return;
    }
    this.lastBotDisconnectAlert = now;

    await this.send(
      `🔌 <b>BOT DESCONECTADO</b>\n\n` +
        `La extension de automatizacion se desconecto del servidor.\n` +
        `Si se reconecta en los proximos minutos, es normal (Chrome suspende el service worker).`,
    );
  }

  // --- Verification extension alerts (EX11/EX12) ---
  // Per-wallet cooldown so a flapping wallet doesn't spam the Telegram channel.
  private lastVerifierAlertAt = new Map<string, number>(); // key = `${type}:${walletId}` → ms
  private static readonly VERIFIER_ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min

  private shouldThrottleVerifierAlert(type: string, walletId: string): boolean {
    const key = `${type}:${walletId}`;
    const last = this.lastVerifierAlertAt.get(key) || 0;
    if (Date.now() - last < TelegramService.VERIFIER_ALERT_COOLDOWN_MS)
      return true;
    this.lastVerifierAlertAt.set(key, Date.now());
    return false;
  }

  async alertVerifierOffline(walletId: string, walletType: string) {
    if (this.shouldThrottleVerifierAlert('offline', walletId)) return;
    await this.send(
      `📡 <b>VERIFIER OFFLINE</b>\n\n` +
        `Wallet: <b>${walletId}</b> (${walletType})\n` +
        `La extension no responde hace 2+ minutos. Si la PC del operador esta encendida, ` +
        `revisa que Chrome este abierto y que la pestaña de la billetera no este cerrada.`,
    );
  }

  async alertVerifierSessionExpired(walletId: string, walletType: string) {
    if (this.shouldThrottleVerifierAlert('session', walletId)) return;
    await this.send(
      `🔐 <b>SESION CAIDA</b>\n\n` +
        `Wallet: <b>${walletId}</b> (${walletType})\n` +
        `La sesion de la billetera expiro o pidio QR/login. Iniciar sesion manualmente para ` +
        `que la verificacion automatica vuelva a funcionar.`,
    );
  }

  async alertVerifierStale(
    walletId: string,
    walletType: string,
    hoursSinceLast: number,
  ) {
    if (this.shouldThrottleVerifierAlert('stale', walletId)) return;
    await this.send(
      `🕐 <b>SIN TRANSFERS DETECTADAS</b>\n\n` +
        `Wallet: <b>${walletId}</b> (${walletType})\n` +
        `Hace <b>${hoursSinceLast}h</b> que la verificacion no detecta una transferencia entrante. ` +
        `Si esto es normal por hora del dia, ignorar. Si hay actividad en la billetera, ` +
        `los selectores DOM probablemente cambiaron.`,
    );
  }

  /**
   * Daily summary at 23:59 ART. Counts transfers verified, offline minutes, stale wallets.
   * Stats source is wired by mp-verification.gateway via the daily-report payload.
   */
  async sendDailyVerifierReport(payload: {
    date: string; // YYYY-MM-DD ART
    walletReports: Array<{
      walletId: string;
      walletType: string;
      transfersDetected: number;
      offlineMinutes: number;
      lastSeenAt?: string | null;
    }>;
  }) {
    if (!this.enabled) return;
    const lines =
      payload.walletReports.length > 0
        ? payload.walletReports.map(
            (w) =>
              `• <b>${w.walletId}</b> (${w.walletType}): ` +
              `${w.transfersDetected} transfers, ${w.offlineMinutes}min offline` +
              (w.lastSeenAt
                ? `, ult. visto ${new Date(w.lastSeenAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`
                : ''),
          )
        : ['(sin verifiers activos)'];
    await this.send(
      `📅 <b>RESUMEN DIARIO ${payload.date}</b>\n\n${lines.join('\n')}`,
    );
  }

  private lastMpSessionAlert = 0;
  private static readonly MP_SESSION_ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min cooldown

  async alertReconciliationMismatch(
    requestId: string,
    flags: string[],
    aiExtracted?: any,
    mpActual?: any,
  ) {
    const flagText = flags.map((f) => `• ${f}`).join('\n');
    const aiInfo = aiExtracted
      ? `\nAI: $${aiExtracted.amount || '?'} - ${aiExtracted.senderName || '?'} - ${aiExtracted.date || '?'}`
      : '';
    const mpInfo = mpActual
      ? `\nMP: $${mpActual.amount || '?'} - ${mpActual.senderName || '?'} - ${mpActual.date || '?'}`
      : '';

    await this.send(
      `⚠️ <b>DISCREPANCIA EN VERIFICACION</b>\n\n` +
        `Request: ${requestId}\n\n` +
        `Flags:\n${flagText}\n` +
        `${aiInfo}${mpInfo}\n\n` +
        `El pago fue verificado pero hay diferencias entre el comprobante y lo que llego a MP.`,
    );
  }

  async alertMpSessionExpired(walletLabel?: string) {
    const now = Date.now();
    if (
      now - this.lastMpSessionAlert <
      TelegramService.MP_SESSION_ALERT_COOLDOWN_MS
    ) {
      return;
    }
    this.lastMpSessionAlert = now;

    const walletInfo = walletLabel ? `\nBilletera: ${walletLabel}` : '';
    await this.send(
      `🔐 <b>SESION MP EXPIRADA</b>\n\n` +
        `La sesion de MercadoPago se cerro.${walletInfo}\n` +
        `Escaneá el QR para reconectarte.\n\n` +
        `⚠️ Las verificaciones de pago estan pausadas hasta que se restaure la sesion.`,
    );
  }

  // ==========================================
  // PRIZE CLAIM ALERTS
  // ==========================================

  async alertNewPrizeClaim(
    username: string,
    amount: number,
    chipBalance: number,
  ) {
    await this.send(
      `🏆 <b>NUEVO PREMIO</b>\n\n` +
        `Usuario: ${username}\n` +
        `Monto: <b>$${amount.toLocaleString('es-AR')}</b>\n` +
        `Fichas verificadas: $${chipBalance.toLocaleString('es-AR')}\n\n` +
        `Esperando accion del operador.`,
    );
  }

  async alertPrizeWithdrawalFailed(username: string, error: string) {
    await this.send(
      `❌ <b>RETIRO DE FICHAS FALLIDO</b>\n\n` +
        `Usuario: ${username}\n` +
        `Error: ${error}`,
    );
  }

  /**
   * User explicitly tapped "Necesito ayuda" in the chat-app. Operators get a
   * direct ping in Telegram even if no panel is open.
   */
  async alertHelpRequested(username: string, context: 'chat' | 'prize') {
    const contextLabel =
      context === 'prize' ? 'cobro de premio' : 'chat de soporte';
    await this.send(
      `🙋 <b>AYUDA SOLICITADA</b>\n\n` +
        `Usuario: <b>${username}</b>\n` +
        `Contexto: ${contextLabel}\n\n` +
        `Abrí el panel y respondele.`,
    );
  }

  private async handlePremiosCommand(chatId: string) {
    try {
      const pending = await this.prisma.prizeClaim.findMany({
        where: {
          status: { in: ['VERIFIED', 'CHIPS_WITHDRAWN', 'PROCESSING'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      if (pending.length === 0) {
        await this.sendTo(chatId, '🏆 <b>No hay premios pendientes!</b>');
        return;
      }

      let msg = `🏆 <b>Premios Pendientes</b> (${pending.length})\n\n`;
      for (const claim of pending) {
        const statusIcon =
          claim.status === 'VERIFIED'
            ? '⏳'
            : claim.status === 'CHIPS_WITHDRAWN'
              ? '💸'
              : '⚙️';
        msg += `${statusIcon} ${claim.targetUsername} — $${Number(claim.amount).toLocaleString('es-AR')}`;
        if (claim.status === 'CHIPS_WITHDRAWN')
          msg += ' (fichas retiradas, falta pagar)';
        if (claim.status === 'PROCESSING') msg += ' (retirando fichas...)';
        msg += '\n';
      }
      await this.sendTo(chatId, msg);
    } catch (error: any) {
      await this.sendTo(
        chatId,
        `❌ Error al obtener premios: ${error.message}`,
      );
    }
  }

  private async handleUpdateCommand(chatId: string, version: string) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      await this.sendTo(
        chatId,
        '❌ Version invalida. Usa formato X.Y.Z (ej: 1.2.0)',
      );
      return;
    }

    try {
      // Get APK URL from settings or use default landing page URL
      const customApkUrl = await this.prisma.setting
        ?.findUnique?.({ where: { key: 'APP_APK_URL_CHAT' } })
        .then((s) => s?.value)
        .catch(() => null);
      const apkUrl =
        customApkUrl ||
        'https://tiorico-landing.onrender.com/tio-rico-fichas.apk';

      // Save version settings
      const settingsService = this.moduleRef.get(
        require('../settings/settings.service').SettingsService,
        { strict: false },
      );
      if (!settingsService) {
        await this.sendTo(chatId, '❌ Servicio de settings no disponible');
        return;
      }

      await settingsService.setSetting('APP_VERSION_CHAT', version);
      await settingsService.setSetting('APP_APK_URL_CHAT', apkUrl);

      // Notify users via push
      const { NotificationsService } = require('./notifications.service');
      const notificationsService = this.moduleRef.get(NotificationsService, {
        strict: false,
      });
      let pushCount = 0;
      if (notificationsService) {
        pushCount = await notificationsService.broadcastPromo(
          'Nueva version disponible',
          `Actualiza a v${version} para tener las ultimas mejoras.`,
          { type: 'APP_UPDATE', version },
        );
      }

      await this.sendTo(
        chatId,
        `✅ Actualizacion publicada!\n\n` +
          `📦 Version: ${version}\n` +
          `🔗 APK: ${apkUrl}\n` +
          `📱 ${pushCount} usuarios notificados\n\n` +
          `Los usuarios seran forzados a actualizar la proxima vez que abran la app.`,
      );
    } catch (error: any) {
      await this.sendTo(
        chatId,
        `❌ Error publicando actualizacion: ${error.message}`,
      );
    }
  }

  private async handlePromoCommand(chatId: string, message: string) {
    if (!message) {
      await this.sendTo(
        chatId,
        '📢 Uso: /promo <mensaje>\n\nEjemplo: /promo HOY 10% extra!',
      );
      return;
    }

    try {
      const pushCount = await this.notificationsService.broadcastPromo(
        '📢 Tio Rico',
        message,
      );

      // Also broadcast to Telegram users via the user bot
      let tgCount = 0;
      const userBotToken = this.configService.get<string>(
        'TELEGRAM_USER_BOT_TOKEN',
      );
      if (userBotToken) {
        const tgUsers = await this.prisma.user.findMany({
          where: { telegramId: { not: null }, role: 'CLIENT', isActive: true },
          select: { telegramId: true },
        });

        for (const user of tgUsers) {
          if (!user.telegramId) continue;
          try {
            await fetch(
              `https://api.telegram.org/bot${userBotToken}/sendMessage`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: user.telegramId,
                  text: `📢 ${message}`,
                }),
              },
            );
            tgCount++;
            await new Promise((r) => setTimeout(r, 50)); // Telegram rate limit
          } catch {}
        }
      }

      await this.sendTo(
        chatId,
        `✅ Promo enviada!\n\n` +
          `📱 ${pushCount} usuarios notificados via push\n` +
          `💬 ${tgCount} usuarios notificados via Telegram\n` +
          `📋 Mensaje: "${message}"`,
      );
    } catch (error: any) {
      this.logger.error(`Promo command failed: ${error.message}`);
      await this.sendTo(chatId, `❌ Error enviando promo: ${error.message}`);
    }
  }

  // ==========================================
  // MONTHLY REPORT (auto-generated)
  // ==========================================

  /**
   * Runs at 00:05 on the 1st of each month.
   * Generates and sends the previous month's report.
   */
  @Cron('0 5 0 1 * *')
  async sendMonthlyReport() {
    if (!this.enabled) return;

    try {
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
      );
      const monthName = prevMonth.toLocaleString('es-AR', {
        month: 'long',
        year: 'numeric',
      });

      // Gather stats for previous month
      const [completedCount, completedAmount, failedCount, totalRequests] =
        await Promise.all([
          this.prisma.request.count({
            where: {
              status: 'COMPLETED',
              updatedAt: { gte: prevMonth, lte: monthEnd },
            },
          }),
          this.prisma.request.aggregate({
            where: {
              status: 'COMPLETED',
              updatedAt: { gte: prevMonth, lte: monthEnd },
            },
            _sum: { amount: true },
          }),
          this.prisma.request.count({
            where: {
              status: 'FAILED',
              updatedAt: { gte: prevMonth, lte: monthEnd },
            },
          }),
          this.prisma.request.count({
            where: { createdAt: { gte: prevMonth, lte: monthEnd } },
          }),
        ]);

      const totalAmount = Number(completedAmount._sum.amount || 0);
      const successRate =
        totalRequests > 0
          ? ((completedCount / totalRequests) * 100).toFixed(1)
          : '0';

      const report =
        `📊 <b>REPORTE MENSUAL — ${monthName.toUpperCase()}</b>\n\n` +
        `💰 <b>Monto procesado:</b> $${totalAmount.toLocaleString('es-AR')}\n` +
        `✅ <b>Cargas completadas:</b> ${completedCount}\n` +
        `❌ <b>Cargas fallidas:</b> ${failedCount}\n` +
        `📈 <b>Tasa de exito:</b> ${successRate}%\n` +
        `📋 <b>Total requests:</b> ${totalRequests}\n\n` +
        `<i>Reporte generado automaticamente — ${now.toLocaleString('es-AR')}</i>`;

      await this.send(report);
      this.logger.log(`Monthly report sent for ${monthName}`);
    } catch (error: any) {
      this.logger.error(`Monthly report failed: ${error.message}`);
    }
  }
}
