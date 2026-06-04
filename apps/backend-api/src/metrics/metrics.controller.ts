import { Controller, Get } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('api/metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Public()
  getMetrics() {
    return this.metricsService.getMetrics();
  }
}
