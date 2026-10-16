import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModuleRef } from '@nestjs/core';
import { BotService } from './bot.service';
import { PrismaService } from '../prisma/prisma.service';
import { BalanceService } from '../balance/balance.service';
import { EventsGateway } from '../events/events.gateway';
import { BotGateway } from './bot.gateway';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../notifications/telegram.service';

/**
 * El heartbeat prueba que el bot está vivo, NO que esté libre.
 *
 * Estas pruebas existen porque el comportamiento contrario estuvo latente mucho
 * tiempo sin que se notara: `POST /bot/heartbeat` rebotaba con 400 (el DTO no
 * aceptaba el payload de la extensión), así que `handleHeartbeat` no corría
 * nunca. Al arreglar el DTO, el `status = 'online'` incondicional se despertó y
 * empezó a borrar los estados 'busy' y 'error' cada 24 segundos.
 */
describe('BotService.handleHeartbeat — no pisa el status', () => {
  let service: BotService;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        {
          provide: PrismaService,
          useValue: {
            setting: { upsert: jest.fn() },
            $transaction: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: BalanceService, useValue: {} },
        { provide: EventsGateway, useValue: { emitBotStatus: jest.fn() } },
        { provide: BotGateway, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: TelegramService, useValue: {} },
        { provide: ModuleRef, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = mod.get<BotService>(BotService);
  });

  const hb = { version: '1.0.4-extension', uptimeMinutes: 7 };

  it('NO baja un bot ocupado a online (una carga puede durar minutos)', async () => {
    (service as any).botState.status = 'busy';
    await service.handleHeartbeat(hb);
    expect((service as any).botState.status).toBe('busy');
  });

  it('NO borra un estado de error — el operador tiene que verlo', async () => {
    (service as any).botState.status = 'error';
    await service.handleHeartbeat(hb);
    expect((service as any).botState.status).toBe('error');
  });

  it("SI levanta un bot en 'unknown' (arranque sin estado persistido)", async () => {
    (service as any).botState.status = 'unknown';
    await service.handleHeartbeat(hb);
    expect((service as any).botState.status).toBe('online');
  });

  it('SI levanta un bot que dábamos por muerto', async () => {
    (service as any).botState.status = 'offline';
    await service.handleHeartbeat(hb);
    expect((service as any).botState.status).toBe('online');
  });

  it('refresca lastHeartbeat y uptime en todos los casos', async () => {
    (service as any).botState.status = 'busy';
    (service as any).botState.lastHeartbeat = null;
    await service.handleHeartbeat(hb);
    expect((service as any).botState.lastHeartbeat).toBeInstanceOf(Date);
    // uptimeMinutes: la extension manda este nombre, no `uptime`
    expect((service as any).botState.uptime).toBe(7);
  });

  it('tampoco pisa el status por panel', async () => {
    await service.handleHeartbeat(hb, 'panel-3');
    expect(service.getPanelState('panel-3')?.status).toBe('online');

    (service as any).botStates.get('panel-3').status = 'busy';
    await service.handleHeartbeat(hb, 'panel-3');
    expect(service.getPanelState('panel-3')?.status).toBe('busy');
  });
});
