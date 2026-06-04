import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotController } from './telegram-bot.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RequestsModule } from '../requests/requests.module';
import { PaymentsModule } from '../payments/payments.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PrizeClaimsModule } from '../prize-claims/prize-claims.module';
import { ChatsModule } from '../chats/chats.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => RequestsModule),
    forwardRef(() => PaymentsModule),
    forwardRef(() => UploadsModule),
    forwardRef(() => PrizeClaimsModule),
    forwardRef(() => ChatsModule),
    forwardRef(() => MessagesModule),
  ],
  controllers: [TelegramBotController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
