# Build & Deploy Instructions

## Prerequisites

- Docker Desktop running
- Docker Hub logged in (`docker login` as `ganamos399`)
- Render CLI installed (`render` command available)
- Android SDK installed (`ANDROID_HOME` set)
- Java 17 (`java -version`)
- Node.js 20+

## Render Services

| Service | Image | ID |
|---------|-------|----|
| tiorico-api (backend) | ganamos399/tiorico-api:latest | srv-d75uba75r7bs738qam90 |
| tiorico-chat-web | ganamos399/tiorico-chat-web:latest | srv-d77ghg95pdvs73a5edlg |
| tiorico-landing | ganamos399/tiorico-landing:latest | srv-d77gn815pdvs73a5g20g |

---

## 1. Extensions (just copy)

```bash
# Automation extension
rm -rf builds/automation-extension && cp -r apps/automation-extension builds/automation-extension

# MP Verification extension
rm -rf builds/mp-verification-extension && cp -r apps/mp-verification-extension builds/mp-verification-extension

# Ripio Verification extension (selectors pending)
rm -rf builds/ripio-verification-extension && cp -r apps/ripio-verification-extension builds/ripio-verification-extension

# Fiwind Verification extension (selectors pending)
rm -rf builds/fiwind-verification-extension && cp -r apps/fiwind-verification-extension builds/fiwind-verification-extension

# Prex Verification extension (selectors pending)
rm -rf builds/prex-verification-extension && cp -r apps/prex-verification-extension builds/prex-verification-extension

# Owner dashboard
rm -rf builds/owner-dashboard && cp -r apps/owner-dashboard builds/owner-dashboard
```

---

## 2. Electron Apps (Windows exe)

```bash
# Validator app
cd apps/validator-app && npm run build:win
# Output: apps/validator-app/dist/*.exe

# Operator panel
cd apps/operator-panel && npm run build:win
# Output: apps/operator-panel/dist/*.exe

# Copy to builds
cp apps/validator-app/dist/*.exe builds/validator-app-win/
cp apps/operator-panel/dist/*.exe builds/operator-panel-win/
```

---

## 3. Android APKs

### CRITICAL: Kotlin & Gradle Compatibility (expo 52)

Expo 52 usa `expo-modules-core@2.2.3` que requiere Kotlin 1.9.25, pero el Kotlin gradle plugin por defecto resuelve a 1.9.24. Esto causa el error de Compose Compiler.

**Despues de cada `expo prebuild --clean`**, hay que aplicar estos fixes:

#### Fix 1: Pinear Kotlin 1.9.25

En `android/build.gradle`, cambiar:
```groovy
classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
```
a:
```groovy
classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25')
```

En `android/gradle.properties`, agregar:
```
android.kotlinVersion=1.9.25
```

#### Fix 2: expo-av build.gradle (SOLO chat-app)

`expo-av` (cualquier version 15.x+) usa `expo-module-gradle-plugin` que solo existe en expo 53+.
El monorepo resuelve expo-av@15 sin importar lo que pongas en package.json (lockfile gana).

**La solucion es parchar el build.gradle de expo-av con la version de v14:**

```bash
# Descargar build.gradle de expo-av@14
cd /tmp && npm pack expo-av@14.0.7 && tar xzf expo-av-14.0.7.tgz

# Copiar sobre el local
# NOTA: expo-av puede estar en el root node_modules (monorepo hoisting) o en apps/chat-app/node_modules
# Verificar cual existe:
EXPO_AV_PATH=$(find . -path "*/expo-av/android/build.gradle" | head -1)
cp package/android/build.gradle "$EXPO_AV_PATH"

# Agregar exclude de libreactnative.so (necesario para RN 0.76+)
# En el build.gradle copiado, dentro de packagingOptions.excludes, agregar MANUALMENTE:
#   "**/libreactnative.so",
# (despues de la linea "**/libreactnativejni.so",)

# Limpiar
rm -rf /tmp/package /tmp/expo-av-14.0.7.tgz
```

**IMPORTANTE**: Este parche se pierde con cada `npm install`. Hay que re-aplicarlo despues.
**NOTA**: En monorepos, expo-av suele estar en `node_modules/expo-av/` (root), no en `apps/chat-app/node_modules/expo-av/`.

### Chat App APK

```bash
cd apps/chat-app

# 1. Asegurar deps correctas
npm install expo-av@15 expo-share-intent@5 --save
npm install  # para actualizar node_modules local

# 2. Prebuild
npx expo prebuild --platform android --clean

# 3. Aplicar fixes post-prebuild
# En android/build.gradle: classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25')
# En android/gradle.properties: android.kotlinVersion=1.9.25

# 4. Build
cd android && chmod +x gradlew && ./gradlew assembleRelease

# 5. Copiar APK
cp app/build/outputs/apk/release/app-release.apk ../../../builds/chat-app-android/
```

