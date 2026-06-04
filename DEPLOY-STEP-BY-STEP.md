# Deploy paso a paso — Tio Rico

> Hacer los pasos **uno por uno**, esperando que cada build termine antes de
> arrancar el siguiente. La compu no banca dos electron-builder o dos gradlew
> en paralelo.

---

## Estado actual del repo

- Branch: `main` del repo `github.com/testingwhatshere/tio-rico-fichas` (público)
- Commits locales **pusheados ya**:
  - `c844e08` refactor: remove internal balance + unify withdraw into prize-claim
  - `013f2ec` landing: point APK download to GitHub Releases CDN
  - `b7d055e` Initial commit
- Release publicado: `v1.0.0` con APK actual (75 MB) en
  https://github.com/testingwhatshere/tio-rico-fichas/releases/download/v1.0.0/tio-rico-fichas.apk

---

## Pre-checks antes de arrancar

```bash
# 1. Docker daemon vivo (si no, abrir Docker Desktop manualmente y esperar)
docker info | head -3

# 2. gh autenticado como testingwhatshere
gh auth status | head -3

# 3. Render token activo (si "token is expired", correr `render login` interactivo)
render services --output json 2>/dev/null | head -3 || echo "→ render login"

# 4. Java 17 + ANDROID_HOME
java -version 2>&1 | head -1
[ -d "$ANDROID_HOME" ] && echo "android-sdk ok" || echo "→ exportar ANDROID_HOME"
```

Sólo cuando los 4 dan verde, seguís.

---

## Paso 1 — Backend Docker → Docker Hub → Render

Tiempo total estimado: **8–12 min**.

```bash
cd ~/Trabajo/Codigo/Misc/game-automation-platform/apps/backend-api

# Build (~5 min) — Render corre amd64 así que forzamos esa plataforma
docker build --platform=linux/amd64 -t ganamos399/tiorico-api:latest .

# Push (~2 min)
docker push ganamos399/tiorico-api:latest

# Trigger redeploy en Render
render deploys create srv-d75uba75r7bs738qam90 -o json | jq -r '.id, .status'
# Esperar a que el deploy quede en "live":
render deploys list srv-d75uba75r7bs738qam90 --limit 1
```

**Verificación**: `curl https://tiorico-api.onrender.com/api/health` devuelve 200.

---

## Paso 2 — Chat-app web (React Native Web) → Render

Tiempo estimado: **5–8 min**.

```bash
cd ~/Trabajo/Codigo/Misc/game-automation-platform/apps/chat-app
npx expo export --platform web   # genera dist/

# build docker estático (mismo Dockerfile que la landing)
cd dist
cp ../../landing-page/public/Dockerfile .   # nginx servir estático
docker build --platform=linux/amd64 -t ganamos399/tiorico-chat-web:latest .
docker push ganamos399/tiorico-chat-web:latest

render deploys create srv-d77ghg95pdvs73a5edlg
```

---

## Paso 3 — Landing-page → Render

Tiempo: **2–3 min**.

```bash
cd ~/Trabajo/Codigo/Misc/game-automation-platform/apps/landing-page/public
docker build --platform=linux/amd64 -t ganamos399/tiorico-landing:latest .
docker push ganamos399/tiorico-landing:latest
render deploys create srv-d77gn815pdvs73a5g20g
```

**Verificación**: visitar https://tiorico.com (o el dominio configurado), botón
"Descargar" lleva a `github.com/testingwhatshere/tio-rico-fichas/releases/...`.

---

## Paso 4 — Chat-app APK (Android) → GitHub Release

Tiempo: **10–15 min en frío** (primer build), **3–5 min** en builds siguientes.

