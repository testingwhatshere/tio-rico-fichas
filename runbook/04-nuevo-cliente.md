# Onboarding de nuevo cliente

## Checklist completo

### Fase 1: Configuracion en Aurum
- [ ] Crear cliente en Aurum (+ Nuevo Cliente)
- [ ] Llenar datos de identidad (nombre, ID)
- [ ] Click "Auto-completar" para rellenar packages, prefijos, etc.
- [ ] Configurar URLs (API, landing, panel del casino)
- [ ] Generar credenciales (boton "Generar" en tab Credenciales)
- [ ] Configurar tema/colores del cliente
- [ ] Escribir la AI persona del bot
- [ ] Subir assets (iconos, splash)
- [ ] Guardar

### Fase 2: Selectores del casino
- [ ] Guardar MHTML del panel del casino (Ctrl+S en Chrome)
- [ ] Abrir editor de selectores en Aurum
- [ ] Cargar el MHTML
- [ ] Mapear los 13 selectores requeridos
- [ ] Guardar perfil

### Fase 3: Deploy
- [ ] Configurar datos de deploy (DB URL, Cloudinary, Telegram)
- [ ] Generar archivos de deploy desde Aurum (tab Deploy → "Generar todos")
- [ ] Crear servicio en Render (o donde corresponda)
- [ ] Configurar variables de entorno con el .env generado
- [ ] Correr migraciones: `npx prisma migrate deploy`
- [ ] Correr seed de produccion: `npm run db:seed:prod` con las env vars del cliente
- [ ] Verificar que el backend responde: `curl <API_URL>/health/live`

### Fase 4: Apps
- [ ] Buildear Chat App APK con el package name del cliente
- [ ] Buildear Operator Panel EXE/DMG
- [ ] Buildear Validator App EXE/DMG
- [ ] Copiar extension de automation + MP verification

### Fase 5: Configuracion en destino
- [ ] Instalar extension en Chrome del operador
- [ ] Configurar Options de la extension (URL, API Key, panel URL)
- [ ] Pegar el panel-profile.json en la extension
- [ ] Loguearse en el panel del casino
- [ ] Verificar que la extension se conecta (status: CONNECTED)
- [ ] Ejecutar un job de prueba
- [ ] Configurar billeteras de pago en el backend
- [ ] Configurar Telegram bot del cliente

### Fase 6: VPN
- [ ] Crear peer en Aurum VPN Manager para la maquina del operador
- [ ] Descargar .conf
- [ ] Instalar WireGuard en la maquina del operador
- [ ] Importar la config
- [ ] Verificar conexion VPN

### Fase 7: Comisiones
- [ ] Configurar fee type y porcentaje en Aurum (tab Comisiones)
- [ ] Configurar costos del cliente en Finanzas

### Fase 8: Verificacion final
- [ ] Monitoring: refresh en Aurum → todo verde
- [ ] Health check: esperar 5min → sin alertas
- [ ] Selector check: esperar 1h → todo OK
- [ ] Flujo completo: crear usuario → request → pagar → verificar → cargar fichas
