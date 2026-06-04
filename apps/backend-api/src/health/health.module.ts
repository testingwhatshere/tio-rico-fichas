import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { BotHealthIndicator } from './indicators/bot.health';
import { SelfMonitorService } from './self-monitor.service';
import { BotModule } from '../bot/bot.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TerminusModule,
    ConfigModule,
    ScheduleModule.forRoot(),
    forwardRef(() => BotModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => SettingsModule),
  ],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    BotHealthIndicator,
    SelfMonitorService,
  ],
})
export class HealthModule {}
