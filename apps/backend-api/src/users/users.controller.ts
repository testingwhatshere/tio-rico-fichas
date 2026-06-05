import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/interfaces/current-user.interface';
import { CreateUserDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';
import { BalanceService } from '../balance/balance.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly balanceService: BalanceService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SENIOR_OPERATOR)
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SENIOR_OPERATOR)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }

  /**
   * Update a user's username (operator action)
   * This also updates targetUsername in all pending requests
   */
  @Patch(':id/username')
  @Roles(UserRole.OPERATOR, UserRole.SENIOR_OPERATOR, UserRole.ADMIN)
  async updateUsername(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { username: string },
  ) {
    return this.usersService.updateUsername(id, dto.username);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }

  /**
   * Create a new user on the gaming panel.
   * Creates a CREATE_USER job for the automation extension.
   * Available to operators and admins.
   */
  @Post('create-panel-user')
  @Roles(UserRole.ADMIN, UserRole.SENIOR_OPERATOR, UserRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  async createPanelUser(
    @Body() body: { targetUsername: string },
  ) {
    return this.usersService.requestCreateUser(body.targetUsername);
  }

  /**
   * Request a password change on the gaming panel.
   * Creates a CHANGE_PASSWORD job for the automation extension.
   */
  @Post('me/change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: { newPassword: string; confirmPassword: string },
  ) {
    return this.usersService.requestPasswordChange(
      user.sub,
      body.newPassword,
      body.confirmPassword,
    );
  }

  /**
   * Save push notification token for the current user
   */
  @Post('me/push-token')
  @HttpCode(HttpStatus.OK)
  async savePushToken(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: { token: string; platform?: string },
  ) {
    await this.usersService.updatePushToken(user.sub, body.token);
    return { success: true };
  }

  /**
   * Get current user's balance — DEPRECATED.
   * The internal `User.balance` no longer tracks anything meaningful: real
   * chip balance lives on the gaming panel and is fetched on-demand by the
   * chrome extension during prize-claim verification. Endpoint kept so old
   * APKs don't 404; always returns `null` to make it obvious nothing's there.
   */
  @Get('me/balance')
  async getMyBalance(@CurrentUser() _user: CurrentUserPayload) {
    return { balance: null, deprecated: true };
  }

  /**
   * Get current user's transaction history
   */
  @Get('me/transactions')
  async getMyTransactions(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limit?: string,
  ) {
    const transactions = await this.balanceService.getTransactionHistory(
      user.sub,
      limit ? parseInt(limit, 10) : 50,
    );
    return { transactions };
  }

  // ============================================
  // PRELOADED USERS (operator-imported via CSV)
  // ============================================

  /**
   * Bulk import preloaded users from CSV-derived array.
   * Each entry: { username, phone, panelId? }.
   * - Creates new User if username doesn't exist.
   * - Updates phone/panelId/isPreloaded if username exists.
   * - Conflict (phone already used by another username) → reported in errors.
   */
  @Post('preloaded/bulk')
  @Roles(UserRole.OPERATOR, UserRole.SENIOR_OPERATOR, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async bulkImportPreloaded(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: { entries: Array<{ username: string; phone: string; panelId?: string }> },
  ) {
    return this.usersService.bulkImportPreloaded(body.entries || [], user.sub);
  }

  /** List all currently-preloaded users (latest first). */
  @Get('preloaded')
  @Roles(UserRole.OPERATOR, UserRole.SENIOR_OPERATOR, UserRole.ADMIN)
  async listPreloaded() {
    return this.usersService.findPreloaded();
  }

  /** Remove a user from the preloaded list (does NOT delete the User row). */
  @Delete('preloaded/:id')
  @Roles(UserRole.SENIOR_OPERATOR, UserRole.ADMIN)
  async unflagPreloaded(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.unflagPreloaded(id);
  }
}
