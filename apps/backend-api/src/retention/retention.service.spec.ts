import { Test, TestingModule } from '@nestjs/testing';
import { RetentionService } from './retention.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

/**
 * Lo que se prueba acá es que NO borre de más: una carga que no terminó bien
 * puede estar en revisión y su comprobante es la única evidencia.
 */
describe('RetentionService', () => {
  let service: RetentionService;
  let prisma: any;
  let uploads: { deleteByPublicId: jest.Mock };

  const PDF =
    'https://res.cloudinary.com/demo/image/upload/v1/proofs/abc123.pdf';

  beforeEach(async () => {
    prisma = {
      request: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      botSessionLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      validatorLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    uploads = { deleteByPublicId: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: uploads },
      ],
    }).compile();

    service = module.get(RetentionService);
  });

  describe('comprobantes', () => {
    it('sólo mira cargas COMPLETED, viejas y sin purgar', async () => {
      await service.purgeOldProofs();

      const where = prisma.request.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('COMPLETED');
      expect(where.proofUrl).toEqual({ not: null });

      // El corte tiene que caer alrededor de 6 meses atrás.
      const dias =
        (Date.now() - where.createdAt.lt.getTime()) / (24 * 60 * 60 * 1000);
      expect(Math.round(dias)).toBe(180);
    });

    it('borra el archivo y marca la carga', async () => {
      prisma.request.findMany.mockResolvedValue([{ id: 'req-1', proofUrl: PDF }]);

      const n = await service.purgeOldProofs();

      expect(uploads.deleteByPublicId).toHaveBeenCalledWith('proofs/abc123');
      expect(prisma.request.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { proofUrl: null },
      });
      expect(n).toBe(1);
    });

    it('si no puede interpretar la URL no borra nada', async () => {
      prisma.request.findMany.mockResolvedValue([
        { id: 'req-1', proofUrl: 'https://otro-servidor.com/x.pdf' },
      ]);

      const n = await service.purgeOldProofs();

      expect(uploads.deleteByPublicId).not.toHaveBeenCalled();
      expect(prisma.request.update).not.toHaveBeenCalled();
      expect(n).toBe(0);
    });

    it('un archivo que falla no corta la tanda ni marca la carga', async () => {
      prisma.request.findMany.mockResolvedValue([
        { id: 'req-1', proofUrl: PDF },
        { id: 'req-2', proofUrl: PDF.replace('abc123', 'def456') },
      ]);
      uploads.deleteByPublicId
        .mockRejectedValueOnce(new Error('Cloudinary caído'))
        .mockResolvedValueOnce(undefined);

      const n = await service.purgeOldProofs();

      expect(n).toBe(1);
      expect(prisma.request.update).toHaveBeenCalledTimes(1);
      expect(prisma.request.update.mock.calls[0][0].where).toEqual({
        id: 'req-2',
      });
    });
  });

  describe('logs', () => {
    it('borra los de más de 30 días, y sólo esos', async () => {
      prisma.botSessionLog.deleteMany.mockResolvedValue({ count: 120 });
      prisma.validatorLog.deleteMany.mockResolvedValue({ count: 80 });

      const r = await service.purgeOldLogs();

      expect(r).toEqual({ bot: 120, validator: 80 });
      for (const mock of [
        prisma.botSessionLog.deleteMany,
        prisma.validatorLog.deleteMany,
      ]) {
        const corte = mock.mock.calls[0][0].where.createdAt.lt;
        const dias = (Date.now() - corte.getTime()) / (24 * 60 * 60 * 1000);
        expect(Math.round(dias)).toBe(30);
      }
    });
  });
});
