import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('jobs')
@Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  // ==========================================
  // STATIC ROUTES FIRST (before :id params)
  // ==========================================

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.jobsService.findAll({
      status: status as any,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('active')
  async getActive() {
    return this.jobsService.getActiveJob();
  }

  @Get('queued')
  async getQueued() {
    return this.jobsService.getQueuedJobs();
  }

  @Get('stats')
  async getStats() {
    return this.jobsService.getStats();
  }

  @Get('queue-info')
  async getQueueInfo() {
    return this.jobsService.getQueueInfo();
  }

  // ==========================================
  // OPERATOR STATIC ROUTES (must come before :id)
  // ==========================================

  @Get('operator/my-assignments')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getMyAssignments(@CurrentUser() user: { sub: string }) {
    return this.jobsService.getAssignedToOperator(user.sub);
  }

  @Get('operator/unassigned-failures')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getUnassignedFailedJobs() {
    return this.jobsService.getUnassignedFailedJobs();
  }

  @Post('request/:requestId')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async createForRequest(@Param('requestId') requestId: string) {
    return this.jobsService.createJobForRequest(requestId);
  }

  // ==========================================
  // PARAMETERIZED ROUTES (must come LAST)
  // ==========================================

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @Post(':id/assign')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async assignOperator(
    @Param('id') id: string,
    @Body('operatorId') operatorId: string,
  ) {
    return this.jobsService.assignOperator(id, operatorId);
  }

  @Post(':id/unassign')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async unassignOperator(@Param('id') id: string) {
    return this.jobsService.unassignOperator(id);
  }

  @Post(':id/retry')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async retryJob(@Param('id') id: string) {
    return this.jobsService.retryJob(id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async cancel(@Param('id') id: string) {
    return this.jobsService.cancelJob(id);
  }
}
