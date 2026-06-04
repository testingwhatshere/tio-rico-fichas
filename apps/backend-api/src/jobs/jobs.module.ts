import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { BotModule } from '../bot/bot.module';
import { RequestsModule } from '../requests/requests.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => BotModule),
    forwardRef(() => RequestsModule),
    forwardRef(() => EventsModule),
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
