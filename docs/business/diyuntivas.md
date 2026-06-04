# Disyuntivas, Bugs y Roadmap

Documento de seguimiento -- Todo lo que hay que arreglar, decidir, e ideas para el futuro.

**Ultima actualizacion**: 2026-04-05

---

## Nomenclatura

- **ROTO** -- No funciona, hay que arreglarlo ya
- **PENDIENTE** -- Hay que hacerlo, pero no es urgente hoy
- **IDEA** -- Para evaluar a futuro

---

## Prioridad Alta -- Cosas Rotas

### 1. EXTENSION -- Flujo de carga de fichas roto

**Estado**: ARREGLADO (2026-04-05)

**Que estaba roto**: El refactor de la extension dividio el flujo en 3 scripts separados con `executeScript`. El step 8 (click Aceptar) solo removia `aria-disabled` y clickeaba, pero NO seteaba Vue `$data`, asi que Vue rechazaba el submit internamente (amount=0). El MAIN world del job-processor que SI seteaba Vue `$data` corria DESPUES del timeout de 15s del step 9, cuando ya era tarde.

**Que se arreglo**:
- `panel-automation.js` step 8: El script inyectado en MAIN world ahora lee el monto del input DOM, sube por el DOM buscando `__vue__`, setea `$data` con `$set` (Vue 2 reactivity), remueve `aria-disabled`, y clickea Aceptar. Todo en un solo script.
- `job-processor.js`: Se elimino el MAIN world injection redundante que corria despues del timeout. Ahora si `fillAmountAndSubmit` reporta exito retorna directo, si falla espera 3s y hace un check final.

**Pendiente de verificar en produccion**:
- [ ] Activar debug mode y verificar que aparezca `[Bot] Set vue.XXX = AMOUNT` en consola
- [ ] Verificar que SweetAlert de exito aparece
- [ ] Verificar que el balance del usuario cambia en la tabla

---

### 2. EXTENSION -- Cambio de contrasena no funciona

**Estado**: ARREGLADO (2026-04-05)

**Que estaba roto**: Los steps 3-5 de `changePassword()` eran mas debiles que los de `loadCredits()`:
- Step 3 (click_buscar): Usaba `querySelectorAll('button')` + `.find()` en vez de `waitForElementWithTextCI`
- Step 4 (wait_for_search_results): Solo esperaba un delay random, NO verificaba que el usuario aparezca en la tabla. Si DataTables tardaba, seguia con tabla vacia.
- Step 5 (find_row): Usaba `row.textContent.includes()` en vez de `span.color` text

**Aclaracion**: El modal de admin tiene solo 2 campos (contrasena + confirmacion), no 3. El mhtml de `cambiar-pass.mhtml` era del modal de usuario, no de admin. Step 7 que llena 2 campos esta bien.

**Que se arreglo**: Se alinearon los steps 3, 4, 5 con la implementacion robusta de `loadCredits()`:
- Step 3: `humanize.waitForElementWithTextCI` con fallbacks
- Step 4: Polling de 15s que verifica `span.color` en cada fila
- Step 5: Busqueda de fila con `span.color` text

**Pendiente de verificar en produccion**:
- [ ] Disparar un job CHANGE_PASSWORD y verificar que el modal se abre
- [ ] Verificar que los 2 campos de password se llenan correctamente
- [ ] Verificar SweetAlert de exito

---

### 3. EXTENSION -- Creacion de usuarios no funcionaba como job

**Estado**: ARREGLADO (2026-04-05)

**Que estaba roto**: `CREATE_USER` no existia como job type. La funcion existia en la extension pero nunca se ejecutaba porque no habia forma de crearla ni routearla.

**Que se implemento**:
- [x] `CREATE_USER` agregado al enum `JobType` en Prisma schema
- [x] `requestCreateUser()` en `users.service.ts` — crea job con password `123casino`
- [x] `POST /users/create-panel-user` endpoint para operadores
- [x] `create_panel_user` socket event en `operator.gateway.ts`
- [x] Handling de resultado en `bot.service.ts` (limpia password, notifica)
- [x] Routing en `service-worker.js` → `JobProcessor.createUser()`
- [x] UI "Crear en Panel" en operator panel (input + boton en vista de usuarios)
- [x] IPC bridge en `preload.js` + handler en `main.js`
- [x] UI "Crear" en operator mobile (input + boton en tab usuarios)
- [ ] Bot AI deberia poder disparar creacion si el usuario dice "necesito una cuenta" (actualizar prompt en `main.js`)

