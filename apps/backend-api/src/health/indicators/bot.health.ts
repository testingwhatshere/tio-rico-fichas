import { Injectable, Inject, forwardRef } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { BotService } from '../../bot/bot.service';

@Injectable()
export class BotHealthIndicator extends HealthIndicator {
  constructor(
    @Inject(forwardRef(() => BotService))
    private readonly botService: BotService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const state = this.botService.getBotState();
    const isHealthy = state.status === 'online' || state.status === 'busy';

    const result = this.getStatus(key, isHealthy, {
      status: state.status,
      lastHeartbeat: state.lastHeartbeat?.toISOString() || null,
      version: state.version,
    });

    if (isHealthy) {
      return result;
    }

    throw new HealthCheckError('Bot is not healthy', result);
  }
}
