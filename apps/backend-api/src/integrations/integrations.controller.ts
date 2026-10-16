import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { IntegrationKeyGuard } from './integration-key.guard';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationActionDto, PayoutDto } from './dto';

/**
 * Entrada de TioRicoCargas (servicio a servicio, sin JWT): acciones sobre el
 * panel pedidas desde el chat del equipo. El resultado vuelve por webhook; el
 * GET sirve de respaldo si el webhook no llegó.
 */
@Controller('integrations/tiorico-cargas')
@Public()
@UseGuards(IntegrationKeyGuard)
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Post('actions')
  @HttpCode(HttpStatus.OK)
  submit(@Body() dto: CreateIntegrationActionDto) {
    return this.service.submit(dto);
  }

  /** Premio retirado: el operador registra el pago con el comprobante. */
  @Post('actions/:externalId/payout')
  @HttpCode(HttpStatus.OK)
  payout(@Param('externalId') externalId: string, @Body() dto: PayoutDto) {
    return this.service.payout(externalId, dto.proofs);
  }

  @Get('actions/:externalId')
  get(@Param('externalId') externalId: string) {
    return this.service.get(externalId);
  }
}
