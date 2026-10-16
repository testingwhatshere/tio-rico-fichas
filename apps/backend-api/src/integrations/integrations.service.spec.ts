jest.mock('../requests/requests.service');
jest.mock('../users/users.service');
jest.mock('../jobs/jobs.service');
jest.mock('../settings/settings.service');
jest.mock('../prize-claims/prize-claims.service');
jest.mock('../uploads/uploads.service');

import { createHmac } from 'crypto';
import { IntegrationsService } from './integrations.service';
import { RequestsService } from '../requests/requests.service';
import { UsersService } from '../users/users.service';
import { JobsService } from '../jobs/jobs.service';
import { SettingsService } from '../settings/settings.service';
import { PrizeClaimsService } from '../prize-claims/prize-claims.service';
import { UploadsService } from '../uploads/uploads.service';

/**
 * Acciones pedidas desde TioRicoCargas. Prisma en memoria (sólo lo que usa el
 * servicio) para probar el circuito completo: alta idempotente → seguimiento →
 * webhook firmado.
 */
function fakePrisma() {
  const actions = new Map<string, any>();
  const users: any[] = [];
  const claims = new Map<string, any>();
  const jobs = new Map<string, any>();
  const requests = new Map<string, any>();
  let seq = 0;
  const match = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'equals' in v)
        return (
          String(row[k] ?? '').toLowerCase() === String(v.equals).toLowerCase()
        );
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
      if (v && typeof v === 'object' && 'lte' in v) return row[k] <= v.lte;
      return row[k] === v;
    });
  return {
    actions,
    users,
    jobs,
    requests,
    integrationAction: {
      findUnique: jest.fn(async ({ where }) => {
        const k = where.source_externalId;
        return (
          [...actions.values()].find(
            (a) => a.source === k.source && a.externalId === k.externalId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }) => {
        const row = {
          id: `act${++seq}`,
          status: 'RUNNING',
          amount: null,
          requestId: null,
          jobId: null,
          userId: null,
          result: null,
          error: null,
          createdAt: new Date(),
          completedAt: null,
          callbackStatus: 'NONE',
          callbackAttempts: 0,
          callbackNextAt: null,
          ...data,
        };
        actions.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = actions.get(where.id);
        for (const [k, v] of Object.entries<any>(data)) {
          row[k] =
            v && typeof v === 'object' && 'increment' in v
              ? row[k] + v.increment
              : v;
        }
        return row;
      }),
      findMany: jest.fn(async ({ where }) =>
        [...actions.values()].filter((a) => match(a, where)),
      ),
      findFirst: jest.fn(async ({ where }) => {
        const { id, ...rest } = where;
        return (
          [...actions.values()].find(
            (a) => match(a, rest) && (!id?.not || a.id !== id.not),
          ) ?? null
        );
      }),
    },
    prizeClaim: {
      create: jest.fn(async ({ data }) => {
        const c = { id: `claim${++seq}`, ...data };
        claims.set(c.id, c);
        return c;
      }),
      findUnique: jest.fn(async ({ where }) => claims.get(where.id) ?? null),
    },
    user: {
      findUnique: jest.fn(
        async ({ where }) => users.find((u) => u.id === where.id) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }) => users.find((u) => match(u, where)) ?? null,
      ),
      create: jest.fn(async ({ data }) => {
        const u = { id: `u${++seq}`, panelId: null, ...data };
        users.push(u);
        return u;
      }),
      update: jest.fn(async ({ where, data }) =>
        Object.assign(
          users.find((u) => u.id === where.id),
          data,
        ),
      ),
    },
    job: {
      create: jest.fn(async ({ data }) => {
        const j = { id: `job${++seq}`, error: null, result: null, ...data };
        jobs.set(j.id, j);
        return j;
      }),
      findUnique: jest.fn(async ({ where }) => jobs.get(where.id) ?? null),
      findFirst: jest.fn(
        async ({ where }) =>
          [...jobs.values()].find((j) => match(j, where)) ?? null,
      ),
    },
    request: {
      findUnique: jest.fn(async ({ where }) => requests.get(where.id) ?? null),
    },
  };
}

