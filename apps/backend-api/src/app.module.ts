import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { BotModule } from './bot/bot.module';
// New modules
import { EventsModule } from './events/events.module';
import { UploadsModule } from './uploads/uploads.module';
import { RequestsModule } from './requests/requests.module';
import { JobsModule } from './jobs/jobs.module';
import { PaymentsModule } from './payments/payments.module';
import { ChatsModule } from './chats/chats.module';
import { MessagesModule } from './messages/messages.module';
import { OperatorsModule } from './operators/operators.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StatusModule } from './status/status.module';
import { LoggingModule } from './logging/logging.module';
import { ValidatorModule } from './validator/validator.module';
import { BalanceModule } from './balance/balance.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { MetricsModule } from './metrics/metrics.module';
import { PanelsModule } from './panels/panels.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { PrizeClaimsModule } from './prize-claims/prize-claims.module';
import { MpVerificationModule } from './mp-verification/mp-verification.module';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { OutboundPaymentsModule } from './outbound-payments/outbound-payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public', 'dashboard'),
      serveRoot: '/dashboard',
      serveStaticOptions: { index: ['index.html'] },
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    HealthModule,
    BotModule,
    // Real-time & Infrastructure
    EventsModule,
    UploadsModule,
    // Core Business Logic
    RequestsModule,
    JobsModule,
    PaymentsModule,
    BalanceModule,
    WithdrawalsModule,
    // Chat System
    ChatsModule,
    MessagesModule,
    // Operator Management
    OperatorsModule,
    DashboardModule,
    // System Management
    AuditModule,
    SettingsModule,
    NotificationsModule,
    StatusModule,
    LoggingModule,
    ValidatorModule,
    MetricsModule,
    PanelsModule,
    DiscoveryModule,
    PrizeClaimsModule,
    MpVerificationModule,
    TelegramBotModule,
    OutboundPaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
