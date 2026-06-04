import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
