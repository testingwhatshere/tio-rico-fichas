import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
} from '@nestjs/common';
import { OperatorsService } from './operators.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateOperatorDto, UpdateOperatorDto } from './dto';

@Controller('operators')
export class OperatorsController {
  constructor(private readonly operatorsService: OperatorsService) {}

  // ==========================================
  // SELF MANAGEMENT
  // ==========================================

  /**
   * Get my operator profile
   */
  @Get('me')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getMyProfile(@Request() req: any) {
    return this.operatorsService.getOperatorByUserId(req.user.sub);
  }

  /**
   * Update my availability
   */
  @Patch('me/availability')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async setMyAvailability(
    @Body() body: { isAvailable: boolean },
    @Request() req: any,
  ) {
    return this.operatorsService.setAvailability(
      req.user.sub,
      body.isAvailable,
    );
  }

  /**
   * Get my stats
   */
  @Get('me/stats')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getMyStats(@Request() req: any) {
    const profile = await this.operatorsService.getOperatorByUserId(
      req.user.sub,
    );
    return this.operatorsService.getOperatorStats(profile.id);
  }

  // ==========================================
  // ADMIN MANAGEMENT
  // ==========================================

  /**
   * List all operators
   */
  @Get()
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getAllOperators() {
    return this.operatorsService.getAllOperators();
  }

  /**
   * Get available operators
   */
  @Get('available')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getAvailableOperators() {
    return this.operatorsService.getAvailableOperators();
  }

  /**
   * Get all operators stats
   */
  @Get('stats')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getAllOperatorsStats() {
    return this.operatorsService.getAllOperatorsStats();
  }

  /**
   * Get operator by ID
   */
  @Get(':id')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getOperatorById(@Param('id') id: string) {
    return this.operatorsService.getOperatorById(id);
  }

  /**
   * Get operator stats
   */
  @Get(':id/stats')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getOperatorStats(@Param('id') id: string) {
    return this.operatorsService.getOperatorStats(id);
  }

  /**
   * Create operator profile
   */
  @Post()
  @Roles('ADMIN')
  async createOperator(@Body() dto: CreateOperatorDto) {
    return this.operatorsService.createOperator(dto);
  }

  /**
   * Update operator
   */
  @Patch(':id')
  @Roles('ADMIN')
  async updateOperator(
    @Param('id') id: string,
    @Body() dto: UpdateOperatorDto,
  ) {
    return this.operatorsService.updateOperator(id, dto);
  }

  /**
   * Delete operator
   */
  @Delete(':id')
  @Roles('ADMIN')
  async deleteOperator(@Param('id') id: string) {
    return this.operatorsService.deleteOperator(id);
  }
}
