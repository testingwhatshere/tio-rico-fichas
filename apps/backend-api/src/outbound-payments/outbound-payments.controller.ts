import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { OutboundPaymentsService } from './outbound-payments.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ConfirmOutboundPaymentDto,
  CancelOutboundPaymentDto,
  BuyCryptoDto,
} from './dto';

@Controller('outbound-payments')
export class OutboundPaymentsController {
  constructor(private readonly service: OutboundPaymentsService) {}

  // ==========================================
  // OPERATOR ENDPOINTS
  // ==========================================

  @Get()
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findPending() {
    return this.service.findPending();
  }

  @Get('recent')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findRecent(@Query('limit') limit?: string) {
    return this.service.findRecent(limit ? parseInt(limit) : 20);
  }

  @Get('stats')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getStats() {
    return this.service.getStats();
  }

  @Get('by-status/:status')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findByStatus(@Param('status') status: string) {
    return this.service.findByStatus(status);
  }

  @Post(':id/confirm')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: ConfirmOutboundPaymentDto,
  ) {
    return this.service.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: CancelOutboundPaymentDto,
  ) {
    return this.service.cancel(id, user.sub, dto.reason);
  }

  @Post(':id/retry')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async retry(@Param('id') id: string, @CurrentUser() user: { sub: string }) {
    return this.service.retry(id, user.sub);
  }

  // ==========================================
  // CRYPTO
  // ==========================================

  @Post('crypto/buy')
  @Roles('ADMIN')
  async buyCrypto(
    @Body() dto: BuyCryptoDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.buyCrypto(dto, user.sub);
  }
}
