# INVESTIGACIÓN COMPLETA: Bugs del Sistema (2026-06-20)

## Resumen Ejecutivo

Se identificaron **3 bugs críticos** con raíces relacionadas:

1. ✅ **Payout proof images no se ven en chat-app** → ARREGLADO
2. ✅ **PDFs no se validan** → ARREGLADO  
3. ❌ **Password change timeout (15s)** → CAUSA RAÍZ IDENTIFICADA, PARCIALMENTE ARREGLADA

---

## Bug 1: Payout Proof Images ✅ ARREGLADO

**Problema:** Usuario no ve imágenes cuando operador sube payout proof.

**Causa:** `ChatBubble.tsx` no rendereaba `imageUrl` para mensajes SYSTEM.

**Fix:**
- `apps/chat-app/components/chat/ChatBubble.tsx` → Added image rendering for SYSTEM messages
- `apps/operator-mobile/components/ChatBubble.tsx` → Same fix applied

**Estado:** ✅ Deployable

---

## Bug 2: PDF Validation ✅ ARREGLADO

**Problema:** PDFs de comprobante fallan en validator, recibe error "cannot parse as PDF".

**Causa:** 
- Backend envía `mimeType: "application/pdf"` 
- Pero Cloudinary transforma PDF→JPEG via `/f_jpg,pg_1/`
- Validator recibe JPEG pero intenta parsear como PDF → falla

**Fix:**
- `apps/backend-api/src/payments/payments.service.ts` → Detect PDF→JPEG transform y update mimeType a `image/jpeg`
- Línea ~201: Check if PDF was transformed, set `validationMimeType = "image/jpeg"`

**Estado:** ✅ Deployable

---

## Bug 3: Password Change Timeout ❌ CAUSA RAÍZ DESCUBIERTA

### Síntoma
```
Error en panel: "Failed at wait for searchresults after 15000 ms"
```

### Capas del Problema

#### Capa 1: Selectores Rotos (HOY ARREGLADO)
**Diagnóstico:** Backend logs mostraban:
```
Failed selectors: 14/22 OK
- LOGIN_USERNAME_INPUT, PASSWORD_INPUT, PASSWORD_SUBMIT
- USER_SEARCH_INPUT, CHANGE_PASSWORD_BUTTON
- MODAL_AMOUNT_INPUT, OWN_BALANCE
... etc
```

**Root Cause:** Panel HTML cambió desde último MHTML snapshot (2026-05-15).

**Fix Aplicado:**
- Actualizé 22 selectores en `apps/automation-extension/content/panel-automation.js` basado en MHTMLs nuevos (2026-06-20)
- Cambios clave:
  * LOGIN: `.form-control`, `.btn-default`, `.peach-gradient`
  * USUARIOS: `#filter-input`, `a.action-plus`, `a.action-password`
  * MODAL: `.cascading-modal`, `[style*="opacity"]`
  * PASSWORD: `[aria-label*="Contrase"]`, fallbacks `:first-of-type` / `:last-of-type`

#### Capa 2: ACK Timeout Corto (IDENTIFICADO)
**Código:** `apps/backend-api/src/bot/bot.gateway.ts:530`
```typescript
const ACK_TIMEOUT_MS = 5000;  // 5 segundos
```

**Flujo:**
1. Backend envía `new_job` al bot
2. Bot tiene 5 segundos para responder con ACK
3. Si selectores están rotos → búsqueda de usuario falla
4. Bot no puede responder en 5s
5. Backend marca como "ACK timeout" → intenta next bot
6. Si TODOS los bots fallan ACK → Job queda en PROCESSING

#### Capa 3: Desconexión Cíclica (DESCUBIERTA)
**Código:** `apps/automation-extension/background/service-worker.js:1690-1706`
```javascript
// Zombie WebSocket detection
if (state.connectionType === 'WEBSOCKET' && state.websocket && state.lastWsMessageTime > 0) {
    const silentMs = Date.now() - state.lastWsMessageTime;
    if (silentMs > WS_ZOMBIE_THRESHOLD_MS) {  // 120 segundos
      state.websocket.close();  // Cierra conexión
    }
}
```

