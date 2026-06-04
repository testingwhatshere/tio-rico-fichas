# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plataforma de carga automatizada de créditos en un panel de juego externo. La filosofía del sistema es **"casi totalmente automatizado, los humanos supervisan fallas"**: el flujo normal corre sin intervención humana (chat → AI valida comprobante → extension verifica acreditación en MP → bot carga créditos), y los operadores solo intervienen ante validación fallida, error del bot, sospecha o consulta del usuario.

Se conecta a paneles externos protegidos por Cloudflare. Por eso la automatización corre en **Chrome real con extensión MV3**, no en Playwright/Puppeteer (los headless dejan fingerprint detectable). Mantener esta decisión arquitectónica.

## Critical Project Rules

Reglas duras del proyecto. Romperlas tiene consecuencias reales (datos perdidos, bot detectado, usuarios afectados).

1. **Nunca correr seed/migrations/ops destructivas sobre la DB.** La base tiene datos de producción. `prisma migrate reset`, `prisma db push --force-reset`, `db:seed` y similares están prohibidos sin pedido explícito del usuario.
2. **Aislar cambios al app target del monorepo.** No tocar otros apps "de paso". Cada app tiene su propio dueño en producción.
3. **Ollama corre solo en operator-panel desktop.** Es la máquina 24/7. Nunca portar AI a móvil/backend.
4. **Chat app no expone historial ni totales al usuario.** No mostrar lista de pedidos, cantidades acumuladas, ni info estilo "ya cargaste $X".
5. **Reglas no negociables del bot** (todas viven en `apps/automation-extension/content/humanize.js` y `panel-automation.js`):
   - Nunca headless. Nunca acciones instantáneas. Delays randomizados 2-7s, tipeo char-por-char.
   - **Un solo job a la vez.** Nada de paralelismo ni batches.
   - Login una vez, persistir cookies + localStorage. Logins frecuentes = red flag.
   - **Nunca reintentar automáticamente.** Si falla → STOP, log, esperar revisión manual.
   - Clicks en panel siempre en MAIN world: `chrome.scripting.executeScript({ world: 'MAIN' })` desde `job-processor.js`. Nunca `document.createElement('script')` (CSP lo bloquea), nunca `form.requestSubmit()` como fallback (causa double-execution).

## Common Commands

### Dev / Build (desde root)

```bash
bun install                    # instalar todo (workspaces)
bun run dev                    # arranca todos los apps en paralelo (Bun workspaces)

bun run build:backend          # nest build (incluye prisma generate)
bun run build:chat             # expo export --platform web
bun run build:operator         # electron-builder operator-panel
bun run build:validator        # electron-builder validator-app
bun run build:extension        # zip de automation-extension
bun run build:all              # ./scripts/build-all.sh
```

### Backend (apps/backend-api)

```bash
bun run start:dev              # NestJS en watch mode (puerto 3000)
bun run lint                   # eslint --fix
bun run test                   # Jest, todo el suite
bun run test -- ruta/al/archivo.spec.ts   # un solo test file
bun run test -- -t "nombre"    # filtrar por nombre de test

bun run db:push                # sincronizar schema sin migración (dev)
bun run db:migrate:deploy      # aplicar migraciones (prod)
bun run db:studio              # Prisma Studio
# NUNCA: db:seed, prisma migrate reset (ver Critical Rules)
```

### E2E

`package.json` define `test:e2e` apuntando a `tests/e2e/playwright.config.ts`, pero **el directorio `tests/` no existe en este branch**. Si se restauran tests, el backend default es `http://localhost:3005` (no 3000) y `apps/chat-app/.env` debe apuntar al mismo URL.

### Builds de producción (APK / exe / Docker)

Ver **`build-and-deploy-instructions.md`**. Tiene la matriz de versiones críticas y los workarounds obligatorios:
- **Expo 52 + Kotlin 1.9.25 pin** (1.9.24 falla con Compose Compiler).
- **Parche manual a `expo-av/android/build.gradle`** (v15 requiere expo-module-gradle-plugin de Expo 53).
- **`expo prebuild --no-install`** para `operator-mobile` (sino el ajv del root rompe).
- **Servicios Render**: `srv-d75uba75r7bs738qam90` (api), `srv-d77ghg95pdvs73a5edlg` (chat-web), `srv-d77gn815pdvs73a5g20g` (landing).

