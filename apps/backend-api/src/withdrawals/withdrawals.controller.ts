import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateWithdrawalDto,
  ApproveWithdrawalDto,
  RejectWithdrawalDto,
} from './dto';

@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  // ==========================================
  // CLIENT ENDPOINTS
  // ==========================================

  @Post()
  async create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.withdrawalsService.create(user.sub, dto);
  }

  @Get()
  async findMine(@CurrentUser() user: { sub: string }) {
    return this.withdrawalsService.findAllByUser(user.sub);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    // Operators can view any withdrawal
    if (['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(user.role)) {
      return this.withdrawalsService.findOne(id);
    }
    return this.withdrawalsService.findOne(id, user.sub);
  }

  // ==========================================
  // OPERATOR ENDPOINTS
  // ==========================================

  @Get('operator/pending')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findPending() {
    return this.withdrawalsService.findPending();
  }

  @Get('operator/all')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findAll(@Query('status') status?: string) {
    return this.withdrawalsService.findAll(status);
  }

  @Post(':id/approve')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: ApproveWithdrawalDto,
  ) {
    return this.withdrawalsService.approve(id, user.sub, dto);
  }

  @Post(':id/reject')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async reject(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.withdrawalsService.reject(id, user.sub, dto);
  }

  @Post(':id/complete')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async complete(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.withdrawalsService.complete(id, user.sub);
  }
}
