import { Module, forwardRef } from '@nestjs/common';
import { PrizeClaimsController } from './prize-claims.controller';
import { PrizeClaimsService } from './prize-claims.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { BotModule } from '../bot/bot.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => EventsModule),
    forwardRef(() => BotModule),
    forwardRef(() => NotificationsModule),
    UploadsModule,
  ],
  controllers: [PrizeClaimsController],
  providers: [PrizeClaimsService],
  exports: [PrizeClaimsService],
})
export class PrizeClaimsModule {}