> El `Makefile` en root quedó desactualizado: tiene targets `make bot` apuntando a `apps/automation-bot/` (no existe; ahora es `apps/automation-extension/` y se carga unpacked en Chrome). Preferir los scripts de `package.json`.

## Architecture

### Data Flow (happy path, 100% automático)

```
chat-app  →  POST proof  →  backend (RequestStatus.VALIDATING)
                              │
                              ↓ /validator namespace (Socket.IO)
                          validator-app (Ollama OCR + score)
                              │ valid
                              ↓ RequestStatus.PENDING_MP_VERIFICATION
                          mp-verification-extension (scrapea MP activities)
                              │ match con operationNumber
                              ↓ RequestStatus.APPROVED
                          JobsService.tryDispatchNextJob()  (cola Postgres)
                              │ /bot namespace
                              ↓
                          automation-extension (Chrome real, MAIN-world clicks)
                              │ success
                              ↓ RequestStatus.COMPLETED + balance update
                          chat:message + push notification al usuario
```

### Failure path
Cualquier paso falla → `RequestStatus.VALIDATION_FAILED` o `FAILED` → emite a `/operator` namespace + Telegram → operador revisa modal con proof + score + reason → APPROVE manual / REJECT / pedir nuevo proof.

### Backend (apps/backend-api/src/)

NestJS 11 + Prisma 6.1 (cliente; root usa Prisma 7.2 — la fuente de verdad del schema es `apps/backend-api/prisma/schema.prisma`). Módulos actuales:

```
audit  auth  balance  bot  chats  common  dashboard  discovery  events
health  jobs  logging  messages  metrics  mp-verification  notifications
operators  outbound-payments  panels  payments  prisma  prize-claims
requests  settings  status  telegram-bot  uploads  users  validator  withdrawals
```

Convención: controllers thin (routing), services con la lógica, guards para roles (`RolesGuard`, `BotApiKeyGuard`), interceptores para audit log.

### Socket.IO Gateways (7 namespaces)

| Namespace | Archivo | Cliente |
|-----------|---------|---------|
| `/` (root) | `events/events.gateway.ts` | (legacy / general) |
| `/chats` | `events/chats.gateway.ts` | chat-app |
| `/operator` | `events/operator.gateway.ts` | operator-panel + operator-mobile |
| `/bot` | `bot/bot.gateway.ts` | automation-extension |
| `/validator` | `validator/validator.gateway.ts` | validator-app (heartbeat app-level 30s, timeout server-side 90s) |
| `/payment-bot` | `outbound-payments/payment-bot.gateway.ts` | 4 payment extensions (MP/Fiwind/Ripio/Prex) |
| `/mp-verifier` | `mp-verification/mp-verification.gateway.ts` | 4 verification extensions |

Notas:
- `BotGateway` usa `pingInterval: 60s`, `pingTimeout: 30s`, debounce de 45s en disconnect (para tolerar suspensión del Service Worker de Chrome).
- `ValidatorGateway` usa lazy injection vía `ModuleRef` para acceder a `OperatorGateway` (evita circular dep).
- `OperatorGateway` necesita `forwardRef` para inyectar `EventsGateway` y `ChatsGateway`.

### Cola de jobs (Postgres, no BullMQ)

La tabla `Job` es la cola. **No hay Redis ni BullMQ** (el campo `Job.bullmqJobId` es vestigial). Diseño:

- `JobsService.tryDispatchNextJob()` envuelve el fetch-and-lock en `$transaction({ isolationLevel: 'Serializable' })` para que dos requests concurrentes no procesen el mismo job.
- Concurrencia 1, FIFO por `createdAt`, cooldown configurable entre jobs (`QUEUE_COOLDOWN_MS`, default 30s).
- Stuck-job checker corre cada 5min y resetea `PROCESSING` viejos a `QUEUED`.
- En completion exitoso, `BotService` agrega balance al usuario (con dedup check para evitar doble suma) y crea record de transacción.

### Apps del monorepo (20 apps)

