import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JobsModule } from '../jobs/jobs.module';
import { UploadsModule } from '../uploads/uploads.module';
import { BotApiKeyGuard } from '../bot/guards/bot-api-key.guard';

@Module({
  imports: [forwardRef(() => JobsModule), ConfigModule, UploadsModule],
  controllers: [DashboardController],
  providers: [DashboardService, BotApiKeyGuard],
  exports: [DashboardService],
})
export class DashboardModule {}
