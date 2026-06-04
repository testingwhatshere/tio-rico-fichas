import { Module, forwardRef } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { UploadsModule } from '../uploads/uploads.module';
import { PaymentsModule } from '../payments/payments.module';
import { EventsModule } from '../events/events.module';
import { SettingsModule } from '../settings/settings.module';
import { MessagesModule } from '../messages/messages.module';
import { JobsModule } from '../jobs/jobs.module';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [
    UploadsModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => EventsModule),
    SettingsModule,
    forwardRef(() => MessagesModule),
    forwardRef(() => JobsModule),
    forwardRef(() => ChatsModule),
  ],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
