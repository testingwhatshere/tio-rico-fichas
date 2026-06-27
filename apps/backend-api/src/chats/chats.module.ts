import { Module, forwardRef } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // forwardRef on NotificationsModule because the cycle is:
  // ChatsModule -> NotificationsModule -> MessagesModule -> ChatsModule.
  imports: [
    forwardRef(() => EventsModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