**Pendiente de verificar**:
- [ ] Correr `npx prisma migrate dev --name add_create_user_job_type`
- [ ] Testear end-to-end: crear usuario desde panel operador → job llega a extension → usuario creado en panel externo

**Archivos**:
- `apps/backend-api/prisma/schema.prisma` (enum `JobType`)
- `apps/backend-api/src/jobs/jobs.service.ts`
- `apps/backend-api/src/bot/bot.service.ts`
- `apps/automation-extension/background/service-worker.js` (~linea 971)
- `apps/automation-extension/background/job-processor.js`
- `apps/automation-extension/content/panel-automation.js` (~lineas 1398-1640)

---

### 4. IA -- Se rompe con montos escritos en palabras

**Estado**: ARREGLADO (2026-04-05)

**Que se arreglo**:
- Nueva funcion `parseSpanishAmount(text)` en `main.js` que convierte:
  - Palabras: "mil", "cinco mil", "diez mil", "tres mil quinientos", etc.
  - Slang: "5k" → 5000, "10 lucas" → 10000
  - Cientos: "quinientos" → 500, "doscientos" → 200
- `extractIntentFallback()` ahora usa `parsedAmount` (digitos o palabras) en vez de solo `numMatch` (digitos)
- Prompt de Ollama actualizado con instruccion explicita de convertir montos en palabras a numeros

**Pendiente**: Tests automatizados para los casos comunes

---

## Prioridad Media -- Mejoras Necesarias

### 5. CHAT APP -- Spam de mensajes rompe el flujo

**Estado**: ARREGLADO (2026-04-05)

**Que se arreglo**: Nuevo estado `waitingForBot` en `chat.tsx`:
- Se activa despues de enviar un mensaje
- Bloquea el input (integrado en `isInputDisabled`)
- Muestra TypingIndicator (reusa el existente)
- Se desactiva cuando llega respuesta del bot (message_received de tipo no-USER, o bot:show_card)
- Safety timeout de 30s para que el input no quede bloqueado si el bot no responde
- Timer se limpia en unmount

**Archivos modificados**:
- `apps/chat-app/app/chat.tsx` — estado waitingForBot, timer, isInputDisabled, TypingIndicator
- `apps/chat-app/hooks/useSocketHandlers.ts` — callback setWaitingForBot, desactivacion en handleNewMessage y handleBotShowCard

---

### 6. MONTOS -- Nunca deben tener centavos

**Estado**: ARREGLADO (2026-04-05)

