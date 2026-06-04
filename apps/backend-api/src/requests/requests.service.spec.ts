import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventsGateway } from '../events/events.gateway';
import { OperatorGateway } from '../events/operator.gateway';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { MessagesService } from '../messages/messages.service';
import { ChatsService } from '../chats/chats.service';

describe('RequestsService', () => {
  let service: RequestsService;

  // Prisma mock with nested model methods
  let prisma: {
    user: { findUnique: jest.Mock };
    request: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    requestStatusHistory: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  let eventEmitter: { emit: jest.Mock };
  let eventsGateway: {
    emitRequestCreated: jest.Mock;
    emitRequestUpdated: jest.Mock;
    emitRequestRejected: jest.Mock;
    emitDashboardUpdate: jest.Mock;
    emitToOperators: jest.Mock;
  };
  let operatorGateway: { emitToAll: jest.Mock };
  let paymentsService: {
    getSelectedWallet: jest.Mock;
    accumulateAndCheckRotation: jest.Mock;
    getWalletById: jest.Mock;
    decrementWalletAmount: jest.Mock;
  };
  let settingsService: {
    checkUserRateLimit: jest.Mock;
    getSetting: jest.Mock;
  };
  let jobsService: { createJobForRequest: jest.Mock };
  let messagesService: { sendSystemMessage: jest.Mock };
  let chatsService: { getOrCreateChat: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      request: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      requestStatusHistory: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      // $transaction executes the callback with `prisma` itself as the tx client
      $transaction: jest.fn().mockImplementation(async (fn, _opts?) => {
        if (typeof fn === 'function') {
          return fn(prisma);
        }
        return fn;
      }),
    };

    eventEmitter = { emit: jest.fn() };
    eventsGateway = {
      emitRequestCreated: jest.fn(),
      emitRequestUpdated: jest.fn(),
      emitRequestRejected: jest.fn(),
      emitDashboardUpdate: jest.fn(),
      emitToOperators: jest.fn(),
    };
    operatorGateway = { emitToAll: jest.fn() };
    paymentsService = {
      getSelectedWallet: jest.fn(),
      accumulateAndCheckRotation: jest.fn(),
      getWalletById: jest.fn(),
      decrementWalletAmount: jest.fn(),
    };
    settingsService = {
      checkUserRateLimit: jest.fn(),
      getSetting: jest.fn(),
    };
    jobsService = { createJobForRequest: jest.fn() };
    messagesService = { sendSystemMessage: jest.fn().mockResolvedValue({}) };
    chatsService = { getOrCreateChat: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: EventsGateway, useValue: eventsGateway },
        { provide: OperatorGateway, useValue: operatorGateway },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: SettingsService, useValue: settingsService },
        { provide: JobsService, useValue: jobsService },
        { provide: MessagesService, useValue: messagesService },
        { provide: ChatsService, useValue: chatsService },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
  });

  // ==============================
  // create()
  // ==============================
  describe('create', () => {
    const userId = 'user-1';
    const dto = { amount: 500 };

    function setupCreateHappyPath() {
      prisma.user.findUnique.mockResolvedValue({ username: 'player1', isActive: true });
      prisma.request.count.mockResolvedValue(0);
      settingsService.checkUserRateLimit.mockResolvedValue({ allowed: true });
      settingsService.getSetting.mockResolvedValue('10000');
      paymentsService.getSelectedWallet.mockResolvedValue({ id: 'wallet-1', alias: 'main' });

      const createdRequest = {
        id: 'req-1',
        userId,
        targetUsername: 'player1',
        amount: 500,
        status: 'PENDING_PROOF',
        user: { id: userId, username: 'player1', email: 'a@b.com' },
      };
      prisma.request.create.mockResolvedValue(createdRequest);
      prisma.requestStatusHistory.create.mockResolvedValue({});
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });

      return createdRequest;
    }

    it('should create a request successfully', async () => {
      const createdRequest = setupCreateHappyPath();

      const result = await service.create(userId, dto);

      expect(result).toEqual({ ...createdRequest, chat: { id: 'chat-1' } });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: { username: true, isActive: true },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(eventsGateway.emitRequestCreated).toHaveBeenCalledWith(userId, expect.objectContaining({
        requestId: 'req-1',
        status: 'PENDING_PROOF',
      }));
      expect(eventsGateway.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should throw BadRequestException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.create(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user has no username', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: null, isActive: true });

      await expect(service.create(userId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if user is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: 'player1', isActive: false });

      await expect(service.create(userId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if user already has a pending request', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: 'player1', isActive: true });
      prisma.request.count.mockResolvedValue(1);

      await expect(service.create(userId, dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(userId, dto)).rejects.toThrow(
        'Ya tenés una carga en proceso',
      );
    });

    it('should throw BadRequestException if rate limit exceeded', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: 'player1', isActive: true });
      prisma.request.count.mockResolvedValue(0);
      settingsService.checkUserRateLimit.mockResolvedValue({
        allowed: false,
        resetAt: new Date(Date.now() + 600000),
      });

      await expect(service.create(userId, dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(userId, dto)).rejects.toThrow('Límite de solicitudes excedido');
    });

    it('should throw BadRequestException if amount is zero or negative', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: 'player1', isActive: true });
      prisma.request.count.mockResolvedValue(0);
      settingsService.checkUserRateLimit.mockResolvedValue({ allowed: true });

      await expect(service.create(userId, { amount: 0 })).rejects.toThrow(BadRequestException);
      await expect(service.create(userId, { amount: -10 })).rejects.toThrow(
        'El monto debe ser mayor a 0',
      );
    });

    // MAX_REQUEST_AMOUNT limit removed — no amount cap

    it('should throw BadRequestException if no wallet is selected', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: 'player1', isActive: true });
      prisma.request.count.mockResolvedValue(0);
      settingsService.checkUserRateLimit.mockResolvedValue({ allowed: true });
      settingsService.getSetting.mockResolvedValue('10000');
      paymentsService.getSelectedWallet.mockResolvedValue(null);

      await expect(service.create(userId, dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(userId, dto)).rejects.toThrow('No hay billetera configurada');
    });
  });

  // ==============================
  // approve()
  // ==============================
  describe('approve', () => {
    const requestId = 'req-1';
    const operatorId = 'op-1';

    it('should approve a VALIDATION_FAILED request', async () => {
      const existingRequest = {
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATION_FAILED',
        walletId: 'wallet-1',
      };
      const updatedRequest = {
        ...existingRequest,
        status: 'APPROVED',
        manuallyApproved: true,
        approvedById: operatorId,
      };

      prisma.request.findUnique.mockResolvedValue(existingRequest);
      prisma.request.update.mockResolvedValue(updatedRequest);
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null); // no push token
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      jobsService.createJobForRequest.mockResolvedValue({});
      prisma.requestStatusHistory.findFirst.mockResolvedValue(null);
      paymentsService.accumulateAndCheckRotation.mockResolvedValue({ rotated: false, allFull: false });
      paymentsService.getWalletById.mockResolvedValue({ id: 'wallet-1' });

      const result = await service.approve(requestId, operatorId);

      expect(result.status).toBe('APPROVED');
      expect(result.manuallyApproved).toBe(true);
      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: requestId },
          data: expect.objectContaining({
            status: 'APPROVED',
            manuallyApproved: true,
            approvedById: operatorId,
          }),
        }),
      );
      expect(eventsGateway.emitRequestUpdated).toHaveBeenCalled();
      expect(jobsService.createJobForRequest).toHaveBeenCalledWith(requestId);
    });

    it('should approve a VALIDATING request', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATING',
        walletId: null,
      });
      prisma.request.update.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'APPROVED',
        walletId: null,
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      jobsService.createJobForRequest.mockResolvedValue({});

      const result = await service.approve(requestId, operatorId);

      expect(result.status).toBe('APPROVED');
    });

    it('should throw BadRequestException for invalid status', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        status: 'COMPLETED',
        amount: '500',
      });

      await expect(service.approve(requestId, operatorId)).rejects.toThrow(BadRequestException);
      await expect(service.approve(requestId, operatorId)).rejects.toThrow(
        'Esta solicitud no puede ser aprobada',
      );
    });

    it('should throw NotFoundException if request does not exist', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      await expect(service.approve(requestId, operatorId)).rejects.toThrow(NotFoundException);
    });

    it('should update amount when approvedAmount is provided', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATION_FAILED',
        walletId: null,
      });
      prisma.request.update.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: 700,
        status: 'APPROVED',
        walletId: null,
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      jobsService.createJobForRequest.mockResolvedValue({});
      settingsService.getSetting.mockResolvedValue('10000');

      await service.approve(requestId, operatorId, { approvedAmount: 700 });

      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 700,
          }),
        }),
      );
    });

    it('should throw BadRequestException if approvedAmount exceeds max', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATION_FAILED',
        walletId: null,
      });
      settingsService.getSetting.mockResolvedValue('1000');

      await expect(
        service.approve(requestId, operatorId, { approvedAmount: 2000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not fail approval if job creation fails', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATION_FAILED',
        walletId: null,
      });
      prisma.request.update.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'APPROVED',
        walletId: null,
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      jobsService.createJobForRequest.mockRejectedValue(new Error('Queue full'));

      // Should not throw despite job creation failure
      const result = await service.approve(requestId, operatorId);
      expect(result.status).toBe('APPROVED');
    });
  });

  // ==============================
  // reject()
  // ==============================
  describe('reject', () => {
    const requestId = 'req-1';
    const operatorId = 'op-1';
    const dto = { reason: 'Comprobante inválido' };

    it('should reject a VALIDATION_FAILED request', async () => {
      const existingRequest = {
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATION_FAILED',
        walletId: null,
      };
      const updatedRequest = {
        ...existingRequest,
        status: 'REJECTED',
        rejectionReason: dto.reason,
        _wasApproved: false,
        _walletId: null,
        _amount: 500,
      };

      prisma.request.findUnique.mockResolvedValue(existingRequest);
      prisma.request.update.mockResolvedValue(updatedRequest);
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });

      const result = await service.reject(requestId, operatorId, dto);

      expect(result.status).toBe('REJECTED');
      expect(eventsGateway.emitRequestUpdated).toHaveBeenCalledWith('user-1', expect.objectContaining({
        requestId,
        status: 'REJECTED',
        reason: dto.reason,
      }));
      expect(eventsGateway.emitRequestRejected).toHaveBeenCalledWith('user-1', expect.objectContaining({
        requestId,
        status: 'REJECTED',
        reason: dto.reason,
      }));
      expect(eventsGateway.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should reject a VALIDATING request', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATING',
        walletId: null,
      });
      prisma.request.update.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        status: 'REJECTED',
        _wasApproved: false,
        _walletId: null,
        _amount: 500,
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });

      const result = await service.reject(requestId, operatorId, dto);
      expect(result.status).toBe('REJECTED');
    });

    it('should reject an APPROVED request and decrement wallet', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'APPROVED',
        walletId: 'wallet-1',
      });
      const updatedRequest = {
        id: requestId,
        userId: 'user-1',
        status: 'REJECTED',
        _wasApproved: true,
        _walletId: 'wallet-1',
        _amount: 500,
      };
      prisma.request.update.mockResolvedValue(updatedRequest);
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      paymentsService.decrementWalletAmount.mockResolvedValue({});
      paymentsService.getWalletById.mockResolvedValue({ id: 'wallet-1' });

      await service.reject(requestId, operatorId, dto);

      expect(paymentsService.decrementWalletAmount).toHaveBeenCalledWith('wallet-1', 500);
      expect(operatorGateway.emitToAll).toHaveBeenCalledWith('wallet_updated', { id: 'wallet-1' });
    });

    it('should throw BadRequestException for invalid status', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        status: 'COMPLETED',
        amount: '500',
      });

      await expect(service.reject(requestId, operatorId, dto)).rejects.toThrow(BadRequestException);
      await expect(service.reject(requestId, operatorId, dto)).rejects.toThrow(
        'Esta solicitud ya fue procesada',
      );
    });

    it('should throw NotFoundException if request does not exist', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      await expect(service.reject(requestId, operatorId, dto)).rejects.toThrow(NotFoundException);
    });
  });

  // ==============================
  // setValidationResult()
  // ==============================
  describe('setValidationResult', () => {
    const requestId = 'req-1';

    it('should auto-approve when validation is valid', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATING',
        walletId: 'wallet-1',
      });
      const updatedRequest = {
        id: requestId,
        userId: 'user-1',
        status: 'APPROVED',
        validationScore: 0.95,
      };
      prisma.request.update.mockResolvedValue(updatedRequest);
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      prisma.requestStatusHistory.findFirst.mockResolvedValue(null);
      paymentsService.accumulateAndCheckRotation.mockResolvedValue({ rotated: false, allFull: false });
      paymentsService.getWalletById.mockResolvedValue({ id: 'wallet-1' });

      const result = await service.setValidationResult(requestId, {
        valid: true,
        score: 0.95,
      });

      expect(result.status).toBe('APPROVED');
      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'APPROVED',
            validationScore: 0.95,
          }),
        }),
      );
      expect(eventsGateway.emitRequestUpdated).toHaveBeenCalledWith('user-1', expect.objectContaining({
        status: 'APPROVED',
        validationScore: 0.95,
      }));
    });

    it('should set VALIDATION_FAILED when validation is invalid', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATING',
        walletId: null,
      });
      const updatedRequest = {
        id: requestId,
        userId: 'user-1',
        status: 'VALIDATION_FAILED',
        validationScore: 0.3,
        validationError: 'Amount mismatch',
      };
      prisma.request.update.mockResolvedValue(updatedRequest);
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });

      const result = await service.setValidationResult(requestId, {
        valid: false,
        score: 0.3,
        error: 'Amount mismatch',
      });

      expect(result.status).toBe('VALIDATION_FAILED');
      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'VALIDATION_FAILED',
            validationScore: 0.3,
            validationError: 'Amount mismatch',
          }),
        }),
      );
    });

    it('should skip if request is not in VALIDATING status (idempotent)', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        status: 'APPROVED',
      });

      const result = await service.setValidationResult(requestId, {
        valid: true,
        score: 0.9,
      });

      // Returns existing request without updating
      expect(result.status).toBe('APPROVED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.request.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if request does not exist', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      await expect(
        service.setValidationResult(requestId, { valid: true, score: 0.9 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not accumulate wallet when validation fails', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATING',
        walletId: 'wallet-1',
      });
      prisma.request.update.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        status: 'VALIDATION_FAILED',
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });

      await service.setValidationResult(requestId, {
        valid: false,
        score: 0.2,
        error: 'Fake proof',
      });

      expect(paymentsService.accumulateAndCheckRotation).not.toHaveBeenCalled();
    });
  });

  // ==============================
  // findActiveForUser()
  // ==============================
  describe('findActiveForUser', () => {
    it('should return active request when one exists', async () => {
      const activeRequest = {
        id: 'req-1',
        userId: 'user-1',
        status: 'VALIDATING',
        chat: { id: 'chat-1' },
      };
      prisma.request.findFirst.mockResolvedValue(activeRequest);

      const result = await service.findActiveForUser('user-1');

      expect(result).toEqual(activeRequest);
      expect(prisma.request.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: {
            in: ['PENDING_PROOF', 'VALIDATING', 'APPROVED', 'PROCESSING'],
          },
        },
        include: {
          chat: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return null when no active request exists', async () => {
      prisma.request.findFirst.mockResolvedValue(null);

      const result = await service.findActiveForUser('user-1');

      expect(result).toBeNull();
    });
  });

  // ==============================
  // findOne()
  // ==============================
  describe('findOne', () => {
    it('should return a request by id', async () => {
      const request = {
        id: 'req-1',
        userId: 'user-1',
        user: { id: 'user-1', email: 'a@b.com' },
        job: null,
        chat: null,
      };
      prisma.request.findUnique.mockResolvedValue(request);

      const result = await service.findOne('req-1');

      expect(result).toEqual(request);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if userId does not match', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        user: { id: 'user-1', email: 'a@b.com' },
        job: null,
        chat: null,
      });

      await expect(service.findOne('req-1', 'other-user')).rejects.toThrow(ForbiddenException);
    });
  });
});
