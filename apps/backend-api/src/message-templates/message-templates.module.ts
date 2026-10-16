import { Global, Module } from '@nestjs/common';
import { MessageTemplatesService } from './message-templates.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Global: lo consumen requests, prize-claims y el gateway de operadores, y es
 * un servicio sin estado propio más allá del cache.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [MessageTemplatesService],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
