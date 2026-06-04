# Procedimientos de emergencia

## Kill switch activado por error
1. Verificar en Aurum → Monitoring → cliente
2. Desactivar kill switch (necesita confirmacion)
3. Los jobs se reanudan automaticamente
4. Revisar audit log para ver quien lo activo

## Base de datos caida
1. Verificar el proveedor de DB (Supabase, Neon, etc.)
2. Revisar status page del proveedor
3. Si es un problema del proveedor: esperar
4. Si es config: verificar DATABASE_URL en Render
5. Los jobs se pausan automaticamente (no hay DB = no hay queue)
6. Al recuperar: los jobs queued se procesan

## Extension detectada por el casino (poco probable)
1. ACTIVAR KILL SWITCH INMEDIATAMENTE desde Aurum
2. No modificar nada en la extension
3. Esperar 24-48h sin actividad
4. Revisar si hay un patron que los delato
5. Verificar con IP limpia si la cuenta sigue activa
6. Si bloquearon la cuenta: usar otra cuenta de admin
7. Revisar humanizacion de delays

## Todas las wallets llenas
1. El sistema alerta automaticamente por Telegram
2. Los requests nuevos se siguen aceptando pero quedan en cola
3. Retirar fondos de las wallets llenas
4. Resetear accumulatedAmount desde Prisma Studio o el panel de operador
5. El sistema retoma automaticamente

## Comprobante duplicado / fraude
1. El sistema detecta duplicados por hash de imagen
2. Si un comprobante se usa en dos clientes: alerta
3. Rechazar el request duplicado
4. Investigar al usuario
5. Bloquear si es reincidente
