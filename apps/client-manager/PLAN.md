# Plan: Client Manager — Hardening + Branding Pipeline

> **Estado**: Pendiente de implementación. Generado 2026-04-15.

---

## Contexto

El Client Manager está por empezar a usarse en producción para 10+ clientes con paneles de juego diferentes. Se identificaron dos grandes bloques de trabajo:

1. **Hardening** — El Client Manager tiene bugs críticos (escrituras no atómicas, sin backups, validación que no bloquea, .env sin escapar, JSON.parse sin error handling)
2. **Branding pipeline** — Las apps (chat app, operator panel, landing page) tienen colores/nombres hardcodeados de "Tio Rico". El Client Manager genera configs pero NADA las consume. Hay que conectar las dos puntas.

### Decisiones del usuario
- Almacenamiento local (file-based) por seguridad — decisión de diseño, no un gap
- Backup automático al guardar (rotación de 10)
- App posiblemente compartida entre personas
- Cada cliente tiene panel de juego diferente → selector editor es crítico
- Validación BLOQUEA generación de deploy files si faltan campos críticos
- Tema default configurable en Settings del Client Manager (para clientes sin diseño custom)
- Cada cliente tiene su propio build (APK, exe, landing)
- Deploy es "casero": Render, sin git en servers, manual
- Encriptación de credenciales NO es prioridad

---

## Bloque 1: Hardening del Client Manager

### P0: Protección contra pérdida de datos

#### A. Escrituras atómicas (write-then-rename)
- **Archivo**: `src/main/file-operations.ts`
- Crear helper `atomicWriteFileSync(filePath, content)`:
  - Escribe a `{filePath}.tmp`
  - Renombra `.tmp` → archivo real (rename es atómico en POSIX/NTFS)
  - Si falla el rename, borra el .tmp
- Reemplazar TODOS los `writeFileSync()` (config.json, panel-profile.json, commissions.json, deploy files, aurum-config.json, costs.json, vpn-config.json)

#### B. Backup automático antes de guardar
- **Archivo**: `src/main/file-operations.ts`
- En `saveClient()`, antes de escribir:
  1. Si `config.json` existe, copiar a `clients/{id}/backups/config_{timestamp}.json`
  2. Si `panel-profile.json` existe, copiar a `clients/{id}/backups/profile_{timestamp}.json`
  3. Mantener máximo 10 backups por cliente (borrar los más viejos)
- NO hacer backup de deploy files (se regeneran)

#### C. JSON.parse con error handling
- **Archivo**: `src/main/file-operations.ts`
- Crear helper `safeParseJSON(filePath)`: try/catch → return null si falla
- Reemplazar TODOS los JSON.parse directos
- Si config.json está corrupto, intentar leer el backup más reciente

#### D. Lock de save concurrente
- **Archivo**: `src/main/file-operations.ts`
- `Map<string, boolean>` de clientIds en uso
- `saveClient()` rechaza si el lock está ocupado

### P1: Validación estricta de deploy files

#### E. Bloquear generación con campos faltantes
- **Archivo**: `src/renderer/lib/deploy-generator.ts`
- Crear `validateBeforeGeneration(config): { valid, errors[], warnings[] }`
- Campos BLOQUEANTES: id, businessName, apiUrl, gamePanelUrl, botApiKey, operatorApiKey, validatorApiKey, jwtSecret, databaseUrl
- Campos WARNING: chatWebUrl, landingUrl, cloudinaryUrl, telegramBotToken, telegramChatId, monitoringApiKey
- `generateAllFiles()` tira error si validación no pasa