| App | Stack | Rol |
|-----|-------|-----|
| `backend-api` | NestJS 11, Prisma 6.1, Socket.IO | API + WS server, fuente de verdad |
| `chat-app` | Expo 54, RN 0.81, Zustand | App móvil del usuario final (APK) |
| `chat-app-web` | (build artifact) | Export web del chat-app — rebuild con `expo export` |
| `operator-panel` | Electron 33, vanilla JS | Desktop operador, **corre Ollama** |
| `operator-mobile` | Expo / RN | Operador móvil, paridad con desktop |
| `validator-app` | Electron 33 + Ollama | Valida proofs (llava/llama3.2-vision/minicpm-v) |
| `automation-extension` | Chrome MV3 | Bot que carga créditos en panel de juego |
| `mp-verification-extension` | Chrome MV3 | Verifica acreditación entrante en MercadoPago |
| `ripio-verification-extension` | Chrome MV3 | Idem para Ripio (selectores pendientes) |
| `fiwind-verification-extension` | Chrome MV3 | Idem para Fiwind (selectores pendientes) |
| `prex-verification-extension` | Chrome MV3 | Idem para Prex (selectores pendientes) |
| `wallet-listener-android` | Kotlin + Compose, MV3-equivalent | App Android nativa que reemplaza progresivamente las verification extensions. Vive en celulares del cliente con sesión iniciada en una billetera; lee notifs push via `NotificationListenerService` y reporta al backend en el namespace `/mp-verifier`. Cubre billeteras mobile-only (Brubank, Cuenta DNI, Ualá, etc.) que no tienen panel web scrapeable. |
| `mp-payment-extension` | Chrome MV3 | Pagos salientes desde MercadoPago |
| `ripio-payment-extension` | Chrome MV3 | Pagos salientes desde Ripio |
| `fiwind-payment-extension` | Chrome MV3 | Pagos salientes desde Fiwind |
| `prex-payment-extension` | Chrome MV3 | Pagos salientes desde Prex |
| `client-manager` | (multi-cliente) | Gestión de instancias de la plataforma |
| `onboarding-portal` | (estático/web) | Portal de alta de nuevos clientes |
| `landing-page` | HTML/CSS/JS + Dockerfile | Marketing + descarga APK |
| `sales-page` | (estático) | Página de ventas |
| `owner-dashboard` | Vanilla JS + Chart.js | Servido por backend en `/dashboard` |

Packages compartidos: `shared-types` (DTOs/enums), `shared-utils` (helpers), `shared-config` (env schemas).

## Non-obvious gotchas

- **Prisma client 6.1 ≠ Prisma 7.2 root.** El backend declara `@prisma/client@6.1.0`; el root tiene `prisma@7.2.0` y `@prisma/client@7.2.0`. Operar siempre desde `apps/backend-api/` para comandos de Prisma.
- **`EventsGateway` y `ChatsGateway` no se inyectan a `OperatorGateway` por default** → requieren `forwardRef`.
- **Chat-app socket conecta a `/chats`, no al root.**
- **FlatList del chat está invertida** (newest first = index 0).
- **Operator panel: preload.js es bridge IPC** entre main (sockets) y renderer (UI). Cada nuevo evento WS necesita un `onXxx` en preload + window global en renderer.
- **`chatToRequestMap`** en `apps/chat-app/stores/request.store.ts` mapea chatId→requestId. Mensajes ruteados sin esto se pierden.
- **`Decimal` de Prisma llega como string** al frontend. Usar `parseAmount()` de `apps/chat-app/utils/amount.ts`.
- **Eventos de wallet usan timestamp guard por wallet** (Map, no global) para evitar procesar fuera de orden.
- **Mensajes desconocidos**: el chat-app bufferea por chatId con max 50 y TTL 5min para reconciliar race conditions de creación de chat.
- **Bot WebSocket auth**: el extension manda `apiKey` en query string (raw WS, no header), no en `auth` payload.
- **Comments en operator-panel a veces salen como `/` en grep output** — leer el archivo real con `Read`, no asumir desde Grep.

## Reference Pointers

- **`build-and-deploy-instructions.md`** — flujo completo de builds y push a Render. Leer antes de cualquier release.
- **`runbook/`** — playbooks operacionales (5 archivos): bot no carga, selectores cambiaron, MP no verifica, alta nuevo cliente, emergencias.
- **`docs/business/`, `docs/guides/`, `docs/marketing/`** — material no técnico.
- **`docs/mhtml-references/`** — snapshots MHTML de paneles externos para extraer/actualizar selectores cuando el panel cambia.
- **`ROADMAP.md`** — features pendientes y futuras.
- **`render.yaml`** — definición de servicios Render.
- **`docker-compose.yml`** — Postgres + Redis local (Redis está pero el sistema actual no lo usa para cola; queda por si vuelve).
