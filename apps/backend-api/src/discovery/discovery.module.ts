import { Module, forwardRef } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BotModule } from '../bot/bot.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => BotModule),
    forwardRef(() => EventsModule),
  ],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
