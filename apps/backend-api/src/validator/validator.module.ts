import { Module, Global, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ValidatorGateway } from './validator.gateway';
import { ValidatorAnalyticsService } from './validator-analytics.service';
import { ValidatorHealthService } from './validator-health.service';
import { ValidatorController } from './validator.controller';
import { SettingsModule } from '../settings/settings.module';
import { EventsModule } from '../events/events.module';

@Global()
@Module({
  imports: [ConfigModule, forwardRef(() => SettingsModule), forwardRef(() => EventsModule)],
  controllers: [ValidatorController],
  providers: [ValidatorGateway, ValidatorAnalyticsService, ValidatorHealthService],
  exports: [ValidatorGateway, ValidatorAnalyticsService, ValidatorHealthService],
})
export class ValidatorModule {}
