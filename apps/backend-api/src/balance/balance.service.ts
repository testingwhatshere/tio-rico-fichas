import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class BalanceService {
  constructor(private prisma: PrismaService) {}

  async getUserBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    return user ? Number(user.balance) : 0;
  }

  async addBalance(
    userId: string,
    amount: number,
    requestId: string,
    description: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Atomic increment — Postgres handles the arithmetic
      const result = await tx.$queryRaw<{ balance: any }[]>`
        UPDATE "User"
        SET balance = balance + ${amount}::decimal,
            "updatedAt" = NOW()
        WHERE id = ${userId}
        RETURNING balance
      `;

      if (result.length === 0) {
        throw new BadRequestException('User not found');
      }

      const balanceAfter = Number(result[0].balance);
      const balanceBefore = balanceAfter - amount;

      await tx.transaction.create({
        data: {
          userId,
          type: 'DEPOSIT',
          amount: new Decimal(amount),
          balanceBefore: new Decimal(balanceBefore),
          balanceAfter: new Decimal(balanceAfter),
          requestId,
          description,
        },
      });
    });
  }

  async subtractBalance(
    userId: string,
    amount: number,
    withdrawalId: string,
    description: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Atomic decrement with non-negative guard
      const result = await tx.$queryRaw<{ balance: any }[]>`
        UPDATE "User"
        SET balance = balance - ${amount}::decimal,
            "updatedAt" = NOW()
        WHERE id = ${userId}
          AND balance >= ${amount}::decimal
        RETURNING balance
      `;

      if (result.length === 0) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { balance: true },
        });
        if (!user) throw new BadRequestException('User not found');
        throw new BadRequestException('Insufficient balance');
      }

      const balanceAfter = Number(result[0].balance);
      const balanceBefore = balanceAfter + amount;

      await tx.transaction.create({
        data: {
          userId,
          type: 'WITHDRAWAL',
          amount: new Decimal(-amount),
          balanceBefore: new Decimal(balanceBefore),
          balanceAfter: new Decimal(balanceAfter),
          withdrawalId,
          description,
        },
      });
    });
  }

  async getTransactionHistory(userId: string, limit = 50) {
    return this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        request: {
          select: {
            id: true,
            status: true,
            targetUsername: true,
            amount: true,
          },
        },
      },
    });
  }
}
