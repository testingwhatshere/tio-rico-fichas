import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
