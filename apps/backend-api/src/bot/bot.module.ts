import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { BotGateway } from './bot.gateway';
import { BotApiKeyGuard } from './guards/bot-api-key.guard';
import { EventsModule } from '../events/events.module';
import { BalanceModule } from '../balance/balance.module';
import { SettingsModule } from '../settings/settings.module';
import { PanelsModule } from '../panels/panels.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrizeClaimsModule } from '../prize-claims/prize-claims.module';

/**
 * Bot Module
 *
 * Handles all communication between the automation bot and the backend.
 * Provides:
 * - Job status updates (started, progress, result)
 * - Bot health monitoring (heartbeat, status)
 * - Control features (kill switch, activity window)
 * - WebSocket gateway for real-time bot communication
 *
 * All endpoints are protected by API key authentication.
 */
@Module({
  imports: [
    ConfigModule,
    forwardRef(() => EventsModule),
    BalanceModule,
    forwardRef(() => SettingsModule),
    PanelsModule,
    forwardRef(() => DiscoveryModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => PrizeClaimsModule),
  ],
  controllers: [BotController],
  providers: [BotService, BotGateway, BotApiKeyGuard],
  exports: [BotService, BotGateway],
})
export class BotModule {}