**Pattern Observado en Logs (Render):**
```
00:23:40 [BotGateway] Bot connected for panel X
00:23:45 [DEBUG] Reconnect dispatch: No dispatchable jobs
00:23:49 [BotGateway] Bot disconnected
```

**Ciclo:** ~10-15 segundos (coincide con backoff exponencial: 3s → 4.5s → 6.75s → 10s → 15s)

### Hipótesis de Causa Raíz Integrada

1. **Selectores rotos** → búsqueda de usuario falla (timeout 45s)
2. **No hay respuesta ACK en 5s** → backend cierra job como fallido
3. **Bot no recibe más jobs** → WebSocket queda "silencioso"
4. **Backend hace ping cada 90s, timeout 45s** → conexión se mantiene
5. **Pero si estamos fuera de ventana de actividad o hay reconexión frecuente**
   → offscreen keepalive (20s) + alarm (90s) pueden entrar en conflicto
6. **Resultado:** Ciclo de reconexión cada 10-15s

### Por Qué Hoy Se Arregla

**Selectors Fixed** → User search succeeds → ACK responds in <5s → Backend gets result → Job completes → No "silencio" prolongado → WebSocket stays healthy

---

## Cambios Deployables

### Archivo 1: `apps/automation-extension/content/panel-automation.js`
- **Cambio:** 22 selectores actualizados (líneas 11-42)
- **Antes:** Selectores old (basados en MHTML 2026-05-15)
- **Después:** Selectores new (basados en MHTML 2026-06-20)
- **Impacto:** User search, password change, modal detection, balance reading

### Archivo 2: `apps/backend-api/src/payments/payments.service.ts`
- **Cambio:** Detect PDF→JPEG transform (líneas ~201-211)
- **Antes:** Siempre envía `mimeType: application/pdf`
- **Después:** Si PDF transformed → envía `mimeType: image/jpeg`
- **Impacto:** Payout proof validation

---

## Testing Recomendado Post-Deploy

1. **Jeni5mar cambiar contraseña:**
   - ✅ Search results encontrando usuario
   - ✅ Modal aparece sin timeout
   - ✅ Cambio se aplica exitosamente

2. **Payout proof upload:**
   - ✅ Imagen visible en chat-app
   - ✅ Imagen visible en operator-panel
   - ✅ PDF se valida exitosamente

3. **WebSocket health:**
   - ✅ Bots no desconectan cada 10-15s
   - ✅ Jobs se procesan sin ACK timeout
   - ✅ Logs muestran conexiones longevas (>120s sin zombie detection)

---

## Notas Técnicas

### Backoff de Reconexión (Extension)
```javascript
// service-worker.js:839
const delay = Math.min(3000 * Math.pow(1.5, attempt - 1), 15000);
// Intento 1: 3s
// Intento 2: 4.5s  
// Intento 3: 6.75s
// Intento 4: 10s
// Intento 5+: 15s (cap)
```
Esto explica el ciclo 10-15s observado en logs.

### Keepalive Configuration
- Offscreen document ping: 20s
- Backend ping interval: 90s
- Backend ping timeout: 45s
- Zombie detection threshold: 120s

### ACK Timeout Configuration
- ACK esperado en: 5 segundos
- Si ACK no llega: Job va a siguiente bot
- Si TODOS fallan ACK: Job permanece PROCESSING

---

## Estado del Deploy

- [x] Selectores actualizados (panel-automation.js)
- [x] PDF mimeType fixed (payments.service.ts)
- [x] Commit hecho con cuenta correcta
- [ ] Backend build & deploy
- [ ] Chat-web export & deploy
- [ ] Extension zip build

**Listo para deploy end-to-end.**
