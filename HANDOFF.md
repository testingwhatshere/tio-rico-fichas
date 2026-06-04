# Handoff — game-automation-platform sesión 2026-04-28

> **Lectura para próxima sesión / próximo Claude.** Este documento captura todo lo hecho en
> esta sesión + lo que sigue pendiente, para retomar sin perder contexto.

## Estado del proyecto

3 oleadas de trabajo, en orden:

1. **Audit + hardening del `validator-app`** (Electron) — pre-prod release Windows portable.
2. **Audit + fixes de las 9 extensiones Chrome** + **app Android nueva** (`wallet-listener-android`).
3. **Plan aprobado de auto-open + PIN-aware alerting** para la app Android (MOB13). **Pendiente
   de implementar** — el usuario lo aprobó como "plus, lo testeamos más adelante".

Backend solo se tocó para: agregar `transfer_detected` handler + canary cron + Telegram alerts
nuevos en `mp-verification.gateway.ts` y `telegram.service.ts`. El resto del backend no se tocó.

## Trabajo completado (resumen)

### A. validator-app (Electron) — production-ready
**5 workstreams cerrados**, ~30 hallazgos remediados:
- W1 (OCR-first cascada): nuevo `pipeline.js` con `fast → aggressive → ollama` cascade. Match
  exacto bypassea threshold de confidence. Counters por source para medir tasa OCR vs Ollama.
  `extractAmount(text, expectedAmount)` rewriteado — prefiere match exacto cuando hay múltiples
  amounts (resuelve "$500.000 saldo + $1.000 monto"). Timezone ART (-3) en parseo de fechas.
- W2 (seguridad UI): CSP + `escapeHtml` en 6 sitios + payload validation + Content-Type del
  proof + sanitización URL del wizard + strip api-mock/test-index del bundle.
- W3 (lifecycle): heartbeat con ACK timeout, queue atomic + TTL 7d, ollama treeKill al quit,
  preload con cap de listeners, logger flush stop, purgeOldLogs(30) al startup.
- W4 (UX): close → minimize tray, tray menu nuevo, panel "Estadísticas hoy", botón "Copiar
  logs", botón Ollama timeout 30s.
- W5 (build): solo Windows portable, `extraResources` para `spa.traineddata`, `asarUnpack`
  para sharp/tesseract/pdf-poppler, exclusión de api-mock + test-index. Worker ahora carga
  `spa.traineddata` bundled (no descarga de CDN).

**Archivo del plan original**: ya pisado por este handoff. El detalle de cada cambio está en
los commits diff (sin commitear todavía — ver "Git status" abajo).

### B. Extensions audit (9 extensions Chrome)
**12 de 13 issues fixeados**:
- EX1: typo `wsConnection` → `state.websocket` en `automation-extension/background/service-worker.js:1565`. **Era prod-blocker** (selector health check via WS no se mandaba).
- EX2: `lastJobCompletedAt` consolidado a `Date.now()` siempre.
- EX3+EX4: dedup persistente + MutationObserver disconnect en las 4 verification extensions.
- EX5: borradas carpetas literales `{background,content,popup,options,icons}` (bug mkdir) y dead code de `requestSubmit` en `panel-automation.js` (203 líneas).
- EX6: manifest mp-payment-extension limpio (content_scripts vacío sacado).
- EX7: confirmé que las 4 verification ya tienen zombie detection. Renombré `[MP-Verifier]` → `[Ripio-Verifier]` / `[Prex-Verifier]` / `[Fiwind-Verifier]` en sus logs.
- EX8: host_permissions restringidos a dominios específicos en 7 manifests (automation se queda con `https://*/*` por design — panelUrl es config del cliente).
- EX9: code review de detail-scrapers Ripio + Prex (no estaban vacíos como dijo el agent — alucinó). Mejoré `extractDetailValue` en Ripio para no contaminar con labels.
- EX11: Telegram alerts nuevos: `alertVerifierOffline`, `alertVerifierSessionExpired`, `alertVerifierStale` + `sendDailyVerifierReport`.
- EX12: canary cron (cada 30min) en `mp-verification.gateway.ts` que alerta si una wallet >6h sin transfers detectadas. Agregado handler `transfer_detected` y `session_expired`.
- EX13: cierre del health-check WS dependía de EX1 — destrabado.

**EX10 descartado**: refactor a `packages/shared-extension-core/`. Razón: las verification
extensions van a ser reemplazadas por la app Android. Refactor de código que se elimina = waste.

