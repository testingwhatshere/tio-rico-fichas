import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProofValidationService } from './proof-validation.service';
import { RequestsModule } from '../requests/requests.module';
import { UploadsModule } from '../uploads/uploads.module';
import { EventsModule } from '../events/events.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    forwardRef(() => RequestsModule),
    forwardRef(() => EventsModule),
    forwardRef(() => SettingsModule),
    UploadsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, ProofValidationService],
  exports: [PaymentsService, ProofValidationService],
})
export class PaymentsModule {}
