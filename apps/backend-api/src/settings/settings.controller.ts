import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Request,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UpdateSettingDto, UpdateSystemSettingsDto } from './dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // ==========================================
  // PUBLIC SETTINGS (for clients)
  // ==========================================

  /**
   * Check if an app update is available (public — no auth needed)
   */
  @Public()
  @Get('check-update')
  async checkAppUpdate(
    @Query('app') app?: string,
    @Query('currentVersion') currentVersion?: string,
  ) {
    return this.settingsService.checkAppUpdate(
      app || 'chat',
      currentVersion || '0.0.0',
    );
  }

  /**
   * Get public system info (non-sensitive)
   */
  @Public()
  @Get('public')
  async getPublicSettings() {
    const settings = await this.settingsService.getSystemSettings();
    return {
      maxRequestsPerUserPerHour: settings.maxRequestsPerUserPerHour,
      supportPhoneNumber: settings.supportPhoneNumber || '',
    };
  }

  // ==========================================
  // OPERATOR SETTINGS
  // ==========================================

  /**
   * Get all system settings
   */
  @Get()
  @Roles('ADMIN')
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  /**
   * Get system settings as structured object
   */
  @Get('system')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getSystemSettings() {
    return this.settingsService.getSystemSettings();
  }

  /**
   * Update system settings
   */
  @Patch('system')
  @Roles('ADMIN')
  async updateSystemSettings(
    @Body() dto: UpdateSystemSettingsDto,
    @Request() req: any,
  ) {
    return this.settingsService.updateSystemSettings(dto, req.user.sub);
  }

  /**
   * Get specific setting
   */
  @Get(':key')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getSetting(@Param('key') key: string) {
    const value = await this.settingsService.getSetting(key);
    return { key, value };
  }

  /**
   * Update specific setting
   */
  @Patch(':key')
  @Roles('ADMIN')
  async updateSetting(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @Request() req: any,
  ) {
    return this.settingsService.setSetting(key, dto.value, req.user.sub);
  }

  // ==========================================
  // KILL SWITCH
  // ==========================================

  /**
   * Get kill switch status
   */
  @Get('killswitch/status')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getKillSwitchStatus() {
    return this.settingsService.getKillSwitch();
  }

  /**
   * Activate kill switch (EMERGENCY)
   */
  @Post('killswitch/activate')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async activateKillSwitch(
    @Body() body: { reason?: string },
    @Request() req: any,
  ) {
    await this.settingsService.activateKillSwitch(req.user.sub, body.reason);
    return { success: true, message: 'Kill switch activated' };
  }

  /**
   * Deactivate kill switch
   */
  @Post('killswitch/deactivate')
  @Roles('ADMIN')
  async deactivateKillSwitch(@Request() req: any) {
    await this.settingsService.deactivateKillSwitch(req.user.sub);
    return { success: true, message: 'Kill switch deactivated' };
  }

  // ==========================================
  // BOT STATUS
  // ==========================================

  /**
   * Get bot status
   */
  @Get('bot/status')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getBotStatus() {
    return this.settingsService.getBotStatus();
  }

  /**
   * Check activity window
   */
  @Get('bot/activity-window')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async checkActivityWindow() {
    return this.settingsService.isWithinActivityWindow();
  }
}
