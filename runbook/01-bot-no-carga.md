# Bot no carga fichas

## Sintomas
- Jobs quedan en QUEUED sin procesarse
- El bot aparece como "offline" en el dashboard
- Los usuarios reportan que la carga no llega

## Diagnostico

### 1. Verificar estado del bot
- Abrir Aurum → Monitoring → cliente → verificar "Bot status"
- Si dice "offline": el Chrome con la extension no esta corriendo o perdio conexion

### 2. Verificar kill switch
- Aurum → Monitoring → cliente → verificar que Kill Switch este OFF
- Si esta ON: desactivarlo (necesita confirmacion)

### 3. Verificar la extension
- Abrir Chrome en la maquina del operador
- Click en el icono de la extension → verificar estado "CONNECTED"
- Si dice "DISCONNECTED": verificar que el backend esta corriendo
- Revisar la consola de la extension (chrome://extensions → Details → Service Worker → Inspect)

### 4. Verificar jobs stuck
- Aurum → Monitoring → cliente → ver "Jobs activos"
- Si hay un job en PROCESSING hace >5min: esta stuck
- El self-monitor deberia haberlo detectado y alertado

## Solucion

### Bot offline
1. Verificar que Chrome esta abierto en la maquina
2. Verificar que la extension esta habilitada
3. Verificar la URL del backend en Options de la extension
4. Verificar que el API Key matchea con el backend
5. Reiniciar Chrome

### Job stuck
1. Abrir Prisma Studio: `npx prisma studio`
2. Buscar el job en PROCESSING
3. Cambiar status a FAILED con error "Manual reset"
4. El queue dispatcher tomara el siguiente job automaticamente

### Kill switch activo
1. Desactivar desde Aurum (Monitoring → Kill Switch)
2. Verificar quien lo activo en el audit log
3. Los jobs se reanudan automaticamente

## Prevencion
- Verificar diariamente que el bot esta online
- Configurar alertas de Telegram (health check automatico)
- No dejar Chrome minimizado por periodos largos (puede suspenderse)
