import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Send push notification to a single user by userId.
   * Silently skips if user has no push token.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { pushToken: true },
      });

      if (!user?.pushToken) return false;

      return this.sendToTokens([user.pushToken], title, body, data);
    } catch (error: any) {
      this.logger.error(`Failed to send push to user ${userId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Send push notification to multiple users by userIds.
   */
  async sendToUsers(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<boolean> {
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds }, pushToken: { not: null } },
        select: { pushToken: true },
      });

      const tokens = users.map((u) => u.pushToken!).filter(Boolean);
      if (tokens.length === 0) return false;

      return this.sendToTokens(tokens, title, body, data);
    } catch (error: any) {
      this.logger.error(`Failed to send push to ${userIds.length} users: ${error.message}`);
      return false;
    }
  }

  /**
   * Send push notification to ALL users with a push token (broadcast).
   * Returns the number of users notified.
   */
  async sendToAll(
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<number> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          pushToken: { not: null },
          role: 'CLIENT',
          isActive: true,
        },
        select: { pushToken: true },
      });

      const tokens = users.map((u) => u.pushToken!).filter(Boolean);
      if (tokens.length === 0) return 0;

      await this.sendToTokens(tokens, title, body, data);
      return tokens.length;
    } catch (error: any) {
      this.logger.error(`Failed to broadcast push: ${error.message}`);
      return 0;
    }
  }

  /**
   * Send push notifications via Expo Push API.
   * Handles batching (Expo limit: 100 per request) and token cleanup.
   */
  private async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<boolean> {
    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      title,
      body,
      data,
      sound: 'default' as const,
      channelId: 'default',
    }));

    // Batch in chunks of 100 (Expo limit)
    const chunks: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    let allSuccess = true;

    for (const chunk of chunks) {
      try {
        const response = await fetch(this.EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(chunk),
        });

        if (!response.ok) {
          this.logger.error(`Expo Push API error: ${response.status} ${response.statusText}`);
          allSuccess = false;
          continue;
        }

        const result = await response.json();
        const tickets: ExpoPushTicket[] = result.data || [];

        // Handle invalid tokens — clean them from the database
        const tokensToRemove: string[] = [];
        tickets.forEach((ticket, index) => {
          if (
            ticket.status === 'error' &&
            ticket.details?.error === 'DeviceNotRegistered'
          ) {
            tokensToRemove.push(chunk[index].to);
          }
        });

        if (tokensToRemove.length > 0) {
          this.logger.warn(`Cleaning ${tokensToRemove.length} invalid push tokens`);
          await this.prisma.user.updateMany({
            where: { pushToken: { in: tokensToRemove } },
            data: { pushToken: null },
          });
        }

        this.logger.debug(`Push sent to ${chunk.length} devices, ${tokensToRemove.length} invalid tokens cleaned`);
      } catch (error: any) {
        this.logger.error(`Failed to send push batch: ${error.message}`);
        allSuccess = false;
      }
    }

    return allSuccess;
  }
}