**Que se arreglo**:
- `AmountSelectorCard.tsx`: Input solo acepta digitos (`[^0-9]`), `Math.floor()` en handleContinue
- `requests.service.ts`: `Math.floor(dto.amount)` al crear request en la DB
- `panel-automation.js`: `Math.floor(parseFloat(jobData.amount))` antes de typeIntoElement
- Prompt de IA (item #4): ya instruye devolver montos enteros

---

### 3b. DISCOVERY -- Busqueda automatica de panel al registrarse/loguearse

**Estado**: ARREGLADO (2026-04-05)

**Contexto**: El `username` del login de la chat app ES el username del panel de juegos (son la misma cosa). Antes, `savedTargetUsername` se seteaba por la IA via `bot:save_username`, pero no tiene sentido porque ya lo tenemos desde el registro.

**Que se implemento**:
- Al **registrarse** (crear cuenta nueva en `clientAuth()`): se setea `savedTargetUsername = username` automaticamente, y se dispara `discoverUser()` fire-and-forget
- Al **loguearse** (usuario existente): si no tiene `panelId`, se dispara discovery tambien
- `discoverUser()` busca en todos los paneles idle → si encuentra: guarda `panelId` → si no: crea en `DEFAULT_NEW_USER_PANEL_ID`
- Para cuando el usuario haga su primera carga, ya se sabe en que panel esta (o ya fue creado)

**Cambios**:
- `auth.service.ts`: `clientAuth()` ahora setea `savedTargetUsername` al crear usuario + dispara `triggerPanelDiscovery()` fire-and-forget en registro Y login
- `discovery.service.ts`: Nuevo metodo `discoverUser(userId, targetUsername)`. DiscoveryState refactoreado con `taskId` + `requestId?` opcional. Request/Job condicionales.
- `operator.gateway.ts`: Trigger en `bot:save_username` como fallback (por si la IA cambia el username)

**Backward compatible**: `startDiscovery()` con requestId sigue funcionando para el flujo de requests existente.

---

### 7. VALIDADOR -- Muy lento, siempre cae en timeout

**Estado**: PENDIENTE

**Problema**: La PC del validador no tiene GPU. Ollama con modelos de vision (llava ~7GB, llama3.2-vision ~30GB) tarda 30-120 segundos por imagen en CPU puro. El timeout del backend es ~90 segundos y no alcanza.

**Timeouts actuales**:
- Ollama health check: 8s (hardcoded en `main.js`)
- Ollama generate: 30s (hardcoded en `callOllama()`)
- Backend gateway: dinamico desde settings `VALIDATION_TIMEOUT_MS` (default 60s) + 5s buffer

**Alternativas a evaluar**:

**Opcion A -- API Cloud**:
- Google Cloud Vision / GPT-4V / Claude Vision
- Ventajas: rapido (2-5s), no necesita hardware, alta precision
- Desventajas: costo por uso (~$0.01-0.03 por imagen), depende de internet, data sale del sistema
- [ ] Investigar precios de Google Vision para OCR de comprobantes de pago argentinos
- [ ] Investigar GPT-4V / Claude Vision pricing
- [ ] Evaluar approach hibrido: cloud para velocidad, local como fallback si no hay internet

**Opcion B -- Modelo Ollama mas liviano**:
- Buscar modelo de vision que corra aceptable en CPU
- Ventajas: gratis, offline, privado
- Desventajas: puede ser poco preciso o no existir uno suficientemente rapido
- [ ] Probar `moondream` (~1.8B params, muy liviano)
- [ ] Probar `bakllava` (derivado de llava mas liviano)
- [ ] Benchmark real: medir tiempo en la PC del operador con comprobantes reales

**Archivos**:
- `apps/validator-app/src/main.js` (~lineas 520-614)
- `apps/backend-api/src/payments/payments.service.ts` (~lineas 51-140)

---

### 8. USUARIOS -- No aparecen en el panel de operador

**Estado**: ARREGLADO (2026-04-05)

**Que se arreglo**: Boton "Refrescar" en la vista de usuarios del operator panel. Fuerza `getClients()` y actualiza la lista. Operator mobile ya tenia pull-to-refresh nativo.

**Archivos**: `apps/operator-panel/src/renderer/views/users.js` + `renderer.js`

---

### 9. OPERADORES -- Crear usuarios del panel de juegos manualmente

**Estado**: ARREGLADO (2026-04-05) — Implementado como parte del item #3 (CREATE_USER job type).

UI de "Crear en Panel" en operator panel y operator mobile. Ver item #3 para detalles.

---

### 9b. CHAT APP WEB -- PWA install prompt

**Estado**: ARREGLADO (2026-04-05)

**Que se implemento**: Cuando un usuario entra a la chat app desde el navegador del celular, aparece un modal con el pato para "instalar" la app en la pantalla de inicio.

**Flujo**:
- Solo en web (`Platform.OS === 'web'`)
- Detecta si ya esta instalada como PWA (standalone mode)
- **Android/Chrome**: Captura `beforeinstallprompt`, boton "Instalar" directo
- **iOS/Safari**: Instrucciones paso a paso (Compartir → Agregar a Inicio)
- Modal con icono del pato, se puede cerrar → no reaparece por 7 dias

**Archivos creados/modificados**:
- `apps/chat-app/public/manifest.json` — metadata PWA
- `apps/chat-app/public/icon-192.png` + `icon-512.png` — iconos PWA
- `apps/chat-app/components/InstallPrompt.tsx` — modal de instalacion
- `apps/chat-app/app/_layout.tsx` — montaje del componente
- `builds/chat-app-web/index.html` — meta tags PWA (manifest, apple-touch-icon, theme-color)
- `builds/chat-app-web/manifest.json` + iconos copiados

**Pendiente**:
- [ ] Service worker para offline (cache basico)
- [ ] Verificar que el icono se ve bien en home screen iOS y Android

---

## Prioridad Baja -- Ideas Futuras

### 10. WHATSAPP -- Canal alternativo de comunicacion

**Estado**: LISTO PARA DEPLOY (extension 95% production-ready, solo falta backend integration)

**Decision**: Chrome extension sobre WhatsApp Web (sin costo cloud). Corre en un Chrome SEPARADO del panel de juegos. Los contactos ya estan agendados con el username del panel. El usuario escribe primero.

**Alcance**: Flujo completo -- cargar fichas, cobrar premios, soporte con operador.

---

#### Arquitectura existente (`apps/whatsapp-extension/`)

**Componentes**:

| Archivo | Funcion | Estado |
|---|---|---|
| `background/service-worker.js` | Orquestador: polling 4s, manejo de conexiones per-user, kill switch, stats | 95% listo |
| `background/message-router.js` | Cola FIFO per-phone, rate limit, cooldowns, dedup con TTL | 100% listo |
| `background/api-client.js` | HTTP + Cloudinary upload + retry con backoff exponencial | 100% listo |
| `background/user-manager.js` | Phone normalization AR, JWT caching con expiry, auth locks | 100% listo |
| `content/whatsapp-reader.js` | MutationObserver + sidebar scanner, media detection | 95% listo |
| `content/whatsapp-writer.js` | Busqueda de chat + typing humanizado en Lexical editor | 98% listo |
| `content/whatsapp-selectors.js` | Selectores estructurales (data-testid, aria-label, role) -- NO CSS ofuscado | 100% listo |
| `content/image-handler.js` | Blob URL → base64 → Cloudinary (con canvas fallback) | 100% listo |
| `content/humanize.js` | Delays gaussianos, typing char-by-char, mouse offsets | 100% listo |
| `utils/card-formatter.js` | Convierte bot:show_card → texto WhatsApp (todos los card types) | 100% listo |
| `popup/` | Dashboard con status, stats en tiempo real, kill switch | 100% listo |
| `options/` | Config: backend URL, delays, rate limits, activity window | 100% listo |

---

#### Flujo de mensajes

```
Usuario manda mensaje en WhatsApp
  → whatsapp-reader.js detecta via MutationObserver
  → Envia WA_NEW_MESSAGE al service-worker
  → Service worker: read delay (simula lectura), rate check
  → user-manager.js: identifica usuario por nombre de contacto → User.username
     (si no agendado: normaliza telefono → busca User.phone)
  → api-client.js: POST /api/messages (con JWT del usuario)
  → Backend procesa → bot IA responde
  → Service worker: polling 4s detecta respuesta
  → message-router.js: encola con delay random 3-8s
  → card-formatter.js: convierte cards a texto
  → whatsapp-writer.js: abre chat + typing humanizado + envia
```

---

#### Medidas anti-ban implementadas (25+)

**Timing**:
- Delays gaussianos de typing (~90ms/char, stddev 25ms)
- Read delay configurable antes de procesar
- Reply delay random 3-8s entre recibir y responder
- Cooldown de 2 min cada 10 mensajes
- Rate limit configurable (default 30 msgs/hora)
- Activity window (ej: solo 9am-11pm)
- Between-message gaps 2-5s

**Deteccion**:
- Selectores estructurales (data-testid, aria-label) -- NO clases CSS ofuscadas
- Click con offset random (35-65% del area del boton)
- Secuencia mousedown → mouseup → click con delays
- Clearing con Ctrl+A + Backspace (como humano)
- InputEvent nativo (no solo execCommand)
- Deteccion de QR code → pausa automatica

**Concurrencia**:
- Un mensaje a la vez per phone (FIFO)
- Auth lock para evitar race conditions
- Content-based dedup con TTL 30s
- First-poll skip (no procesa mensajes viejos al conectar)

---

#### Vinculacion de usuarios

**Contactos agendados** (caso comun):
- El nombre del contacto en WhatsApp = username del panel
- `whatsapp-reader.js` lee el nombre del contacto del header del chat
- `user-manager.js` busca `User.username` que matchee

**Usuarios nuevos** (no agendados):
- Solo se ve el numero de telefono
- `user-manager.js` normaliza el telefono (ultimos 10 digitos para Argentina)
- Busca `User.phone` en el backend
- Si no existe: puede crear usuario nuevo via API

---

#### Deployment

- Chrome **separado** del browser del panel de juegos
- Cada Chrome = 1 numero de WhatsApp
- WhatsApp Web debe estar logueado y mantenerse abierto
- Configurar en Options: backend URL, API key, delays, activity window
- Systemd/PM2 para mantener Chrome vivo

---

#### Lo que falta para activar

**Backend integration**: ARREGLADO (2026-04-05)
- [x] Endpoints ya existian: `/api/auth/client`, `/api/chats/me`, `/api/messages`, `/api/messages/chat/:id`, `/api/uploads/chat-image`
- [x] Upload de imagenes: cambiado de `sign-proof` (requiere requestId) a `chat-image` (multipart server-side, sin requestId)
- [x] Auth: usa contactName como username si el contacto esta agendado, fallback a `wa{phone}` si no
- [x] userManager refactoreado: distingue phone vs contactName, pasa contactName al auth

**Testing**:
- [ ] Probar con 1-2 usuarios reales antes de escalar
- [ ] Monitorear si WhatsApp detecta algo (observar bans)
- [ ] Verificar que selectores funcionan con la version actual de WhatsApp Web
- [ ] Probar manejo de imagenes (comprobantes) end-to-end

**Conocidas limitaciones**:
- 1 Chrome = 1 numero = bottleneck (no escala horizontalmente facil)
- WhatsApp puede actualizar el DOM y romper selectores
- Sin WebSocket mode (solo polling 4s) -- funcional pero no ideal
- Sin offline persistence -- mensajes en cola se pierden si se reinicia

**Alternativa futura (si hay presupuesto)**:
- WhatsApp Business API oficial ($0.05-0.10/msg) -- sin riesgo de ban, legal
- Bot de Telegram -- gratis, API oficial, sin riesgo de ban

**Archivos**: `apps/whatsapp-extension/` (todo el directorio, ~16 archivos)

---

### 11. DISPOSITIVO EMBEBIDO -- Mini PC llave en mano para clientes

**Estado**: IDEA (concepto refinado)

---

#### El producto

Mini PC preconfigurado que se vende a operadores de casino. El cliente lo enchufa, se conecta a WiFi, y ya tiene el sistema de automatizacion andando. Todo casero, sin depender de app stores, Expo, ni servicios cloud caros.

---

#### Arquitectura: Cloud + Hardware hibrido

**En cloud (una instancia POR CLIENTE, no multi-tenant)**:
- Backend API (NestJS) + PostgreSQL + Redis
- Chat App Web (PWA — los usuarios acceden desde el browser, sin app store)
- Operator Panel Web (alternativa al desktop para acceso remoto)

**En el mini PC del cliente**:
- Chrome con extension de automatizacion (el "brazo ejecutor")
- Chrome separado con extension de WhatsApp (canal alternativo)
- Validador de comprobantes (Electron + Ollama local)
- Operator Panel Desktop (Electron, para monitoreo local)
- Systemd/PM2 para mantener todo vivo

**Lo que NO va en el mini PC**: Backend, base de datos, Redis. Eso va en cloud.

```
[Usuarios]                    [Cloud por cliente]              [Mini PC del cliente]
  |                               |                                |
  Chat App (PWA) ──────────> Backend NestJS ──────────> Chrome + Extension Automatizacion
  WhatsApp ───> Chrome+Ext ──────> Backend                Chrome + Extension WhatsApp
                                  PostgreSQL                Validador Electron + Ollama
                                  Redis                     Operator Panel Desktop
```

---

#### Cada cliente = una plataforma de casino diferente

Los selectores CSS (a.action-plus, .widthdraw.modal, etc.) varian por plataforma. Solucion:

**Perfiles de selectores**: Cuando un cliente nuevo compra, nosotros analizamos su panel y creamos un "perfil" con todos los selectores necesarios. Se carga en la extension via options page o config remota.

Esto implica:
- [ ] Refactorear `panel-automation.js` para que SELECTORS sea configurable (cargado desde storage, no hardcodeado)
- [ ] Crear un "panel profile" JSON por plataforma con: selectores, URLs, flujos especificos
- [ ] Herramienta/guia para mapear selectores de un panel nuevo (inspector manual + template)
- [ ] Versionado de perfiles (si el panel del cliente se actualiza, actualizar selectores remotamente)

**Plataformas soportadas inicialmente**: Solo TioRico (la actual). Cada cliente nuevo es un perfil nuevo que creamos nosotros.

---

#### Todo casero, sin dependencias externas

- **Chat App**: PWA (web) — los usuarios la "instalan" desde el browser. Sin Expo, sin app stores.
- **Operator Panel**: Electron desktop (ya existe) o version web. Sin app store.
- **Operator Mobile**: Version web responsive del operator panel. Sin Google Play ni App Store.
- **Updates**: Git pull + rebuild via script, o Docker images + watchtower. Sin infra compleja.
- **Validador**: Ollama local (sin API cloud). Si el hardware no aguanta → modelo liviano.

---

#### Hardware recomendado

Para correr Chrome x2 + Validador Ollama + Operator Panel:

| Hardware | RAM | CPU | Precio aprox | Viabilidad |
|---|---|---|---|---|
| Raspberry Pi 5 | 8 GB | ARM Cortex-A76 | ~$80 USD | Justo para Chrome x2. Ollama MUY lento en ARM. |
| Mini PC x86 (Intel N100) | 16 GB | x86 4-core | ~$180 USD | **Recomendado**. Corre todo bien, compatibilidad total. |
| Mini PC x86 (Intel N95) | 8 GB | x86 4-core | ~$130 USD | Aceptable si Ollama usa modelo liviano (<2B params). |

**Recomendacion**: Mini PC x86 con Intel N100, 16GB RAM, 256GB SSD. Precio costo ~$180, venta ~$400-500.

---

#### Modelo de negocio

**Ingresos**:
- Venta del dispositivo: $400-500 USD (margen ~$200)
- Suscripcion mensual: $50-100 USD (incluye: hosting cloud del backend, updates, soporte, perfiles de selectores)
- Setup fee: $100-200 USD (configuracion inicial: analizar panel del cliente, crear perfil de selectores, deploy de backend)

**Costos por cliente**:
- Hardware: ~$180-200 USD (una vez)
- Cloud hosting (backend + DB): ~$10-20 USD/mes (VPS chico)
- Soporte: variable

**Margen neto estimado por cliente**: ~$200 inicial + ~$30-80/mes recurrente

---

#### Desafios tecnicos

**Selectores configurables** (critico):
- [ ] Refactorear SELECTORS en `panel-automation.js` para que se carguen desde `chrome.storage.local`
- [ ] Formato del perfil de panel: JSON con selectores, URLs, credenciales, flujos custom
- [ ] Mecanismo para actualizar perfil remotamente (sin acceso fisico al dispositivo)

**Deployment por cliente**:
- [ ] Script/tool para provisionar nuevo cliente: crear instancia cloud, configurar dominio, generar API keys
- [ ] Imagen base del mini PC: Linux + Chrome + extensiones pre-instaladas + auto-start
- [ ] VPN o Tailscale para acceso remoto al mini PC (soporte tecnico)

**Updates**:
- [ ] Mecanismo de OTA para actualizar extensiones en el mini PC
- [ ] Auto-update del backend en cloud (Docker + watchtower, o Render/Railway auto-deploy)
- [ ] Versionado de perfiles de selectores (push remoto cuando un panel se actualiza)

**Monitoreo**:
- [ ] Dashboard centralizado para ver estado de todos los dispositivos vendidos
- [ ] Alertas cuando un dispositivo se desconecta o tiene errores
- [ ] Metricas por cliente: jobs completados, tasa de error, uptime

**Seguridad**:
- [ ] Credenciales del panel del cliente encriptadas en el dispositivo
- [ ] Acceso fisico al mini PC = acceso a todo → evaluar cifrado de disco
- [ ] API keys por cliente → revocables si el cliente deja de pagar

---

#### Pasos para MVP

1. [x] Selectores configurables — `DEFAULT_SELECTORS` (TioRico intacto) + override desde storage + fetch remoto via URL
2. [x] Repositorio de profiles: `profiles/tiorico.json` (referencia) + `profiles/TEMPLATE.json` (para nuevas plataformas)
3. [x] Update remoto: campo `panelProfileUrl` en Options. La extension fetchea al arrancar, cachea local para offline.
4. [x] Script de provisioning: `scripts/provision-device.sh` — Node, Chrome, Ollama, PM2, Tailscale, systemd services
3. [ ] Comprar un mini PC Intel N100 16GB y probar que todo corra junto
4. [ ] Deploy backend en Render para el primer cliente
5. [ ] Probar con 1 cliente real (vos mismo u operador de confianza)
6. [ ] Crear wizard de setup inicial en el dispositivo (pagina web local)
7. [ ] Sistema de updates remoto basico (SSH + git pull, o Tailscale + script)
8. [ ] Documentar proceso de onboarding de cliente nuevo
9. [ ] Pricing: $10k USD por sistema, sin fee mensual

---

## Cosas que NO hay que tocar (funcionan bien)

Estas cosas se arreglaron en Enero-Febrero 2026 y estan estables:

- Flujo de polling + WebSocket del bot (fix 1.1 - formato de job)
- Balance auto-add en job completion (fix 1.2)
- Session validation con retry antes de cada job (fix 1.3)
- Element-based waits en humanize.js (improvement 2.1)
- Reconnection backoff del validator (improvement 2.2)
- Error messages contextuales de la extension (improvement 2.3)
- Kill switch (funciona en popup, backend, y operator panel)
- Cooldown enforcement entre jobs
- Bot disconnect/reconnect flapping (Chrome SW suspension fix)

---

## Deuda tecnica menor (no urgente)

- [ ] `apps/backend-api/dist/` esta commiteado en git (deberia estar en `.gitignore`)
- [ ] `builds/` tiene binarios commiteados (APKs, EXEs, .exe) -- el repo pesa muchisimo
- [ ] Tests E2E borrados (`tests/e2e/` en status `D`) -- hay que recrearlos eventualmente
- [ ] Logs de `.playwright-mcp/` sin `.gitignore` (se trackean archivos temporales)
- [ ] Docs frontend borrados (`docs/frontend/`) -- evaluar si se necesitan
- [ ] Screenshots de e2e borrados (`e2e-screenshots/`) -- limpiar del historial

---

## Referencia rapida de selectores del panel externo

Sacado de los archivos .mhtml guardados en el root del proyecto:

```
PAGINA DE USUARIOS:
  Busqueda:    #filter-input (placeholder="Nombre de Usuario")
  Buscar btn:  .input-group-append button
  Checkbox:    #directo
  Tabla:       #DataTables_Table_0
  Processing:  #DataTables_Table_0_processing

ACCIONES POR FILA:
  Cargar:      a.action-plus > i.fas.fa-plus
  Descargar:   a.action-minus > i.fas.fa-minus
  Info:        a.action-info > i.fas.fa-info
  Password:    a.action-password > i.fas.fa-key
  Editar:      a.action-edit > i.fas.fa-user-edit

MODAL CARGAR/DESCARGAR FICHAS (.widthdraw.modal):
  Input monto: input[inputmode="decimal"] (placeholder="0,00")
  Cancelar:    button.btn.btn-outline-cyan
  Aceptar:     button[type="submit"].btn.btn-cyan (tiene aria-disabled="true")
  Montos rapidos: botones + 100, + 1.000, + 10.000

MODAL CREAR USUARIO (.insert-mo.modal):
  Nickname:    .insert-mo input[type="text"][aria-label="Nickname"]
  Password:    .insert-mo input[type="password"][aria-label="Contrasena"]
  Aceptar:     .insert-mo button[type="submit"].btn.btn-cyan

MODAL CAMBIAR PASSWORD (.insert-mo.modal):
  Pass actual: input[type="password"][aria-label="Contrasena Actual"]
  Pass nueva:  input[type="password"][aria-label="Contrasena Nueva"]
  Confirmar:   input[type="password"][aria-label="Confirmacion Contrasena"]
  Aceptar:     .insert-mo button.btn.btn-cyan

NAVEGACION:
  Sidebar:     .mdbvue-sidenav.sidenav
  Users link:  a.mdbvue-sidenav__item[href*="/users"]
  Balance:     span.own-balance
  Logout:      texto "Salir" (sin href!)
```

---

**Archivos .mhtml de referencia** (root del proyecto):
- `automation-bot-stuck-here.mhtml` -- Modal de Cargar Fichas abierto (donde se traba)
- `nuevo-usuario.mhtml` -- Modal de Crear Nuevo Usuario
- `descargar-fichas-modal.mhtml` -- Modal de Descargar Fichas
- `cambiar-pass.mhtml` -- Modal de Cambiar Contrasena
- `users.mhtml` -- Pagina de usuarios
- `users-with-dialog.mhtml` -- Pagina de usuarios con dialogo abierto
- `whatsapp.mhtml` -- WhatsApp Web
- `whatsapp-con-mensaje.mhtml` -- WhatsApp Web con mensaje
