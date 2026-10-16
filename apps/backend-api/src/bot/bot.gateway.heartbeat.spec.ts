import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
// ws@6 viene hoisteado desde el root del monorepo y exporta el constructor con
// `module.exports =`. Con `import * as` queda un namespace, no una clase.

const WebSocket = require('ws');
import { readFileSync } from 'fs';
import { join } from 'path';
import { BotGateway } from './bot.gateway';
import { BotService } from './bot.service';
import { PrismaService } from '../prisma/prisma.service';
import { BalanceService } from '../balance/balance.service';
import { EventsGateway } from '../events/events.gateway';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../notifications/telegram.service';
import { PanelsService } from '../panels/panels.service';
import { OperatorGateway } from '../events/operator.gateway';

/**
 * Prueba el camino REAL del heartbeat por WebSocket.
 *
 * La extensión no usa socket.io-client: abre un WebSocket pelado y arma los
 * frames del protocolo a mano (`service-worker.js:629` y `:1676`). Un test con
 * socket.io-client probaría otra cosa. Acá se replica el frame exacto.
 *
 * También verifica que `moduleRef.get(BotService, { strict: false })` resuelve
 * de verdad contra el contenedor de Nest, que es lo que no se podía comprobar
 * leyendo el código.
 */
const API_KEY = 'test-bot-api-key';
const PANEL_ID = '6a6a6b21-1111-2222-3333-444444444444';

/**
 * El payload NO se escribe a mano acá: se genera ejecutando el código real de
 * `apps/automation-extension/background/api-client.js`. Si alguien agrega un
 * campo al heartbeat de la extensión, este test lo ve; una copia pegada, no.
 */
function payloadRealDeLaExtension() {
  const ruta = join(
    __dirname,
    '../../../automation-extension/background/api-client.js',
  );
  const fuente = readFileSync(ruta, 'utf8').replace(/^export /gm, '');
  const fabrica = new Function(
    'chrome',
    `${fuente}; return ApiClient.buildHeartbeatPayload;`,
  );
  const build = fabrica({
    runtime: { getManifest: () => ({ version: '1.0.4' }) },
  });
  return build(
    { panelId: PANEL_ID, backendUrl: 'https://x', apiKey: 'k' },
    {
      panelTabId: 5,
      lastKnownUrl: 'https://panel.example/x',
      sessionValid: true,
      startTime: Date.now() - 42 * 60000,
      lastJobCompletedAt: null,
      consecutiveJobErrors: 0,
    },
  );
}

const payload = payloadRealDeLaExtension();

describe('BotGateway — heartbeat por WebSocket crudo (como la extensión)', () => {
  let app: INestApplication;
  let botService: BotService;
  let url: string;
  let emitidoAOperadores: any[];

  beforeAll(async () => {
    emitidoAOperadores = [];
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BotGateway,
        BotService,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => (k === 'BOT_API_KEY' ? API_KEY : undefined),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            setting: { upsert: jest.fn() },
            $transaction: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: BalanceService, useValue: {} },
        { provide: EventsGateway, useValue: { emitBotStatus: jest.fn() } },
        { provide: SettingsService, useValue: {} },
        { provide: TelegramService, useValue: {} },
        {
          provide: PanelsService,
          useValue: { validatePanelId: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: OperatorGateway,
          useValue: {
            emitToAll: (ev: string, d: any) =>
              emitidoAOperadores.push({ ev, d }),
          },
        },
      ],
    }).compile();

    app = mod.createNestApplication();
    await app.init();
    await app.listen(0);
    botService = mod.get(BotService);
    const port = app.getHttpServer().address().port;
    url = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket&apiKey=${encodeURIComponent(API_KEY)}&panelId=${encodeURIComponent(PANEL_ID)}`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /** Handshake socket.io v4 a mano + envío del heartbeat. Devuelve el ack. */
  function heartbeatCrudo(): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('timeout esperando heartbeat_ack'));
      }, 8000);

      ws.on('message', (raw: any) => {
        const msg = raw.toString();
        if (msg.startsWith('0{')) {
          // engine.io OPEN -> entrar al namespace /bot
          ws.send('40/bot,' + JSON.stringify({ panelId: PANEL_ID }));
        } else if (msg.startsWith('40/bot,')) {
          // namespace aceptado -> mandar el heartbeat con el frame de la extension
          ws.send('42/bot,' + JSON.stringify(['heartbeat', payload]));
        } else if (msg.startsWith('42/bot,')) {
          const [evento, data] = JSON.parse(msg.slice('42/bot,'.length));
          if (evento === 'heartbeat_ack') {
            clearTimeout(timer);
            ws.close();
            resolve(data);
          }
        }
      });
      ws.on('error', (e: any) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  it('el backend acepta el frame crudo y contesta heartbeat_ack', async () => {
    const ack = await heartbeatCrudo();
    expect(ack).toHaveProperty('timestamp');
  });

  it('actualiza lastHeartbeat y uptime — o sea, BotService resolvio por ModuleRef', async () => {
    (botService as any).botState.lastHeartbeat = null;
    (botService as any).botState.uptime = null;
    await heartbeatCrudo();
    await new Promise((r) => setTimeout(r, 150)); // la llamada es fire-and-forget
    expect((botService as any).botState.lastHeartbeat).toBeInstanceOf(Date);
    expect((botService as any).botState.uptime).toBe(42);
    expect((botService as any).botState.version).toBe('1.0.4-extension');
  });

  it('NO pisa el estado de un bot ocupado', async () => {
    (botService as any).botState.status = 'busy';
    await heartbeatCrudo();
    await new Promise((r) => setTimeout(r, 150));
    expect((botService as any).botState.status).toBe('busy');
  });

  it('NO borra un estado de error', async () => {
    (botService as any).botState.status = 'error';
    await heartbeatCrudo();
    await new Promise((r) => setTimeout(r, 150));
    expect((botService as any).botState.status).toBe('error');
  });

  it('registra el estado por panel con el panelId del handshake', async () => {
    await heartbeatCrudo();
    await new Promise((r) => setTimeout(r, 150));
    const estado = botService.getPanelState(PANEL_ID);
    expect(estado).not.toBeNull();
    expect(estado!.lastHeartbeat).toBeInstanceOf(Date);
    expect(estado!.version).toBe('1.0.4-extension');
  });

  it('emite extension:heartbeat a los operadores con los 12 campos enriquecidos', async () => {
    emitidoAOperadores.length = 0;
    await heartbeatCrudo();
    await new Promise((r) => setTimeout(r, 150));
    const hb = emitidoAOperadores.find((e) => e.ev === 'extension:heartbeat');
    expect(hb).toBeDefined();
    expect(hb.d.uptimeMinutes).toBe(42);
    expect(hb.d.currentUrl).toBe('https://panel.example/x');
    expect(hb.d.tabStatus).toBe('active');
    expect(hb.d.panelId).toBe(PANEL_ID);
    expect(hb.d.version).toBe('1.0.4-extension');
  });
});