```bash
# Bump version antes de compilar (importante: el version-checker compara semver)
cd ~/Trabajo/Codigo/Misc/game-automation-platform/apps/chat-app
# Editar app.json: "version": "1.0.1"
# Editar android/app/build.gradle: versionCode = 2, versionName = "1.0.1"

cd android
./gradlew assembleRelease    # ⚠️ NO arrancar ningún otro build en paralelo
# APK queda en: app/build/outputs/apk/release/app-release.apk
ls -lh app/build/outputs/apk/release/*.apk

# Copiar a un nombre estable y publicar release
cp app/build/outputs/apk/release/app-release.apk \
   ../../landing-page/public/tio-rico-fichas.apk

cd ~/Trabajo/Codigo/Misc/game-automation-platform
gh release create v1.0.1 \
  apps/landing-page/public/tio-rico-fichas.apk \
  --title "Tio Rico v1.0.1" \
  --notes "Cambios:\n- Sin AI conversacional, solo botón subir comprobante + WhatsApp\n- Sin balance interno (real está en el panel)\n- Withdraw unificado en prize-claim\n- Auto-update flow funcional"
```

**Verificación**: descargar el APK del URL del release y confirmar tamaño ~75 MB.

---

## Paso 5 — Operator-panel.exe (Windows, desde Mac)

Tiempo: **5–8 min**.

```bash
cd ~/Trabajo/Codigo/Misc/game-automation-platform
# Si volviera a fallar por "client-manager not found", correr:
rm -rf node_modules/client-manager 2>/dev/null

cd apps/operator-panel
bun run build:win
# Salida: dist/Panel de Operadores Setup 1.0.0.exe (~80–120 MB)
ls -lh dist/*.exe
```

Distribuir el `.exe` a las máquinas de operadores (Drive, WeTransfer, etc).

---

## Paso 6 — Validator-app.exe (Windows, desde Mac)

Tiempo: **5–8 min**.

```bash
cd ~/Trabajo/Codigo/Misc/game-automation-platform/apps/validator-app
bun run build:win
ls -lh dist/*.exe
```

---

## Paso 7 — Operator-mobile APK

Tiempo: **10–15 min**.

```bash
cd ~/Trabajo/Codigo/Misc/game-automation-platform/apps/operator-mobile
# Si querés override de backend URL durante el build (ver memoria):
# export EXPO_PUBLIC_DEFAULT_API_URL=https://tiorico-api.onrender.com
# export EXPO_PUBLIC_OPERATOR_API_KEY=Narciso   # producción
cd android
./gradlew assembleRelease
ls -lh app/build/outputs/apk/release/*.apk
```

---

## Paso 8 — Publicar la versión nueva del chat-app desde el operator-panel

Una vez que el APK de chat-app está subido al release v1.0.1:

1. Abrir **operator-panel** conectado a producción.
2. Ir a **Configuración → Publicar Actualización**.
3. Completar:
   - Versión: `1.0.1`
   - APK URL: `https://github.com/testingwhatshere/tio-rico-fichas/releases/download/v1.0.1/tio-rico-fichas.apk`
   - Changelog: copiar el del release.
4. Tap **"Publicar y Notificar"**.

Eso setea los settings `APP_VERSION_CHAT`, `APP_APK_URL_CHAT`, `APP_CHANGELOG_CHAT`
en la DB. La próxima vez que cualquier chat-app abra, va a ver el `UpdateBlocker` y
forzar el update.

---

## Si algo falla a mitad de camino

- **Saturación**: matá todos los builds con `pkill -9 -f "gradlew|electron-builder|expo|metro"` y empezá de nuevo desde el paso que falló.
- **Docker daemon caído**: cerrar Docker Desktop, esperar 30 s, abrir de nuevo, esperar a que el icono esté verde, reintentar.
- **`render login` expirado**: correr `render login` interactivo (abre browser).
- **`gh push` rechazado**: verificar `gh auth status` y `git remote get-url origin`. El remote debe ser `https://github.com/testingwhatshere/tio-rico-fichas.git`.

---

## Cosas que dejé sin terminar y conviene hacer en algún momento

