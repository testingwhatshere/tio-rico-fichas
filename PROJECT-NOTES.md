# Project Notes — Tio Rico Fichas

Decisiones de producto / reglas duras que no son obvias del código. Léelas
antes de cambiar algo grande.

---

## 🚫 Reglas que NUNCA romper

1. **No mostrar balance al usuario en la chat-app**. Ni números, ni "ya cargaste $X",
   ni historial de pedidos. La app es transaccional, no un tracker.
2. **No usar AI conversacional**. Sólo el validator-app puede usar Ollama (como
   fallback cuando el OCR falla con un comprobante). El operator-panel ya no
   tiene "bot brain" y la chat-app no tiene TextInput.
3. **No correr migrations/seed contra la DB de Neon**. La de prod tiene datos
   reales. Para local usar Docker postgres en puerto 5435 (ver DEPLOY-STEP-BY-STEP.md).
4. **No introducir paralelismo en el bot de carga** (`automation-extension`).
   Un job a la vez. Login una sola vez. Sin retries automáticos.

---

## 💰 Cómo se trata el "balance"

- El balance REAL del usuario vive en el panel del juego (tioricojuegos.co).
- El backend NO mantiene un counter interno significativo. `User.balance` sigue
  en el schema pero no se escribe ni se lee — drop column pendiente.
- La chat-app puede pedir CUALQUIER monto de premio. No hay validación
  contra "saldo interno".
- La verificación real ocurre cuando el operador procesa el prize-claim: la
  extensión lee el panel, reporta `verifiedBalance`, y el flow continúa o
  rechaza con el monto REAL del panel.

---

## 🪙 Withdraw === PrizeClaim (unificados)

El modelo `Withdrawal` está deprecado. Toda solicitud de retiro/cobro va por
`POST /api/prize-claims` con:
- `amount` (mínimo **$3000**)
- `paymentMethod` (`"CBU"` | `"ALIAS"`)
- `paymentDetails` (`{ cbu? / alias?, accountHolder }`)

`POST /api/withdrawals` ahora devuelve HTTP 410 con hint de migración.

---

## 🤖 Cómo funciona la validación de comprobantes

1. Cliente sube comprobante a Cloudinary (3-step: sign → upload → confirm).
2. Backend dispatcha `validate` por socket al `validator-app` (single instance).
3. Validator-app corre OCR Tesseract en español. Si confidence ≥ threshold y
   amount matchea → APPROVED. Si no → Ollama llava como fallback.
4. Si Ollama tampoco resuelve → `VALIDATION_FAILED` → operador revisa
   manualmente en el panel.
5. Wallet matching: `recipientName` y `recipientAccount` se comparan contra
   la wallet del request (`payments.service.ts:429-452`). Flags:
   `RECIPIENT_MISMATCH`, `RECIPIENT_ACCOUNT_MISMATCH`, `AMOUNT_MISMATCH`,
   `DUPLICATE_TRANSACTION_ID`, `CROSS_USER_DUPLICATE`, `CROSS_USER_SENDER`,
   `STATUS_NOT_APPROVED`, `LIKELY_EDITED`, etc.

---

## 🔄 Auto-update casero del APK

Sin Google Play ni EAS OTA. Flow propio:

1. Subir nueva versión: `gh release create vX.Y.Z apps/landing-page/public/tio-rico-fichas.apk`
2. En operator-panel → Configuración → **Publicar Actualización**:
   - Versión: `X.Y.Z`
   - APK URL: el del release
   - Changelog: lo que corresponda
3. Backend guarda settings `APP_VERSION_CHAT` / `APP_APK_URL_CHAT` / `APP_CHANGELOG_CHAT`.
4. Cada chat-app al abrir llama `GET /api/settings/check-update?app=chat&currentVersion=X`.
5. Si hay versión mayor: pantalla `UpdateBlocker` bloquea el resto de la app
   hasta que el user tap "Actualizar ahora" → descarga via `expo-file-system` →
   `expo-intent-launcher` lanza el installer nativo.
6. User confirma → APK reemplazado → app reinicia.

**Auto-update es para JS+native. Cualquier nueva versión requiere recompilar APK
y publicar nuevo release.** No tenemos OTA JS-only (a futuro podríamos
configurar `expo-updates`).

---

## 🏠 Multi-panel discovery

3 perfiles Chrome con la extensión = 3 `panelId` distintos conectados al
`/bot` namespace. Cuando un nuevo usuario hace su primera request:
1. `DiscoveryService.startDiscovery` emite `search_user` a TODOS los paneles idle.
2. Paneles ocupados quedan en `busyPanels` para retry cuando se desocupen.
3. **First-responder-wins**: el primer `found: true` se queda con el user
   (asigna `User.panelId`).
