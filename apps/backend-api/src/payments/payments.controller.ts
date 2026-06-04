import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ============================================
  // CLIENT ENDPOINTS
  // ============================================

  /**
   * Get the currently selected wallet (public - for chat app)
   */
  @Get('wallet')
  @Public()
  async getSelectedWallet() {
    return this.paymentsService.getSelectedWallet();
  }

  // ============================================
  // OPERATOR/ADMIN ENDPOINTS
  // ============================================

  /**
   * Get all wallets (for operator panel)
   */
  @Get('wallets')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getAllWallets() {
    return this.paymentsService.getAllWallets();
  }

  /**
   * Create a new wallet
   */
  @Post('wallets')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async createWallet(
    @Body()
    body: {
      type: 'MERCADOPAGO' | 'CBU' | 'CVU';
      label: string;
      holderName: string;
      details: Record<string, string>;
    },
  ) {
    return this.paymentsService.createWallet(body);
  }

  /**
   * Update a wallet
   */
  @Patch('wallets/:id')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async updateWallet(
    @Param('id') id: string,
    @Body()
    body: {
      label?: string;
      holderName?: string;
      details?: Record<string, string>;
    },
  ) {
    return this.paymentsService.updateWallet(id, body);
  }

  /**
   * Select a wallet (make it the active one for clients)
   */
  @Post('wallets/:id/select')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async selectWallet(@Param('id') id: string) {
    return this.paymentsService.selectWallet(id);
  }

  /**
   * Delete a wallet (soft delete)
   */
  @Delete('wallets/:id')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async deleteWallet(@Param('id') id: string) {
    return this.paymentsService.deleteWallet(id);
  }

  /**
   * Trigger validation for a request (internal/admin)
   */
  @Post('validate/:requestId')
  @Roles('ADMIN')
  async validate(@Param('requestId') requestId: string) {
    return this.paymentsService.validateProof(requestId);
  }

  // ============================================
  // LEGACY ENDPOINTS (backwards compatibility)
  // ============================================

  @Get('config')
  @Public()
  async getConfig() {
    return this.paymentsService.getPaymentConfig();
  }

  @Post('config')
  @Roles('ADMIN')
  async createConfig(
    @Body() body: { provider: string; alias: string; name: string },
  ) {
    return this.paymentsService.createPaymentConfig(body);
  }

  @Patch('config/:id')
  @Roles('ADMIN')
  async updateConfig(
    @Param('id') id: string,
    @Body() body: { alias?: string; name?: string; isActive?: boolean },
  ) {
    return this.paymentsService.updatePaymentConfig(id, body);
  }

  @Delete('config/:id')
  @Roles('ADMIN')
  async deleteConfig(@Param('id') id: string) {
    return this.paymentsService.deletePaymentConfig(id);
  }
}