#### F. Escapar valores en .env
- **Archivo**: `src/renderer/lib/deploy-generator.ts`
- Helper `escapeEnvValue(value)`: escapar `"`, `$`, `\`, newlines
- Aplicar a TODOS los valores en `generateBackendEnv()` y `generateChatAppEnv()`

#### G. Actualizar UI de DeployTools
- **Archivo**: `src/renderer/components/DeployTools.tsx`
- Modal rojo con lista de campos faltantes si validación falla
- Deshabilitar botón "Generar" hasta que se corrijan
- Warnings como banner amarillo

### P2: Robustez de file operations

#### H. Error handling en operaciones de archivo
- **Archivo**: `src/main/file-operations.ts`
- `deleteClient()`: try-catch, retornar `{ success, error? }`
- `importClient()`: try-catch, limpiar copia parcial si falla
- `copyDirRecursive()`: try-catch, no dejar archivos huérfanos
- `copyAssetToClient()`: validar que source existe

#### I. Sanitización de paths
- **Archivo**: `src/main/file-operations.ts`
- `sanitizeClientId(id)`: rechazar `..`, `/`, `\`, chars especiales
- `sanitizeFileName(name)`: para deploy files y assets
- Aplicar en: loadClient, saveClient, deleteClient, importClient, saveDeployFiles, copyAssetToClient

#### J. Validación de inputs en IPC handlers
- **Archivo**: `src/main/ipc-handlers.ts`
- Validar clientId, filePath, fileName en todos los handlers

### P3: Monitoring robusto

#### K. Fetch con AbortController + cleanup
- **Archivo**: `src/renderer/lib/monitoring-api.ts`
- Limpiar timeout en catch de `checkClientHealth()`
- Separar monitoringApiKey de botApiKey
- Mejorar mensajes de error
- Validar response es JSON antes de parsear

#### L. Dashboard con rate limiting y cleanup
- **Archivo**: `src/renderer/pages/MonitoringDashboard.tsx`
- AbortController en cada fetch, abort en cleanup
- Limitar refreshAll a 5 requests paralelos
- Toast cuando un cliente falla
- Marcar datos como "stale" si >5 minutos

### P4: Selector editor confiable

#### M. Validación de selectores
- **Archivo**: `src/renderer/pages/SelectorEditor.tsx`
- No permitir guardar si REQUIRED_SELECTORS vacíos
- Trim whitespace
- Warning si selector parece inválido
- Dirty flag + confirmación al salir

#### N. Actualizar REQUIRED_SELECTORS
- **Archivo**: `src/renderer/lib/constants.ts`
- Revisar qué selectores son críticos para la automatización

### P5: Mejoras menores

#### O. ClientEditor no guarda si validación falla
- **Archivo**: `src/renderer/pages/ClientEditor.tsx`

#### P. Store: protección contra loads rápidos
- **Archivo**: `src/renderer/store/client-store.ts`
- Comparar requestedId al recibir respuesta

---

## Bloque 2: Branding Pipeline (Config → Build → Deploy)

### Estado actual (DISCONNECTED)
- Chat app: colores hardcodeados en `constants/colors.ts` (verde/dorado "Tio Rico")
- Chat app: nombre "Tio Rico Fichas" hardcodeado en `app.json`
- Chat app: package `com.tiorico.tioricofichas` hardcodeado
- Operator panel: tema hardcodeado en CSS (`styles.css`)
- Landing page: URLs hardcodeadas en `script.js`
- Deploy generator: NO exporta colores ni nombres a los .env

### Lo que hay que hacer

#### Fase 1: Chat App lee colores de env vars

1. **Actualizar deploy-generator.ts** — agregar al `chat-app.env` generado:
   ```
   EXPO_PUBLIC_APP_NAME="CasinoAzul"
   EXPO_PUBLIC_THEME_PRIMARY=#0052CC
   EXPO_PUBLIC_THEME_ACCENT=#FFD700
   EXPO_PUBLIC_THEME_BACKGROUND=#0B0F15
   EXPO_PUBLIC_THEME_TEXT=#E0E0E0
   EXPO_PUBLIC_THEME_HEADER=#0D1117
   EXPO_PUBLIC_THEME_ERROR=#FF5252
   EXPO_PUBLIC_THEME_SUCCESS=#4CAF50
   ```

2. **Crear `apps/chat-app/constants/theme-loader.ts`** — lee `EXPO_PUBLIC_THEME_*` env vars, fallback a colores actuales de `colors.ts` si no están definidos

3. **Reemplazar imports** en toda la chat app: `import colors from '@/constants/colors'` → importar desde theme-loader

4. **Actualizar `apps/chat-app/types/env.d.ts`** — declarar las nuevas env vars

#### Fase 2: app.json dinámico

1. **Crear `apps/chat-app/app.config.js`** (dynamic config de Expo):
   - Lee `EXPO_PUBLIC_APP_NAME` para el nombre
   - Lee package name de env var o usa default
   - Lee splash background color de env var
   - Los assets (icon, splash) se copian al proyecto antes del build

2. **Actualizar deploy-generator.ts** — agregar al chat-app.env:
   ```
   EXPO_PUBLIC_PACKAGE_NAME=com.casinoazul.fichas
   EXPO_PUBLIC_DEEP_LINK_SCHEME=casinoazul
   ```

#### Fase 3: Operator panel dinámico

1. **Crear `apps/operator-panel/src/theme-loader.js`** — inyecta CSS variables desde config
2. **El .env del operator panel** incluye colores como variables
3. **`main.js`** carga el tema al iniciar y aplica CSS custom properties

#### Fase 4: Landing page templating

1. **Convertir `index.html` a template** con placeholders `{{BUSINESS_NAME}}`, `{{PRIMARY_COLOR}}`, etc.
2. **Deploy-generator.ts** genera el HTML final reemplazando placeholders
3. O: CSS variables en `:root` que se setean desde un `config.js` generado

#### Fase 5: Build scripts por cliente

1. **Deploy-generator.ts** genera un `build.sh` por cliente:
   ```bash
   #!/bin/bash
   # Build script for CasinoAzul
   
   # 1. Copy .env to chat-app
   cp ./chat-app.env ../../apps/chat-app/.env
   
   # 2. Copy assets (icon, splash)
   cp ./assets/icon.png ../../apps/chat-app/assets/icon.png
   cp ./assets/splash.png ../../apps/chat-app/assets/splash.png
   
   # 3. Prebuild + APK
   cd ../../apps/chat-app
   npx expo prebuild --platform android --clean
   # Apply Kotlin 1.9.25 fix
   sed -i "s/kotlin-gradle-plugin:.*/kotlin-gradle-plugin:1.9.25')/" android/build.gradle
   echo "android.kotlinVersion=1.9.25" >> android/gradle.properties
   cd android && chmod +x gradlew && ./gradlew assembleRelease
   
   # 4. Copy APK to client deploy folder
   cp app/build/outputs/apk/release/app-release.apk ../../clients/casinoazul/deploy/casinoazul.apk
   
   # 5. Build operator panel
   cp ./backend.env ../../apps/operator-panel/.env
   cd ../../apps/operator-panel && npm run build:win
   
   echo "Build completo para CasinoAzul"
   ```

2. Operador ejecuta `bash clients/casinoazul/deploy/build.sh` y obtiene todos los artifacts

### Tema default
- En Settings del Client Manager, se configura un tema default (colores neutros)
- Al crear cliente nuevo, se auto-rellena con el tema default
- El cliente puede customizar después si paga plan premium

---

## Archivos clave a modificar

### Client Manager
| Archivo | Cambios |
|---------|---------|
| `src/main/file-operations.ts` | Atomic writes, backups, JSON safe parse, locks, sanitización, error handling |
| `src/main/ipc-handlers.ts` | Validación de inputs |
| `src/renderer/lib/deploy-generator.ts` | Validación bloqueante, escape .env, theme vars, build.sh |
| `src/renderer/components/DeployTools.tsx` | Modal de errores, botón disabled |
| `src/renderer/lib/monitoring-api.ts` | AbortController, error handling |
| `src/renderer/pages/MonitoringDashboard.tsx` | Rate limiting, cleanup, stale data |
| `src/renderer/pages/SelectorEditor.tsx` | Validación, dirty flag |
| `src/renderer/lib/constants.ts` | REQUIRED_SELECTORS actualizado |
| `src/renderer/pages/ClientEditor.tsx` | Bloquear save si validación falla |
| `src/renderer/store/client-store.ts` | Guard contra loads rápidos |

### Chat App
| Archivo | Cambios |
|---------|---------|
| `constants/theme-loader.ts` | NUEVO — carga colores de env vars con fallback |
| `constants/colors.ts` | Se mantiene como fallback/default |
| `app.config.js` | NUEVO — dynamic Expo config (nombre, package, splash) |
| `types/env.d.ts` | Agregar EXPO_PUBLIC_THEME_* types |
| Todos los componentes | Reemplazar import de colors → theme-loader |

### Operator Panel
| Archivo | Cambios |
|---------|---------|
| `src/theme-loader.js` | NUEVO — inyecta CSS variables |
| `src/styles.css` | Colores via CSS custom properties en vez de hardcodeados |
| `src/main.js` | Cargar tema al iniciar |

### Landing Page
| Archivo | Cambios |
|---------|---------|
| `public/index.html` | Template con placeholders o CSS variables |
| `public/styles.css` | Colores via CSS variables |
| `public/script.js` | URLs desde config.js generado |

---

## Verificación

### Hardening
1. Guardar cliente, kill -9 durante save → config no corrupto
2. Guardar 12 veces → exactamente 10 backups
3. Corromper config.json → app muestra error y ofrece restaurar backup
4. Crear cliente incompleto → deploy files bloqueados con lista de faltantes
5. JWT secret con `$"\\n` → .env bien escapado
6. ClientId `../../etc/passwd` → rechazado
7. Backend offline → dashboard muestra error + toast
8. Required selectors vacíos → save bloqueado

### Branding
1. Crear cliente "CasinoAzul" con tema azul en Client Manager
2. Generar deploy files → chat-app.env tiene `EXPO_PUBLIC_THEME_PRIMARY=#0052CC`
3. Copiar .env a chat app, buildear → APK muestra colores azules
4. Nombre de app es "CasinoAzul" (no "Tio Rico")
5. Landing page muestra colores y nombre del cliente
6. Operator panel muestra tema del cliente
7. Cliente sin tema custom → usa tema default de Settings

---

## Notas importantes

- **"Tio Rico" es el primer cliente real** — su branding actual (hardcodeado) NO se pierde, se preserva como defaults en `colors.ts` y como config en el Client Manager
- **Build por cliente** — cada cliente tiene su propio APK, exe, landing. No es multi-tenant runtime.
- **Render deploy** — todo manual, no hay CI/CD. Los scripts generados automatizan los comandos pero el operador los ejecuta.
- **Compatibilidad Expo** — hay que aplicar Kotlin 1.9.25 fix y expo-av patch en cada prebuild (documentado en build-and-deploy-instructions.md)
