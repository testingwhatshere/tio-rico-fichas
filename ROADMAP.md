# Roadmap — Multi-Client Operations

## Context
La plataforma se vende a múltiples clientes. Aurum (apps/client-manager) ya gestiona configuración, monitoring, comisiones, deploy, y VPN. Este documento lista las features pendientes para operar múltiples clientes de forma profesional.

---

## Prioridad Alta — Próximos a implementar

### 1. Health Checks Automáticos + Alertas
**Qué:** Cada backend de cliente se monitorea a sí mismo 24/7. Si detecta problemas, alerta por Telegram.
**Cómo:**
- Cron job dentro de cada backend (NestJS `@Cron`) que cada 5-10 min checkea:
  - DB accesible
  - Bot online (heartbeat reciente)
  - Cola no tiene jobs stuck
  - Kill switch no activado por error
  - MP verification extension conectada
- Si algo falla → manda alerta al bot de Telegram del cliente + al bot interno nuestro
- Endpoint `GET /api/health/full` ya existe, el cron lo invoca internamente

**Archivos a tocar:**
- `apps/backend-api/src/health/` — agregar cron de auto-monitoreo
- `apps/backend-api/src/notifications/telegram.service.ts` — agregar alertas de health

### 2. Selector Health Monitor — HECHO
**Estado:** Implementado.
- `panel-automation.js`: `validateSelectors()` + listener `CHECK_SELECTORS`
- `api-client.js`: `postSelectorCheck()` reporta al backend
- `service-worker.js`: alarm cada 60 min, ejecuta check, notifica si falla
- Backend: `POST /bot/selector-check` guarda resultado + alerta Telegram

### 3. Runbook Operativo — HECHO
**Estado:** Implementado.
- 5 runbooks en `runbook/`: bot no carga, selectores cambiaron, MP no verifica, onboarding nuevo cliente, emergencias
- Página `/runbook` en Aurum con sidebar + visor Markdown custom
- Cada runbook tiene: síntomas, diagnóstico, solución, prevención

### 5. Reporte Mensual Automático
**Qué:** PDF/mensaje automático con stats del mes, enviado por Telegram al cliente.
**Cómo:**
- Cron en el backend que el día 1 de cada mes genera el reporte del mes anterior
- Datos: cargas totales, monto procesado, tasa de éxito, uptime, incidentes
- Se manda como mensaje formateado por Telegram (HTML) al chat del cliente
- Opcionalmente genera un PDF bonito

**Archivos a tocar:**
- `apps/backend-api/src/notifications/telegram.service.ts` — agregar comando de reporte + cron mensual
- `apps/backend-api/src/dashboard/dashboard.service.ts` — método `getMonthlyReport(month, year)`

### 6. Canal de Telegram por Cliente — HECHO
**Estado:** Implementado.
- Cada backend ya tiene `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` en env
- Aurum tiene página Settings (`/settings`) con config de Telegram interno
- Config global en `aurum-config.json`: `internalTelegramBotToken`, `internalTelegramChatId`
- Settings también tiene: nombre empresa, email admin, directorio base

---

## Prioridad Media

### 8. Dashboard Financiero en Aurum — HECHO
**Estado:** Implementado.
- Página `/finance` en Aurum con 5 KPI cards (revenue, pendientes, cobradas, costos, margen)
- Tabla por cliente con desglose completo
- Costos editables por cliente (`costs.json`): Render, Cloudinary, VPN, otros
- Filtro por período (mes)
- Fila de totales

### 9. Testing E2E Automatizado por Cliente — HECHO
**Estado:** Implementado.
- 8 tests: health live, DB ready, full health, monitoring endpoint, dashboard stats, metrics, settings, bot status
- Integrado en MonitoringDetail con progress bar y resultados inline
- Tests críticos bloquean los siguientes si fallan (skip)
- Color-coded: verde pass, rojo fail, gris skip
- Muestra duración por test y total

### 12. Multi-Wallet Rotation — YA EXISTÍA
**Estado:** Ya implementado en `payments.service.ts:accumulateAndCheckRotation()`.
- Auto-rota cuando `accumulatedAmount` supera `amountLimit`
- Selecciona la wallet con menos acumulado
- Fallback a la menos llena si todas están al límite
- Emite eventos WebSocket: `wallet_selected`, `wallet_updated`, `wallets_all_full`

