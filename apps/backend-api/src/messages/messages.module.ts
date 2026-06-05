import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { EventsModule } from '../events/events.module';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [forwardRef(() => EventsModule), forwardRef(() => ChatsModule)],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
