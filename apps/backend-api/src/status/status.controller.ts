import { Controller, Get, Param } from '@nestjs/common';
import { StatusService } from './status.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('status')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  /**
   * Get current request status (for clients)
   */
  @Get('request/:id')
  async getRequestStatus(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    return this.statusService.getRequestStatus(id, user.sub, user.role);
  }

  /**
   * Get current job status (for clients)
   */
  @Get('job/:id')
  async getJobStatus(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    return this.statusService.getJobStatus(id, user.sub, user.role);
  }

  /**
   * Get all active requests for user (for polling)
   */
  @Get('my-requests')
  async getMyActiveRequests(@CurrentUser() user: { sub: string }) {
    return this.statusService.getUserActiveRequests(user.sub);
  }

  /**
   * Get system status (for operators)
   */
  @Get('system')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getSystemStatus() {
    return this.statusService.getSystemStatus();
  }

  /**
   * Get queue status (for operators)
   */
  @Get('queue')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getQueueStatus() {
    return this.statusService.getQueueStatus();
  }
}
