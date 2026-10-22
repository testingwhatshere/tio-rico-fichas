jest.mock('cloudinary', () => ({ v2: {} }));
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { PayoutFingerprintService } from './payout-fingerprint.service';

describe('PayoutFingerprintService', () => {
  const proof = (n: number) => ({
    url: `https://res.cloudinary.com/x/image/upload/v1/proofs/p${n}.jpg`,
    type: 'image',
  });

  function setup(claims: any[], results: any[]) {
    const stored = new Map(claims.map((c) => [c.id, c]));
    const prisma: any = {
      prizeClaim: {
        findMany: jest.fn().mockResolvedValue(claims),
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(stored.get(where.id)),
        ),
      },
      $executeRaw: jest.fn((_s: any, json: string, id: string) => {
        stored.get(id).payoutProofs = JSON.parse(json);
        return Promise.resolve(1);
      }),
    };
    const validation: any = {
      isIdle: jest.fn().mockReturnValue(true),
      validateProof: jest.fn(),
    };
    results.forEach((r) => validation.validateProof.mockResolvedValueOnce(r));
    const uploads: any = { toDeliverableUrl: (u: string) => u };
    const service = new PayoutFingerprintService(prisma, uploads, validation);
    return { service, validation, stored };
  }

  it('manda el monto del premio como monto esperado (el validador rechaza 0)', async () => {
    const { service, validation, stored } = setup(
      [{ id: 'c1', amount: 30000, payoutProofs: [proof(1)] }],
      [{ flags: [], transactionId: '184375842151', extractedAmount: 30000 }],
    );

    await service.sweep();

    expect(validation.validateProof.mock.calls[0][2]).toBe(30000);
    expect(stored.get('c1').payoutProofs[0].transactionId).toBe('184375842151');
    expect(stored.get('c1').payoutProofs[0].fingerprintedAt).toBeDefined();
  });

  it('si el validador rechaza, corta el barrido en vez de seguir con todos los premios', async () => {
    const claims = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      amount: 5000,
      payoutProofs: [proof(i)],
    }));
    const { service, validation } = setup(claims, [
      { flags: ['REQUIRES_MANUAL_REVIEW'], reasoning: 'invalid' },
    ]);

    await service.sweep();

    expect(validation.validateProof).toHaveBeenCalledTimes(1);
  });

  it('a los 3 intentos fallidos da el comprobante por ilegible', async () => {
    const fail = { flags: ['REQUIRES_MANUAL_REVIEW'], reasoning: 'x' };
    const { service, stored } = setup(
      [{ id: 'c1', amount: 5000, payoutProofs: [proof(1)] }],
      [fail, fail, fail],
    );

    await service.sweep();
    await service.sweep();
    expect(stored.get('c1').payoutProofs[0].fingerprintedAt).toBeUndefined();
    await service.sweep();

    expect(stored.get('c1').payoutProofs[0].fingerprintedAt).toBeDefined();
    expect(stored.get('c1').payoutProofs[0].transactionId).toBeNull();
  });

  it('no usa el validador si está ocupado con cargas', async () => {
    const { service, validation } = setup(
      [{ id: 'c1', amount: 5000, payoutProofs: [proof(1)] }],
      [],
    );
    validation.isIdle.mockReturnValue(false);

    await service.sweep();

    expect(validation.validateProof).not.toHaveBeenCalled();
  });
});
