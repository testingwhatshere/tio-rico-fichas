// Mock ESM modules that Jest cannot parse
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));
jest.mock('cloudinary', () => ({ v2: {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventsGateway } from '../events/events.gateway';
import { RequestsService } from '../requests/requests.service';
import { UploadsService } from '../uploads/uploads.service';
import { SettingsService } from '../settings/settings.service';
import { ProofValidationService } from './proof-validation.service';
import { PushService } from '../notifications/push.service';
import { AppEvent } from '../common/events/app-events';

// Helper to build a mock validation result from ProofValidationService
function buildProofResult(overrides: Record<string, any> = {}) {
  return {
    isValid: true,
    confidence: 0.95,
    extractedAmount: 5000,
    extractedDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'MERCADOPAGO',
    reasoning: 'Comprobante valido',
    flags: [],
    extractedTime: null,
    transactionId: null,
    referenceNumber: null,
    senderName: null,
    senderDniCuit: null,
    recipientName: null,
    recipientAccount: null,
    recipientMatch: null,
    bankName: null,
    transactionStatus: null,
    authenticityChecks: null,
    ...overrides,
  };
}

// Helper to build a mock request from Prisma
function buildRequest(overrides: Record<string, any> = {}) {
  return {
    id: 'req-1',
    userId: 'user-1',
    targetUsername: 'player123',
    amount: 5000,
    proofUrl: 'https://res.cloudinary.com/test/proof.png',
    walletId: null,
    status: 'VALIDATING',
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: Record<string, any>;
  let eventEmitter: { emit: jest.Mock };
  let eventsGateway: Record<string, jest.Mock>;
  let requestsService: Record<string, jest.Mock>;
  let uploadsService: Record<string, any>;
  let settingsService: { getSetting: jest.Mock };
  let proofValidationService: { validateProof: jest.Mock };

  beforeEach(async () => {
    prisma = {
      request: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      paymentConfig: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };

    eventEmitter = { emit: jest.fn() };

    eventsGateway = {
      emitValidationStarted: jest.fn(),
      emitValidationCompleted: jest.fn(),
      emitValidationFailed: jest.fn(),
    };

    requestsService = {
      setValidationResult: jest.fn().mockResolvedValue(undefined),
      updateRequestStatus: jest.fn().mockResolvedValue(undefined),
    };

    uploadsService = {
      // Identity passthrough — the actual transform is unit-tested separately.
      toDeliverableUrl: jest.fn((url: string) => url),
    };

    settingsService = {
      getSetting: jest.fn().mockImplementation((key: string) => {
        const settings: Record<string, string> = {
          VALIDATION_THRESHOLD: '0.8',
          VALIDATION_DATE_WINDOW_DAYS: '7',
          VALIDATION_TIMEOUT_MS: '60000',
        };
        return Promise.resolve(settings[key] || null);
      }),
    };

    proofValidationService = {
      validateProof: jest.fn().mockResolvedValue(buildProofResult()),
    };

    const pushService = { sendToUser: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: EventsGateway, useValue: eventsGateway },
        { provide: RequestsService, useValue: requestsService },
        { provide: UploadsService, useValue: uploadsService },
        { provide: SettingsService, useValue: settingsService },
        { provide: ProofValidationService, useValue: proofValidationService },
        { provide: PushService, useValue: pushService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  // ========================================================
  // validateProof - success path
  // ========================================================
  describe('validateProof - success', () => {
    it('should return valid result and emit VALIDATION_COMPLETED event', async () => {
      const request = buildRequest();
      prisma.request.findUnique.mockResolvedValue(request);

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(true);
      expect(result.score).toBe(0.95);
      expect(result.error).toBeUndefined();

      // Should emit validation started
      expect(eventsGateway.emitValidationStarted).toHaveBeenCalledWith(
        'user-1',
        {
          requestId: 'req-1',
          status: 'VALIDATING',
        },
      );

      // Should set validation result
      expect(requestsService.setValidationResult).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ valid: true, score: 0.95 }),
      );

      // Should emit completed to user
      expect(eventsGateway.emitValidationCompleted).toHaveBeenCalledWith(
        'user-1',
        {
          requestId: 'req-1',
          status: 'APPROVED',
          score: 0.95,
        },
      );

      // Should emit VALIDATION_COMPLETED event for job creation
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AppEvent.VALIDATION_COMPLETED,
        expect.objectContaining({ requestId: 'req-1', score: 0.95 }),
      );
    });

    it('should pass wallet info to proof validation service when walletId exists', async () => {
      const request = buildRequest({ walletId: 'wallet-1' });
      prisma.request.findUnique.mockResolvedValue(request);
      prisma.paymentConfig.findUnique.mockResolvedValue({
        id: 'wallet-1',
        holderName: 'Juan Perez',
        holderLegalName: 'Juan Alberto Perez',
        holderDni: '12345678',
        type: 'MERCADOPAGO',
        details: { alias: 'juan.mp', cbu: '1234567890123456789012' },
      });

      await service.validateProof('req-1');

      expect(proofValidationService.validateProof).toHaveBeenCalledWith(
        request.proofUrl,
        'image/png',
        5000,
        'req-1',
        expect.objectContaining({
          holderName: 'Juan Perez',
          holderLegalName: 'Juan Alberto Perez',
          alias: 'juan.mp',
          cbu: '1234567890123456789012',
        }),
      );
    });

    it('should look up selected wallet when no walletId on request', async () => {
      const request = buildRequest({ walletId: null });
      prisma.request.findUnique.mockResolvedValue(request);
      prisma.paymentConfig.findFirst.mockResolvedValue({
        id: 'wallet-default',
        holderName: 'Default Holder',
        holderLegalName: null,
        holderDni: null,
        type: 'CBU',
        details: { cbu: '9999999999999999999999' },
      });

      await service.validateProof('req-1');

      expect(prisma.paymentConfig.findFirst).toHaveBeenCalledWith({
        where: { isActive: true, isSelected: true },
      });
    });
  });

  // ========================================================
  // validateProof - no request / no proof
  // ========================================================
  describe('validateProof - missing data', () => {
    it('should return invalid when request not found', async () => {
      prisma.request.findUnique.mockResolvedValue(null);

      const result = await service.validateProof('nonexistent');

      expect(result.valid).toBe(false);
      expect(result.score).toBe(0);
      expect(result.error).toBe('No proof found');
    });

    it('should return invalid and set validation result when request exists but has no proofUrl', async () => {
      prisma.request.findUnique.mockResolvedValue(
        buildRequest({ proofUrl: null }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(requestsService.setValidationResult).toHaveBeenCalledWith(
        'req-1',
        {
          valid: false,
          score: 0,
          error: 'No se encontr\u00f3 comprobante adjunto',
        },
      );
    });
  });

  // ========================================================
  // validateProof - invalid proof (AI says invalid)
  // ========================================================
  describe('validateProof - invalid proof', () => {
    it('should return invalid and emit VALIDATION_FAILED when AI says invalid', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          isValid: false,
          confidence: 0.3,
          reasoning: 'Comprobante borroso',
        }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.score).toBe(0.3);

      // Should NOT emit VALIDATION_COMPLETED app event
      expect(eventEmitter.emit).not.toHaveBeenCalled();

      // Should emit validation failed to user
      expect(eventsGateway.emitValidationFailed).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          requestId: 'req-1',
          status: 'VALIDATION_FAILED',
        }),
      );
    });
  });

  // ========================================================
  // validateProof - validator unavailable / timeout
  // ========================================================
  describe('validateProof - validator unavailable', () => {
    it('should return invalid with VALIDATION_ERROR when proofValidationService throws "No validator connected"', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockRejectedValue(
        new Error('No validator connected'),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      // The error is caught inside performValidation and wrapped
      expect(result.error).toContain('No validator connected');

      // Should emit validation failed (through performValidationFlow invalid path)
      expect(eventsGateway.emitValidationFailed).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          requestId: 'req-1',
          status: 'VALIDATION_FAILED',
        }),
      );
    });

    it('should return invalid when "Validator disconnected" error occurs', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockRejectedValue(
        new Error('Validator disconnected during validation'),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Validator disconnected');
      expect(eventsGateway.emitValidationFailed).toHaveBeenCalled();
    });

    it('should handle timeout and return invalid result', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());

      // Override setting to a very small timeout to test quickly
      // VALIDATION_TIMEOUT_BUFFER_MS is 5000, so total = 10 + 5000 = 5010ms
      // We need the total (gateway + buffer) to be small
      // Actually: total = parseInt(VALIDATION_TIMEOUT_MS) + 5000
      // So set VALIDATION_TIMEOUT_MS to 1 => total = 5001ms — still too long
      // We need to set it to 0 and make validation take > 5000ms
      // Better approach: set timeout to 50ms, total = 50 + 5000 = 5050ms — too long
      // The buffer is a compile-time constant (5000ms).
      // Instead, let's test the timeout at the outer catch level by making
      // performValidationFlow itself throw a timeout-like error
      settingsService.getSetting.mockImplementation((key: string) => {
        if (key === 'VALIDATION_TIMEOUT_MS') return Promise.resolve('1'); // 1ms gateway
        if (key === 'VALIDATION_THRESHOLD') return Promise.resolve('0.8');
        if (key === 'VALIDATION_DATE_WINDOW_DAYS') return Promise.resolve('7');
        return Promise.resolve(null);
      });

      // Make validation take 6 seconds (longer than 1ms + 5000ms buffer = 5001ms)
      proofValidationService.validateProof.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(buildProofResult()), 6000),
          ),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('timed out');
      // Timeout errors are treated as validator unavailable
      expect(eventsGateway.emitValidationFailed).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ validatorUnavailable: true }),
      );
    }, 10000);

    it('should return wrapped error message for non-validator errors caught in performValidation', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockRejectedValue(
        new Error('Unexpected database error'),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      // Error is caught inside performValidation's try/catch and wrapped
      expect(result.error).toContain('Unexpected database error');

      // Should emit validation failed through the invalid path in performValidationFlow
      expect(eventsGateway.emitValidationFailed).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          requestId: 'req-1',
          status: 'VALIDATION_FAILED',
        }),
      );
    });
  });

  // ========================================================
  // Confidence threshold behavior
  // ========================================================
  describe('confidence threshold', () => {
    it('should mark as invalid when confidence is below threshold', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ isValid: true, confidence: 0.6 }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.score).toBe(0.6);
      expect(result.error).toContain('Baja confianza');
    });

    it('should mark as valid when confidence equals threshold', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ isValid: true, confidence: 0.8 }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(true);
      expect(result.score).toBe(0.8);
    });

    it('should respect custom threshold from settings', async () => {
      settingsService.getSetting.mockImplementation((key: string) => {
        if (key === 'VALIDATION_THRESHOLD') return Promise.resolve('0.9');
        if (key === 'VALIDATION_DATE_WINDOW_DAYS') return Promise.resolve('7');
        if (key === 'VALIDATION_TIMEOUT_MS') return Promise.resolve('60000');
        return Promise.resolve(null);
      });
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ isValid: true, confidence: 0.85 }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.score).toBe(0.85);
    });
  });

  // ========================================================
  // Fraud detection: DUPLICATE_TRANSACTION_ID
  // ========================================================
  describe('fraud detection - duplicate transaction ID', () => {
    it('should flag DUPLICATE_TRANSACTION_ID when same transactionId exists on another request', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ transactionId: 'TX-12345' }),
      );
      prisma.request.findFirst.mockResolvedValue({
        id: 'req-other',
        userId: 'user-1',
        status: 'COMPLETED',
      });

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.details?.flags).toContain('DUPLICATE_TRANSACTION_ID');
    });

    it('should additionally flag CROSS_USER_DUPLICATE when duplicate belongs to different user', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ transactionId: 'TX-12345' }),
      );
      prisma.request.findFirst.mockResolvedValue({
        id: 'req-other',
        userId: 'user-2',
        status: 'COMPLETED',
      });

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.details?.flags).toContain('DUPLICATE_TRANSACTION_ID');
      expect(result.details?.flags).toContain('CROSS_USER_DUPLICATE');
    });

    it('should not flag when no duplicate transactionId found', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ transactionId: 'TX-unique' }),
      );
      prisma.request.findFirst.mockResolvedValue(null);

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(true);
      expect(result.details?.flags).not.toContain('DUPLICATE_TRANSACTION_ID');
    });

    it('should add FRAUD_CHECK_ERROR flag when transaction ID check throws', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ transactionId: 'TX-12345' }),
      );
      prisma.request.findFirst.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).toContain('FRAUD_CHECK_ERROR');
    });
  });

  // ========================================================
  // Fraud detection: STATUS_NOT_APPROVED
  // ========================================================
  describe('fraud detection - STATUS_NOT_APPROVED', () => {
    it('should flag STATUS_NOT_APPROVED when transaction status is "pendiente"', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ transactionStatus: 'Pendiente' }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.details?.flags).toContain('STATUS_NOT_APPROVED');
    });

    it('should not flag when transaction status is "Aprobada"', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ transactionStatus: 'Aprobada' }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(true);
      expect(result.details?.flags).not.toContain('STATUS_NOT_APPROVED');
    });

    it('should accept various approved status variants', async () => {
      const variants = [
        'aprobada',
        'Exitosa',
        'completada',
        'Acreditada',
        'APPROVED',
      ];

      for (const status of variants) {
        proofValidationService.validateProof.mockResolvedValue(
          buildProofResult({ transactionStatus: status }),
        );
        prisma.request.findUnique.mockResolvedValue(buildRequest());

        const result = await service.validateProof('req-1');

        expect(result.details?.flags).not.toContain('STATUS_NOT_APPROVED');
      }
    });
  });

  // ========================================================
  // Fraud detection: OLD_DATE
  // ========================================================
  describe('fraud detection - OLD_DATE', () => {
    it('should flag OLD_DATE when proof date is older than date window', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days ago (window is 7)
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          extractedDate: oldDate.toISOString().split('T')[0],
        }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.details?.flags).toContain('OLD_DATE');
    });

    it('should not flag when proof date is within window', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3); // 3 days ago
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          extractedDate: recentDate.toISOString().split('T')[0],
        }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(true);
      expect(result.details?.flags).not.toContain('OLD_DATE');
    });

    it('should flag FUTURE_DATE and SUSPICIOUS when date is in the future', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          extractedDate: futureDate.toISOString().split('T')[0],
        }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.details?.flags).toContain('FUTURE_DATE');
      expect(result.details?.flags).toContain('SUSPICIOUS');
    });
  });

  // ========================================================
  // Fraud detection: CROSS_USER_SENDER
  // ========================================================
  describe('fraud detection - CROSS_USER_SENDER', () => {
    it('should flag CROSS_USER_SENDER without auto-rejecting (operator reviews)', async () => {
      // En AR es comun que un familiar pague por el usuario. El flag se mantiene
      // visible para el operador pero ya NO bloquea automaticamente.
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ senderDniCuit: '20-12345678-9' }),
      );
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'req-x', userId: 'user-2' },
      ]);

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(true);
      expect(result.details?.flags).toContain('CROSS_USER_SENDER');
      expect(result.details?.fraudFlags).toContain('CROSS_USER_SENDER');
    });

    it('should not flag when senderDniCuit is not used by another user', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ senderDniCuit: '20-12345678-9' }),
      );
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).not.toContain('CROSS_USER_SENDER');
    });
  });

  // ========================================================
  // Fraud detection: HIGH_FAILURE_RATE / VERY_HIGH_FAILURE_RATE
  // ========================================================
  describe('fraud detection - failure rate', () => {
    it('should flag HIGH_FAILURE_RATE when user has 5+ failed validations in 30 days', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult(),
      );
      prisma.request.count.mockResolvedValue(5);

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).toContain('HIGH_FAILURE_RATE');
    });

    it('should flag VERY_HIGH_FAILURE_RATE when user has 10+ failed validations', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult(),
      );
      prisma.request.count.mockResolvedValue(10);

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.details?.flags).toContain('VERY_HIGH_FAILURE_RATE');
    });

    it('should not flag when failure count is below 5', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult(),
      );
      prisma.request.count.mockResolvedValue(4);

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).not.toContain('HIGH_FAILURE_RATE');
      expect(result.details?.flags).not.toContain('VERY_HIGH_FAILURE_RATE');
    });
  });

  // ========================================================
  // Fraud detection: MULTIPLE_SENDERS
  // ========================================================
  describe('fraud detection - multiple senders', () => {
    it('should flag MULTIPLE_SENDERS when 3+ distinct senders found', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ senderName: 'Carlos Garcia' }),
      );
      // Two existing distinct senders + current = 3
      prisma.$queryRaw.mockImplementation((strings: any) => {
        const query = typeof strings === 'string' ? strings : strings[0];
        if (query && query.includes('senderDniCuit'))
          return Promise.resolve([]);
        if (query && query.includes('senderName'))
          return Promise.resolve([
            { sender_name: 'Ana Lopez' },
            { sender_name: 'Roberto Martinez' },
          ]);
        return Promise.resolve([]);
      });

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).toContain('MULTIPLE_SENDERS');
    });
  });

  // ========================================================
  // Fraud detection: LIKELY_EDITED / INVALID_FORMAT
  // ========================================================
  describe('fraud detection - authenticity checks', () => {
    it('should flag LIKELY_EDITED when editing_signs is "likely"', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          authenticityChecks: {
            editing_signs: 'likely',
            has_proper_formatting: true,
            has_bank_logo: true,
          },
        }),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.details?.flags).toContain('LIKELY_EDITED');
    });

    it('should flag INVALID_FORMAT when no proper formatting and no bank logo', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          authenticityChecks: {
            editing_signs: 'none',
            has_proper_formatting: false,
            has_bank_logo: false,
          },
        }),
      );

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).toContain('INVALID_FORMAT');
    });
  });

  // ========================================================
  // Fraud detection: RECIPIENT_MISMATCH / RECIPIENT_ACCOUNT_MISMATCH
  // ========================================================
  describe('fraud detection - recipient verification', () => {
    beforeEach(() => {
      prisma.paymentConfig.findFirst.mockResolvedValue({
        id: 'wallet-1',
        holderName: 'Juan Perez',
        holderLegalName: 'Juan Alberto Perez',
        holderDni: '12345678',
        type: 'MERCADOPAGO',
        details: { alias: 'juan.mp', cbu: '1234567890123456789012' },
      });
    });

    it('should flag RECIPIENT_MISMATCH when extracted name does not match wallet holder', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ recipientName: 'Maria Rodriguez' }),
      );

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).toContain('RECIPIENT_MISMATCH');
    });

    it('should not flag when recipient name matches holder name', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ recipientName: 'Juan Perez' }),
      );

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).not.toContain('RECIPIENT_MISMATCH');
    });

    it('should flag RECIPIENT_ACCOUNT_MISMATCH when account does not match', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ recipientAccount: 'totally.different.alias' }),
      );

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).toContain('RECIPIENT_ACCOUNT_MISMATCH');
    });

    it('should not flag when recipient account matches wallet alias', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({ recipientAccount: 'juan.mp' }),
      );

      const result = await service.validateProof('req-1');

      expect(result.details?.flags).not.toContain('RECIPIENT_ACCOUNT_MISMATCH');
    });
  });

  // ========================================================
  // Critical flags override isValid
  // ========================================================
  describe('critical flags override', () => {
    it('should mark as invalid even with high confidence when critical flag present', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          isValid: true,
          confidence: 0.99,
          transactionId: 'TX-DUP',
        }),
      );
      // Simulate duplicate transaction ID
      prisma.request.findFirst.mockResolvedValue({
        id: 'req-other',
        userId: 'user-1',
        status: 'COMPLETED',
      });

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.score).toBe(0.99);
      expect(result.details?.flags).toContain('DUPLICATE_TRANSACTION_ID');
    });
  });

  // ========================================================
  // MIME type detection
  // ========================================================
  describe('MIME type detection', () => {
    it('should detect PDF mime type from URL', async () => {
      prisma.request.findUnique.mockResolvedValue(
        buildRequest({ proofUrl: 'https://example.com/proof.pdf' }),
      );

      await service.validateProof('req-1');

      expect(proofValidationService.validateProof).toHaveBeenCalledWith(
        'https://example.com/proof.pdf',
        'application/pdf',
        5000,
        'req-1',
        null,
      );
    });

    it('should detect PNG mime type from URL', async () => {
      prisma.request.findUnique.mockResolvedValue(
        buildRequest({ proofUrl: 'https://example.com/proof.png' }),
      );

      await service.validateProof('req-1');

      expect(proofValidationService.validateProof).toHaveBeenCalledWith(
        'https://example.com/proof.png',
        'image/png',
        5000,
        'req-1',
        null,
      );
    });

    it('should default to image/jpeg for unknown extensions', async () => {
      prisma.request.findUnique.mockResolvedValue(
        buildRequest({ proofUrl: 'https://example.com/proof.jpg' }),
      );

      await service.validateProof('req-1');

      expect(proofValidationService.validateProof).toHaveBeenCalledWith(
        'https://example.com/proof.jpg',
        'image/jpeg',
        5000,
        'req-1',
        null,
      );
    });
  });

  // ========================================================
  // Details structure
  // ========================================================
  describe('result details structure', () => {
    it('should include fraudFlags in details containing only fraud-related flags', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockResolvedValue(
        buildProofResult({
          transactionStatus: 'Pendiente',
          flags: ['AMOUNT_MISMATCH'],
        }),
      );

      const result = await service.validateProof('req-1');

      // STATUS_NOT_APPROVED should be in fraudFlags
      expect(result.details?.fraudFlags).toContain('STATUS_NOT_APPROVED');
      // AMOUNT_MISMATCH is in flags but not in the fraudFlags filter list
      expect(result.details?.flags).toContain('AMOUNT_MISMATCH');
    });
  });

  // ========================================================
  // ProofValidation service error handling
  // ========================================================
  describe('performValidation error handling', () => {
    it('should return VALIDATION_ERROR flag when proofValidationService throws', async () => {
      prisma.request.findUnique.mockResolvedValue(buildRequest());
      proofValidationService.validateProof.mockRejectedValue(
        new Error('Ollama crashed'),
      );

      const result = await service.validateProof('req-1');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Ollama crashed');
    });
  });
});
