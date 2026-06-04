import { Controller, Post, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Roles } from '../common/decorators/roles.decorator';
import { SendNotificationDto, BroadcastNotificationDto } from './dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Send notification to specific user (admin)
   */
  @Post('user')
  @Roles('ADMIN')
  async sendToUser(@Body() dto: SendNotificationDto) {
    await this.notificationsService.sendToUser(dto);
    return { success: true };
  }

  /**
   * Send notification to all operators (admin)
   */
  @Post('operators')
  @Roles('ADMIN')
  async sendToOperators(@Body() dto: BroadcastNotificationDto) {
    await this.notificationsService.sendToOperators(dto);
    return { success: true };
  }

  /**
   * Broadcast to all users (admin)
   */
  @Post('broadcast')
  @Roles('ADMIN')
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    await this.notificationsService.broadcast(dto);
    return { success: true };
  }
}