---

## Prioridad Baja (futuro)

### 4. Portal de Cliente (web, read-only)
Mini web por cliente para ver sus stats. Reduce preguntas "anda el sistema?".

### 7. Facturación Automática
Generar PDF de factura/recibo por cliente basado en datos de comisiones.

### 10. Rollback / Snapshots
Snapshots de DB antes de deploys importantes.

### 11. CI/CD Pipeline Centralizado
GitHub Actions que buildea, tagea, y deja listo para deploy.

### 13. Audit Trail Centralizado
Log de acciones de operadores cross-client en Aurum.

### 14. Access Control por Operador en Aurum
Perfiles de acceso: "Juan solo opera Cliente X e Y".

### 15. Detección de Fraude Cross-Client
Alertar si el mismo comprobante aparece en dos clientes.

---

## Decisiones Tomadas
- **Health checks**: cada backend se auto-monitorea (cron interno) + alerta por Telegram
- **Reportes**: generados automáticamente por el backend, enviados por Telegram
- **Telegram**: cada cliente tiene su bot, nosotros tenemos "Aurum Bot" para alertas internas
- **Runbook**: integrado en Aurum como visor de Markdown
- **Aurum**: es la herramienta central para todo (config, monitoring, comisiones, VPN, deploy, runbook)

---

## Futuro — Cuando crezca el negocio

### Con 2-3 clientes (PROXIMO)

**White-label build pipeline**
Hoy buildear la app de un cliente nuevo es manual (cambiar packages, colores, iconos, compilar). Aurum ya tiene el config.json con toda la data — falta un script que lea ese config y buildee automáticamente. Botón "Buildear APK" en Aurum que escupe el APK listo.

**Alertas cross-client en tu Telegram**
Cada backend alerta a SU Telegram. Vos necesitás un solo lugar con las alertas de TODOS los clientes. El bot interno de Aurum debería recibir un consolidado: "Cliente X: bot offline", "Cliente Y: 3 fallos hoy". Requiere que cada backend reporte a tu bot además del bot del cliente.

**Onboarding semi-automatizado**
El runbook de nuevo cliente tiene 40+ pasos. Varios se pueden automatizar: crear servicio en Render (API de Render), correr seed, verificar respuesta. Un wizard en Aurum que va tildando pasos automáticamente.

### Con 5+ clientes

**Portal de cliente web (read-only)**
Cada cliente quiere ver "anda el sistema?", "cuánto se cargó este mes?". Un mini dashboard web por cliente (ruta protegida del backend, tipo `/portal`). Reduce tickets de soporte.

**Facturación automática**
Aurum ya calcula comisiones. Falta generar PDF de factura con logo, período, desglose. Librería `pdfkit` o `jspdf` en Aurum.

**Versionado de selectores**
Historial de cambios del panel-profile.json por cliente. Cuándo se cambió, qué se cambió, quién lo cambió. Útil cuando los casinos actualizan su UI.

### Cuando sea negocio serio

**Multi-región / redundancia**
Si un cliente genera mucha guita, un solo backend en Render free tier es riesgoso. Backup en otro proveedor (Railway, Fly.io).

**Rate analytics por cliente**
Patrones: a qué hora cargan, qué días, estacionalidad. Detectar anomalías y dimensionar servicio.

**SDK / API para integraciones**
Si algún cliente quiere integrar con su propia app. API documentada con auth dedicada.

**Detección de fraude cross-client**
Comprobantes reutilizados entre clientes, usuarios en múltiples plataformas. Servicio centralizado que cruce hashes.

### Técnico (cuando haya tiempo)

- **Tests unitarios del backend** — specs existen pero están básicos
- **CI/CD con GitHub Actions** — build, test, artifacts listos para deploy
- **Logs estructurados (JSON)** — para buscar y filtrar mejor
- **Migrations remotas** — que Aurum corra `prisma migrate deploy` en un cliente

---

**Última actualización:** 2026-04-15
