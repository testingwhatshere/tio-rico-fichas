import { Module, forwardRef } from '@nestjs/common';
import { OutboundPaymentsService } from './outbound-payments.service';
import { OutboundPaymentsController } from './outbound-payments.controller';
import { PaymentBotController, PaymentBotStatusController } from './payment-bot.controller';
import { PaymentBotGateway } from './payment-bot.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => SettingsModule),
  ],
  controllers: [OutboundPaymentsController, PaymentBotController, PaymentBotStatusController],
  providers: [OutboundPaymentsService, PaymentBotGateway],
  exports: [OutboundPaymentsService, PaymentBotGateway],
})
export class OutboundPaymentsModule {}