### C. App Android `wallet-listener-android` — scaffolding completo
**21 archivos creados** (~1500 LOC Kotlin + 2 archivos HTML/JS para operator-panel + 2 docs):

```
apps/wallet-listener-android/
├── settings.gradle.kts, build.gradle.kts, gradle.properties, .gitignore, README.md
├── app/build.gradle.kts, proguard-rules.pro
└── app/src/main/
    ├── AndroidManifest.xml — perms + 3 services + receiver + queries con 20 wallets
    ├── res/values/strings.xml, themes.xml
    ├── res/xml/{accessibility_service_config, data_extraction_rules, backup_rules}.xml
    └── kotlin/io/tiorico/walletlistener/
        ├── WalletListenerApp.kt — Application + notif channel
        ├── MainActivity.kt — Compose UI, 4 permisos
        ├── data/
        │   ├── Models.kt — WalletId enum (16 wallets), ParsedTransfer, PairingConfig
        │   ├── ConfigStore.kt — DataStore Preferences
        │   ├── DedupCache.kt — singleton compartido (ahora con `companion object { val shared }`)
        │   └── WalletRegistry.kt — package name → WalletId
        ├── service/
        │   ├── WalletNotificationListener.kt — camino A
        │   ├── WalletAccessibilityService.kt — camino B (lee pantalla)
        │   ├── BackendForegroundService.kt — owner del Socket.IO
        │   └── BootReceiver.kt — re-arma service post-reboot
        ├── parsers/  (camino A — notif strings)
        │   ├── ParserRegistry.kt + AmountUtils.kt + GenericArsTransferParser.kt
        │   └── MercadoPagoParser, FiwindParser, RipioParser, PrexParser
        ├── scrapers/  (camino B — AccessibilityNodeInfo)
        │   ├── ScreenScraperRegistry.kt + NodeUtils.kt + GenericArsScreenScraper.kt
        │   └── MercadoPagoScreenScraper, BrubankScreenScraper, UalaScreenScraper, CuentaDniScreenScraper
        ├── backend/BackendClient.kt — Socket.IO al namespace /mp-verifier (reusa el namespace existente, backend NO necesita cambios)
        └── setup/QrSetupActivity.kt — ZXing scanner
```

**Operator panel** — agregado QR pairing window:
- `apps/operator-panel/src/qr-pairing.html` — form + canvas con QR generado
- `apps/operator-panel/src/preload-qr-pairing.js` — expone solo `qrcode.toCanvas`
- `apps/operator-panel/src/main.js` — handler `open-qr-pairing` + tray menu item "📱 Vincular celular (QR)"
- `apps/operator-panel/src/preload.js` — `openQrPairing()` expuesto al renderer
- `apps/operator-panel/package.json` — agregado `qrcode@^1.5.4`

**Docs**:
- `apps/wallet-listener-android/README.md` — arquitectura, build, 4 permisos, troubleshooting
- `docs/wallet-notif-fixtures/README.md` — specs de fixtures pendientes por wallet
- `CLAUDE.md` — agregada `wallet-listener-android` a la tabla de apps

---

## Pendiente de implementar (próxima sesión arranca por acá)

### MOB13 — Auto-open + PIN-aware alerting (plan aprobado, **NO implementado**)

El usuario lo aprobó pero dijo "es plus, lo testeamos más adelante". **Implementarlo** cuando
la próxima sesión arranque. Diseño completo abajo.

**Por qué se necesita**: las apps de billetera no siempre notifican (cifradas, generic
"nueva actividad", silenciadas, app abierta no notifica). El AccessibilityService que ya
existe **solo lee** cuando el operador abre la app manualmente. Para llegar al 100% hay que
**abrir las apps automáticamente** desde el ForegroundService. Cuando la app pide PIN, no
intentamos guardar credenciales — alertamos por Telegram al operador.

**Decisiones del usuario que arman este plan:**
- Notif + auto-open + alerta (no auto-tipeo de PIN, riesgo inaceptable).
- Mix de modos por celular: dedicado vs multi-uso. Configurable.
- Es 1 capa más, no la única. Validator + extensions de respaldo. Una pérdida ocasional no rompe.

**Strategy — modos por celular** (en QR pairing payload):

| Modo | Frecuencia auto-open | Visibility |
|------|----------------------|------------|
| `KIOSK` | N/A — `lockTask()`, scrape continuo | Always foreground |
| `DEDICATED` | Cada 3 min | Foreground brevemente, vuelve al home |
| `SHARED` | Cada 15 min, solo si `isInteractive() == false` y operador inactivo 5min | Mínima |

Default: `SHARED` (más conservador).

