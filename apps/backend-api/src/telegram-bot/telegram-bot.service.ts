import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Bot, InlineKeyboard, Context, webhookCallback } from 'grammy';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RequestsService } from '../requests/requests.service';
import { PaymentsService } from '../payments/payments.service';
import { UploadsService } from '../uploads/uploads.service';
import { PrizeClaimsService } from '../prize-claims/prize-claims.service';
import { ChatsService } from '../chats/chats.service';
import { MessagesService } from '../messages/messages.service';

// ==========================================
// TYPES
// ==========================================

type ConversationStep =
  | 'IDLE'
  | 'AWAITING_USERNAME'
  | 'AWAITING_LINK_USERNAME'
  | 'AWAITING_CUSTOM_AMOUNT'
  | 'AWAITING_PROOF'
  | 'AWAITING_PRIZE_CUSTOM_AMOUNT'
  | 'AWAITING_PAYMENT_METHOD'
  | 'AWAITING_CBU'
  | 'AWAITING_ALIAS'
  | 'AWAITING_ACCOUNT_HOLDER'
  | 'IN_SUPPORT';

interface ConversationState {
  step: ConversationStep;
  requestId?: string;
  amount?: number;
  prizeData?: {
    amount?: number;
    paymentMethod?: string;
    cbu?: string;
    alias?: string;
    accountHolder?: string;
  };
  supportChatId?: string;
  lastActivity: number;
}

