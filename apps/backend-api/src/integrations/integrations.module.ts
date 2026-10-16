import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationKeyGuard } from './integration-key.guard';

/**
 * Integración con TioRicoCargas. Usa RequestsService / UsersService /
 * JobsService / SettingsService por ModuleRef (sin importar sus módulos, que
 * tienen dependencias circulares entre sí).
 */
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationKeyGuard],
})
export class IntegrationsModule {}