**Components a agregar:**

1. **`data/Models.kt`** — agregar `enum DeviceMode { KIOSK, DEDICATED, SHARED }`. Extender
   `PairingConfig` con `deviceMode: DeviceMode = DeviceMode.SHARED`.

2. **`data/ConfigStore.kt`** — persistir `deviceMode` + opcional `openIntervalSeconds`.

3. **`opener/WalletOpener.kt`** (nuevo):
   ```kotlin
   fun open(context: Context, walletPackage: String): Boolean {
     val launch = context.packageManager.getLaunchIntentForPackage(walletPackage)
       ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP) }
       ?: return false
     context.startActivity(launch)
     return true
   }
   ```
   Android 10+ requiere `SYSTEM_ALERT_WINDOW` + foreground service activo.

4. **`opener/AutoOpenScheduler.kt`** (nuevo) — wrapper de `AlarmManager`:
   - `schedule(walletPackage, deviceMode)` calcula próximo trigger
   - `setExactAndAllowWhileIdle()` para resistir Doze
   - Skip-condition para `SHARED`: `PowerManager.isInteractive() == false` y
     `UsageStatsManager` confirma operador inactivo en últimos 5min
   - Después de cada open, programa el siguiente

5. **`opener/AutoOpenReceiver.kt`** (nuevo) — `BroadcastReceiver` que el alarm dispara.

6. **`scrapers/PinDetector.kt`** (nuevo) — heurísticas:
   - Strings: "Ingresá tu PIN", "Verificá tu identidad", "Iniciá sesión", "Huella dactilar"
   - Botones: teclado numérico, botón "Continuar" deshabilitado
   - Resource ids por wallet cuando los tengamos
   - Si detecta → emite `WalletNeedsAttention(reason="pin_screen", walletPackage)` al BackendClient

7. **`service/WalletAccessibilityService.kt`** — extender:
   - Antes de `ScreenScraperRegistry.scrape`, correr `PinDetector.check(root, wallet)`
   - Si detecta PIN → `performGlobalAction(GLOBAL_ACTION_HOME)`, no quedar trabado
   - Después de scrape exitoso/fallido en `DEDICATED`/`SHARED` → `GLOBAL_ACTION_HOME`. En
     `KIOSK` no — la app queda pinneada.

8. **`backend/BackendClient.kt`** — agregar `emitNeedsAttention(walletPackage, reason)` que
   manda evento WS `wallet:needs_attention`.

9. **`MainActivity.kt`** — agregar selector `DeviceMode` (3 chips), status del último
   auto-open por wallet, botón "Probar auto-open ahora".

10. **`AndroidManifest.xml`** — agregar permisos:
    - `SYSTEM_ALERT_WINDOW` (background activity launch Android 10+)
    - `SCHEDULE_EXACT_ALARM` (Android 12+)
    - `PACKAGE_USAGE_STATS` (skip-condition SHARED)
    - Registrar `AutoOpenReceiver`.

11. **Operator panel `qr-pairing.html`** — agregar `<select>` para `deviceMode`. JSON del QR
    incluye `deviceMode`. Texto explicativo de cada modo.

12. **Backend `mp-verification.gateway.ts`** — handler:
    ```typescript
    @SubscribeMessage('wallet:needs_attention')
    handleNeedsAttention(client: Socket, data: { walletPackage: string, reason: string }) {
      const walletId = this.socketToWallet.get(client.id) ?? 'unknown';
      const walletType = this.walletTypes.get(walletId) ?? 'unknown';
      this.telegram.alertVerifierNeedsAttention(walletId, walletType, data.reason).catch(() => {});
    }
    ```

13. **Backend `telegram.service.ts`** — método nuevo (sigue patrón de los 3 `alertVerifier*`):
    ```typescript
    async alertVerifierNeedsAttention(walletId: string, walletType: string, reason: string) {
      if (this.shouldThrottleVerifierAlert('attention', walletId)) return;
      const reasonText = { pin_screen: 'pide PIN', login_screen: 'pide login', unknown_screen: 'pantalla desconocida' }[reason] || reason;
      await this.send(
        `👉 <b>WALLET NECESITA ATENCION</b>\n\n` +
        `Wallet: <b>${walletId}</b> (${walletType})\n` +
        `La app ${reasonText}. Desbloqueá manualmente para que el auto-open siga funcionando.`,
      );
    }
    ```

