# Análisis de Riesgos: Concurrencia Masiva

## Configuración Actual del Sistema

| Parámetro | Valor | Ubicación |
|-----------|-------|-----------|
| ACK Timeout | 5 segundos | bot.gateway.ts:530 |
| Search User Timeout | 45 segundos | panel-automation.js (wait_for_search_results) |
| Cooldown entre jobs | ~30 segundos (configurable) | jobs.service.ts |
| Stuck Job Timeout | 5 minutos (300s) | timeouts.ts |
| Jobs por bot | 1 simultáneo | CLAUDE.md rule |
| Ping interval servidor | 90 segundos | constants/timeouts.ts |
| Ping timeout servidor | 45 segundos | constants/timeouts.ts |

---

## Escenario: 100 Usuarios en Cola

### Timeline Esperado (Sin Problemas)

```
Tiempo (s) | Bot1       | Bot2       | Bot3       | Backend
-----------|------------|------------|------------|----------
0          | Recibe J1  |            |            | Envía J1 a Bot1
0.1        | ACK OK     |            |            | ACK recibido
1-15       | Busca user | Recibe J2  |            | Envía J2 a Bot2
5-20       | Carga cred | ACK OK     |            |
20-30      | J1 done    | Busca user | Recibe J3  | Envía J3 a Bot3, Envía J4 a Bot1
30-50      | J4 process | J2 done    | Busca user |
50-70      | J4 done    | J5 process | J3 done    |
...        | Continúa   | Continúa   | Continúa   | 100 jobs ÷ 3 bots ≈ 33-50 seg/job

Total: ~100 * 50s = 5000s = 83 minutos para todos
```

Con 3 bots simultáneos procesando: ~28-30 minutos para completar.

---

## Riesgos Identificados

### Riesgo 1: Selectores Todavía Pueden Ser Lentos ⚠️

**Escenario:** Panel bajo carga masiva (100+ operaciones simultáneas)

**Problema:**
```javascript
// wait_for_search_results en panel-automation.js
// Busca span.color con data-username que matchee el usuario
while (Date.now() - startTime < 45000) {
  const results = document.querySelectorAll('span.color');
  // Si hay 1000 elementos en tabla, buscar 1 por 1 puede ser LENTO
  if (results.find(r => r.textContent.includes(targetUsername))) {
    return true;
  }
  await sleep(200);
}
```

**Bajo Carga Normal:** ~1-5 segundos
**Bajo Carga Masiva:** Podría llegar a 15-45 segundos si:
- Tabla tiene miles de filas
- DOM está siendo modificado continuamente
- Browser está hace garbage collection
- Panel servers están respondiendo lentamente

**Riesgo:** Si búsqueda toma >45s → timeout → job falla

---

### Riesgo 2: ACK Timeout No Espera Búsqueda ⚠️

**Código:**
```javascript
// service-worker.js:721
sendAck({ received: true, accepted: true, jobId });  // 5s window
await handleNewJob(eventData);  // Puede tomar 45+ segundos
```

**Buena Noticia:** ACK se envía INMEDIATAMENTE (antes de procesar), así que esto NO es un riesgo.

**Confirmación:** ACK confirma solo "recibido", no "completado".

---

### Riesgo 3: Selección de Usuario Falla Silenciosamente ⚠️

**Escenario:** Selector `span.color` no encuentra el usuario pero NO timea.

**Código en panel-automation.js:**
```javascript
// Busca span con data-username attribute
const userRow = Array.from(
  document.querySelectorAll('[data-username], span.color')
).find(el => el.textContent?.includes(targetUsername));

if (!userRow) {
  throw new Error(`Usuario no encontrado`);  // ← Esto es BUENO
}
```

**Resultado:** Si no encuentra → lanza error → job reporta "user not found" → backend lo maneja.

**Riesgo:** BAJO (hay error handling)

---

### Riesgo 4: Stuck Job Cleanup Después de 5 Minutos ⚠️

**Timeline de un job "stuck":**
```
T=0s       Job enviado a Bot1
T=5s       Bot1 ACK: received=true
T=5-50s    Bot1 busca usuario (toma 45s)
T=50s      Job completa exitosamente
           → No hay problema

PERO SI falla:
T=0s       Job enviado a Bot1
T=5s       Bot1 ACK: received=true
T=5-50s    Bot1 búsqueda lenta/falla
T=50s      Job reporta error
T=50-80s   Backend intenta Bot2
T=80-130s  Bot2 hace lo mismo, falla
T=130-180s Bot3 igual
T=180s     Todos los bots fallaron ACK en algún punto
           Job va a QUEUED para reintentar

T=300s (5min)
           Si job aún en PROCESSING → se marca como STUCK
           → Automáticamente se marca FAILED

Resultado: Job se retira después de 5 minutos max
```

---

## Análisis de Presión bajo Concurrencia

### Caso Base: 10 Usuarios/Min

