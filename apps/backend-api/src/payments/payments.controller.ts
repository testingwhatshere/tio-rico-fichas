import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request as ExpressRequest } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * El panel del que pregunta, sacado del token.
   *
   * La ruta sigue siendo publica: la app manda el token en todas las llamadas,
   * pero si no viniera —o no se pudiera leer— esto devuelve null y el usuario
   * recibe la billetera compartida, que es lo que pasaba antes. Nunca falla la
   * consulta por no poder identificar al usuario.
   */
  private async panelOfCaller(req: ExpressRequest): Promise<string | null> {
    const header = req?.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const payload = await this.jwtService.verifyAsync(header.slice(7));
      if (!payload?.sub) return null;
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { panelId: true },
      });
      return user?.panelId ?? null;
    } catch {
      // Token vencido o invalido: no es motivo para no mostrar una billetera.
      return null;
    }
  }

  // ============================================
  // CLIENT ENDPOINTS
  // ============================================

  /**
   * Get the currently selected wallet (public - for chat app)
   */
  @Get('wallet')
  @Public()
  async getSelectedWallet(@Req() req: ExpressRequest) {
    const panelId = await this.panelOfCaller(req);
    return this.paymentsService.getSelectedWallet(panelId);
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