**Reusar:**
- `DedupCache.shared` ya es singleton — el scrape post-auto-open dedupea automáticamente.
- `BackendForegroundService.dispatch()` ya es la única vía.
- `TelegramService.shouldThrottleVerifierAlert()` ya existe (15min cooldown por key).
- `MpVerificationGateway.walletTypes` ya mapea walletId → walletType.

**Trampas Android para documentar en README**:
- Background activity launch requiere `SYSTEM_ALERT_WINDOW` + foreground service activo.
- Xiaomi/Huawei/Oppo matan foreground services — settings extras (auto-start, lock screen).
- `SCHEDULE_EXACT_ALARM` requiere consent del usuario en settings (Android 12+).
- `PACKAGE_USAGE_STATS` requiere consent manual. Skip-condition se degrada a "siempre disparar" si no está habilitado.
- Kiosk mode requiere device-owner via ADB shell o app pinning manual.

**Verification (test plan):**
1. `cd apps/wallet-listener-android && ./gradlew :app:assembleDebug` — compila.
2. `cd apps/backend-api && npx tsc --noEmit` — solo el error preexistente de `bot.gateway.ts:321` queda; cualquier otro es regresión.
3. Test funcional con celular real:
   - Instalar APK, scanear QR con `deviceMode=DEDICATED`
   - Conceder los 6 permisos
   - Verificar auto-open MP cada 3min, scrape, vuelve home
   - Cerrar sesión MP, esperar trigger: verificar `alertVerifierNeedsAttention` Telegram con `reason: pin_screen`
4. Test SHARED:
   - `deviceMode=SHARED`, tocar pantalla → no dispara
   - Quieto 10min → sí dispara
5. Test dedup cross-path: transfer real → llega 1 sola vez (no notif + scrape duplicados).
6. Test alerta debug: `adb shell am broadcast -a io.tiorico.walletlistener.TEST_ATTENTION -e wallet com.mercadopago.wallet`.

---

## Pendiente del lado del usuario (acción humana)

Bloqueante para que esto sirva en producción. Sin esto, la app móvil corre con los parsers
genéricos que cubren ~50-60% de los casos:

### 1. Fixtures de notificaciones por wallet (camino A)

Para cada wallet que NO sea MP/Fiwind/Ripio/Prex, capturar 3-5 ejemplos reales:

```
wallet: brubank
title: ¿Recibiste $5.000?
text: Juan Pérez te transfirió $5.000 a tu cuenta Brubank
bigText:
```

Guardar en `docs/wallet-notif-fixtures/<wallet>.txt`. Tabla de wallets pendientes en
`docs/wallet-notif-fixtures/README.md`. Idealmente cubrir:
- Monto chico ($500), monto grande ($500.000+)
- Sender con tildes y mayúsculas mixtas
- Casos donde la notif tiene el monto solo en `title` o solo en `bigText`

### 2. Screenshots de pantalla "Movimientos / Actividad" (camino B)

Para cada wallet que el operador planee auto-abrir, screenshot del momento donde hay una
transferencia recibida visible. Sirve para:
- Confirmar los strings de anchor que usé en los scrapers (`Transferencia recibida`,
  `Cobro recibido`, `Recibiste`).
- Identificar resource IDs estables (si están disponibles).
- Detectar si la app usa `FLAG_SECURE` (oculta contenido a screenshots → también oculta a
  AccessibilityService).

### 3. Fixtures de comprobantes para validator-app (deuda anterior, sigue pendiente)

50-100 comprobantes reales anonimizados, agrupados por banco en `apps/validator-app/test-fixtures/`
(gitignored). Tachar nombres/CBU/CUIT. Dejar montos/fechas/headers intactos. Sin esto, no se
puede medir si el OCR mejoró del 50-80% al 90%+ target.

### 4. Test E2E del APK (cuando se implemente MOB13)

Requiere celular Android real con:
- MP instalado y sesión iniciada
- Habilidad de hacer una transferencia entrante de prueba (otro cel, otra cuenta)
- Cable USB para `adb logcat` y debugging
- Backend de **staging** (no production) configurado

### 5. Decisión: keystore para release APK

Antes de distribuir el APK lateralmente:
1. Generar keystore con `keytool -genkey -v -keystore release.keystore -alias listener -keyalg RSA -keysize 2048 -validity 10000`.
2. Crear `apps/wallet-listener-android/keystore.properties` (en .gitignore) con `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
3. Activar `signingConfigs` en `app/build.gradle.kts` antes del release build.

---

## Issues conocidos / deuda técnica

1. **`apps/backend-api/src/bot/bot.gateway.ts:321`** — error TS preexistente
   (`Property 'versionStatus' does not exist...`). No causado por mí. Hay que arreglarlo
   pero no bloquea.
2. **Iconos de la app Android** — los `mipmap-*/ic_launcher.png` no se crearon. Generar
   con Android Studio "Image Asset" wizard antes del primer build oficial.
3. **`apps/automation-extension/manifest.json`** — `host_permissions` queda con `https://*/*`
   porque el panelUrl es config del cliente. MV3 alternativa: `optional_host_permissions` +
   `chrome.permissions.request()` runtime. Refactor mayor, no urgente.