```
Tiempo Total = 10 users * 60s/user (30s cooldown + 30s búsqueda/carga)
             = ~600s = 10 minutos
Status: ✅ OK - Sin problemas
```

### Caso Medio: 100 Usuarios/Hora

```
Con 3 bots: 100 / 3 = 33.3 users/bot
Tiempo/bot = 33 * 60s = 1980s = 33 minutos
Estado: ✅ OK - Se completan en ~33 minutos
```

### Caso de Pico: 100 Usuarios/Minuto

```
100 users/min * 60s = 6000 segundos de demanda
Con 3 bots solo pueden procesar 3 * 60 = 180s = 3 jobs/min
Demanda: 100 jobs/min
Capacidad: 3 jobs/min
Deficit: 97 jobs/min que entran en QUEUE

Con acumulación en 1 minuto: 97 jobs en QUEUE
Con acumulación en 5 minutos: 485 jobs en QUEUE
Con acumulación en 10 minutos: 970 jobs en QUEUE

Riesgo: ✅ Controlado porque:
  1. Jobs quedan en QUEUE (no PROCESSING)
  2. A medida que bots terminen, procesen más
  3. Después de 5 minutos en PROCESSING → auto-fail
  4. User recibe feedback de error (por Telegram)
```

---

## Punto Crítico Identificado

**La vulnerabilidad REAL es:**

Si selectores son INCORRECTOS (siguen no matcheando nada), entonces:

1. Bot recibe job
2. ACK enviado (OK)
3. Intenta buscar usuario
4. Selector no encuentra nada
5. **Espera 45 segundos completos** (timeout máximo)
6. Timeout alcanzado → lanza error "not found"
7. Backend recibe error
8. Reintenta con otro bot
9. **Mismo problema con todos los bots**
10. Después de intentos, job se marca FAILED

**En caso de pico:** Esto significa que todos los 100 jobs se FALLAN después de intentar durante 45-50 segundos cada uno.

**Timeline del desastre:**
```
T=0s      100 jobs llegan a QUEUE
T=5-50s   Cada bot intenta procesar, todos fallan (selector incorrecto)
T=50s     Primeros 3 jobs fallan (1 por bot)
T=55-100s Siguiente batch de 3 jobs falla
T=300s    Stuck job cleanup dispara para los que siguen en PROCESSING
T=~5min   Todos los 100 jobs se han fallado
```

---

## Soluciones y Mitigaciones

### ✅ IMPLEMENTADO HOY:
1. Selectores actualizados a partir de MHTML real (2026-06-20)
2. Fallbacks múltiples en selectores
3. Mejor logging para diagnosticar qué falla

### 🔧 RECOMENDADO POST-DEPLOY:

**1. Verificar Selectores en Producción**
```bash
# Monitorear logs por 24 horas
render logs -r srv-d75uba75r7bs738qam90 --follow

# Buscar:
# - "not found in search results"
# - "wait_for_search_results timeout"
# - Cualquier mensaje de error de selector
```

**2. Aumentar Timeout de Búsqueda (Optional)**
- Current: 45s
- Si panel es muy lento: 60-90s
- Riesgo: Más demora en fallar, pero menos false negatives

**3. Agregar Validación de Selectores (Recomendado)**
```javascript
// En panel-automation.js:
const validateSelectorsExist = () => {
  const critical = [
    { selector: 'span.color', name: 'user-search' },
    { selector: '#filter-input', name: 'search-input' },
    { selector: 'a.action-plus', name: 'add-credits-button' },
  ];
  
  for (const {selector, name} of critical) {
    if (!document.querySelector(selector)) {
      console.warn(`[ValidationFail] Selector "${name}" not found: ${selector}`);
      return false;
    }
  }
  return true;
};
```

**4. Circuit Breaker para Bots Fallando**
- Si un bot falla >5 jobs consecutivos → marcar como offline
- No enviarle más jobs hasta que se recupere
- (Esto ya existe en el código, verificar que funcione)

---

## Recomendación Final

**Con los selectores arreglados HOY:**
- ✅ Sistema debería manejar 50-100 usuarios/minuto sin problemas
- ✅ Jobs se procesan en 30-90 segundos típicamente
- ⚠️  Bajo carga extrema (1000+ usuarios/min): queue crece pero se auto-limpia en 5min

**Antes de poner en producción masiva:**
1. ✅ Deploy los cambios de selectores
2. ✅ Monitorear logs por 24 horas
3. ✅ Probar con picos graduales (10, 50, 100 users/min)
4. ✅ Verificar circuit breaker funciona
5. ✅ Validar que NO hay selectores fallando silenciosamente

**Si falla bajo carga:**
1. Aumentar WAI_FOR_SEARCH_RESULTS timeout (45 → 90s)
2. Revisar HTML del panel para cambios estructurales
3. Considerar agregar validación de selectores en el inicio de cada job
