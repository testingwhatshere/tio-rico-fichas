import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BalanceService', () => {
  let service: BalanceService;
  let prisma: {
    user: { findUnique: jest.Mock };
    transaction: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      transaction: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BalanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
  });

  describe('getUserBalance', () => {
    it('should return user balance as number', async () => {
      prisma.user.findUnique.mockResolvedValue({ balance: '5000.00' });

      const result = await service.getUserBalance('user-1');

      expect(result).toBe(5000);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { balance: true },
      });
    });

    it('should return 0 if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getUserBalance('nonexistent');

      expect(result).toBe(0);
    });
  });

  describe('addBalance', () => {
    it('should atomically add balance and create transaction record', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([{ balance: '6000' }]),
        transaction: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await service.addBalance('user-1', 1000, 'req-1', 'Credit load');

      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(mockTx.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          type: 'DEPOSIT',
          requestId: 'req-1',
          description: 'Credit load',
        }),
      });
    });

    it('should throw BadRequestException if user not found', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        transaction: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await expect(
        service.addBalance('nonexistent', 1000, 'req-1', 'Test'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate balanceBefore correctly', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([{ balance: '3500' }]),
        transaction: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await service.addBalance('user-1', 500, 'req-1', 'Test');

      const createCall = mockTx.transaction.create.mock.calls[0][0];
      // balanceBefore = balanceAfter - amount = 3500 - 500 = 3000
      expect(Number(createCall.data.balanceBefore)).toBe(3000);
      expect(Number(createCall.data.balanceAfter)).toBe(3500);
    });
  });

  describe('subtractBalance', () => {
    it('should atomically subtract balance and create transaction record', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([{ balance: '4000' }]),
        transaction: { create: jest.fn().mockResolvedValue({}) },
        user: { findUnique: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await service.subtractBalance('user-1', 1000, 'wd-1', 'Withdrawal');

      expect(mockTx.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          type: 'WITHDRAWAL',
          withdrawalId: 'wd-1',
          description: 'Withdrawal',
        }),
      });
    });

    it('should throw BadRequestException on insufficient balance', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        transaction: { create: jest.fn() },
        user: { findUnique: jest.fn().mockResolvedValue({ balance: '100' }) },
      };
      prisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await expect(
        service.subtractBalance('user-1', 5000, 'wd-1', 'Test'),
      ).rejects.toThrow('Insufficient balance');
    });

    it('should throw BadRequestException if user not found on insufficient balance path', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        transaction: { create: jest.fn() },
        user: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      prisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await expect(
        service.subtractBalance('nonexistent', 100, 'wd-1', 'Test'),
      ).rejects.toThrow('User not found');
    });

    it('should store negative amount for withdrawal transactions', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([{ balance: '2000' }]),
        transaction: { create: jest.fn().mockResolvedValue({}) },
        user: { findUnique: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await service.subtractBalance('user-1', 500, 'wd-1', 'Test');

      const createCall = mockTx.transaction.create.mock.calls[0][0];
      expect(Number(createCall.data.amount)).toBe(-500);
      // balanceBefore = balanceAfter + amount = 2000 + 500 = 2500
      expect(Number(createCall.data.balanceBefore)).toBe(2500);
      expect(Number(createCall.data.balanceAfter)).toBe(2000);
    });
  });

  describe('getTransactionHistory', () => {
    it('should return transactions ordered by createdAt desc', async () => {
      const mockTransactions = [
        { id: 't-1', type: 'DEPOSIT', amount: 1000 },
        { id: 't-2', type: 'WITHDRAWAL', amount: -500 },
      ];
      prisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const result = await service.getTransactionHistory('user-1');

      expect(result).toEqual(mockTransactions);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
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
    });

    it('should respect custom limit', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);

      await service.getTransactionHistory('user-1', 10);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });
});
