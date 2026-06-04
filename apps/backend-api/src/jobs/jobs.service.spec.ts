import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// Mock transitive dependencies that use ESM (uuid, cloudinary, etc.)
// These mocks prevent Jest from traversing the full import tree.
jest.mock('../events/events.gateway');
jest.mock('../bot/bot.service');
jest.mock('../bot/bot.gateway');
jest.mock('../requests/requests.service');

import { JobsService } from './jobs.service';
import { EventsGateway } from '../events/events.gateway';
import { BotService } from '../bot/bot.service';
import { BotGateway } from '../bot/bot.gateway';
import { RequestsService } from '../requests/requests.service';

// Prevent real timers from firing during tests
jest.useFakeTimers();

describe('JobsService', () => {
  let service: JobsService;
  let prisma: {
    job: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    request: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let events: {
    emitJobQueued: jest.Mock;
    emitJobFailed: jest.Mock;
    emitDashboardUpdate: jest.Mock;
    emitDispatchBlocked: jest.Mock;
    emitToOperators: jest.Mock;
    emitSystemAlert: jest.Mock;
  };
  let botService: {
    checkKillSwitch: jest.Mock;
    checkActivityWindow: jest.Mock;
  };
  let botGateway: {
    isAnyBotConnected: jest.Mock;
    pushJobToBot: jest.Mock;
  };
  let requestsService: {
    updateRequestStatus: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      job: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      request: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    events = {
      emitJobQueued: jest.fn(),
      emitJobFailed: jest.fn(),
      emitDashboardUpdate: jest.fn(),
      emitDispatchBlocked: jest.fn(),
      emitToOperators: jest.fn(),
      emitSystemAlert: jest.fn(),
    };

    botService = {
      checkKillSwitch: jest.fn().mockResolvedValue({ active: false }),
      checkActivityWindow: jest.fn().mockResolvedValue({ allowed: true }),
    };

    botGateway = {
      isAnyBotConnected: jest.fn().mockReturnValue(false),
      pushJobToBot: jest.fn().mockReturnValue(true),
    };

    requestsService = {
      updateRequestStatus: jest.fn().mockResolvedValue({}),
    };

    configService = {
      get: jest.fn().mockReturnValue(30000),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
        { provide: EventsGateway, useValue: events },
        { provide: BotService, useValue: botService },
        { provide: BotGateway, useValue: botGateway },
        { provide: RequestsService, useValue: requestsService },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
  });

  afterEach(() => {
    // Clean up intervals/timers set by onModuleInit
    service.onModuleDestroy();
    jest.clearAllTimers();
  });

  // ── createJobForRequest ──────────────────────────────────────────

  describe('createJobForRequest', () => {
    const mockRequest = {
      id: 'req-1',
      status: 'APPROVED',
      targetUsername: 'player123',
      amount: 5000,
      userId: 'user-1',
    };

    it('should create a job and emit events on success', async () => {
      prisma.request.findUnique.mockResolvedValue(mockRequest);
      prisma.job.create.mockResolvedValue({ id: 'job-1', requestId: 'req-1', status: 'QUEUED' });

      // tryDispatchNextJob will be called - set up for "no bot connected" path
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      // Cooldown check
      prisma.job.findFirst.mockResolvedValue(null);
      // Transaction for atomic claim
      prisma.$transaction.mockResolvedValue(null);
      // hasActiveJob check after no claimed job
      prisma.job.findFirst.mockResolvedValue(null);

      const result = await service.createJobForRequest('req-1');

      expect(result).toEqual({ id: 'job-1', requestId: 'req-1', status: 'QUEUED' });
      expect(prisma.job.create).toHaveBeenCalledWith({
        data: { requestId: 'req-1', status: 'QUEUED' },
      });
      expect(events.emitJobQueued).toHaveBeenCalledWith({
        jobId: 'job-1',
        requestId: 'req-1',
        targetUsername: 'player123',
      });
      expect(events.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should throw NotFoundException if request does not exist', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      await expect(service.createJobForRequest('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if request is not APPROVED', async () => {
      prisma.request.findUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING_PROOF' });

      await expect(service.createJobForRequest('req-1')).rejects.toThrow(BadRequestException);
    });

    it('should return existing job on P2002 unique constraint violation', async () => {
      prisma.request.findUnique.mockResolvedValue(mockRequest);
      const uniqueError = new Error('Unique constraint failed') as any;
      uniqueError.code = 'P2002';
      prisma.job.create.mockRejectedValue(uniqueError);

      const existingJob = { id: 'job-existing', requestId: 'req-1', status: 'QUEUED' };
      prisma.job.findUnique.mockResolvedValue(existingJob);

      const result = await service.createJobForRequest('req-1');

      expect(result).toEqual(existingJob);
      expect(prisma.job.findUnique).toHaveBeenCalledWith({ where: { requestId: 'req-1' } });
    });

    it('should rethrow non-P2002 errors from job creation', async () => {
      prisma.request.findUnique.mockResolvedValue(mockRequest);
      const dbError = new Error('Database connection lost') as any;
      dbError.code = 'P1001';
      prisma.job.create.mockRejectedValue(dbError);

      await expect(service.createJobForRequest('req-1')).rejects.toThrow('Database connection lost');
    });

    it('should emit dispatch blocked when dispatch fails after job creation', async () => {
      prisma.request.findUnique.mockResolvedValue(mockRequest);
      prisma.job.create.mockResolvedValue({ id: 'job-1', requestId: 'req-1', status: 'QUEUED' });

      // Kill switch active blocks dispatch
      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'Maintenance' });

      const result = await service.createJobForRequest('req-1');

      expect(result).toEqual({ id: 'job-1', requestId: 'req-1', status: 'QUEUED' });
      expect(events.emitDispatchBlocked).toHaveBeenCalledWith({
        jobId: 'job-1',
        reason: 'Kill switch active: Maintenance',
      });
    });
  });

  // ── tryDispatchNextJob ───────────────────────────────────────────

  describe('tryDispatchNextJob', () => {
    it('should block dispatch when kill switch is active', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'Emergency' });

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain('Kill switch active');
    });

    it('should block dispatch outside activity window', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: false, reason: 'Off hours' });

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain('Outside activity window');
    });

    it('should block dispatch when cooldown is active', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      // isCooldownActive: return a recently completed job
      prisma.job.findFirst.mockResolvedValueOnce({
        status: 'COMPLETED',
        completedAt: new Date(Date.now() - 5000), // 5 seconds ago, within 30s cooldown
      });

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain('Cooldown active');
    });

    it('should dispatch successfully when bot is connected', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      // isCooldownActive: no completed jobs
      prisma.job.findFirst.mockResolvedValueOnce(null);

      // Transaction claims a job
      const claimedJob = {
        id: 'job-1',
        requestId: 'req-1',
        targetUsername: 'player123',
        amount: 5000,
      };
      prisma.$transaction.mockResolvedValue(claimedJob);

      botGateway.isAnyBotConnected.mockReturnValue(true);
      botGateway.pushJobToBot.mockReturnValue(true);

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(true);
      expect(botGateway.pushJobToBot).toHaveBeenCalledWith(claimedJob);
    });

    it('should revert job to QUEUED when no bot is connected', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      prisma.job.findFirst.mockResolvedValueOnce(null); // cooldown check

      const claimedJob = {
        id: 'job-1',
        requestId: 'req-1',
        targetUsername: 'player123',
        amount: 5000,
      };
      prisma.$transaction.mockResolvedValue(claimedJob);
      botGateway.isAnyBotConnected.mockReturnValue(false);

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain('No bot connected');
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'QUEUED' },
      });
    });

    it('should handle serialization conflict (P2034) gracefully', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      prisma.job.findFirst.mockResolvedValueOnce(null); // cooldown check

      const serializationError = new Error('Serialization failure') as any;
      serializationError.code = 'P2034';
      prisma.$transaction.mockRejectedValue(serializationError);

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain('Concurrent dispatch');
    });

    it('should rethrow non-serialization transaction errors', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      prisma.job.findFirst.mockResolvedValueOnce(null); // cooldown check

      prisma.$transaction.mockRejectedValue(new Error('Connection lost'));

      await expect(service.tryDispatchNextJob()).rejects.toThrow('Connection lost');
    });

    it('should report "Another job is already processing" when transaction returns null and active job exists', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      prisma.job.findFirst
        .mockResolvedValueOnce(null) // cooldown check (no completed job)
        .mockResolvedValueOnce({ id: 'active-job', status: 'PROCESSING' }); // hasActiveJob check
      prisma.$transaction.mockResolvedValue(null);

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('Another job is already processing');
    });

    it('should report "No jobs in queue" when transaction returns null and no active job', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      prisma.job.findFirst
        .mockResolvedValueOnce(null) // cooldown check
        .mockResolvedValueOnce(null); // hasActiveJob check
      prisma.$transaction.mockResolvedValue(null);

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('No jobs in queue');
    });

    it('should revert job when bot is connected but pushJobToBot fails', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: false });
      botService.checkActivityWindow.mockResolvedValue({ allowed: true });
      prisma.job.findFirst.mockResolvedValueOnce(null);

      const claimedJob = {
        id: 'job-1',
        requestId: 'req-1',
        targetUsername: 'player123',
        amount: 5000,
      };
      prisma.$transaction.mockResolvedValue(claimedJob);
      botGateway.isAnyBotConnected.mockReturnValue(true);
      botGateway.pushJobToBot.mockReturnValue(false); // push failed

      const result = await service.tryDispatchNextJob();

      expect(result.dispatched).toBe(false);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'QUEUED' },
      });
    });
  });

  // ── checkForStuckJobs (via reflection) ───────────────────────────

  describe('checkForStuckJobs', () => {
    // Access private method for testing
    const callCheckForStuckJobs = (svc: any) => svc.checkForStuckJobs();

    it('should do nothing when no stuck jobs exist', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await callCheckForStuckJobs(service);

      expect(prisma.job.update).not.toHaveBeenCalled();
      expect(events.emitDashboardUpdate).not.toHaveBeenCalled();
    });

    it('should mark stuck PROCESSING jobs as FAILED and emit events', async () => {
      const stuckJob = {
        id: 'stuck-1',
        requestId: 'req-1',
        status: 'PROCESSING',
        startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        request: {
          id: 'req-1',
          targetUsername: 'player123',
          amount: 5000,
          userId: 'user-1',
        },
      };
      prisma.job.findMany.mockResolvedValue([stuckJob]);

      // After cleanup, tryDispatchNextJob is called - block it with kill switch
      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'test' });

      await callCheckForStuckJobs(service);

      // Job should be marked FAILED
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'stuck-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          error: expect.stringContaining('timed out'),
          completedAt: expect.any(Date),
        }),
      });

      // Request status updated
      expect(requestsService.updateRequestStatus).toHaveBeenCalledWith(
        'req-1',
        'FAILED',
        'system-stuck-job-cleanup',
        expect.objectContaining({ reason: 'job_timed_out', jobId: 'stuck-1' }),
      );

      // Events emitted
      expect(events.emitJobFailed).toHaveBeenCalledWith('user-1', expect.objectContaining({
        jobId: 'stuck-1',
        requestId: 'req-1',
      }));
      expect(events.emitSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
        type: 'STUCK_JOB_CLEANED',
        severity: 'warning',
      }));
      expect(events.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should continue processing remaining stuck jobs if one fails to update', async () => {
      const stuckJobs = [
        {
          id: 'stuck-1',
          requestId: 'req-1',
          status: 'PROCESSING',
          startedAt: new Date(Date.now() - 10 * 60 * 1000),
          request: { id: 'req-1', targetUsername: 'p1', amount: 1000, userId: 'u1' },
        },
        {
          id: 'stuck-2',
          requestId: 'req-2',
          status: 'PROCESSING',
          startedAt: new Date(Date.now() - 10 * 60 * 1000),
          request: { id: 'req-2', targetUsername: 'p2', amount: 2000, userId: 'u2' },
        },
      ];
      prisma.job.findMany.mockResolvedValue(stuckJobs);

      // First job update fails, second succeeds
      prisma.job.update
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({});

      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'test' });

      await callCheckForStuckJobs(service);

      // Both jobs attempted
      expect(prisma.job.update).toHaveBeenCalledTimes(2);
      // Dashboard update still emitted
      expect(events.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should handle requestsService.updateRequestStatus failure gracefully', async () => {
      const stuckJob = {
        id: 'stuck-1',
        requestId: 'req-1',
        status: 'PROCESSING',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        request: { id: 'req-1', targetUsername: 'p1', amount: 1000, userId: 'u1' },
      };
      prisma.job.findMany.mockResolvedValue([stuckJob]);
      prisma.job.update.mockResolvedValue({});
      requestsService.updateRequestStatus.mockRejectedValue(new Error('Request update failed'));

      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'test' });

      // Should not throw - error is caught internally
      await callCheckForStuckJobs(service);

      // Events still emitted despite request update failure
      expect(events.emitJobFailed).toHaveBeenCalled();
      expect(events.emitDashboardUpdate).toHaveBeenCalled();
    });
  });

  // ── isCooldownActive ─────────────────────────────────────────────

  describe('isCooldownActive', () => {
    it('should return inactive when no completed jobs exist', async () => {
      prisma.job.findFirst.mockResolvedValue(null);

      const result = await service.isCooldownActive();

      expect(result).toEqual({ active: false, remainingMs: 0 });
    });

    it('should return active when last job completed recently', async () => {
      prisma.job.findFirst.mockResolvedValue({
        completedAt: new Date(Date.now() - 10000), // 10 seconds ago
      });

      const result = await service.isCooldownActive();

      expect(result.active).toBe(true);
      expect(result.remainingMs).toBeGreaterThan(0);
      expect(result.remainingMs).toBeLessThanOrEqual(20000);
    });

    it('should return inactive when cooldown has elapsed', async () => {
      prisma.job.findFirst.mockResolvedValue({
        completedAt: new Date(Date.now() - 60000), // 60 seconds ago, past 30s cooldown
      });

      const result = await service.isCooldownActive();

      expect(result).toEqual({ active: false, remainingMs: 0 });
    });
  });

  // ── hasActiveJob ─────────────────────────────────────────────────

  describe('hasActiveJob', () => {
    it('should return true when a PROCESSING job exists', async () => {
      prisma.job.findFirst.mockResolvedValue({ id: 'job-1', status: 'PROCESSING' });

      expect(await service.hasActiveJob()).toBe(true);
    });

    it('should return false when no PROCESSING job exists', async () => {
      prisma.job.findFirst.mockResolvedValue(null);

      expect(await service.hasActiveJob()).toBe(false);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return job with included request', async () => {
      const mockJob = { id: 'job-1', request: { user: { id: 'u1', email: 'a@b.com' } } };
      prisma.job.findUnique.mockResolvedValue(mockJob);

      const result = await service.findOne('job-1');

      expect(result).toEqual(mockJob);
    });

    it('should throw NotFoundException when job does not exist', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll ──────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return jobs with default limit and offset', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });

    it('should filter by status when provided', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.findAll({ status: 'FAILED' as any });

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'FAILED' } }),
      );
    });
  });

  // ── cancelJob ────────────────────────────────────────────────────

  describe('cancelJob', () => {
    it('should cancel a QUEUED job and revert request', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', status: 'QUEUED', requestId: 'req-1' });
      prisma.$transaction.mockResolvedValue([]);

      const result = await service.cancelJob('job-1');

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(events.emitDashboardUpdate).toHaveBeenCalled();
    });

    it('should throw NotFoundException for nonexistent job', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.cancelJob('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-QUEUED job', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', status: 'PROCESSING' });

      await expect(service.cancelJob('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── assignOperator ───────────────────────────────────────────────

  describe('assignOperator', () => {
    it('should assign operator to a FAILED job', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', status: 'FAILED', request: {} });
      const updatedJob = { id: 'job-1', assignedOperatorId: 'op-1' };
      prisma.job.update.mockResolvedValue(updatedJob);

      const result = await service.assignOperator('job-1', 'op-1');

      expect(result).toEqual(updatedJob);
      expect(events.emitToOperators).toHaveBeenCalledWith('job:assigned', { jobId: 'job-1', operatorId: 'op-1' });
    });

    it('should throw NotFoundException for nonexistent job', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.assignOperator('nonexistent', 'op-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-FAILED job', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', status: 'COMPLETED', request: {} });

      await expect(service.assignOperator('job-1', 'op-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── onJobCompleted ───────────────────────────────────────────────

  describe('onJobCompleted', () => {
    it('should schedule next dispatch after cooldown', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'test' });

      await service.onJobCompleted('job-1');

      // Timer should be set but not fired yet
      expect(botService.checkKillSwitch).not.toHaveBeenCalled();

      // Advance timer past cooldown
      jest.advanceTimersByTime(30000);

      // Allow the async callback to resolve
      await Promise.resolve();
      await Promise.resolve();

      expect(botService.checkKillSwitch).toHaveBeenCalled();
    });
  });

  // ── onBotConnected ───────────────────────────────────────────────

  describe('onBotConnected', () => {
    it('should attempt to dispatch queued jobs', async () => {
      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'test' });

      await service.onBotConnected();

      expect(botService.checkKillSwitch).toHaveBeenCalled();
    });
  });

  // ── getStats ─────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return aggregated job statistics', async () => {
      prisma.job.count
        .mockResolvedValueOnce(2)   // queued
        .mockResolvedValueOnce(1)   // processing
        .mockResolvedValueOnce(50)  // completed
        .mockResolvedValueOnce(5)   // failed
        .mockResolvedValueOnce(10); // todayCompleted

      prisma.job.findMany.mockResolvedValue([
        { startedAt: new Date(1000), completedAt: new Date(31000) }, // 30s
        { startedAt: new Date(1000), completedAt: new Date(21000) }, // 20s
      ]);

      const result = await service.getStats();

      expect(result).toEqual({
        queued: 2,
        processing: 1,
        completed: 50,
        failed: 5,
        todayCompleted: 10,
        averageTime: 25, // (30+20)/2 = 25
      });
    });

    it('should return averageTime 0 when no recent completed jobs', async () => {
      prisma.job.count.mockResolvedValue(0);
      prisma.job.findMany.mockResolvedValue([]);

      const result = await service.getStats();

      expect(result.averageTime).toBe(0);
    });
  });

  // ── getQueueInfo ─────────────────────────────────────────────────

  describe('getQueueInfo', () => {
    it('should return queue counts and cooldown status', async () => {
      prisma.job.count
        .mockResolvedValueOnce(3)   // waiting
        .mockResolvedValueOnce(1)   // active
        .mockResolvedValueOnce(100) // completed
        .mockResolvedValueOnce(10); // failed

      // isCooldownActive - no completed jobs
      prisma.job.findFirst.mockResolvedValue(null);

      const result = await service.getQueueInfo();

      expect(result).toEqual({
        waiting: 3,
        active: 1,
        completed: 100,
        failed: 10,
        cooldown: { active: false, remainingMs: 0 },
      });
    });
  });

  // ── retryJob ─────────────────────────────────────────────────────

  describe('retryJob', () => {
    it('should throw NotFoundException for nonexistent job', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.retryJob('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-FAILED job', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', status: 'QUEUED', request: {} });

      await expect(service.retryJob('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── handleValidationCompleted ────────────────────────────────────

  describe('handleValidationCompleted', () => {
    it('should create a job when validation completes', async () => {
      const mockRequest = {
        id: 'req-1',
        status: 'APPROVED',
        targetUsername: 'player123',
        amount: 5000,
      };
      prisma.request.findUnique.mockResolvedValue(mockRequest);
      prisma.job.create.mockResolvedValue({ id: 'job-1', requestId: 'req-1', status: 'QUEUED' });

      // tryDispatchNextJob blocked by kill switch for simplicity
      botService.checkKillSwitch.mockResolvedValue({ active: true, reason: 'test' });

      await service.handleValidationCompleted({ requestId: 'req-1', score: 0.95 });

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: { requestId: 'req-1', status: 'QUEUED' },
      });
    });

    it('should emit system alert to operators when job creation fails', async () => {
      prisma.request.findUnique.mockResolvedValue(null); // triggers NotFoundException

      await service.handleValidationCompleted({ requestId: 'req-1', score: 0.95 });

      expect(events.emitToOperators).toHaveBeenCalledWith('system:alert', {
        type: 'JOB_CREATION_FAILED',
        requestId: 'req-1',
        error: expect.any(String),
      });
    });
  });

  // ── onModuleDestroy ──────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('should clear all intervals and timers', async () => {
      // Trigger onModuleInit to set up intervals
      service.onModuleInit();

      // Verify intervals are set by calling destroy
      service.onModuleDestroy();

      // Calling destroy again should not throw
      service.onModuleDestroy();
    });
  });
});