function setup(env: Record<string, string> = {}) {
  const prisma = fakePrisma();
  const requestsSvc = {
    createManualLoad: jest.fn(async () => ({ requestId: 'req1' })),
  };
  const usersSvc = {
    findOrCreateOperator: jest.fn(async () => ({ id: 'op1' })),
  };
  const jobsSvc = {
    tryDispatchNextJob: jest.fn(async () => ({ dispatched: true })),
  };
  const settingsSvc = { getSetting: jest.fn(async () => 'panel-default') };
  const prizesSvc = {
    process: jest.fn(async (claimId: string) => {
      const c = await prisma.prizeClaim.findUnique({ where: { id: claimId } });
      if (c) c.status = 'PROCESSING';
      return { success: true, jobId: 'withdraw-job' };
    }),
    complete: jest.fn(async (claimId: string) => {
      const c = await prisma.prizeClaim.findUnique({ where: { id: claimId } });
      if (c) c.status = 'COMPLETED';
    }),
  };
  const uploadsSvc = {
    getFileBuffer: jest.fn(async () => Buffer.from('jpg')),
    uploadFile: jest.fn(async () => ({ cloudinaryUrl: 'https://res.cloudinary.com/plataforma/copia.jpg' })),
  };
  const services = new Map<unknown, unknown>([
    [RequestsService, requestsSvc],
    [UsersService, usersSvc],
    [JobsService, jobsSvc],
    [SettingsService, settingsSvc],
    [PrizeClaimsService, prizesSvc],
    [UploadsService, uploadsSvc],
  ]);
  const moduleRef = { get: (token: unknown) => services.get(token) ?? null };
  const config = { get: (k: string) => env[k] };
  const service = new IntegrationsService(
    prisma as any,
    moduleRef as any,
    config as any,
  );
  return { service, prisma, requestsSvc, jobsSvc, prizesSvc, uploadsSvc };
}

afterEach(() => jest.restoreAllMocks());

