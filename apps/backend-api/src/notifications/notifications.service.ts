import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { MessagesService } from '../messages/messages.service';
import { PushService } from './push.service';
import {
  SendNotificationDto,
  BroadcastNotificationDto,
  NotificationType,
  NotificationPriority,
} from './dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    private readonly pushService: PushService,
  ) {}

  /**
   * Send notification to a specific user (WebSocket + Push)
   */
  async sendToUser(dto: SendNotificationDto): Promise<void> {
    // Real-time via WebSocket (for online users)
    this.eventsGateway.emitToUser(dto.userId, 'notification', {
      type: dto.type,
      title: dto.title,
      message: dto.message,
      priority: dto.priority,
      data: dto.data,
      timestamp: new Date(),
    });

    // Push notification (for offline users — Expo handles dedup if app is foreground)
    this.pushService.sendToUser(
      dto.userId,
      dto.title,
      dto.message,
      dto.data,
    ).catch((err) => this.logger.warn(`Push failed for user ${dto.userId}: ${err.message}`));

    this.logger.log(`Notification sent to user ${dto.userId}: ${dto.title}`);
  }

  /**
   * Send notification to all operators
   */
  async sendToOperators(dto: BroadcastNotificationDto): Promise<void> {
    this.eventsGateway.emitToOperators('notification', {
      title: dto.title,
      message: dto.message,
      priority: dto.priority,
      data: dto.data,
      timestamp: new Date(),
    });

    this.logger.log(`Notification sent to operators: ${dto.title}`);
  }

  /**
   * Broadcast to all connected clients (WebSocket only)
   */
  async broadcast(dto: BroadcastNotificationDto): Promise<void> {
    this.eventsGateway.emitToAll('notification', {
      title: dto.title,
      message: dto.message,
      priority: dto.priority,
      data: dto.data,
      timestamp: new Date(),
    });

    this.logger.log(`Broadcast notification: ${dto.title}`);
  }

  /**
   * Broadcast promo to all users (WebSocket + Push).
   * Returns the number of push recipients.
   */
  async broadcastPromo(title: string, message: string, data?: Record<string, any>): Promise<number> {
    // WebSocket to online users
    this.eventsGateway.emitToAll('promo', {
      title,
      message,
      data,
      timestamp: new Date().toISOString(),
    });

    // Push to all users (including offline)
    const count = await this.pushService.sendToAll(title, message, { type: 'PROMO', ...data });
    this.logger.log(`Promo broadcast: "${title}" sent to ${count} users via push`);
    return count;
  }

  // ==========================================
  // CONVENIENCE METHODS FOR COMMON NOTIFICATIONS
  // ==========================================

  /**
   * Notify user about request status change
   */
  async notifyRequestStatus(
    userId: string,
    requestId: string,
    status: string,
    details?: Record<string, any>,
  ): Promise<void> {
    const messages: Record<string, { type: NotificationType; title: string; message: string }> = {
      VALIDATING: {
        type: NotificationType.REQUEST_CREATED,
        title: 'Comprobante recibido',
        message: 'Estamos validando tu comprobante de pago...',
      },
      VALIDATION_FAILED: {
        type: NotificationType.VALIDATION_FAILED,
        title: 'Validación fallida',
        message: 'No pudimos validar tu comprobante. Un operador lo revisará.',
      },
      APPROVED: {
        type: NotificationType.REQUEST_APPROVED,
        title: 'Solicitud aprobada',
        message: 'Tu solicitud fue aprobada y está en cola para procesar.',
      },
      PROCESSING: {
        type: NotificationType.JOB_STARTED,
        title: 'Procesando',
        message: 'Estamos cargando los créditos en tu cuenta...',
      },
      COMPLETED: {
        type: NotificationType.REQUEST_COMPLETED,
        title: 'Completado',
        message: '¡Créditos cargados exitosamente!',
      },
      FAILED: {
        type: NotificationType.REQUEST_FAILED,
        title: 'Error',
        message: 'Hubo un error al procesar tu solicitud. Un operador te contactará.',
      },
      REJECTED: {
        type: NotificationType.REQUEST_REJECTED,
        title: 'Solicitud rechazada',
        message: 'Tu solicitud fue rechazada. Revisa los detalles en el chat.',
      },
      CANCELLED: {
        type: NotificationType.REQUEST_CANCELLED,
        title: 'Solicitud cancelada',
        message: 'Tu solicitud ha sido cancelada.',
      },
    };

    const notification = messages[status];
    if (notification) {
      await this.sendToUser({
        userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority:
          status === 'FAILED' || status === 'REJECTED'
            ? NotificationPriority.HIGH
            : NotificationPriority.MEDIUM,
        data: { requestId, status, ...details },
      });
    }
  }

  /**
   * Notify operators about new failure requiring attention
   */
  async notifyOperatorsFailure(
    type: 'validation' | 'job',
    id: string,
    details: Record<string, any>,
  ): Promise<void> {
    const title =
      type === 'validation' ? 'Validación fallida' : 'Job fallido';
    const message =
      type === 'validation'
        ? 'Un comprobante requiere revisión manual'
        : 'Un job de carga falló y requiere atención';

    await this.sendToOperators({
      title,
      message,
      priority: NotificationPriority.HIGH,
      data: { type, id, ...details },
    });
  }

  /**
   * Send system alert to all operators
   */
  async sendSystemAlert(
    title: string,
    message: string,
    priority: NotificationPriority = NotificationPriority.URGENT,
    data?: Record<string, any>,
  ): Promise<void> {
    await this.sendToOperators({
      title: `⚠️ ${title}`,
      message,
      priority,
      data: { ...data, isSystemAlert: true },
    });

    this.logger.warn(`System alert: ${title} - ${message}`);
  }

  /**
   * Send chat message as system notification
   */
  async sendChatSystemMessage(
    chatId: string,
    content: string,
  ): Promise<void> {
    await this.messagesService.sendSystemMessage(chatId, content);
  }
}
