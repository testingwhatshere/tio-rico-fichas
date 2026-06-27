import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ValidatorGateway } from './validator.gateway';
import { SettingsService } from '../settings/settings.service';
import { EventsGateway } from '../events/events.gateway';
import {
  VALIDATOR_HEALTH_CHECK_MS,
  VALIDATOR_DISCONNECT_ALERT_MS,
} from '../common/constants/timeouts';

@Injectable()
export class ValidatorHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ValidatorHealthService.name);
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastConnectedTime: Date | null = null;
  private disconnectedAlertSent = false;

  private readonly CHECK_INTERVAL_MS = VALIDATOR_HEALTH_CHECK_MS;
  private readonly DISCONNECT_ALERT_THRESHOLD_MS =
    VALIDATOR_DISCONNECT_ALERT_MS;

  constructor(
    private readonly validatorGateway: ValidatorGateway,
    private readonly settingsService: SettingsService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  onModuleInit() {
    this.startHealthCheck();
    this.logger.log('Validator health monitoring started');
  }

  onModuleDestroy() {
    this.stopHealthCheck();
  }

  private startHealthCheck() {
    this.healthCheckInterval = setInterval(() => {
      this.checkValidatorHealth();
    }, this.CHECK_INTERVAL_MS);

    // Initial check
    this.checkValidatorHealth();
  }

  private stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async checkValidatorHealth() {
    const isConnected = this.validatorGateway.isValidatorConnected();

    if (isConnected) {
      this.lastConnectedTime = new Date();
      this.disconnectedAlertSent = false;
    } else {
      // Check if disconnected for too long
      if (this.lastConnectedTime) {
        const disconnectedDuration =
          Date.now() - this.lastConnectedTime.getTime();

        if (
          disconnectedDuration > this.DISCONNECT_ALERT_THRESHOLD_MS &&
          !this.disconnectedAlertSent
        ) {
          this.sendDisconnectedAlert(disconnectedDuration);
          this.disconnectedAlertSent = true;
        }
      }
    }
  }

  private sendDisconnectedAlert(disconnectedDurationMs: number) {
    const minutes = Math.floor(disconnectedDurationMs / 60000);
    this.logger.warn(
      `Validator disconnected for ${minutes} minutes - alerting operators`,
    );

    // Send alert to all connected operators
    this.eventsGateway.emitSystemAlert({
      type: 'VALIDATOR_DISCONNECTED',
      severity: 'warning',
      title: 'Validador Desconectado',
      message: `El validador ha estado desconectado por ${minutes} minutos. Las validaciones de comprobantes no estan funcionando.`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get current health status
   */
  getHealthStatus(): {
    connected: boolean;
    lastConnected: Date | null;
    disconnectedMinutes: number | null;
  } {
    const isConnected = this.validatorGateway.isValidatorConnected();

    let disconnectedMinutes: number | null = null;
    if (!isConnected && this.lastConnectedTime) {
      disconnectedMinutes = Math.floor(
        (Date.now() - this.lastConnectedTime.getTime()) / 60000,
      );
    }

    return {
      connected: isConnected,
      lastConnected: this.lastConnectedTime,
      disconnectedMinutes,
    };
  }

  /**
   * Manually trigger a health check
   */
  triggerHealthCheck() {
    this.checkValidatorHealth();
    return this.getHealthStatus();
  }
}
