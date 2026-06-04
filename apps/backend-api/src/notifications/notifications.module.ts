import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';
import { PushService } from './push.service';
import { EventsModule } from '../events/events.module';
import { MessagesModule } from '../messages/messages.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => EventsModule),
    forwardRef(() => MessagesModule),
    forwardRef(() => BotModule),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, TelegramService, PushService],
  exports: [NotificationsService, TelegramService, PushService],
})
export class NotificationsModule {}
