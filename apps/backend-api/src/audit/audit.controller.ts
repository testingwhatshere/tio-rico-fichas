import { Controller, Get, Query, Param } from '@nestjs/common';
import { AuditService } from './audit.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditLogQueryDto, EntityType } from './dto';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Query audit logs with filters
   */
  @Get()
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async queryLogs(@Query() query: AuditLogQueryDto) {
    return this.auditService.query(query);
  }

  /**
   * Get recent activity
   */
  @Get('recent')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getRecentActivity(@Query('limit') limit?: string) {
    return this.auditService.getRecentActivity(
      limit ? parseInt(limit, 10) : 50,
    );
  }

  /**
   * Get action statistics
   */
  @Get('stats')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getActionStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.auditService.getActionStats(fromDate, toDate);
  }

  /**
   * Get audit history for an entity
   */
  @Get('entity/:type/:id')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getEntityHistory(
    @Param('type') type: EntityType,
    @Param('id') id: string,
  ) {
    return this.auditService.getEntityHistory(type, id);
  }

  /**
   * Get operator activity
   */
  @Get('operator/:operatorId')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getOperatorActivity(
    @Param('operatorId') operatorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.auditService.getOperatorActivity(operatorId, fromDate, toDate);
  }
}
