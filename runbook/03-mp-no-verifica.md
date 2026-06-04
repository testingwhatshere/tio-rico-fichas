# MercadoPago no verifica pagos

## Sintomas
- Requests quedan en PENDING_MP_VERIFICATION indefinidamente
- La extension de MP verification no detecta transferencias
- Alerta de timeout: "Request stuck >30min"

## Diagnostico

### 1. Verificar la extension de MP
- Abrir Chrome en la maquina que corre la extension
- Verificar que la extension esta habilitada
- Verificar que el tab de MP actividades esta abierto
- Revisar la consola de la extension

### 2. Verificar sesion de MP
- Si la extension detecta la pagina de login/QR: la sesion expiro
- Se envia alerta automatica por Telegram y Chrome notification

### 3. Verificar el backend
- El backend tiene un timeout checker cada 5min
- Si un request esta en PENDING_MP_VERIFICATION >30min: genera alerta

## Solucion

### Sesion expirada
1. Abrir el tab de MercadoPago manualmente
2. Loguearse / escanear QR
3. La extension detecta automaticamente que volvio a la pagina de actividades
4. Reintenta la verificacion pendiente

### Extension no funciona
1. Verificar que la URL del backend esta correcta en Options
2. Verificar el API Key
3. Recargar la extension (chrome://extensions → Reload)
4. Revisar logs en la consola del service worker

### Aprobar manualmente
1. Si urge: ir al panel de operador → Failures
2. Buscar el request pendiente
3. Aprobar manualmente (bypasea MP verification)
4. Agregar nota de porque se aprobo manualmente

## Prevencion
- Mantener la sesion de MP activa (no cerrar el tab)
- La extension reabre el tab automaticamente si se cierra
- Configurar alertas de sesion en Telegram
