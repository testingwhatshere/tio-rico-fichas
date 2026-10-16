import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { join } from 'path';
import { ValidatorGateway } from './validator.gateway';
import { SettingsService } from '../settings/settings.service';

/**
 * Prueba el camino REAL entre el backend y el validador: el gateway de Nest
 * contra los módulos de conexión y cola de `apps/validator-app` (los mismos que
 * corren en Render), con el OCR reemplazado por un pipeline simulado.
 *
 * Cubre lo que se rompió el 2026-10-13: un corte de red del validador mandaba
 * cada comprobante en vuelo a revisión manual, y las respuestas de error salían
 * sin `id` y el backend las descartaba.
 */
const API_KEY = 'test-validator-key';
const VALIDATION_TIMEOUT_MS = 8_000;

const VALIDATOR_SRC = join(__dirname, '../../../validator-app/src');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createConnection } = require(
  join(VALIDATOR_SRC, 'socket/connection.js'),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createQueueManager } = require(join(VALIDATOR_SRC, 'socket/queue.js'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const validatorLogger = require(join(VALIDATOR_SRC, 'logger.js'));

// El logger real del validador, mudo y sin mandar logs al backend.
validatorLogger.configure({ writeFiles: false });
validatorLogger.log = () => ({});
validatorLogger.setBackendConfig = () => {};
const silent = validatorLogger;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 5_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: timeout');
    await sleep(20);
  }
}

type FakeValidator = {
  connection: any;
  queue: any;
  processed: string[];
  /** Si se setea, cada validación espera esta promesa antes de contestar. */
  gate: Promise<void> | null;
  replaced: boolean;
};

/** Un validador modo servidor con el pipeline OCR reemplazado. */
function startValidator(backendUrl: string): FakeValidator {
  const v: FakeValidator = {
    connection: null,
    queue: null,
    processed: [],
    gate: null,
    replaced: false,
  };
  v.queue = createQueueManager({
    config: {},
    logger: silent,
    sendToRenderer: () => {},
    headless: true,
    processValidationRequest: async (request: any) => {
      v.processed.push(request.id);
      if (v.gate) await v.gate;
      v.queue.emitValidationResult(request, {
        isValid: true,
        confidence: 1,
        extractedAmount: request.expectedAmount,
        reasoning: 'ok',
        flags: [],
      });
    },
    getSocket: () => v.connection?.getSocket(),
    isConnected: () => v.connection?.getIsConnected() ?? false,
  });
  v.connection = createConnection({
    config: { backendUrl, apiKey: API_KEY },
    logger: silent,
    sendToRenderer: () => {},
    queueManager: v.queue,
    updateTray: () => {},
    onReplaced: () => {
      v.replaced = true;
    },
  });
  v.connection.connectToBackend();
  return v;
}

describe('ValidatorGateway ↔ validador (modo servidor)', () => {
  let app: INestApplication;
  let gateway: ValidatorGateway;
  let backendUrl: string;
  let images: HttpServer;
  let imagesUrl: string;
  const validators: FakeValidator[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ValidatorGateway,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string) =>
              key === 'VALIDATOR_API_KEY' ? API_KEY : def,
          },
        },
        {
          provide: SettingsService,
          useValue: { getSetting: async () => String(VALIDATION_TIMEOUT_MS) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    backendUrl = `http://127.0.0.1:${port}`;
    gateway = app.get(ValidatorGateway);

    // Imágenes: /ok responde una imagen, /404 no existe.
    images = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from('fake-png'));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => images.listen(0, '127.0.0.1', () => r()));
    imagesUrl = `http://127.0.0.1:${(images.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const v of validators.splice(0)) {
      try {
        v.connection.disconnect({ permanent: true });
      } catch {
        /* noop */
      }
    }
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => images.close(() => r()));
  });

  async function connected(v: FakeValidator) {
    validators.push(v);
    await waitFor(
      () => gateway.getStatus().validatorId === v.connection.getSocket()?.id,
    );
  }

  it('valida un comprobante de punta a punta', async () => {
    const v = startValidator(backendUrl);
    await connected(v);

    const result = await gateway.requestValidation(
      'req-1',
      `${imagesUrl}/ok`,
      'image/png',
      1000,
    );

    expect(result.isValid).toBe(true);
    expect(result.requestId).toBe('req-1');
    expect(result.id).toMatch(/^val_/);
  });

  it('si no puede bajar la imagen contesta enseguida, con id, sin esperar el timeout', async () => {
    const v = startValidator(backendUrl);
    await connected(v);

    const t0 = Date.now();
    const result = await gateway.requestValidation(
      'req-404',
      `${imagesUrl}/404`,
      'image/png',
      1000,
    );

    expect(Date.now() - t0).toBeLessThan(VALIDATION_TIMEOUT_MS / 2);
    expect(result.isValid).toBe(false);
    expect(result.flags).toEqual(
      expect.arrayContaining(['IMAGE_FETCH_ERROR', 'REQUIRES_MANUAL_REVIEW']),
    );
    expect(result.requestId).toBe('req-404');
  });

  it('un corte del validador en medio de una validación no la pierde', async () => {
    const v = startValidator(backendUrl);
    await connected(v);

    let release!: () => void;
    v.gate = new Promise<void>((r) => (release = r));

    const pending = gateway.requestValidation(
      'req-corte',
      `${imagesUrl}/ok`,
      'image/png',
      2500,
    );
    await waitFor(() => v.processed.length === 1);

    // Corte de red: el backend ve la desconexión mientras el OCR sigue corriendo.
    const firstSocketId = v.connection.getSocket().id;
    v.connection.getSocket().io.engine.close();
    await waitFor(() => gateway.getStatus().validatorId !== firstSocketId);
    expect(gateway.getStatus().pendingValidations).toBe(1);

    // Termina el OCR y se reconecta: el resultado llega igual.
    release();
    const result = await pending;
    expect(result.isValid).toBe(true);
    expect(result.extractedAmount).toBe(2500);
    // Se procesó una sola vez aunque el backend lo reenvió al reconectar.
    expect(v.processed).toHaveLength(1);
  });

  it('un validador nuevo toma el lugar, recibe lo pendiente y el viejo no se reconecta', async () => {
    const viejo = startValidator(backendUrl);
    await connected(viejo);
    viejo.gate = new Promise<void>(() => {}); // nunca contesta

    const pending = gateway.requestValidation(
      'req-deploy',
      `${imagesUrl}/ok`,
      'image/png',
      700,
    );
    await waitFor(() => viejo.processed.length === 1);

    const nuevo = startValidator(backendUrl);
    await connected(nuevo);

    const result = await pending;
    expect(result.isValid).toBe(true);
    expect(nuevo.processed).toHaveLength(1);

    await waitFor(() => viejo.replaced);
    await sleep(4_000); // más que el primer reintento de reconexión (3 s)
    expect(gateway.getStatus().validatorId).toBe(
      nuevo.connection.getSocket().id,
    );
  }, 15_000);
});
