import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
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

  /**
   * DEPRECATED — use POST /api/prize-claims instead. Withdrawals were unified
   * with prize-claims (which verify the real chip balance on the panel via the
   * chrome extension instead of an internal counter). Old clients that still
   * hit this endpoint get a 410 with the migration hint.
   */
  @Post()
  async create(
    @CurrentUser() _user: { sub: string },
    @Body() _dto: CreateWithdrawalDto,
  ) {
    throw new HttpException(
      {
        statusCode: HttpStatus.GONE,
        message:
          'Este endpoint está deprecado. Usá POST /api/prize-claims para cobrar premios.',
        replacement: 'POST /api/prize-claims',
      },
      HttpStatus.GONE,
    );
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
