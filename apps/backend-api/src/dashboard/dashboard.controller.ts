import { Controller, Get, Post, Put, Delete, Query, Param, Body, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Public } from '../common/decorators/public.decorator';
import { BotApiKeyGuard } from '../bot/guards/bot-api-key.guard';

@Controller('dashboard')
@Public()
@UseGuards(BotApiKeyGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('analytics')
  async getAnalytics() {
    return this.dashboardService.getAnalytics();
  }

  @Get('stats')
  async getDashboardStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.dashboardService.getDashboardStats(fromDate, toDate);
  }

  @Get('trends')
  async getRequestTrends(@Query('days') days?: string) {
    return this.dashboardService.getRequestTrends(days ? parseInt(days, 10) : 7);
  }

  @Get('revenue')
  async getRevenueStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.dashboardService.getRevenueStats(fromDate, toDate);
  }

  @Get('health')
  async getSystemHealth() {
    return this.dashboardService.getSystemHealth();
  }

  @Get('failures')
  async getFailureQueue() {
    return this.dashboardService.getFailureQueue();
  }

  @Get('activity')
  async getRecentActivity(@Query('limit') limit?: string) {
    return this.dashboardService.getRecentActivity(
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ==========================================
  // KILL SWITCH
  // ==========================================

  @Get('killswitch')
  async getKillSwitch() {
    return this.dashboardService.getKillSwitchInfo();
  }

  @Post('killswitch/activate')
  async activateKillSwitch(@Body('reason') reason?: string) {
    return this.dashboardService.activateKillSwitch(reason);
  }

  @Post('killswitch/deactivate')
  async deactivateKillSwitch() {
    return this.dashboardService.deactivateKillSwitch();
  }

  // ==========================================
  // EXPENSES
  // ==========================================

  @Get('expenses')
  async getExpenses(@Query('month') month?: string) {
    return this.dashboardService.getExpenses(month);
  }

  @Post('expenses')
  async createExpense(@Body() body: { category: string; description: string; amount: number; date: string; recurring?: boolean }) {
    return this.dashboardService.createExpense(body);
  }

  @Delete('expenses/:id')
  async deleteExpense(@Param('id') id: string) {
    return this.dashboardService.deleteExpense(id);
  }

  // ==========================================
  // VAULT
  // ==========================================

  @Get('vault')
  async getVaultEntries() {
    return this.dashboardService.getVaultEntries();
  }

  @Post('vault')
  async createVaultEntry(@Body() body: { category: string; label: string; username?: string; password: string; url?: string; notes?: string }) {
    return this.dashboardService.createVaultEntry(body);
  }

  @Put('vault/:id')
  async updateVaultEntry(@Param('id') id: string, @Body() body: any) {
    return this.dashboardService.updateVaultEntry(id, body);
  }

  @Delete('vault/:id')
  async deleteVaultEntry(@Param('id') id: string) {
    return this.dashboardService.deleteVaultEntry(id);
  }

  /**
   * Consolidated monitoring endpoint for Client Manager.
   * Returns all key metrics in a single call.
   * Protected by BotApiKeyGuard (class-level) — also accepts X-Monitoring-API-Key.
   */
  @Get('monitoring')
  async getMonitoringData() {
    return this.dashboardService.getMonitoringData();
  }
}