- 4 violaciones de "reglas no negociables del bot" en `automation-extension` (CSP bypass legacy, `retryWithDelay`, `Promise.all` paralelo, zombie threshold 120s vs 180s). Vos dijiste "la extension va bien" — postergado.
- `mp-verification-extension` no tiene source en el repo (solo binario en `/builds/`). Si se rompe MP verification, no hay forma de modificarla.
- Rotar `Narciso` en producción y reemplazar el hardcode en el código fuente. Hoy cualquiera que decompile el APK ve la API key.
- Migración Prisma para dropear `User.balance` columna (hoy queda en schema pero ya no se escribe ni se lee).
- Wallet-listener-android (Kotlin nativa) — no testeada en device real.

---

## Archivos clave que toqué hoy

```
apps/backend-api/src/bot/bot.service.ts                    (sacar addBalance)
apps/backend-api/src/bot/bot.gateway.ts                    (re-validar panelId)
apps/backend-api/src/events/operator.gateway.ts            (delete bot:* handlers + loadErrors + chat:assigned bridge)
apps/backend-api/src/requests/requests.service.ts          (system:alert con severity)
apps/backend-api/src/users/users.controller.ts             (/me/balance deprecado)
apps/backend-api/src/validator/validator.gateway.ts        (heartbeat ACK + zombie validator + onDestroy reject)
apps/backend-api/src/withdrawals/withdrawals.controller.ts (POST → 410 Gone)
apps/chat-app/app/chat.tsx                                 (sin TextInput + WhatsApp + Subir comprobante)
apps/chat-app/app/home.tsx                                 (sin mini-chat input)
apps/chat-app/app/onboarding.tsx                           ("Validacion con IA" → "automatica")
apps/chat-app/components/cards/PaymentDetailsCard.tsx      (sin checkbox "Ya hice la transferencia")
apps/chat-app/services/api.ts                              (401 Promise singleton)
apps/chat-app/services/socket.ts                           (sin stale-token fallback + sin refreshBalance)
apps/chat-app/stores/auth.store.ts                         (refreshBalance/setBalance no-op)
apps/chat-app/stores/chat.store.ts                         (sort guard Invalid Date)
apps/chat-app/stores/request.store.ts                      (flushBuffer atómico + buffer timer reset)
apps/operator-mobile/* (5 archivos)                         (isFailureResolved helper + transports fallback + EXPO_PUBLIC_ override)
apps/operator-panel/src/main.js                            (-857 líneas Ollama brain + chat:assigned + outbound dedup)
apps/landing-page/public/script.js                         (APK_URL → GitHub Releases)
scripts/upload-apk-cloudinary.mjs                          (no usado — Cloudinary free no banca 75MB)
tests/fixtures/*.mjs, *.py, proofs/                        (E2E rig + 20 comprobantes generados)
```

---

## Setup E2E local (sin tocar Neon prod)

```bash
docker-compose up -d postgres

DATABASE_URL="postgresql://postgres:postgres@localhost:5435/tio_rico_fichas" \
DIRECT_URL="postgresql://postgres:postgres@localhost:5435/tio_rico_fichas" \
  bun run --cwd apps/backend-api scripts/e2e-bootstrap.ts

DATABASE_URL="postgresql://postgres:postgres@localhost:5435/tio_rico_fichas" \
DIRECT_URL="postgresql://postgres:postgres@localhost:5435/tio_rico_fichas" \
JWT_SECRET=Narciso BOT_API_KEY=Narciso OPERATOR_API_KEY=Narciso VALIDATOR_API_KEY=Narciso \
PORT=3005 bun --cwd apps/backend-api run start

# En otra terminal:
VALIDATOR_API_KEY=Narciso BACKEND_URL=http://localhost:3005 \
  node tests/fixtures/mock-validator.mjs

BOT_API_KEY=Narciso BACKEND_URL=http://localhost:3005 PANEL_ID=e2e-panel-1 \
  node tests/fixtures/mock-bot.mjs

cd apps/chat-app
EXPO_PUBLIC_API_URL=http://localhost:3005/api \
EXPO_PUBLIC_SOCKET_URL=http://localhost:3005 \
  npx expo start --web --port 8081
```

Login E2E:
- Cliente: `e2e_user` / phone `1100000001`
- Operador: `op@e2e.local` / `test1234`
