// Mock transitive dependencies que arrastran ESM (cloudinary, uuid, etc.).
jest.mock('../events/events.gateway');
jest.mock('../requests/requests.service');
jest.mock('../uploads/uploads.service');
jest.mock('../settings/settings.service');
jest.mock('../notifications/push.service');
jest.mock('./proof-validation.service');

import { PaymentsService } from './payments.service';

/**
 * Barrido de validaciones huérfanas: requests que quedaron en VALIDATING sin
 * nadie esperando (el backend se reinició en el medio).
 */
describe('PaymentsService.sweepStuckValidations', () => {
  const viejo = new Date(Date.now() - 10 * 60 * 1000);

  function crear(candidatos: any[]) {
    const prisma = {
      request: {
        findMany: jest.fn().mockResolvedValue(candidatos),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const events = { emitValidationFailed: jest.fn() };
    const requests = { setValidationResult: jest.fn().mockResolvedValue({}) };
    const push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentsService(
      prisma as any,
      {} as any,
      events as any,
      requests as any,
      {} as any,
      {} as any,
      {} as any,
      push as any,
    );
    const validateProof = jest
      .spyOn(service, 'validateProof')
      .mockResolvedValue({ valid: true, score: 1 } as any);
    // Sin repetidos que resolver en estos tests.
    jest.spyOn(service as any, 'proofTwinsOf').mockResolvedValue([]);
    return { service, prisma, events, requests, validateProof };
  }

  const base = {
    userId: 'u1',
    proofHash: null,
    extractedTransactionId: null,
    targetUsername: 'jugador',
    amount: 1000,
    proofUrl: 'https://res.cloudinary.com/x/image/upload/proofs/a',
    proofUploadedAt: viejo,
  };

  it('relanza una vez la validación de un request huérfano y marca el intento', async () => {
    const { service, prisma, validateProof } = crear([
      {
        ...base,
        id: 'r1',
        validationDetails: { clientCanConfirmOverpaid: true },
      },
    ]);

    await service.sweepStuckValidations();

    expect(prisma.request.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'VALIDATING' },
      data: {
        validationDetails: expect.objectContaining({
          clientCanConfirmOverpaid: true,
          stuckValidationRetries: 1,
        }),
      },
    });
    expect(validateProof).toHaveBeenCalledWith('r1');
  });

  it('no relanza un segundo intento: lo manda a revisión manual', async () => {
    const { service, validateProof, requests, events } = crear([
      { ...base, id: 'r2', validationDetails: { stuckValidationRetries: 1 } },
    ]);

    await service.sweepStuckValidations();
    await new Promise((r) => setImmediate(r));

    expect(validateProof).not.toHaveBeenCalled();
    expect(requests.setValidationResult).toHaveBeenCalledWith(
      'r2',
      expect.objectContaining({ valid: false }),
    );
    expect(events.emitValidationFailed).toHaveBeenCalled();
  });

  it('no toca la pregunta de "transferiste de más" que espera al jugador', async () => {
    const { service, prisma, validateProof } = crear([
      {
        ...base,
        id: 'r3',
        validationDetails: { overpaidOffer: { status: 'PENDING' } },
      },
    ]);

    await service.sweepStuckValidations();

    expect(prisma.request.updateMany).not.toHaveBeenCalled();
    expect(validateProof).not.toHaveBeenCalled();
  });

  it('no relanza si el request cambió de estado justo antes', async () => {
    const { service, prisma, validateProof } = crear([
      { ...base, id: 'r4', validationDetails: null },
    ]);
    prisma.request.updateMany.mockResolvedValue({ count: 0 });

    await service.sweepStuckValidations();

    expect(validateProof).not.toHaveBeenCalled();
  });

  it('busca sólo VALIDATING con comprobante subido hace más de 4 minutos', async () => {
    const { service, prisma } = crear([]);

    await service.sweepStuckValidations();

    const where = prisma.request.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('VALIDATING');
    expect(where.proofUrl).toEqual({ not: null });
    const cutoff = where.proofUploadedAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(4 * 60 * 1000 - 50);
  });
});
