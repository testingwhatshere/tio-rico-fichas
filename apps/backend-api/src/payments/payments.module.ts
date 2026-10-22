import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProofValidationService } from './proof-validation.service';
import { PayoutFingerprintService } from './payout-fingerprint.service';
import { RequestsModule } from '../requests/requests.module';
import { UploadsModule } from '../uploads/uploads.module';
import { EventsModule } from '../events/events.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    forwardRef(() => RequestsModule),
    forwardRef(() => EventsModule),
    forwardRef(() => SettingsModule),
    UploadsModule,
    NotificationsModule,
    // Para leer (sin exigir) el token en GET /payments/wallet y saber a que
    // panel pertenece quien pregunta. Mismo secreto que AuthModule.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, ProofValidationService, PayoutFingerprintService],
  exports: [PaymentsService, ProofValidationService, PayoutFingerprintService],
})
export class PaymentsModule {}
