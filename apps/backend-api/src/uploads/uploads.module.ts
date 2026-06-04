import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FILE_SIZE_LIMIT_BYTES } from '../common/constants/timeouts';

@Module({
  imports: [
    PrismaModule,
    // Multer still needed for server-side uploads (bot screenshots, operator chat images)
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: FILE_SIZE_LIMIT_BYTES,
      },
    }),
  ],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