### Operator Mobile APK

```bash
cd apps/operator-mobile

# 1. Prebuild (usar --no-install para evitar conflicto ajv del monorepo root)
npx expo prebuild --platform android --no-install

# 2. Aplicar fixes post-prebuild
# En android/build.gradle: classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25')
# En android/gradle.properties: android.kotlinVersion=1.9.25

# 3. Build
cd android && chmod +x gradlew && ./gradlew assembleRelease

# 4. Copiar APK
cp app/build/outputs/apk/release/app-release.apk ../../../builds/operator-mobile-android/
```

### Troubleshooting APKs

- **"Cannot find module 'ajv/dist/compile/codegen'"** en operator-mobile: Usar `--no-install` en prebuild
- **"expo-module-gradle-plugin not found"**: expo-av o expo-share-intent son version incompatible con expo 52. Downgrade a expo-av@15 y expo-share-intent@5
- **"Compose Compiler requires Kotlin 1.9.25 but using 1.9.24"**: Falta el fix de Kotlin en build.gradle y gradle.properties
- **"Could not get unknown property 'release' for SoftwareComponent"**: AGP 8.6 incompatible con expo-modules-core 2.2.x. Esto se resuelve con la version correcta de expo-av/share-intent (sin expo-module-gradle-plugin)
- **Gradle daemon cacheando versiones viejas**: `./gradlew --stop` o usar `--no-daemon`

---

## 4. Backend Deploy

```bash
cd apps/backend-api

# Build Docker image
docker build -t ganamos399/tiorico-api:latest .

# Push to Docker Hub
docker push ganamos399/tiorico-api:latest

# Trigger Render deploy
render deploys create srv-d75uba75r7bs738qam90 --confirm
```

El owner-dashboard se sirve automaticamente desde `/dashboard` en el backend (via ServeStaticModule).

---

## 5. Chat App Web Deploy

```bash
cd apps/chat-app

# Build web export
npx expo export --platform web

# Copy to builds (preservar Dockerfile)
cp builds/chat-app-web/Dockerfile /tmp/chat-web-dockerfile
rm -rf builds/chat-app-web/*
cp -r apps/chat-app/dist/* builds/chat-app-web/
cp /tmp/chat-web-dockerfile builds/chat-app-web/Dockerfile

# Build and push Docker image
cd builds/chat-app-web
docker build -t ganamos399/tiorico-chat-web:latest .
docker push ganamos399/tiorico-chat-web:latest

# Trigger Render deploy
render deploys create srv-d77ghg95pdvs73a5edlg --confirm
```

---

## 6. Landing Page Deploy (con APK actualizado)

```bash
# Copiar APK nuevo al landing page
cp builds/chat-app-android/app-release.apk apps/landing-page/public/tio-rico-fichas.apk

# Build and push Docker image
cd apps/landing-page/public
docker build -t ganamos399/tiorico-landing:latest .
docker push ganamos399/tiorico-landing:latest

# Trigger Render deploy
render deploys create srv-d77gn815pdvs73a5g20g --confirm
```

---

## 7. Copiar todo a builds/ (para subir a Drive)

```bash
# Verificar que todo esta actualizado
ls -lh builds/automation-extension/
ls -lh builds/whatsapp-extension/
ls -lh builds/owner-dashboard/
ls -lh builds/validator-app-win/
ls -lh builds/operator-panel-win/
ls -lh builds/chat-app-android/
ls -lh builds/operator-mobile-android/
ls -lh builds/chat-app-web/
```

Luego subir toda la carpeta `builds/` a Google Drive manualmente.

---

## Dockerfiles Reference

### Backend (apps/backend-api/Dockerfile)
- Node 20 alpine, multi-stage
- Runs `prisma db push` on startup
- Exposes port 3000

### Chat Web (builds/chat-app-web/Dockerfile)
- nginx:alpine
- SPA fallback to index.html
- Exposes port 10000

### Landing Page (apps/landing-page/public/Dockerfile)
- nginx:alpine
- SPA fallback to index.html
- Exposes port 10000

---

## Version Compatibility Matrix (expo 52)

| Package | Compatible Version | Incompatible |
|---------|-------------------|--------------|
| expo | 52.x | - |
| expo-av | **15.x** | 16.x (needs expo 53) |
| expo-share-intent | **5.x** | 6.x (needs expo 53) |
| Kotlin | **1.9.25** | 1.9.24 (Compose mismatch) |
| AGP | 8.3.x - 8.6.x | - |
| Gradle | 8.10.2 | - |
| React Native | 0.76.x | - |

siempre hace los prebuild de los apk, nada de usar cosas viejas o ya encontradas