import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { AuditService } from '../audit/audit.service';
import { AuditAction, EntityType } from '../audit/dto';
import { BotGateway } from '../bot/bot.gateway';
import {
  SettingResponseDto,
  SystemSettingsDto,
  UpdateSystemSettingsDto,
  DEFAULT_SETTINGS,
} from './dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => AuditService))
    private readonly auditService: AuditService,
    @Inject(forwardRef(() => BotGateway))
    private readonly botGateway: BotGateway,
  ) {}

  /**
   * Check if an app update is available
   */
  async checkAppUpdate(appName: string, currentVersion: string) {
    const prefixMap: Record<string, string> = {
      chat: 'CHAT',
      operator: 'OPERATOR',
      'operator-panel': 'OPERATOR_PANEL',
      validator: 'VALIDATOR',
    };
    const prefix = prefixMap[appName] || 'CHAT';
    const latestVersion = await this.getSetting(`APP_VERSION_${prefix}`);

    if (!latestVersion) {
      return { updateAvailable: false };
    }

    if (!this.isNewerVersion(latestVersion, currentVersion)) {
      return { updateAvailable: false };
    }

    const apkUrl = await this.getSetting(`APP_APK_URL_${prefix}`);
    const changelog = await this.getSetting(`APP_CHANGELOG_${prefix}`);

    return {
      updateAvailable: true,
      latestVersion,
      apkUrl: apkUrl || '',
      changelog: changelog || '',
    };
  }

  /**
   * Compare semver strings: returns true if latest > current
   */
  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('-')[0].split('.').map(Number);
    const currentParts = current.split('-')[0].split('.').map(Number);

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  /**
   * Get a single setting by key
   */
  async getSetting(key: string): Promise<string> {
    const setting = await this.prisma.setting.findUnique({
      where: { key },
    });

    return setting?.value ?? DEFAULT_SETTINGS[key] ?? '';
  }

  /**
   * Set a single setting
   */
  async setSetting(
    key: string,
    value: string,
    operatorId?: string,
  ): Promise<SettingResponseDto> {
    const setting = await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    this.logger.log(`Setting ${key} updated to ${value}`);

    // Audit log
    if (operatorId) {
      await this.auditService.logSystem(
        AuditAction.SYSTEM_SETTING_CHANGED,
        operatorId,
        { key, value },
      );
    }

    // Emit setting change event
    this.eventsGateway.emitToOperators('setting:changed', { key, value });

    return {
      id: setting.id,
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt,
    };
  }

  /**
   * Get all settings
   */
  async getAllSettings(): Promise<SettingResponseDto[]> {
    const settings = await this.prisma.setting.findMany();

    // Merge with defaults
    const allKeys = Object.keys(DEFAULT_SETTINGS);
    const settingsMap = new Map(settings.map((s) => [s.key, s]));

    return allKeys.map((key) => {
      const setting = settingsMap.get(key);
      return {
        id: setting?.id ?? '',
        key,
        value: setting?.value ?? DEFAULT_SETTINGS[key],
        updatedAt: setting?.updatedAt ?? new Date(),
      };
    });
  }

  private safeParseInt(value: string, fallback: number): number {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  private safeParseFloat(value: string, fallback: number): number {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Get system settings as structured object
   */
  async getSystemSettings(): Promise<SystemSettingsDto> {
    const settings = await this.getAllSettings();
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

    const getValue = (key: string) => settingsMap.get(key) ?? DEFAULT_SETTINGS[key];

    return {
      killSwitch: getValue('KILL_SWITCH') === 'true',
      botEnabled: getValue('BOT_ENABLED') === 'true',
      botActivityWindowStart: getValue('BOT_ACTIVITY_WINDOW_START'),
      botActivityWindowEnd: getValue('BOT_ACTIVITY_WINDOW_END'),
      queueCooldownMs: this.clamp(this.safeParseInt(getValue('QUEUE_COOLDOWN_MS'), 30000), 1000, 300000),
      maxConcurrentJobs: this.clamp(this.safeParseInt(getValue('MAX_CONCURRENT_JOBS'), 1), 1, 1),
      maxRequestsPerUserPerHour: this.clamp(this.safeParseInt(getValue('MAX_REQUESTS_PER_USER_PER_HOUR'), 10), 1, 100),
      maxRequestAmount: this.clamp(this.safeParseInt(getValue('MAX_REQUEST_AMOUNT'), 50000), 100, 1000000),
      // Validation settings
      validationThreshold: this.clamp(this.safeParseFloat(getValue('VALIDATION_THRESHOLD'), 0.8), 0.5, 1),
      validationTimeoutMs: this.clamp(this.safeParseInt(getValue('VALIDATION_TIMEOUT_MS'), 90000), 10000, 300000),
      validationAmountTolerance: this.clamp(this.safeParseFloat(getValue('VALIDATION_AMOUNT_TOLERANCE'), 0.1), 0.01, 0.5),
      validationDateWindowDays: this.clamp(this.safeParseInt(getValue('VALIDATION_DATE_WINDOW_DAYS'), 7), 1, 30),
      validatorHeartbeatIntervalMs: this.clamp(this.safeParseInt(getValue('VALIDATOR_HEARTBEAT_INTERVAL_MS'), 30000), 5000, 120000),
      // Chat settings
      maxChatsPerOperator: this.clamp(this.safeParseInt(getValue('MAX_CHATS_PER_OPERATOR'), 5), 1, 20),
      autoAssignChats: getValue('AUTO_ASSIGN_CHATS') === 'true',
      // Support contact
      supportPhoneNumber: getValue('SUPPORT_PHONE_NUMBER') || '',
      // Panel balance alert
      panelBalanceThreshold: this.safeParseInt(getValue('PANEL_BALANCE_THRESHOLD'), 1000),
      // Panel for auto-creating new users
      defaultNewUserPanelId: getValue('DEFAULT_NEW_USER_PANEL_ID') || '',
      // Outbound payments
      autoPaymentEnabled: getValue('AUTO_PAYMENT_ENABLED') === 'true',
      autoPaymentRequiresConfirm: getValue('AUTO_PAYMENT_REQUIRES_CONFIRM') !== 'false', // default true
      autoPaymentMaxAmount: this.clamp(this.safeParseInt(getValue('AUTO_PAYMENT_MAX_AMOUNT'), 50000), 100, 1000000),
      outboundPaymentWalletId: getValue('OUTBOUND_PAYMENT_WALLET_ID') || '',
      // Crypto auto-buy
      cryptoAutoBuyEnabled: getValue('CRYPTO_AUTO_BUY_ENABLED') === 'true',
      cryptoAutoBuyThreshold: this.clamp(this.safeParseInt(getValue('CRYPTO_AUTO_BUY_THRESHOLD'), 100000), 1000, 10000000),
      cryptoAutoBuyWalletId: getValue('CRYPTO_AUTO_BUY_WALLET_ID') || '',
    };
  }

  /**
   * Update system settings
   */
  async updateSystemSettings(
    dto: UpdateSystemSettingsDto,
    operatorId: string,
  ): Promise<SystemSettingsDto> {
    const updates: Array<{ key: string; value: string }> = [];

    if (dto.killSwitch !== undefined) {
      updates.push({ key: 'KILL_SWITCH', value: dto.killSwitch.toString() });
    }
    if (dto.botEnabled !== undefined) {
      updates.push({ key: 'BOT_ENABLED', value: dto.botEnabled.toString() });
    }
    if (dto.botActivityWindowStart !== undefined) {
      updates.push({ key: 'BOT_ACTIVITY_WINDOW_START', value: dto.botActivityWindowStart });
    }
    if (dto.botActivityWindowEnd !== undefined) {
      updates.push({ key: 'BOT_ACTIVITY_WINDOW_END', value: dto.botActivityWindowEnd });
    }
    if (dto.queueCooldownMs !== undefined) {
      updates.push({ key: 'QUEUE_COOLDOWN_MS', value: dto.queueCooldownMs.toString() });
    }
    if (dto.maxConcurrentJobs !== undefined) {
      updates.push({ key: 'MAX_CONCURRENT_JOBS', value: dto.maxConcurrentJobs.toString() });
    }
    if (dto.maxRequestsPerUserPerHour !== undefined) {
      updates.push({
        key: 'MAX_REQUESTS_PER_USER_PER_HOUR',
        value: dto.maxRequestsPerUserPerHour.toString(),
      });
    }
    if (dto.maxRequestAmount !== undefined) {
      updates.push({ key: 'MAX_REQUEST_AMOUNT', value: dto.maxRequestAmount.toString() });
    }
    if (dto.validationThreshold !== undefined) {
      updates.push({ key: 'VALIDATION_THRESHOLD', value: dto.validationThreshold.toString() });
    }
    if (dto.validationTimeoutMs !== undefined) {
      updates.push({ key: 'VALIDATION_TIMEOUT_MS', value: dto.validationTimeoutMs.toString() });
    }
    if (dto.validationAmountTolerance !== undefined) {
      updates.push({ key: 'VALIDATION_AMOUNT_TOLERANCE', value: dto.validationAmountTolerance.toString() });
    }
    if (dto.validationDateWindowDays !== undefined) {
      updates.push({ key: 'VALIDATION_DATE_WINDOW_DAYS', value: dto.validationDateWindowDays.toString() });
    }
    if (dto.validatorHeartbeatIntervalMs !== undefined) {
      updates.push({ key: 'VALIDATOR_HEARTBEAT_INTERVAL_MS', value: dto.validatorHeartbeatIntervalMs.toString() });
    }
    if (dto.maxChatsPerOperator !== undefined) {
      updates.push({ key: 'MAX_CHATS_PER_OPERATOR', value: dto.maxChatsPerOperator.toString() });
    }
    if (dto.autoAssignChats !== undefined) {
      updates.push({ key: 'AUTO_ASSIGN_CHATS', value: dto.autoAssignChats.toString() });
    }
    if (dto.supportPhoneNumber !== undefined) {
      updates.push({ key: 'SUPPORT_PHONE_NUMBER', value: dto.supportPhoneNumber });
    }
    if (dto.panelBalanceThreshold !== undefined) {
      updates.push({ key: 'PANEL_BALANCE_THRESHOLD', value: dto.panelBalanceThreshold.toString() });
    }
    if (dto.defaultNewUserPanelId !== undefined) {
      updates.push({ key: 'DEFAULT_NEW_USER_PANEL_ID', value: dto.defaultNewUserPanelId });
    }
    // Outbound payments
    if (dto.autoPaymentEnabled !== undefined) {
      updates.push({ key: 'AUTO_PAYMENT_ENABLED', value: dto.autoPaymentEnabled.toString() });
    }
    if (dto.autoPaymentRequiresConfirm !== undefined) {
      updates.push({ key: 'AUTO_PAYMENT_REQUIRES_CONFIRM', value: dto.autoPaymentRequiresConfirm.toString() });
    }
    if (dto.autoPaymentMaxAmount !== undefined) {
      updates.push({ key: 'AUTO_PAYMENT_MAX_AMOUNT', value: dto.autoPaymentMaxAmount.toString() });
    }
    if (dto.outboundPaymentWalletId !== undefined) {
      updates.push({ key: 'OUTBOUND_PAYMENT_WALLET_ID', value: dto.outboundPaymentWalletId });
    }
    // Crypto auto-buy
    if (dto.cryptoAutoBuyEnabled !== undefined) {
      updates.push({ key: 'CRYPTO_AUTO_BUY_ENABLED', value: dto.cryptoAutoBuyEnabled.toString() });
    }
    if (dto.cryptoAutoBuyThreshold !== undefined) {
      updates.push({ key: 'CRYPTO_AUTO_BUY_THRESHOLD', value: dto.cryptoAutoBuyThreshold.toString() });
    }
    if (dto.cryptoAutoBuyWalletId !== undefined) {
      updates.push({ key: 'CRYPTO_AUTO_BUY_WALLET_ID', value: dto.cryptoAutoBuyWalletId });
    }

    // Guard: no valid fields to update
    if (updates.length === 0) {
      this.logger.warn('updateSystemSettings called with no recognized fields — payload may have wrong field names');
      throw new BadRequestException('No se recibieron campos válidos para actualizar');
    }

    // Apply all updates atomically
    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.setting.upsert({
          where: { key: update.key },
          update: { value: update.value },
          create: { key: update.key, value: update.value },
        }),
      ),
    );

    // Post-commit: emit events and single audit log
    for (const update of updates) {
      this.logger.log(`Setting ${update.key} updated to ${update.value}`);
      this.eventsGateway.emitToOperators('setting:changed', {
        key: update.key,
        value: update.value,
      });
    }

    await this.auditService.logSystem(
      AuditAction.SYSTEM_SETTING_CHANGED,
      operatorId,
      { settings: updates },
    );

    return this.getSystemSettings();
  }

  // ==========================================
  // KILL SWITCH
  // ==========================================

  /**
   * Get kill switch status
   */
  async getKillSwitch(): Promise<{ active: boolean; reason?: string }> {
    const active = (await this.getSetting('KILL_SWITCH')) === 'true';
    const reason = await this.getSetting('KILL_SWITCH_REASON');
    return { active, reason: reason || undefined };
  }

  /**
   * Activate kill switch (EMERGENCY STOP)
   */
  async activateKillSwitch(operatorId: string, reason?: string): Promise<void> {
    await this.setSetting('KILL_SWITCH', 'true', operatorId);
    if (reason) {
      await this.setSetting('KILL_SWITCH_REASON', reason, operatorId);
    }

    this.logger.warn(`KILL SWITCH ACTIVATED by ${operatorId}: ${reason || 'No reason provided'}`);

    // Audit
    await this.auditService.logSystem(
      AuditAction.SYSTEM_KILL_SWITCH_ACTIVATED,
      operatorId,
      { reason },
    );

    // Emit to all clients
    this.eventsGateway.emitToAll('system:kill_switch', {
      active: true,
      reason,
      activatedBy: operatorId,
      timestamp: new Date(),
    });

    // Also broadcast to bot extension
    try {
      this.botGateway.broadcastKillSwitch(reason || 'Kill switch activated');
    } catch (err) {
      this.logger.error(`Failed to broadcast kill switch to bots: ${err.message}`);
    }
  }

  /**
   * Deactivate kill switch
   */
  async deactivateKillSwitch(operatorId: string): Promise<void> {
    await this.setSetting('KILL_SWITCH', 'false', operatorId);
    await this.setSetting('KILL_SWITCH_REASON', '', operatorId);

    this.logger.log(`Kill switch deactivated by ${operatorId}`);

    // Audit
    await this.auditService.logSystem(
      AuditAction.SYSTEM_KILL_SWITCH_DEACTIVATED,
      operatorId,
    );

    // Emit to all clients
    this.eventsGateway.emitToAll('system:kill_switch', {
      active: false,
      deactivatedBy: operatorId,
      timestamp: new Date(),
    });
  }

  // ==========================================
  // BOT STATUS (for bot heartbeat)
  // ==========================================

  /**
   * Update bot status (called by bot)
   */
  async updateBotStatus(status: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: 'BOT_STATUS' },
      update: { value: status },
      create: { key: 'BOT_STATUS', value: status },
    });

    await this.prisma.setting.upsert({
      where: { key: 'BOT_LAST_HEARTBEAT' },
      update: { value: new Date().toISOString() },
      create: { key: 'BOT_LAST_HEARTBEAT', value: new Date().toISOString() },
    });

    this.eventsGateway.emitBotStatus({ status, timestamp: new Date() });
  }

  /**
   * Get bot status
   */
  async getBotStatus(): Promise<{
    status: string;
    lastHeartbeat?: Date;
  }> {
    const status = await this.getSetting('BOT_STATUS');
    const lastHeartbeat = await this.getSetting('BOT_LAST_HEARTBEAT');

    return {
      status: status || 'offline',
      lastHeartbeat: lastHeartbeat ? new Date(lastHeartbeat) : undefined,
    };
  }

  // ==========================================
  // ACTIVITY WINDOW
  // ==========================================

  /**
   * Check if current time is within activity window
   */
  async isWithinActivityWindow(): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const botEnabled = (await this.getSetting('BOT_ENABLED')) === 'true';
    if (!botEnabled) {
      return { allowed: false, reason: 'Bot is disabled' };
    }

    const startStr = await this.getSetting('BOT_ACTIVITY_WINDOW_START');
    const endStr = await this.getSetting('BOT_ACTIVITY_WINDOW_END');

    if (!startStr || !endStr) {
      return { allowed: true }; // No window set, always allowed
    }

    // If start === end, treat as 24/7 mode
    if (startStr === endStr) {
      return { allowed: true }; // 24/7 mode
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = startStr.split(':').map(Number);
    const [endHour, endMin] = endStr.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Handle overnight windows (e.g., 22:00 - 06:00)
    let isWithin: boolean;
    if (endMinutes < startMinutes) {
      isWithin = currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      isWithin = currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    if (!isWithin) {
      return {
        allowed: false,
        reason: `Outside activity window (${startStr} - ${endStr})`,
      };
    }

    return { allowed: true };
  }

  // ==========================================
  // RATE LIMITING
  // ==========================================

  /**
   * Check if user has exceeded request rate limit
   */
  async checkUserRateLimit(userId: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const maxPerHour = parseInt(
      await this.getSetting('MAX_REQUESTS_PER_USER_PER_HOUR'),
      10,
    );

    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const recentRequests = await this.prisma.request.count({
      where: {
        userId,
        createdAt: { gte: oneHourAgo },
      },
    });

    const remaining = Math.max(0, maxPerHour - recentRequests);

    // Compute resetAt: when the oldest request in the window expires
    let resetAt: Date;
    if (recentRequests >= maxPerHour) {
      const oldestInWindow = await this.prisma.request.findFirst({
        where: {
          userId,
          createdAt: { gte: oneHourAgo },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });

      if (oldestInWindow) {
        resetAt = new Date(oldestInWindow.createdAt.getTime() + 60 * 60 * 1000);
      } else {
        resetAt = new Date(Date.now() + 60 * 60 * 1000);
      }
    } else {
      resetAt = new Date(Date.now() + 60 * 60 * 1000);
    }

    return {
      allowed: remaining > 0,
      remaining,
      resetAt,
    };
  }
}
