import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MpVerificationService } from './mp-verification.service';
import { MpVerificationController } from './mp-verification.controller';
import { MpVerificationGateway } from './mp-verification.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { RequestsModule } from '../requests/requests.module';
import { PaymentsModule } from '../payments/payments.module';
import { MessagesModule } from '../messages/messages.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LoggingModule } from '../logging/logging.module';
import { BotApiKeyGuard } from '../bot/guards/bot-api-key.guard';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => EventsModule),
    forwardRef(() => RequestsModule),
    forwardRef(() => PaymentsModule),
    MessagesModule,
    forwardRef(() => NotificationsModule),
    LoggingModule,
  ],
  controllers: [MpVerificationController],
  providers: [MpVerificationService, MpVerificationGateway, BotApiKeyGuard],
  exports: [MpVerificationService, MpVerificationGateway],
})
export class MpVerificationModule {}
