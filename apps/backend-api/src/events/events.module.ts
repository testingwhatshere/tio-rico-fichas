import { Module, Global, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';
import { OperatorGateway } from './operator.gateway';
import { ChatsGateway } from './chats.gateway';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { DashboardModule } from '../dashboard/dashboard.module';
import { RequestsModule } from '../requests/requests.module';
import { ChatsModule } from '../chats/chats.module';
import { MessagesModule } from '../messages/messages.module';
import { SettingsModule } from '../settings/settings.module';
import { JobsModule } from '../jobs/jobs.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { BotModule } from '../bot/bot.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
    forwardRef(() => DashboardModule),
    forwardRef(() => RequestsModule),
    forwardRef(() => ChatsModule),
    forwardRef(() => MessagesModule),
    forwardRef(() => SettingsModule),
    forwardRef(() => JobsModule),
    forwardRef(() => PaymentsModule),
    forwardRef(() => UsersModule),
    forwardRef(() => BotModule),
    forwardRef(() => NotificationsModule),
  ],
  providers: [EventsGateway, OperatorGateway, ChatsGateway, WsJwtGuard],
  exports: [EventsGateway, OperatorGateway, ChatsGateway],
})
export class EventsModule {}