describe('IntegrationsService', () => {
  it('la misma acción dos veces (mismo externalId) carga UNA sola vez', async () => {
    const { service, requestsSvc } = setup();
    const dto = {
      externalId: 'trc-abc-123',
      type: 'LOAD_CREDITS' as const,
      username: 'Juan_1',
      amount: 5000.7,
    };
    const a = await service.submit(dto);
    const b = await service.submit(dto);
    expect(b.actionId).toBe(a.actionId);
    expect(requestsSvc.createManualLoad).toHaveBeenCalledTimes(1);
    expect(requestsSvc.createManualLoad).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, operatorId: 'op1' }),
    );
  });

  it('carga a un usuario que la plataforma no conoce: lo crea como cliente', async () => {
    const { service, prisma } = setup();
    await service.submit({
      externalId: 'trc-new-0001',
      type: 'LOAD_CREDITS',
      username: 'nuevo99',
      amount: 1000,
    });
    expect(prisma.users).toEqual([
      expect.objectContaining({
        username: 'nuevo99',
        savedTargetUsername: 'nuevo99',
        role: 'CLIENT',
      }),
    ]);
  });

  it('sigue la carga hasta COMPLETED y avisa por webhook firmado', async () => {
    const { service, prisma } = setup({
      TRC_CALLBACK_URL: 'https://trc.test/api/hooks/platform',
      TRC_WEBHOOK_SECRET: 's3cret',
    });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as any);
    const a = await service.submit({
      externalId: 'trc-load-0002',
      type: 'LOAD_CREDITS',
      username: 'pepe',
      amount: 2000,
    });

    prisma.requests.set('req1', {
      status: 'COMPLETED',
      amount: 2000,
      validationError: null,
      job: null,
    });
    await service.reconcile();
    await service.deliverCallbacks();

    const row = prisma.actions.get(a.actionId);
    expect(row.status).toBe('COMPLETED');
    expect(row.result).toEqual({ amount: 2000 });
    expect(row.callbackStatus).toBe('DELIVERED');

    const [, init] = fetchMock.mock.calls[0] as any;
    const ts = init.headers['X-Platform-Timestamp'];
    const expected = createHmac('sha256', 's3cret')
      .update(`${ts}.${init.body}`)
      .digest('hex');
    expect(init.headers['X-Platform-Signature']).toBe(expected);
    expect(JSON.parse(init.body).action.externalId).toBe('trc-load-0002');
  });

  it('si el webhook falla, queda pendiente para reintentar (no se repite la carga)', async () => {
    const { service, prisma, requestsSvc } = setup({
      TRC_CALLBACK_URL: 'https://trc.test/h',
      TRC_WEBHOOK_SECRET: 'x',
    });
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    const a = await service.submit({
      externalId: 'trc-load-0003',
      type: 'LOAD_CREDITS',
      username: 'ana',
      amount: 100,
    });
    prisma.requests.set('req1', {
      status: 'FAILED',
      amount: 100,
      validationError: null,
      job: { error: 'No success/error response detected' },
    });
    await service.reconcile();
    await service.deliverCallbacks();
    const row = prisma.actions.get(a.actionId);
    expect(row.status).toBe('FAILED');
    expect(row.error).toContain('No success/error response');
    expect(row.callbackStatus).toBe('PENDING');
    expect(row.callbackAttempts).toBe(1);
    expect(requestsSvc.createManualLoad).toHaveBeenCalledTimes(1);
  });

  it('ver saldo: crea VERIFY_CHIPS en el panel del usuario y devuelve el saldo leído', async () => {
    const { service, prisma, jobsSvc } = setup();
    prisma.users.push({
      id: 'u-x',
      username: 'lu',
      savedTargetUsername: 'lu',
      panelId: 'p2',
      role: 'CLIENT',
    });
    const a = await service.submit({
      externalId: 'trc-bal-0004',
      type: 'CHECK_BALANCE',
      username: 'lu',
    });
    const job = [...prisma.jobs.values()][0];
    expect(job).toEqual(
      expect.objectContaining({
        type: 'VERIFY_CHIPS',
        panelId: 'p2',
        targetUsername: 'lu',
      }),
    );
    expect(jobsSvc.tryDispatchNextJob).toHaveBeenCalledWith('p2');

    Object.assign(job, {
      status: 'COMPLETED',
      result: { success: true, reading: { success: true, balance: 12345 } },
    });
    await service.reconcile();
    expect(prisma.actions.get(a.actionId)).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        result: { balance: 12345 },
      }),
    );
  });

  it('ver saldo de alguien sin panel conocido: falla con un mensaje claro, sin crear trabajo', async () => {
    const { service, prisma } = setup();
    const a = await service.submit({
      externalId: 'trc-bal-0005',
      type: 'CHECK_BALANCE',
      username: 'fantasma',
    });
    expect(a.status).toBe('FAILED');
    expect(a.error).toMatch(/no sé en qué panel/i);
    expect(prisma.jobs.size).toBe(0);
  });

  it('crear usuario: va al panel por defecto y al terminar fija el panel del usuario', async () => {
    const { service, prisma } = setup();
    const a = await service.submit({
      externalId: 'trc-cre-0006',
      type: 'CREATE_USER',
      username: 'nuevo_user',
    });
    const job = [...prisma.jobs.values()][0];
    expect(job).toEqual(
      expect.objectContaining({
        type: 'CREATE_USER',
        panelId: 'panel-default',
        newPassword: '123casino',
      }),
    );
    Object.assign(job, { status: 'COMPLETED' });
    await service.reconcile();
    expect(prisma.actions.get(a.actionId).status).toBe('COMPLETED');
    expect(prisma.users[0].panelId).toBe('panel-default');
  });

  it('crear usuario con caracteres que el panel no acepta: se rechaza antes de crear nada', async () => {
    const { service, prisma } = setup();
    await expect(
      service.submit({
        externalId: 'trc-cre-0007',
        type: 'CREATE_USER',
        username: 'con.punto',
      }),
    ).rejects.toThrow(/letras, números/);
    expect(prisma.actions.size).toBe(0);
  });

  it('cambiar contraseña: un solo cambio en curso por usuario', async () => {
    const { service, prisma } = setup();
    prisma.users.push({
      id: 'u-y',
      username: 'mia',
      savedTargetUsername: 'mia',
      panelId: 'p3',
      role: 'CLIENT',
    });
    const a = await service.submit({
      externalId: 'trc-pwd-0008',
      type: 'CHANGE_PASSWORD',
      username: 'mia',
      newPassword: 'nueva1234',
    });
    expect(a.status).toBe('RUNNING');
    const b = await service.submit({
      externalId: 'trc-pwd-0009',
      type: 'CHANGE_PASSWORD',
      username: 'mia',
      newPassword: 'otra12345',
    });
    expect(b.status).toBe('FAILED');
    expect(b.error).toMatch(/en curso/);
  });

  describe('premio', () => {
    function conUsuario(env: Record<string, string> = {}) {
      const ctx = setup(env);
      ctx.prisma.users.push({ id: 'u-p', username: 'gana', savedTargetUsername: 'gana', panelId: 'p2', role: 'CLIENT' });
      return ctx;
    }

    it('primero lee el saldo; si no alcanza, falla con el motivo y NO se registra premio', async () => {
      const { service, prisma, prizesSvc } = conUsuario();
      const a = await service.submit({ externalId: 'trc-pre-0010', type: 'WITHDRAW_PRIZE', username: 'gana', amount: 10000 });
      expect(a.phase).toBe('VERIFYING');
      const job = [...prisma.jobs.values()][0];
      expect(job.type).toBe('VERIFY_CHIPS');

      Object.assign(job, { status: 'COMPLETED', result: { reading: { success: true, balance: 4000 } } });
      await service.reconcile();
      const row = prisma.actions.get(a.actionId);
      expect(row.status).toBe('FAILED');
      expect(row.result).toEqual({ reason: 'INSUFFICIENT_CHIPS', balance: 4000, amount: 10000 });
      expect(row.error).toMatch(/No le alcanzan/);
      expect(prisma.prizeClaim.create).not.toHaveBeenCalled();
      expect(prizesSvc.process).not.toHaveBeenCalled();
    });

    it('si alcanza: registra el premio verificado, arranca el retiro y avisa el avance', async () => {
      const { service, prisma, prizesSvc } = conUsuario({ TRC_CALLBACK_URL: 'https://trc.test/h', TRC_WEBHOOK_SECRET: 'x' });
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as any);
      const a = await service.submit({ externalId: 'trc-pre-0011', type: 'WITHDRAW_PRIZE', username: 'gana', amount: 3000 });
      const verify = [...prisma.jobs.values()][0];
      Object.assign(verify, { status: 'COMPLETED', result: { reading: { success: true, balance: 50000 } } });
      await service.reconcile();

      const row = prisma.actions.get(a.actionId);
      expect(row).toMatchObject({ status: 'RUNNING', phase: 'WITHDRAWING', jobId: 'withdraw-job' });
      expect(prisma.prizeClaim.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u-p', amount: 3000, status: 'VERIFIED', verifiedBalance: 50000, panelId: 'p2' }),
      });
      expect(prizesSvc.process).toHaveBeenCalledWith(row.prizeClaimId, 'op1');

      // El aviso de avance sale aunque la acción siga en curso.
      await service.deliverCallbacks();
      const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
      expect(sent.action).toMatchObject({ status: 'RUNNING', phase: 'WITHDRAWING' });

      // Fichas retiradas → acción completa (falta pagar).
      const c = await prisma.prizeClaim.findUnique({ where: { id: row.prizeClaimId } });
      c.status = 'CHIPS_WITHDRAWN';
      await service.reconcile();
      expect(prisma.actions.get(a.actionId)).toMatchObject({
        status: 'COMPLETED',
        result: expect.objectContaining({ paid: false, amount: 3000 }),
      });
    });

    async function premioRetirado() {
      const ctx = conUsuario();
      const a = await ctx.service.submit({ externalId: 'trc-pre-0020', type: 'WITHDRAW_PRIZE', username: 'gana', amount: 3000 });
      Object.assign([...ctx.prisma.jobs.values()][0], { status: 'COMPLETED', result: { reading: { success: true, balance: 9000 } } });
      await ctx.service.reconcile();
      const row = ctx.prisma.actions.get(a.actionId);
      (await ctx.prisma.prizeClaim.findUnique({ where: { id: row.prizeClaimId } })).status = 'CHIPS_WITHDRAWN';
      await ctx.service.reconcile();
      return { ...ctx, row };
    }
    const proof = { url: 'https://res.cloudinary.com/trc/pago.jpg', type: 'image' as const };

    it('registrar el pago: guarda copia propia del comprobante, completa el premio y queda pagado', async () => {
      const { service, prizesSvc, row } = await premioRetirado();
      const v = await service.payout('trc-pre-0020', [proof]);
      expect(prizesSvc.complete).toHaveBeenCalledWith(row.prizeClaimId, 'op1', {
        proofs: [{ url: 'https://res.cloudinary.com/plataforma/copia.jpg', type: 'image' }],
      });
      expect(v.result).toMatchObject({ paid: true, amount: 3000 });
    });

    it('registrar el pago dos veces: el premio se completa UNA sola vez', async () => {
      const { service, prizesSvc } = await premioRetirado();
      await service.payout('trc-pre-0020', [proof]);
      const v = await service.payout('trc-pre-0020', [proof]);
      expect(prizesSvc.complete).toHaveBeenCalledTimes(1);
      expect(v.result).toMatchObject({ paid: true });
    });

    it('si no se puede copiar el comprobante, el pago se registra igual con el link original', async () => {
      const { service, prizesSvc, uploadsSvc, row } = await premioRetirado();
      uploadsSvc.getFileBuffer.mockRejectedValueOnce(new Error('HTTP 404'));
      await service.payout('trc-pre-0020', [proof]);
      expect(prizesSvc.complete).toHaveBeenCalledWith(row.prizeClaimId, 'op1', { proofs: [proof] });
    });

    it('no deja registrar el pago de un premio que no se retiró', async () => {
      const { service, prizesSvc } = conUsuario();
      await service.submit({ externalId: 'trc-pre-0030', type: 'WITHDRAW_PRIZE', username: 'gana', amount: 3000 });
      await expect(service.payout('trc-pre-0030', [proof])).rejects.toThrow(/fichas ya retiradas/);
      expect(prizesSvc.complete).not.toHaveBeenCalled();
    });
  });
});