4. Si todos responden `not_found` y `DEFAULT_NEW_USER_PANEL_ID` está seteado,
   el usuario se crea automáticamente en ese panel.

---

## 🆔 Identidad del repo (mantener anonimato)

- Repo: `github.com/testingwhatshere/tio-rico-fichas` (público)
- gh auth: cuenta `testingwhatshere` (no email real)
- git config local: `Tio Rico Dev <testingwhatshere@users.noreply.github.com>`
- NO usar `nahueltecnicomdp@gmail.com` ni el nombre real en commits/PRs.
- APKs distribuidos via GitHub Releases (bandwidth ilimitado gratis, hasta
  ~800 downloads/mes es viable también desde Render free según cálculo).

⚠️ **`Narciso` (API key) está hardcoded en código fuente** (operator-mobile,
extension README, scripts, etc). Repo es público → cualquiera puede usarla
contra el backend. **Rotar antes de tener usuarios reales en producción.**

---

## ⚠️ Deuda técnica conocida

Lista canónica de cosas pendientes (no urgentes pero documentadas):

1. **4 violaciones de "reglas no negociables del bot"** en `automation-extension`:
   - LEGACY code con `document.createElement('script')` en `panel-automation.js:1519`
   - `retryWithDelay(maxRetries=2)` helper en `service-worker.js:51`
   - `Promise.all([validateOCR, checkAuthenticity])` en `service-worker.js:365`
   - Zombie threshold `WS_ZOMBIE_THRESHOLD_MS = 120s` debería ser 180s.
2. **`mp-verification-extension` source no está en el repo** (solo binario en `/builds/`).
   Si MP rompe scraping selectors, no hay forma de fix.
3. **Drop `User.balance` column** en Prisma (migration pendiente).
4. **Rotar `Narciso`** y reemplazar hardcode por env-var-only (ya hicimos eso
   en operator-mobile via `EXPO_PUBLIC_OPERATOR_API_KEY`; falta el resto).
5. **wallet-listener-android** (Kotlin nativa) sin testear en device real.

---

## 🧪 Setup E2E local (sin tocar Neon)

Ver `DEPLOY-STEP-BY-STEP.md` sección "Setup E2E local" al final.

Credenciales de test:
- Cliente: `e2e_user` / phone `1100000001`
- Operador: `op@e2e.local` / `test1234`

---

## 📦 Apps del monorepo y a dónde van

| App | Tipo | Deploy target |
|-----|------|---------------|
| backend-api | NestJS | Docker Hub `ganamos399/tiorico-api` → Render `srv-d75uba75r7bs738qam90` |
| chat-app | Expo / RN | (web) Docker Hub → Render `srv-d77ghg95pdvs73a5edlg`; (apk) GitHub Releases |
| operator-panel | Electron + vanilla JS | `.exe` portable a operadores |
| operator-mobile | Expo / RN | APK distribución privada |
| validator-app | Electron + Ollama | `.exe` portable a desktop 24/7 |
| automation-extension | Chrome MV3 | unpacked en Chrome de operadores |
| landing-page | HTML/JS/CSS | Docker Hub `ganamos399/tiorico-landing` → Render `srv-d77gn815pdvs73a5g20g` |
| sales-page | HTML/JS/CSS | (sin servicio Render todavía) |
| owner-dashboard | vanilla JS | servido por backend en `/dashboard` |

---

## 📑 Quick reference de eventos Socket.IO

Backend → Cliente:
- chat-app (`/chats`): `request:created`, `request:updated`, `request:completed`,
  `request:rejected`, `validation:started`, `validation:completed`,
  `validation:failed`, `job:started`, `job:completed`, `job:failed`,
  `message:new`, `operator_typing`, `chat:operator_assigned`, `bot:show_card`.
- operator-panel (`/operator`): `initial_data`, `validation_failed`,
  `job_failed`, `new_message`, `chat:new`, `chat:assigned`, `validator:status`,
  `bot:status`, `system:alert`, `extension:heartbeat`, etc.

Backend → Bot/Extension (`/bot`): `new_job`, `search_user`, `create_user`,
`check_balance`, `verify_chips`, `kill_switch`, `reset_circuit_breaker`.

Backend → Validator (`/validator`): `validate`.

Cliente → Backend (operator acciones): `approve_failure`, `reject_failure`,
`retry_job`, `retry_failed_request`, `select_wallet`, `update_wallet`,
`create_wallet`, `delete_wallet`, `empty_wallet`, `set_kill_switch`,
`publish_app_update`, `broadcast_promo`, `operator:process_prize_claim`,
`operator:complete_prize_claim`, `operator:reject_prize_claim`.