const PRESET_AMOUNTS = [1000, 2000, 5000, 10000];
const PRIZE_PRESET_AMOUNTS = [3000, 5000, 10000, 25000];
const MIN_PRIZE_AMOUNT = 3000;
const CONVERSATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ==========================================
// SERVICE
// ==========================================

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot | null = null;
  private enabled = false;
  private webhookSecret: string;
  private timeoutInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RequestsService))
    private readonly requestsService: RequestsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => UploadsService))
    private readonly uploadsService: UploadsService,
    @Inject(forwardRef(() => PrizeClaimsService))
    private readonly prizeClaimsService: PrizeClaimsService,
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
  ) {
    this.webhookSecret = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET') || 'tg-webhook-secret';
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  async onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_USER_BOT_TOKEN');
    if (!token) {
      this.logger.warn('Telegram user bot disabled (TELEGRAM_USER_BOT_TOKEN missing)');
      return;
    }

    this.bot = new Bot(token);
    this.enabled = true;

    this.registerHandlers();

    // Start bot: webhook or polling
    const webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
    if (webhookUrl) {
      const fullUrl = `${webhookUrl.replace(/\/+$/, '')}/api/telegram-bot/webhook`;
      try {
        await this.bot.api.setWebhook(fullUrl, {
          secret_token: this.webhookSecret,
          drop_pending_updates: true,
        });
        this.logger.log(`Telegram bot webhook set: ${fullUrl}`);
      } catch (err: any) {
        this.logger.error(`Failed to set webhook: ${err.message}. Falling back to polling.`);
        this.startPolling();
      }
    } else {
      this.startPolling();
    }

    // Conversation timeout checker every 5 min
    this.timeoutInterval = setInterval(() => this.cleanupStaleConversations(), 5 * 60 * 1000);

    this.logger.log('Telegram user bot initialized');
  }

  private startPolling() {
    if (!this.bot) return;
    this.bot.start({
      onStart: () => this.logger.log('Telegram bot polling started'),
      drop_pending_updates: true,
    });
  }

  async onModuleDestroy() {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
    }
    if (this.bot) {
      await this.bot.stop();
      this.logger.log('Telegram user bot stopped');
    }
  }

  /** Get webhook handler for the controller */
  getWebhookHandler() {
    if (!this.bot) return null;
    return webhookCallback(this.bot, 'express', { secretToken: this.webhookSecret });
  }

  // ==========================================
  // PERSISTENT STATE (DB-backed)
  // ==========================================

  private async getState(telegramId: string): Promise<ConversationState> {
    const row = await this.prisma.telegramConversation.findUnique({
      where: { telegramId },
    });
    if (!row) return { step: 'IDLE', lastActivity: Date.now() };
    return {
      step: row.step as ConversationStep,
      requestId: row.requestId || undefined,
      amount: row.amount || undefined,
      prizeData: (row.prizeData as any) || undefined,
      supportChatId: row.supportChatId || undefined,
      lastActivity: row.lastActivity.getTime(),
    };
  }

  private async setState(telegramId: string, updates: Partial<ConversationState>) {
    const dbData: any = { lastActivity: new Date() };
    if (updates.step !== undefined) dbData.step = updates.step;
    if (updates.requestId !== undefined) dbData.requestId = updates.requestId;
    if (updates.amount !== undefined) dbData.amount = updates.amount;
    if (updates.prizeData !== undefined) dbData.prizeData = updates.prizeData || null;
    if (updates.supportChatId !== undefined) dbData.supportChatId = updates.supportChatId;

    await this.prisma.telegramConversation.upsert({
      where: { telegramId },
      create: { telegramId, ...dbData },
      update: dbData,
    });
  }

  private async clearState(telegramId: string) {
    await this.prisma.telegramConversation.deleteMany({
      where: { telegramId },
    });
  }

  private getTelegramId(ctx: Context): string {
    return String(ctx.from?.id || '');
  }

  // ==========================================
  // HANDLER REGISTRATION
  // ==========================================

  private registerHandlers() {
    if (!this.bot) return;

    // Commands
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('menu', (ctx) => this.sendMainMenu(ctx));
    this.bot.command('cuenta', (ctx) => this.handleAccount(ctx));
    this.bot.command('estado', (ctx) => this.handleStatus(ctx));
    this.bot.command('cancelar', (ctx) => this.handleCancel(ctx));
    this.bot.command('soporte', (ctx) => this.startSupportFlow(ctx));

    // Callback queries (inline keyboard buttons)
    this.bot.callbackQuery(/^action:/, (ctx) => this.handleAction(ctx));
    this.bot.callbackQuery(/^amount:/, (ctx) => this.handleAmount(ctx));
    this.bot.callbackQuery(/^prize_amount:/, (ctx) => this.handlePrizeAmount(ctx));
    this.bot.callbackQuery(/^payment_method:/, (ctx) => this.handlePaymentMethod(ctx));
    this.bot.callbackQuery('confirm_prize', (ctx) => this.handleConfirmPrize(ctx));
    this.bot.callbackQuery('auto_load_confirm', (ctx) => this.handleAutoLoadConfirm(ctx));
    this.bot.callbackQuery('cancel', (ctx) => this.handleCancel(ctx));
    this.bot.callbackQuery('link_account', (ctx) => this.handleLinkStart(ctx));
    this.bot.callbackQuery('new_account', (ctx) => this.handleNewAccountStart(ctx));
    this.bot.callbackQuery('end_support', (ctx) => this.handleEndSupport(ctx));

    // Photo/document handler (proof upload + forwarded receipts)
    this.bot.on('message:photo', (ctx) => this.handlePhoto(ctx));
    this.bot.on('message:document', (ctx) => this.handleDocument(ctx));

    // Text handler (free-text inputs)
    this.bot.on('message:text', (ctx) => this.handleText(ctx));

    // Error handler
    this.bot.catch((err) => {
      this.logger.error(`Bot error: ${err.message}`, err.stack);
    });
  }

  // ==========================================
  // USER MANAGEMENT
  // ==========================================

  private async findOrCreateUser(telegramId: string, firstName: string, lastName?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true, savedTargetUsername: true, balance: true },
    });

    if (existing) {
      return { ...existing, isNew: false };
    }

    const user = await this.prisma.user.create({
      data: {
        telegramId,
        username: `tg_${telegramId}`,
        role: 'CLIENT',
      },
      select: { id: true, savedTargetUsername: true, balance: true },
    });

    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || telegramId;
    this.logger.log(`New Telegram user: ${displayName} (${telegramId}) → ${user.id}`);
    return { ...user, isNew: true };
  }

  private async linkAccount(telegramId: string, username: string): Promise<{ success: boolean; error?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, telegramId: true },
    });

    if (!user) return { success: false, error: `No encontré un usuario "${username}".` };
    if (user.telegramId && user.telegramId !== telegramId) return { success: false, error: 'Esa cuenta ya está vinculada a otro Telegram.' };
    if (user.telegramId === telegramId) return { success: true };

    // Delete auto-created account if exists
    const existingTg = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
    if (existingTg && existingTg.id !== user.id) {
      await this.prisma.user.delete({ where: { id: existingTg.id } });
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { telegramId } });
    this.logger.log(`Telegram ${telegramId} linked to user ${user.id} (${username})`);
    return { success: true };
  }

  // ==========================================
  // COMMAND: /start
  // ==========================================

  private async handleStart(ctx: Context) {
    const telegramId = this.getTelegramId(ctx);
    if (!telegramId) return;

    const user = await this.findOrCreateUser(telegramId, ctx.from?.first_name || '', ctx.from?.last_name);

    if (user.isNew || !user.savedTargetUsername) {
      await ctx.reply(
        '👋 ¡Bienvenido!\n\nSoy tu asistente para cargar créditos y cobrar premios.\n\nPara empezar, necesito vincular tu cuenta.',
        {
          reply_markup: new InlineKeyboard()
            .text('🔗 Tengo cuenta en la app', 'link_account').row()
            .text('🆕 Soy nuevo', 'new_account'),
        },
      );
    } else {
      await ctx.reply(`👋 ¡Hola de nuevo! Tu usuario: *${this.esc(user.savedTargetUsername)}*`, { parse_mode: 'MarkdownV2' });
      await this.sendMainMenu(ctx);
    }
  }

  private async handleLinkStart(ctx: Context) {
    await ctx.answerCallbackQuery();
    await this.setState(this.getTelegramId(ctx), { step: 'AWAITING_LINK_USERNAME' });
    await ctx.reply('Escribí tu nombre de usuario de la app:');
  }

  private async handleNewAccountStart(ctx: Context) {
    await ctx.answerCallbackQuery();
    await this.setState(this.getTelegramId(ctx), { step: 'AWAITING_USERNAME' });
    await ctx.reply('Escribí tu nombre de usuario de la plataforma de juegos:');
  }

  // ==========================================
  // MAIN MENU
  // ==========================================

  private async sendMainMenu(ctx: Context) {
    await ctx.reply('¿Qué querés hacer?', {
      reply_markup: new InlineKeyboard()
        .text('💰 Cargar Créditos', 'action:load').row()
        .text('🏆 Cobrar Premio', 'action:prize').row()
        .text('💬 Soporte', 'action:support').row()
        .text('👤 Mi Cuenta', 'action:account'),
    });
  }

  // ==========================================
  // ACTION ROUTER
  // ==========================================

  private async handleAction(ctx: Context) {
    const action = ctx.callbackQuery?.data?.replace('action:', '');
    await ctx.answerCallbackQuery();

    const telegramId = this.getTelegramId(ctx);
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true, savedTargetUsername: true, balance: true },
    });

    if (!user) { await ctx.reply('No tenés cuenta. Usá /start.'); return; }
    if (!user.savedTargetUsername && action !== 'account' && action !== 'support') {
      await ctx.reply('Primero necesito tu usuario de juegos. Usá /start.');
      return;
    }

    switch (action) {
      case 'load': await this.startLoadFlow(ctx, telegramId); break;
      case 'prize': await this.startPrizeFlow(ctx, telegramId); break;
      case 'account': await this.handleAccount(ctx); break;
      case 'support': await this.startSupportFlow(ctx); break;
    }
  }

  // ==========================================
  // FLOW: LOAD CREDITS
  // ==========================================

  private async startLoadFlow(ctx: Context, telegramId: string) {
    await this.clearState(telegramId);

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < PRESET_AMOUNTS.length; i += 2) {
      keyboard.text(`$${this.fmt(PRESET_AMOUNTS[i])}`, `amount:${PRESET_AMOUNTS[i]}`);
      if (PRESET_AMOUNTS[i + 1]) keyboard.text(`$${this.fmt(PRESET_AMOUNTS[i + 1])}`, `amount:${PRESET_AMOUNTS[i + 1]}`);
      keyboard.row();
    }
    keyboard.text('✏️ Otro monto', 'amount:custom').row();
    keyboard.text('❌ Cancelar', 'cancel');

    await ctx.reply('¿Cuánto querés cargar?', { reply_markup: keyboard });
  }

  private async handleAmount(ctx: Context) {
    const data = ctx.callbackQuery?.data?.replace('amount:', '');
    await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);

    if (data === 'custom') {
      await this.setState(telegramId, { step: 'AWAITING_CUSTOM_AMOUNT' });
      await ctx.reply('Escribí el monto que querés cargar (número entero):');
      return;
    }

    const amount = parseInt(data || '0', 10);
    if (amount <= 0) return;
    await this.createLoadRequest(ctx, telegramId, amount);
  }

  private async createLoadRequest(ctx: Context, telegramId: string, amount: number) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true },
    });
    if (!user) { await ctx.reply('Error: usuario no encontrado. Usá /start.'); return; }

    try {
      const request = await this.requestsService.create(user.id, { amount });
      const wallet = request.walletId
        ? await this.prisma.paymentConfig.findUnique({ where: { id: request.walletId } })
        : null;

      await this.setState(telegramId, { step: 'AWAITING_PROOF', requestId: request.id, amount });

      if (wallet) {
        const details = wallet.details as any;
        const copyValue = details?.alias || details?.cbu || details?.cvu || '';
        const copyLabel = details?.alias ? 'Alias' : details?.cbu ? 'CBU' : 'CVU';

        // Main message with instructions
        await ctx.reply(
          `💰 *Solicitud creada por \\$${this.esc(this.fmt(amount))}*\n\n` +
          `Transferí a esta cuenta:\n\n` +
          `📋 *${this.esc(copyLabel)}:*\n👤 *Titular:* ${this.esc(wallet.holderName)}\n\n` +
          `Después de transferir, mandame la foto del comprobante\\.`,
          { parse_mode: 'MarkdownV2' },
        );

        // Separate message with just the value — easy to copy with one tap
        await ctx.reply(`\`${copyValue}\``, {
          parse_mode: 'MarkdownV2',
          reply_markup: new InlineKeyboard().text('❌ Cancelar', 'cancel'),
        });
      } else {
        await ctx.reply(
          `💰 *Solicitud creada por \\$${this.esc(this.fmt(amount))}*\n\nDespués de transferir, mandame la foto del comprobante\\.`,
          { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('❌ Cancelar', 'cancel') },
        );
      }
    } catch (err: any) {
      this.logger.error(`Request creation failed for ${telegramId}: ${err.message}`);
      await ctx.reply(`⚠️ ${err.message || 'No se pudo crear la solicitud.'}`);
      await this.clearState(telegramId);
    }
  }

  // ==========================================
  // PHOTO/DOCUMENT HANDLER (PROOF UPLOAD)
  // ==========================================

  private async handlePhoto(ctx: Context) {
    const telegramId = this.getTelegramId(ctx);
    const state = await this.getState(telegramId);

    if (state.step === 'AWAITING_PROOF' && state.requestId) {
      await this.processProofUpload(ctx, telegramId, state);
      return;
    }

    // Support mode — forward as image
    if (state.step === 'IN_SUPPORT' && state.supportChatId) {
      await ctx.reply('📸 Foto recibida. El operador la va a ver en el chat.');
      return;
    }

    // Photo outside any flow — offer auto-load (detect amount from proof)
    const photo = ctx.message?.photo;
    if (photo && photo.length > 0) {
      // Save file ID in state for later use
      const fileId = photo[photo.length - 1].file_id;
      await this.setState(telegramId, { step: 'IDLE', prizeData: { autoLoadFileId: fileId } as any });

      await ctx.reply(
        '📸 ¿Querés cargar con este comprobante?\n\nLa IA va a leer el monto automáticamente.',
        {
          reply_markup: new InlineKeyboard()
            .text('✅ Sí, cargar', 'auto_load_confirm')
            .text('❌ No', 'cancel'),
        },
      );
      return;
    }

    await ctx.reply('No estoy esperando una foto ahora. Usá /menu.');
  }

  private async handleDocument(ctx: Context) {
    const telegramId = this.getTelegramId(ctx);
    const state = await this.getState(telegramId);

    if (state.step !== 'AWAITING_PROOF' || !state.requestId) return;

    const doc = ctx.message?.document;
    if (!doc || !doc.mime_type?.match(/^(image\/|application\/pdf)/)) {
      await ctx.reply('Solo acepto imágenes (JPG, PNG) o PDF.');
      return;
    }

    await this.processProofUpload(ctx, telegramId, state);
  }

  private async processProofUpload(ctx: Context, telegramId: string, state: ConversationState) {
    const statusMsg = await ctx.reply('⏳ Subiendo comprobante...');

    try {
      const photo = ctx.message?.photo;
      const doc = ctx.message?.document;
      let fileId: string;
      let mimeType = 'image/jpeg';
      let fileName = 'proof.jpg';

      if (photo && photo.length > 0) {
        fileId = photo[photo.length - 1].file_id;
      } else if (doc) {
        fileId = doc.file_id;
        mimeType = doc.mime_type || 'image/jpeg';
        fileName = doc.file_name || 'proof';
      } else {
        await ctx.reply('No pude leer el archivo. Intentá de nuevo.');
        return;
      }

      // Download from Telegram
      const file = await ctx.api.getFile(fileId);
      const token = this.configService.get<string>('TELEGRAM_USER_BOT_TOKEN');
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      const hash = createHash('sha256').update(buffer).digest('hex');

      const user = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
      if (!user) throw new Error('User not found');

      const multerFile = { buffer, originalname: `telegram_${fileName}`, mimetype: mimeType, size: buffer.length } as Express.Multer.File;
      const uploaded = await this.uploadsService.uploadFile(multerFile, user.id);

      await this.requestsService.uploadProof(state.requestId!, user.id, uploaded.cloudinaryUrl, hash);

      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, '✅ Comprobante recibido. Validando...\n\nTe aviso cuando esté listo.');
      } catch {
        await ctx.reply('✅ Comprobante recibido. Validando...');
      }

      await this.setState(telegramId, { step: 'IDLE', requestId: state.requestId });
    } catch (err: any) {
      this.logger.error(`Proof upload failed for ${telegramId}: ${err.message}`);
      const errorMsg = err.message?.includes('duplicado') ? 'Este comprobante ya fue usado antes.' : 'No se pudo subir el comprobante. Intentá de nuevo.';
      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `⚠️ ${errorMsg}`);
      } catch {
        await ctx.reply(`⚠️ ${errorMsg}`);
      }
    }
  }

  // ==========================================
  // FLOW: PRIZE CLAIM
  // ==========================================

  private async startPrizeFlow(ctx: Context, telegramId: string) {
    await this.clearState(telegramId);

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < PRIZE_PRESET_AMOUNTS.length; i += 2) {
      keyboard.text(`$${this.fmt(PRIZE_PRESET_AMOUNTS[i])}`, `prize_amount:${PRIZE_PRESET_AMOUNTS[i]}`);
      if (PRIZE_PRESET_AMOUNTS[i + 1]) keyboard.text(`$${this.fmt(PRIZE_PRESET_AMOUNTS[i + 1])}`, `prize_amount:${PRIZE_PRESET_AMOUNTS[i + 1]}`);
      keyboard.row();
    }
    keyboard.text('✏️ Otro monto', 'prize_amount:custom').row();
    keyboard.text('❌ Cancelar', 'cancel');

    await ctx.reply(`¿Cuánto querés cobrar?\n(Mínimo $${this.fmt(MIN_PRIZE_AMOUNT)})`, { reply_markup: keyboard });
  }

  private async handlePrizeAmount(ctx: Context) {
    const data = ctx.callbackQuery?.data?.replace('prize_amount:', '');
    await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);

    if (data === 'custom') {
      await this.setState(telegramId, { step: 'AWAITING_PRIZE_CUSTOM_AMOUNT', prizeData: {} });
      await ctx.reply(`Escribí el monto a cobrar (mínimo $${this.fmt(MIN_PRIZE_AMOUNT)}):`);
      return;
    }

    const amount = parseInt(data || '0', 10);
    if (amount < MIN_PRIZE_AMOUNT) return;

    await this.setState(telegramId, { step: 'AWAITING_PAYMENT_METHOD', prizeData: { amount } });
    await this.showPaymentMethodSelector(ctx);
  }

  private async showPaymentMethodSelector(ctx: Context) {
    await ctx.reply('¿Cómo querés recibir la plata?', {
      reply_markup: new InlineKeyboard()
        .text('🏦 CBU (transferencia)', 'payment_method:CBU').row()
        .text('📱 Alias (MercadoPago)', 'payment_method:ALIAS').row()
        .text('❌ Cancelar', 'cancel'),
    });
  }

  private async handlePaymentMethod(ctx: Context) {
    const method = ctx.callbackQuery?.data?.replace('payment_method:', '');
    await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);
    const state = await this.getState(telegramId);
    if (!state.prizeData?.amount || !method) return;

    const prizeData = { ...state.prizeData, paymentMethod: method };

    if (method === 'CBU') {
      await this.setState(telegramId, { step: 'AWAITING_CBU', prizeData });
      await ctx.reply('Escribí tu CBU (22 dígitos):');
    } else {
      await this.setState(telegramId, { step: 'AWAITING_ALIAS', prizeData });
      await ctx.reply('Escribí tu alias de MercadoPago:');
    }
  }

  private async showPrizeConfirmation(ctx: Context, telegramId: string) {
    const state = await this.getState(telegramId);
    const pd = state.prizeData;
    if (!pd?.amount || !pd.paymentMethod || !pd.accountHolder) return;

    const methodLabel = pd.paymentMethod === 'CBU' ? 'CBU' : 'Alias';
    const detail = pd.paymentMethod === 'CBU' ? pd.cbu : pd.alias;

    await ctx.reply(
      `📋 *Resumen de tu retiro:*\n\n` +
      `💰 Monto: \\$${this.esc(this.fmt(pd.amount))}\n` +
      `🏦 Método: ${this.esc(methodLabel)}\n` +
      `📋 ${this.esc(methodLabel)}: \`${this.esc(detail || '')}\`\n` +
      `👤 Titular: ${this.esc(pd.accountHolder)}`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: new InlineKeyboard()
          .text('✅ Confirmar', 'confirm_prize').text('❌ Cancelar', 'cancel'),
      },
    );
  }

  private async handleConfirmPrize(ctx: Context) {
    await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);
    const state = await this.getState(telegramId);
    const pd = state.prizeData;

    if (!pd?.amount || !pd.paymentMethod || !pd.accountHolder) {
      await ctx.reply('Datos incompletos. Empezá de nuevo con /menu.');
      await this.clearState(telegramId);
      return;
    }

    const user = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
    if (!user) { await ctx.reply('Error: usuario no encontrado.'); return; }

    try {
      await this.prizeClaimsService.createWithPayment(user.id, {
        amount: pd.amount,
        paymentMethod: pd.paymentMethod,
        paymentDetails: { cbu: pd.cbu, alias: pd.alias, accountHolder: pd.accountHolder },
      });

      await this.clearState(telegramId);
      await ctx.reply('✅ ¡Solicitud de retiro creada!\n\nUn operador va a revisarla. Te avisamos cuando esté lista.', {
        reply_markup: new InlineKeyboard().text('📋 Menú', 'action:load'),
      });
    } catch (err: any) {
      this.logger.error(`Prize claim failed for ${telegramId}: ${err.message}`);
      await ctx.reply(`⚠️ ${err.message || 'Error al crear la solicitud.'}`);
      await this.clearState(telegramId);
    }
  }

  // ==========================================
  // AUTO-LOAD: Create request from photo directly
  // ==========================================

  private async handleAutoLoadConfirm(ctx: Context) {
    await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);
    const state = await this.getState(telegramId);

    // Retrieve saved file ID from state
    const fileId = (state.prizeData as any)?.autoLoadFileId;
    if (!fileId) {
      await ctx.reply('La foto expiró. Mandala de nuevo.');
      await this.clearState(telegramId);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true, savedTargetUsername: true },
    });

    if (!user) { await ctx.reply('Error: usuario no encontrado. Usá /start.'); return; }
    if (!user.savedTargetUsername) { await ctx.reply('Primero configurá tu usuario de juegos. Usá /start.'); return; }

    const statusMsg = await ctx.reply('⏳ Creando solicitud y subiendo comprobante...');

    try {
      // Create request with amount=0 (AI will detect it)
      const request = await this.requestsService.create(user.id, { amount: 0, autoDetectAmount: true });

      // Download photo from Telegram
      const file = await ctx.api.getFile(fileId);
      const token = this.configService.get<string>('TELEGRAM_USER_BOT_TOKEN');
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      const hash = createHash('sha256').update(buffer).digest('hex');

      const multerFile = { buffer, originalname: `telegram_autoload.jpg`, mimetype: 'image/jpeg', size: buffer.length } as Express.Multer.File;
      const uploaded = await this.uploadsService.uploadFile(multerFile, user.id);

      await this.requestsService.uploadProof(request.id, user.id, uploaded.cloudinaryUrl, hash);

      await this.setState(telegramId, { step: 'IDLE', requestId: request.id });

      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
          '✅ Comprobante recibido. La IA está leyendo el monto y validando...\n\nTe aviso cuando esté listo.',
        );
      } catch {
        await ctx.reply('✅ Comprobante recibido. Validando...');
      }
    } catch (err: any) {
      this.logger.error(`Auto-load failed for ${telegramId}: ${err.message}`);
      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `⚠️ ${err.message || 'Error al procesar. Intentá de nuevo.'}`);
      } catch {
        await ctx.reply(`⚠️ ${err.message || 'Error al procesar.'}`);
      }
      await this.clearState(telegramId);
    }
  }

  // ==========================================
  // FLOW: SUPPORT BRIDGE (TG ↔ Operator Panel)
  // ==========================================

  private async startSupportFlow(ctx: Context) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);

    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true },
    });
    if (!user) { await ctx.reply('No tenés cuenta. Usá /start.'); return; }

    try {
      // Get or create user's support chat
      const chat = await this.chatsService.getOrCreateChat(user.id);

      await this.setState(telegramId, { step: 'IN_SUPPORT', supportChatId: chat.id });

      await ctx.reply(
        '💬 *Modo soporte activado*\n\nTodo lo que escribas lo va a recibir un operador\\. Te responden por acá\\.\n\nPara salir del soporte, usá el botón de abajo\\.',
        {
          parse_mode: 'MarkdownV2',
          reply_markup: new InlineKeyboard().text('❌ Salir de soporte', 'end_support'),
        },
      );
    } catch (err: any) {
      this.logger.error(`Support flow failed for ${telegramId}: ${err.message}`);
      await ctx.reply('⚠️ No se pudo iniciar el soporte. Intentá de nuevo.');
    }
  }

  private async handleEndSupport(ctx: Context) {
    await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);
    await this.clearState(telegramId);
    await ctx.reply('✅ Soporte finalizado.');
    await this.sendMainMenu(ctx);
  }

  /**
   * Listen for operator messages sent via the operator panel.
   * When an operator sends a message to a chat, check if the client has Telegram
   * and is in support mode — if so, forward the message.
   */
  @OnEvent('chat.operator_message')
  async onOperatorMessage(data: { chatId: string; content: string; senderId: string }) {
    if (!this.bot || !this.enabled) return;

    try {
      // Find the chat's client
      const chat = await this.prisma.chat.findUnique({
        where: { id: data.chatId },
        select: { userId: true },
      });
      if (!chat) return;

      const user = await this.prisma.user.findUnique({
        where: { id: chat.userId },
        select: { telegramId: true },
      });
      if (!user?.telegramId) return;

      // Check if user is in support mode
      const state = await this.getState(user.telegramId);
      if (state.step !== 'IN_SUPPORT') return;

      await this.bot.api.sendMessage(user.telegramId, `👨‍💼 *Operador:*\n${this.esc(data.content)}`, {
        parse_mode: 'MarkdownV2',
        reply_markup: new InlineKeyboard().text('❌ Salir de soporte', 'end_support'),
      });
    } catch (err: any) {
      this.logger.error(`Failed to forward operator message to TG: ${err.message}`);
    }
  }

  // ==========================================
  // TEXT HANDLER
  // ==========================================

  private async handleText(ctx: Context) {
    const telegramId = this.getTelegramId(ctx);
    const state = await this.getState(telegramId);
    const text = ctx.message?.text?.trim() || '';

    if (text.startsWith('/')) return; // Commands handled separately

    // Update activity
    await this.setState(telegramId, {});

    switch (state.step) {
      case 'AWAITING_USERNAME': {
        if (text.length < 3) { await ctx.reply('El usuario debe tener al menos 3 caracteres:'); return; }
        const user = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
        if (user) await this.prisma.user.update({ where: { id: user.id }, data: { savedTargetUsername: text } });
        await this.clearState(telegramId);
        await ctx.reply(`✅ Usuario configurado: *${this.esc(text)}*`, { parse_mode: 'MarkdownV2' });
        await this.sendMainMenu(ctx);
        break;
      }

      case 'AWAITING_LINK_USERNAME': {
        const result = await this.linkAccount(telegramId, text);
        if (result.success) {
          await this.clearState(telegramId);
          await ctx.reply('✅ ¡Cuenta vinculada!');
          await this.sendMainMenu(ctx);
        } else {
          await ctx.reply(`⚠️ ${result.error}\n\nIntentá de nuevo o /cancelar:`);
        }
        break;
      }

      case 'AWAITING_CUSTOM_AMOUNT': {
        const amount = parseInt(text.replace(/[$.]/g, ''), 10);
        if (isNaN(amount) || amount <= 0) { await ctx.reply('Monto inválido. Escribí un número entero:'); return; }
        await this.setState(telegramId, { step: 'IDLE' });
        await this.createLoadRequest(ctx, telegramId, amount);
        break;
      }

      case 'AWAITING_PRIZE_CUSTOM_AMOUNT': {
        const amount = parseInt(text.replace(/[$.]/g, ''), 10);
        if (isNaN(amount) || amount < MIN_PRIZE_AMOUNT) { await ctx.reply(`Mínimo $${this.fmt(MIN_PRIZE_AMOUNT)}:`); return; }
        await this.setState(telegramId, { step: 'AWAITING_PAYMENT_METHOD', prizeData: { amount } });
        await this.showPaymentMethodSelector(ctx);
        break;
      }

      case 'AWAITING_CBU': {
        const cbu = text.replace(/\s/g, '');
        if (!/^\d{22}$/.test(cbu)) { await ctx.reply('CBU: exactamente 22 dígitos numéricos:'); return; }
        const prizeData = { ...state.prizeData, cbu };
        await this.setState(telegramId, { step: 'AWAITING_ACCOUNT_HOLDER', prizeData });
        await ctx.reply('Nombre del titular de la cuenta:');
        break;
      }

      case 'AWAITING_ALIAS': {
        if (text.length < 6) { await ctx.reply('Alias: mínimo 6 caracteres:'); return; }
        const prizeData = { ...state.prizeData, alias: text };
        await this.setState(telegramId, { step: 'AWAITING_ACCOUNT_HOLDER', prizeData });
        await ctx.reply('Nombre del titular de la cuenta:');
        break;
      }

      case 'AWAITING_ACCOUNT_HOLDER': {
        if (text.length < 3) { await ctx.reply('Nombre: mínimo 3 caracteres:'); return; }
        const prizeData = { ...state.prizeData, accountHolder: text };
        await this.setState(telegramId, { step: 'IDLE', prizeData });
        await this.showPrizeConfirmation(ctx, telegramId);
        break;
      }

      case 'AWAITING_PROOF': {
        await ctx.reply('📸 Necesito la *foto* o *PDF* del comprobante, no texto\\.', { parse_mode: 'MarkdownV2' });
        break;
      }

      case 'IN_SUPPORT': {
        // Bridge: send user message to operator panel via backend chat
        if (state.supportChatId && text) {
          const user = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
          if (user) {
            try {
              await this.messagesService.sendMessage(user.id, { chatId: state.supportChatId, content: text }, 'CLIENT');
              // No confirmation needed — feels like real chat
            } catch (err: any) {
              await ctx.reply('⚠️ No se pudo enviar. Intentá de nuevo.');
            }
          }
        }
        break;
      }

      default: {
        await ctx.reply('No entendí. Usá /menu para ver opciones.', {
          reply_markup: new InlineKeyboard().text('📋 Menú', 'action:load'),
        });
        break;
      }
    }
  }

  // ==========================================
  // COMMANDS: /cuenta, /estado, /cancelar
  // ==========================================

  private async handleAccount(ctx: Context) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);

    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { savedTargetUsername: true, balance: true, username: true },
    });

    if (!user) { await ctx.reply('No tenés cuenta. Usá /start.'); return; }

    await ctx.reply(
      `👤 *Mi Cuenta*\n\n` +
      `📛 Usuario: \`${this.esc(user.username || '\\-')}\`\n` +
      `🎮 Juegos: \`${this.esc(user.savedTargetUsername || '\\-')}\`\n` +
      `💰 Balance: \\$${this.esc(this.fmt(Number(user.balance || 0)))}`,
      { parse_mode: 'MarkdownV2', reply_markup: new InlineKeyboard().text('📋 Menú', 'action:load') },
    );
  }

  private async handleStatus(ctx: Context) {
    const telegramId = this.getTelegramId(ctx);
    const user = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
    if (!user) { await ctx.reply('Usá /start.'); return; }

    const request = await this.prisma.request.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true, amount: true, targetUsername: true },
    });

    if (!request) { await ctx.reply('No tenés solicitudes. Usá /menu.'); return; }

    const labels: Record<string, string> = {
      PENDING_PROOF: '📤 Esperando comprobante', VALIDATING: '🔍 Validando', PENDING_MP_VERIFICATION: '🏦 Verificando pago',
      VALIDATION_FAILED: '⚠️ En revisión', APPROVED: '✅ Aprobada', PROCESSING: '🔄 Procesando',
      COMPLETED: '🎉 Completada', FAILED: '❌ Fallida', REJECTED: '🚫 Rechazada', CANCELLED: '🗑️ Cancelada',
    };

    await ctx.reply(
      `📋 *Última solicitud*\n\n💰 \\$${this.esc(this.fmt(Number(request.amount)))}\n🎮 \`${this.esc(request.targetUsername || '')}\`\n📊 ${this.esc(labels[request.status] || request.status)}`,
      { parse_mode: 'MarkdownV2' },
    );
  }

  private async handleCancel(ctx: Context) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    const telegramId = this.getTelegramId(ctx);
    const state = await this.getState(telegramId);

    if (state.requestId) {
      try {
        const user = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
        if (user) await this.requestsService.cancel(state.requestId, user.id);
      } catch {}
    }

    await this.clearState(telegramId);
    await ctx.reply('✅ Operación cancelada.');
    await this.sendMainMenu(ctx);
  }

  // ==========================================
  // CONVERSATION TIMEOUT (Feature 8)
  // ==========================================

  private async cleanupStaleConversations() {
    const cutoff = new Date(Date.now() - CONVERSATION_TIMEOUT_MS);

    const stale = await this.prisma.telegramConversation.findMany({
      where: {
        step: { not: 'IDLE' },
        lastActivity: { lt: cutoff },
      },
    });

    for (const conv of stale) {
      // Cancel pending request if any
      if (conv.requestId) {
        try {
          const user = await this.prisma.user.findUnique({ where: { telegramId: conv.telegramId }, select: { id: true } });
          if (user) await this.requestsService.cancel(conv.requestId, user.id);
        } catch {}
      }

      await this.prisma.telegramConversation.delete({ where: { telegramId: conv.telegramId } });

      // Notify user
      try {
        await this.bot?.api.sendMessage(conv.telegramId,
          '⏰ Tu operación se canceló por inactividad (30 min).\n\nUsá /menu para empezar de nuevo.',
        );
      } catch {} // User might have blocked bot
    }

    if (stale.length > 0) {
      this.logger.log(`Cleaned up ${stale.length} stale Telegram conversation(s)`);
    }
  }

  // ==========================================
  // PROACTIVE NOTIFICATIONS (Feature 1)
  // ==========================================

  @Cron('0 18 * * *') // Every day at 18:00
  async sendEngagementNotifications() {
    if (!this.bot || !this.enabled) return;

    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days

    const inactiveUsers = await this.prisma.user.findMany({
      where: {
        telegramId: { not: null },
        role: 'CLIENT',
        isActive: true,
        requests: { none: { createdAt: { gte: cutoff } } },
      },
      select: { telegramId: true },
      take: 50,
    });

    let sent = 0;
    for (const user of inactiveUsers) {
      if (!user.telegramId) continue;
      try {
        await this.bot.api.sendMessage(user.telegramId,
          '👋 ¡Ey! ¿Necesitás cargar créditos?\n\nEstamos disponibles 24/7.',
          { reply_markup: new InlineKeyboard().text('💰 Cargar', 'action:load') },
        );
        sent++;
        await new Promise(r => setTimeout(r, 100)); // Telegram rate limit
      } catch {} // User blocked bot, etc.
    }

    if (sent > 0) {
      this.logger.log(`Sent engagement notifications to ${sent} inactive users`);
    }
  }

  // ==========================================
  // STATUS NOTIFICATIONS (Event Listeners)
  // ==========================================

  @OnEvent('job.completed')
  async onJobCompleted(data: { requestId: string; userId: string; amount: number }) {
    await this.notifyUser(data.userId,
      `🎉 ¡Créditos cargados!\n\n$${this.fmt(data.amount)} en tu cuenta.`,
      new InlineKeyboard().text('💰 Cargar más', 'action:load').text('📋 Menú', 'action:account'),
    );
  }

  @OnEvent('job.failed')
  async onJobFailed(data: { requestId: string; userId: string }) {
    await this.notifyUser(data.userId, '❌ Hubo un error al procesar tu carga. Un operador va a revisarlo.');
  }

  @OnEvent('job.started')
  async onJobStarted(data: { requestId: string; userId: string }) {
    await this.notifyUser(data.userId, '🔄 Cargando créditos en tu cuenta...');
  }

  @OnEvent('validation.failed')
  async onValidationFailed(data: { requestId: string }) {
    try {
      const request = await this.prisma.request.findUnique({ where: { id: data.requestId }, select: { userId: true } });
      if (request) await this.notifyUser(request.userId, '⚠️ No pudimos validar tu comprobante. Un operador lo va a revisar.');
    } catch {}
  }

  private async notifyUser(userId: string, message: string, keyboard?: InlineKeyboard) {
    if (!this.bot || !this.enabled) return;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
      if (!user?.telegramId) return;
      await this.bot.api.sendMessage(user.telegramId, message, { reply_markup: keyboard });
    } catch (err: any) {
      this.logger.error(`TG notification failed for user ${userId}: ${err.message}`);
    }
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  private fmt(n: number): string {
    return Math.floor(n).toLocaleString('es-AR');
  }

  private esc(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }
}
