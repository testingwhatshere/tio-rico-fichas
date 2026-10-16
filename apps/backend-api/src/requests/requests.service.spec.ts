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
import { PushService } from '../notifications/push.service';
import { MessageTemplatesService } from '../message-templates/message-templates.service';

describe('RequestsService', () => {
  let service: RequestsService;

  // Prisma mock with nested model methods
  let prisma: {
    user: { findUnique: jest.Mock };
    paymentConfig: { findUnique: jest.Mock };
    request: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    requestStatusHistory: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
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
    getSystemSettings: jest.Mock;
  };
  let jobsService: { createJobForRequest: jest.Mock };
  let messagesService: { sendSystemMessage: jest.Mock };
  let chatsService: { getOrCreateChat: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      paymentConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ requiresVerification: false }),
      },
      request: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn(),
      },
      requestStatusHistory: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      // fetchValidationSummaries: sin filas = sin resumen
      $queryRaw: jest.fn().mockResolvedValue([]),
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
      getSystemSettings: jest
        .fn()
        .mockResolvedValue({ maxRequestAmount: 1_000_000 }),
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
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MessageTemplatesService,
          useValue: {
            pick: jest.fn().mockReturnValue('mensaje de prueba'),
            compose: jest.fn().mockReturnValue('mensaje de prueba'),
          },
        },
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

    /** Sin fantasmas que caducar y sin carga activa: el camino libre. */
    function setupNoActiveLoad() {
      prisma.request.findMany.mockResolvedValue([]); // expireStalePendingProofs
      prisma.request.findFirst.mockResolvedValue(null); // chequeo de carga activa
      prisma.request.count.mockResolvedValue(0);
    }

    function setupCreateHappyPath() {
      prisma.user.findUnique.mockResolvedValue({
        username: 'player1',
        isActive: true,
      });
      setupNoActiveLoad();
      settingsService.checkUserRateLimit.mockResolvedValue({ allowed: true });
      settingsService.getSetting.mockResolvedValue('10000');
      paymentsService.getSelectedWallet.mockResolvedValue({
        id: 'wallet-1',
        alias: 'main',
      });

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
        select: {
          username: true,
          savedTargetUsername: true,
          isActive: true,
          panelId: true,
        },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(eventsGateway.emitRequestCreated).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          requestId: 'req-1',
          status: 'PENDING_PROOF',
        }),
      );
      expect(eventsGateway.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should use savedTargetUsername as the panel target when set (alias)', async () => {
      setupCreateHappyPath();
      // App username is "ludmila1212" but the panel account was re-mapped by an
      // operator to "ludmila" (original was taken on the casino's global namespace).
      prisma.user.findUnique.mockResolvedValue({
        username: 'ludmila1212',
        savedTargetUsername: 'ludmila',
        isActive: true,
        panelId: null,
      });

      await service.create(userId, dto);

      expect(prisma.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ targetUsername: 'ludmila' }),
        }),
      );
    });

    it('should throw BadRequestException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.create(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if user has no username', async () => {
      prisma.user.findUnique.mockResolvedValue({
        username: null,
        isActive: true,
      });

      await expect(service.create(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException if user is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({
        username: 'player1',
        isActive: false,
      });

      await expect(service.create(userId, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if user already has a pending request', async () => {
      prisma.user.findUnique.mockResolvedValue({
        username: 'player1',
        isActive: true,
      });
      prisma.request.findMany.mockResolvedValue([]);
      prisma.request.findFirst.mockResolvedValue({
        amount: 8300,
        status: 'VALIDATING',
        proofUrl: 'https://cdn/proof.jpg',
      });

      await expect(service.create(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(userId, dto)).rejects.toThrow(
        'Ya tenés una carga de $8.300 en proceso',
      );
    });

    it('le dice qué hacer cuando la carga viva está esperando el comprobante', async () => {
      // "Esperá a que se complete" es un consejo inútil acá: la carga no avanza
      // sola, avanza cuando él sube el comprobante o la cancela. Sin esto el
      // usuario reintenta en loop (gina3, 2026-09-04: 4 intentos en 7 minutos).
      prisma.user.findUnique.mockResolvedValue({
        username: 'player1',
        isActive: true,
      });
      prisma.request.findMany.mockResolvedValue([]);
      prisma.request.findFirst.mockResolvedValue({
        amount: 8300,
        status: 'PENDING_PROOF',
        proofUrl: null,
      });

      await expect(service.create(userId, dto)).rejects.toThrow(
        'Ya tenés una carga de $8.300 esperando el comprobante. Subilo en el chat, o tocá CANCELAR SOLICITUD para pedir otra.',
      );
    });

    it('caduca la carga sin comprobante que quedó colgada y deja crear la nueva', async () => {
      const createdRequest = setupCreateHappyPath();
      const stale = {
        id: 'req-fantasma',
        userId,
        targetUsername: 'player1',
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      };
      // Primera llamada: el barrido la encuentra. Después ya no hay nada activo.
      prisma.request.findMany.mockResolvedValueOnce([stale]);

      const result = await service.create(userId, dto);

      expect(result).toEqual({ ...createdRequest, chat: { id: 'chat-1' } });
      expect(prisma.request.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'req-fantasma',
          status: 'PENDING_PROOF',
          proofUrl: null,
        },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
      expect(prisma.requestStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestId: 'req-fantasma',
            status: 'CANCELLED',
            metadata: expect.objectContaining({ autoExpired: true }),
          }),
        }),
      );
      expect(eventsGateway.emitRequestUpdated).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          requestId: 'req-fantasma',
          status: 'CANCELLED',
        }),
      );
    });

    it('el barrido sólo mira las que no tienen comprobante y ya pasaron el TTL', async () => {
      // Una carga CON comprobante está en manos del validador o de un operador:
      // no es un fantasma y cancelarla perdería una carga real.
      setupCreateHappyPath();

      await service.create(userId, dto);

      expect(prisma.request.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId,
            status: 'PENDING_PROOF',
            proofUrl: null,
            createdAt: { lt: expect.any(Date) },
          }),
        }),
      );
    });

    it('should throw BadRequestException if rate limit exceeded', async () => {
      prisma.user.findUnique.mockResolvedValue({
        username: 'player1',
        isActive: true,
      });
      setupNoActiveLoad();
      settingsService.checkUserRateLimit.mockResolvedValue({
        allowed: false,
        resetAt: new Date(Date.now() + 600000),
      });

      await expect(service.create(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(userId, dto)).rejects.toThrow(
        'Límite de solicitudes excedido',
      );
    });

    it('should throw BadRequestException if amount is zero or negative', async () => {
      prisma.user.findUnique.mockResolvedValue({
        username: 'player1',
        isActive: true,
      });
      setupNoActiveLoad();
      settingsService.checkUserRateLimit.mockResolvedValue({ allowed: true });

      await expect(service.create(userId, { amount: 0 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(userId, { amount: -10 })).rejects.toThrow(
        'El monto debe ser mayor a 0',
      );
    });

    // MAX_REQUEST_AMOUNT limit removed — no amount cap

    it('should throw BadRequestException if no wallet is selected', async () => {
      prisma.user.findUnique.mockResolvedValue({
        username: 'player1',
        isActive: true,
      });
      setupNoActiveLoad();
      settingsService.checkUserRateLimit.mockResolvedValue({ allowed: true });
      settingsService.getSetting.mockResolvedValue('10000');
      paymentsService.getSelectedWallet.mockResolvedValue(null);

      await expect(service.create(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(userId, dto)).rejects.toThrow(
        'No hay billetera configurada',
      );
    });
  });

  // ==============================
  // uploadProof() — dedup por proofHash
  // ==============================
  describe('uploadProof', () => {
    const requestId = 'req-new';
    const userId = 'user-1';
    const proofUrl = 'https://cdn/proof.jpg';
    const proofHash = 'a'.repeat(64);

    beforeEach(() => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId,
        status: 'PENDING_PROOF',
      });
      prisma.request.findMany.mockResolvedValue([]);
      prisma.request.update.mockResolvedValue({
        id: requestId,
        userId,
        status: 'VALIDATING',
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
    });

    it('deja reusar el comprobante si el intento anterior del mismo usuario murio en VALIDATION_FAILED', async () => {
      // Sin duplicado "vivo": el where excluye los estados muertos del mismo usuario.
      prisma.request.findFirst.mockResolvedValue(null);
      prisma.request.findMany.mockResolvedValue([
        { id: 'req-old', status: 'VALIDATION_FAILED' },
      ]);

      await expect(
        service.uploadProof(requestId, userId, proofUrl, proofHash),
      ).resolves.toBeDefined();
    });

    it('cierra como CANCELLED el intento muerto para que no lo resuciten y cobre dos veces', async () => {
      prisma.request.findFirst.mockResolvedValue(null);
      prisma.request.findMany.mockResolvedValue([
        { id: 'req-old', status: 'VALIDATION_FAILED' },
      ]);

      await service.uploadProof(requestId, userId, proofUrl, proofHash);

      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-old' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(prisma.requestStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestId: 'req-old',
            status: 'CANCELLED',
            metadata: expect.objectContaining({
              reason: 'PROOF_REUSED_AFTER_FAILURE',
              supersededBy: requestId,
            }),
          }),
        }),
      );
    });

    it('sigue bloqueando si el comprobante ya se uso en una carga acreditada', async () => {
      prisma.request.findFirst.mockResolvedValue({
        id: 'req-done',
        status: 'COMPLETED',
        userId,
        createdAt: new Date(),
      });

      await expect(
        service.uploadProof(requestId, userId, proofUrl, proofHash),
      ).rejects.toThrow('ya se usó en una carga que se acreditó');
    });

    it('no cancela nada cuando el comprobante se rechaza por estar acreditado', async () => {
      prisma.request.findFirst.mockResolvedValue({
        id: 'req-done',
        status: 'COMPLETED',
        userId,
        createdAt: new Date(),
      });

      await expect(
        service.uploadProof(requestId, userId, proofUrl, proofHash),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.request.update).not.toHaveBeenCalled();
    });

    it('sigue bloqueando el comprobante de otro usuario aunque aquel intento haya fallado', async () => {
      prisma.request.findFirst.mockResolvedValue({
        id: 'req-otro',
        status: 'VALIDATION_FAILED',
        userId: 'user-2',
        createdAt: new Date(),
      });

      await expect(
        service.uploadProof(requestId, userId, proofUrl, proofHash),
      ).rejects.toThrow('ya fue utilizado en otra solicitud');
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
      paymentsService.accumulateAndCheckRotation.mockResolvedValue({
        rotated: false,
        allFull: false,
      });
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

      await expect(service.approve(requestId, operatorId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.approve(requestId, operatorId)).rejects.toThrow(
        'Esta solicitud no puede ser aprobada',
      );
    });

    it('should throw NotFoundException if request does not exist', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      await expect(service.approve(requestId, operatorId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should approve a FAILED request that has no job (discovery failure)', async () => {
      const existingRequest = {
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'FAILED',
        walletId: null,
        job: null,
      };

      prisma.request.findUnique.mockResolvedValue(existingRequest);
      prisma.request.update.mockResolvedValue({
        ...existingRequest,
        status: 'APPROVED',
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      jobsService.createJobForRequest.mockResolvedValue({});
      prisma.requestStatusHistory.findFirst.mockResolvedValue(null);

      const result = await service.approve(requestId, operatorId);

      expect(result.status).toBe('APPROVED');
    });

    it('should NOT approve a FAILED request that already has a job', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'FAILED',
        job: { id: 'job-1', status: 'FAILED' },
      });

      await expect(service.approve(requestId, operatorId)).rejects.toThrow(
        'Esta solicitud no puede ser aprobada',
      );
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
        amount: 300,
        status: 'APPROVED',
        walletId: null,
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      jobsService.createJobForRequest.mockResolvedValue({});
      settingsService.getSetting.mockResolvedValue('10000');

      // approvedAmount must be ≤ requested amount (operator can only lower it)
      await service.approve(requestId, operatorId, { approvedAmount: 300 });

      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 300,
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
      jobsService.createJobForRequest.mockRejectedValue(
        new Error('Queue full'),
      );

      // Should not throw despite job creation failure
      const result = await service.approve(requestId, operatorId);
      expect(result.status).toBe('APPROVED');
    });
  });

  // ==============================
  // El monto lo decide el operador
  // ==============================
  //
  // El caso que motivó todo: pidió $3.000, transfirió $3.300, la plata entró y
  // no había forma de acreditarle lo que pagó.
  describe('cargar un monto que el comprobante no respalda', () => {
    const requestId = 'req-1';
    const operatorId = 'op-1';

    const enBandeja = (validationDetails: any = null) => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: '3000',
        status: 'VALIDATION_FAILED',
        walletId: null,
        validationDetails,
      });
      prisma.request.update.mockResolvedValue({
        id: requestId,
        userId: 'user-1',
        amount: 3300,
        status: 'APPROVED',
        walletId: null,
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });
      jobsService.createJobForRequest.mockResolvedValue({});
      settingsService.getSetting.mockResolvedValue('10000000');
    };

    it('acredita lo que dice el comprobante sin necesidad de forzar nada', async () => {
      enBandeja({ extractedAmount: 3300 });

      await service.approve(requestId, operatorId, { approvedAmount: 3300 });

      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 3300 }),
        }),
      );
    });

    it('sin la bandera, no deja subir el monto por encima de lo respaldado', async () => {
      enBandeja({ extractedAmount: 3300 });

      await expect(
        service.approve(requestId, operatorId, { approvedAmount: 5000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('con la bandera, carga el monto que el operador decidió', async () => {
      // Sin monto leído: es el caso donde el techo colapsaba a lo pedido y el
      // operador quedaba sin salida.
      enBandeja(null);

      await service.approve(requestId, operatorId, {
        approvedAmount: 3300,
        amountOverride: true,
        overrideReason: 'el comprobante dice 3300',
      });

      expect(prisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 3300 }),
        }),
      );
    });

    it('deja asentado que el monto no coincidía y quién lo decidió', async () => {
      enBandeja({ extractedAmount: 3000 });

      await service.approve(requestId, operatorId, {
        approvedAmount: 9000,
        amountOverride: true,
        overrideReason: 'transferencia aparte',
      });

      expect(prisma.requestStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changedBy: operatorId,
            metadata: expect.objectContaining({
              amountOverride: true,
              techoOriginal: 3000,
              overrideReason: 'transferencia aparte',
            }),
          }),
        }),
      );
    });

    // El tope por carga se eliminó a pedido del dueño (2026-08-29): había un
    // límite efectivo de $50.000 que dejaba plata afuera. Forzando, el operador
    // puede acreditar cualquier monto; lo que sigue quedando registrado es el
    // override (techoOriginal + motivo), no un rechazo.
    it('forzando, el operador puede acreditar cualquier monto', async () => {
      enBandeja({ extractedAmount: 3300 });

      await expect(
        service.approve(requestId, operatorId, {
          approvedAmount: 5000000,
          amountOverride: true,
          overrideReason: 'cliente transfirio por fuera',
        }),
      ).resolves.toBeDefined();
    });
  });

  // ==============================
  // createManualLoad()
  // ==============================
  describe('createManualLoad', () => {
    const operatorId = 'op-1';

    beforeEach(() => {
      settingsService.getSetting.mockResolvedValue('10000000');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'braian',
        savedTargetUsername: 'braian65t',
        panelId: 'panel-1',
      });
      prisma.request.create.mockResolvedValue({
        id: 'req-nuevo',
        userId: 'user-1',
        amount: 3300,
        status: 'APPROVED',
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      jobsService.createJobForRequest.mockResolvedValue({});
    });

    it('crea la carga ya aprobada y la manda al bot', async () => {
      const res = await service.createManualLoad({
        userId: 'user-1',
        amount: 3300,
        operatorId,
        note: 'transfirió de más',
      });

      expect(prisma.request.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            // El nombre del panel, no el de la app.
            targetUsername: 'braian65t',
            amount: 3300,
            status: 'APPROVED',
            manuallyApproved: true,
            approvedById: operatorId,
            // No entró plata por una billetera nuestra en este acto.
            walletId: null,
          }),
        }),
      );
      expect(jobsService.createJobForRequest).toHaveBeenCalledWith('req-nuevo');
      expect(res.amount).toBe(3300);
    });

    it('rechaza montos que no son montos', async () => {
      await expect(
        service.createManualLoad({ userId: 'user-1', amount: 0, operatorId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('no hay tope por carga: un monto grande entra igual', async () => {
      await expect(
        service.createManualLoad({
          userId: 'user-1',
          amount: 5000000,
          operatorId,
        }),
      ).resolves.toBeDefined();
    });

    it('sigue rechazando monto cero o negativo', async () => {
      await expect(
        service.createManualLoad({ userId: 'user-1', amount: 0, operatorId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('avisa si la carga quedó aprobada pero sin job', async () => {
      jobsService.createJobForRequest.mockRejectedValue(new Error('sin panel'));

      await expect(
        service.createManualLoad({
          userId: 'user-1',
          amount: 1000,
          operatorId,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(operatorGateway.emitToAll).toHaveBeenCalledWith(
        'system:alert',
        expect.objectContaining({ type: 'JOB_CREATION_FAILED' }),
      );
    });
  });

  // ==============================
  // reject()
  // ==============================
  describe('reject', () => {
    const requestId = 'req-1';
    const operatorId = 'op-1';
    const dto = { reason: 'Comprobante inválido' };

    it('should bounce a VALIDATION_FAILED request back to PENDING_PROOF for re-upload', async () => {
      const existingRequest = {
        id: requestId,
        userId: 'user-1',
        amount: '500',
        status: 'VALIDATION_FAILED',
        walletId: null,
      };
      const updatedRequest = {
        ...existingRequest,
        status: 'PENDING_PROOF',
        proofUrl: null,
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

      expect(result.status).toBe('PENDING_PROOF');
      expect(eventsGateway.emitRequestUpdated).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          requestId,
          status: 'PENDING_PROOF',
          reason: dto.reason,
        }),
      );
      // Ya no es un rechazo terminal: no debe emitir el evento de rechazo dedicado.
      expect(eventsGateway.emitRequestRejected).not.toHaveBeenCalled();
      expect(eventsGateway.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should bounce a VALIDATING request back to PENDING_PROOF', async () => {
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
        status: 'PENDING_PROOF',
        proofUrl: null,
        _wasApproved: false,
        _walletId: null,
        _amount: 500,
      });
      prisma.requestStatusHistory.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });

      const result = await service.reject(requestId, operatorId, dto);
      expect(result.status).toBe('PENDING_PROOF');
    });

    it('should bounce an APPROVED request back to PENDING_PROOF and decrement wallet', async () => {
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
        status: 'PENDING_PROOF',
        proofUrl: null,
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

      expect(paymentsService.decrementWalletAmount).toHaveBeenCalledWith(
        'wallet-1',
        500,
      );
      expect(operatorGateway.emitToAll).toHaveBeenCalledWith('wallet_updated', {
        id: 'wallet-1',
      });
    });

    it('should throw BadRequestException for invalid status', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: requestId,
        status: 'COMPLETED',
        amount: '500',
      });

      await expect(service.reject(requestId, operatorId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.reject(requestId, operatorId, dto)).rejects.toThrow(
        'Esta solicitud ya fue procesada',
      );
    });

    it('should throw NotFoundException if request does not exist', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      await expect(service.reject(requestId, operatorId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==============================
  // setValidationResult()
  // ==============================
  describe('setValidationResult', () => {
    const requestId = 'req-1';

    describe('transferencia de mas: lo decide el jugador', () => {
      const overpaid = {
        valid: false,
        score: 1,
        error: 'Transfirio de mas',
        details: { extractedAmount: 5300, overpaidOfferable: true },
      };

      it('chat web: queda en VALIDATING y se le pregunta al jugador', async () => {
        prisma.request.findUnique.mockResolvedValue({
          id: requestId,
          userId: 'user-1',
          amount: '5000',
          status: 'VALIDATING',
          validationDetails: { clientCanConfirmOverpaid: true },
        });
        prisma.request.update.mockResolvedValue({ id: requestId, status: 'VALIDATING' });
        prisma.requestStatusHistory.create.mockResolvedValue({});

        await service.setValidationResult(requestId, { ...overpaid });

        const data = prisma.request.update.mock.calls[0][0].data;
        expect(data.status).toBeUndefined();
        expect(data.validationDetails.overpaidOffer).toEqual(
          expect.objectContaining({
            status: 'PENDING',
            requestedAmount: 5000,
            offeredAmount: 5300,
          }),
        );
        expect(eventsGateway.emitRequestUpdated).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({
            status: 'VALIDATING',
            overpaidOffer: expect.objectContaining({ offeredAmount: 5300 }),
          }),
        );
      });

      it('de MENOS: tambien se le pregunta, con el monto del comprobante', async () => {
        prisma.request.findUnique.mockResolvedValue({
          id: requestId,
          userId: 'user-1',
          amount: '5000',
          status: 'VALIDATING',
          validationDetails: { clientCanConfirmOverpaid: true },
        });
        prisma.request.update.mockResolvedValue({ id: requestId, status: 'VALIDATING' });
        prisma.requestStatusHistory.create.mockResolvedValue({});

        await service.setValidationResult(requestId, {
          ...overpaid,
          details: { extractedAmount: 3000, overpaidOfferable: true },
        });

        const data = prisma.request.update.mock.calls[0][0].data;
        expect(data.status).toBeUndefined();
        expect(data.validationDetails.overpaidOffer).toEqual(
          expect.objectContaining({ status: 'PENDING', requestedAmount: 5000, offeredAmount: 3000 }),
        );
      });

      it('APK (no sabe preguntar): va al operador como siempre', async () => {
        prisma.request.findUnique.mockResolvedValue({
          id: requestId,
          userId: 'user-1',
          amount: '5000',
          status: 'VALIDATING',
          validationDetails: null,
        });
        prisma.request.update.mockResolvedValue({
          id: requestId,
          status: 'VALIDATION_FAILED',
        });
        prisma.requestStatusHistory.create.mockResolvedValue({});
        chatsService.getOrCreateChat.mockResolvedValue({ id: 'chat-1' });

        await service.setValidationResult(requestId, { ...overpaid });

        expect(prisma.request.update.mock.calls[0][0].data.status).toBe(
          'VALIDATION_FAILED',
        );
      });
    });

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
      paymentsService.accumulateAndCheckRotation.mockResolvedValue({
        rotated: false,
        allFull: false,
      });
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
      expect(eventsGateway.emitRequestUpdated).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          status: 'APPROVED',
          validationScore: 0.95,
        }),
      );
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
            in: [
              'PENDING_PROOF',
              'VALIDATING',
              'PENDING_MP_VERIFICATION',
              'APPROVED',
              'PROCESSING',
            ],
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
  // findHistoryPage() — comprobante entregable + repetidos
  // ==============================
  describe('findHistoryPage', () => {
    const PDF =
      'https://res.cloudinary.com/demo/image/upload/v1/proofs/abc.pdf';

    /** Primera llamada: la pagina. Segunda: los candidatos a repetido. */
    const mockPageAndTwins = (page: any[], candidates: any[]) => {
      prisma.request.findMany
        .mockResolvedValueOnce(page)
        .mockResolvedValueOnce(candidates);
    };

    it('entrega los PDF transformados (crudos dan 401 y no se ven)', async () => {
      mockPageAndTwins(
        [
          {
            id: 'req-1',
            userId: 'user-1',
            amount: { toString: () => '5000' },
            proofUrl: PDF,
            proofHash: null,
            extractedTransactionId: null,
            createdAt: new Date('2026-09-19T20:00:00Z'),
          },
        ],
        [],
      );

      const { items } = await service.findHistoryPage({ limit: 10 });

      expect(items[0].proofUrl).toBe(
        'https://res.cloudinary.com/demo/image/upload/f_jpg,pg_1/v1/proofs/abc.pdf',
      );
    });

    it('marca el comprobante repetido y no se marca a si mismo', async () => {
      const hash = 'h'.repeat(64);
      mockPageAndTwins(
        [
          {
            id: 'req-2',
            userId: 'user-1',
            amount: { toString: () => '5000' },
            proofUrl: null,
            proofHash: hash,
            extractedTransactionId: null,
            createdAt: new Date('2026-09-19T21:00:00Z'),
          },
        ],
        [
          {
            id: 'req-2',
            userId: 'user-1',
            status: 'VALIDATING',
            amount: { toString: () => '5000' },
            createdAt: new Date('2026-09-19T21:00:00Z'),
            proofHash: hash,
            extractedTransactionId: null,
          },
          {
            id: 'req-1',
            userId: 'user-1',
            status: 'VALIDATION_FAILED',
            amount: { toString: () => '5000' },
            createdAt: new Date('2026-09-19T20:00:00Z'),
            proofHash: hash,
            extractedTransactionId: null,
          },
        ],
      );

      const { items } = await service.findHistoryPage({ limit: 10 });

      expect(items[0].proofTwins).toEqual([
        expect.objectContaining({ id: 'req-1', sameUser: true }),
      ]);
    });

    it('avisa cuando el mismo comprobante es de otra persona', async () => {
      const txId = 'OP-123';
      mockPageAndTwins(
        [
          {
            id: 'req-3',
            userId: 'user-1',
            amount: { toString: () => '5000' },
            proofUrl: null,
            proofHash: null,
            extractedTransactionId: txId,
            createdAt: new Date('2026-09-19T22:00:00Z'),
          },
        ],
        [
          {
            id: 'req-9',
            userId: 'user-OTRO',
            status: 'COMPLETED',
            amount: { toString: () => '5000' },
            createdAt: new Date('2026-09-18T10:00:00Z'),
            proofHash: null,
            extractedTransactionId: txId,
          },
        ],
      );

      const { items } = await service.findHistoryPage({ limit: 10 });

      expect(items[0].proofTwins[0]).toMatchObject({
        id: 'req-9',
        sameUser: false,
      });
    });

    it('resuelve los repetidos de toda la pagina con UNA sola query', async () => {
      mockPageAndTwins(
        [
          {
            id: 'req-1',
            userId: 'user-1',
            amount: { toString: () => '1' },
            proofUrl: null,
            proofHash: 'a',
            extractedTransactionId: null,
            createdAt: new Date(),
          },
          {
            id: 'req-2',
            userId: 'user-2',
            amount: { toString: () => '2' },
            proofUrl: null,
            proofHash: 'b',
            extractedTransactionId: null,
            createdAt: new Date(),
          },
        ],
        [],
      );

      await service.findHistoryPage({ limit: 10 });

      expect(prisma.request.findMany).toHaveBeenCalledTimes(2);
    });

    it('no consulta repetidos si ninguna carga tiene comprobante', async () => {
      prisma.request.findMany.mockResolvedValueOnce([
        {
          id: 'req-1',
          userId: 'user-1',
          amount: { toString: () => '1' },
          proofUrl: null,
          proofHash: null,
          extractedTransactionId: null,
          createdAt: new Date(),
        },
      ]);

      const { items } = await service.findHistoryPage({ limit: 10 });

      expect(prisma.request.findMany).toHaveBeenCalledTimes(1);
      expect(items[0].proofTwins).toEqual([]);
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

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if userId does not match', async () => {
      prisma.request.findUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        user: { id: 'user-1', email: 'a@b.com' },
        job: null,
        chat: null,
      });

      await expect(service.findOne('req-1', 'other-user')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
