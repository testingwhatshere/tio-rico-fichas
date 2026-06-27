import { Module, forwardRef } from '@nestjs/common';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { BotModule } from '../bot/bot.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [forwardRef(() => BotModule), forwardRef(() => JobsModule)],
  controllers: [StatusController],
  providers: [StatusService],
  exports: [StatusService],
})
export class StatusModule {}
