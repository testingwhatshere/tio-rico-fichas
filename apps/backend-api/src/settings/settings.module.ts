import { Module, forwardRef } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { EventsModule } from '../events/events.module';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [forwardRef(() => EventsModule), forwardRef(() => BotModule)],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