4. **`apps/mp-payment-extension`** — solo usa `executeScript()` desde service worker (sin
   content script tradicional). Funciona pero engaña al lector. Queda documentado, no
   crítico mientras funcione.

---

## Git status (sin commitear)

```
modified:
- .claude/settings.local.json (cambios menores)
- CLAUDE.md (agregada wallet-listener-android)
- apps/automation-extension/background/api-client.js (EX2)
- apps/automation-extension/background/service-worker.js (EX1, EX2)
- apps/automation-extension/content/panel-automation.js (EX5 dead code)
- apps/backend-api/src/mp-verification/mp-verification.gateway.ts (EX11+EX12)
- apps/backend-api/src/notifications/telegram.service.ts (EX11)
- apps/chat-app/app/home.tsx (cambio menor preexistente, no mío)
- apps/operator-panel/src/main.js (MOB7 QR window)
- apps/operator-panel/src/preload.js (MOB7)
- apps/operator-panel/package.json (MOB7 qrcode dep)
- apps/{fiwind,ripio,prex,mp}-payment-extension/manifest.json (EX8)
- apps/{fiwind,ripio,prex,mp}-verification-extension/manifest.json (EX8)
- apps/{fiwind,ripio,prex}-verification-extension/background/service-worker.js (EX7 prefix)
- apps/{fiwind,ripio,prex,mp}-verification-extension/content/{observer,mp-observer}.js (EX3+EX4)
- apps/ripio-verification-extension/content/detail-scraper.js (EX9)
- apps/validator-app/* (W1-W5 completo, ~15 archivos)

new files (not staged):
- apps/wallet-listener-android/* (~21 archivos del scaffolding completo)
- apps/operator-panel/src/qr-pairing.html
- apps/operator-panel/src/preload-qr-pairing.js
- docs/wallet-notif-fixtures/README.md
```

**Recomendación**: commitear en grupos lógicos antes de la próxima sesión:
1. `validator-app: deep audit fixes (W1-W5)`
2. `extensions: 12 hardening fixes (EX1-EX9, EX11-EX13)`
3. `wallet-listener-android: initial scaffolding (notif + accessibility paths)`
4. `operator-panel: QR pairing window for Android wallet onboarding`
5. `backend: telegram alerts + canary for verifiers`

El usuario no me autorizó commits explícitamente — pedirle antes.

---

## Cómo retomar en otra sesión

1. **Leer este documento + `CLAUDE.md`** para contexto de proyecto.
2. **Revisar `git status` y `git diff`** para ver el estado real del filesystem.
3. **Decidir si commitear primero** o seguir cambios sin commit.
4. **Implementar MOB13** siguiendo la sección "MOB13 — Auto-open + PIN-aware alerting" de
   este documento. Plan completo, 13 components, ~2-3 horas de trabajo si todo va bien.
5. **NO implementar** auto-tipeo de PIN, kiosk mode automático ni guardar credenciales.
6. **Verificar** según test plan en MOB13 — la mayoría requiere celular real, lo cual el
   user va a hacer "más adelante".
7. Cuando el user mande **fixtures de notificaciones** o **screenshots de pantallas**, agregar
   parsers/scrapers dedicados por wallet faltante.

## Archivos críticos para entender el sistema

- `CLAUDE.md` — overview del monorepo, 20 apps, patterns, gotchas.
- `apps/wallet-listener-android/README.md` — arquitectura dual-path, troubleshooting.
- `apps/backend-api/src/mp-verification/mp-verification.gateway.ts` — namespace `/mp-verifier`,
  consume `transfer_detected` + `wallet:needs_attention` (este último cuando se implemente MOB13).
- `apps/backend-api/src/notifications/telegram.service.ts` — patrón de cooldown por alert key.
- `apps/operator-panel/src/main.js:1759-` — handler `open-qr-pairing`.
- `docs/wallet-notif-fixtures/README.md` — checklist de fixtures pendientes del user.
- `build-and-deploy-instructions.md` (root) — Expo 52 + Kotlin 1.9.25 + cosas frágiles del build.
