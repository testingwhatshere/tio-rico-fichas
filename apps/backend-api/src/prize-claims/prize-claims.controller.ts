import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { PrizeClaimsService } from './prize-claims.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RejectPrizeClaimDto } from './dto';

@Controller('prize-claims')
export class PrizeClaimsController {
  constructor(private readonly prizeClaimsService: PrizeClaimsService) {}

  // ==========================================
  // CLIENT ENDPOINTS (HTTP fallback for socket-based prize claims)
  // ==========================================

  @Post()
  @Roles('CLIENT')
  async create(
    @CurrentUser() user: { sub: string },
    @Body() body: { amount: number; paymentMethod: string; paymentDetails: { cbu?: string; alias?: string; accountHolder: string } },
  ) {
    return this.prizeClaimsService.createWithPayment(user.sub, {
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      paymentDetails: body.paymentDetails,
    });
  }

  // ==========================================
  // OPERATOR ENDPOINTS
  // ==========================================

  @Get('pending')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findPending() {
    return this.prizeClaimsService.findPending();
  }

  @Get()
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findAll(@Query('status') status?: string) {
    return this.prizeClaimsService.findAll(status);
  }

  @Get(':id')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findOne(@Param('id') id: string) {
    return this.prizeClaimsService.findOne(id);
  }

  @Post(':id/process')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async process(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.prizeClaimsService.process(id, user.sub);
  }

  @Post(':id/complete')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async complete(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.prizeClaimsService.complete(id, user.sub);
  }

  @Post(':id/reject')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async reject(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: RejectPrizeClaimDto,
  ) {
    return this.prizeClaimsService.reject(id, user.sub, dto);
  }
}
