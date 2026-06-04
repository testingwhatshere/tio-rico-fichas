# Panel de Operadores

Aplicación de escritorio (Electron) para monitorear y gestionar la automatización de cargas de créditos.

## Características

- **System Tray**: Siempre disponible con contador de fallos pendientes
- **Notificaciones Nativas**: Alertas del sistema para fallos y eventos importantes
- **Dashboard en Tiempo Real**: Estadísticas y vista rápida de estado
- **Cola de Fallos**: Revisar y aprobar/rechazar validaciones fallidas
- **Monitoreo de Trabajos**: Ver estado de todos los trabajos en curso
- **Chat de Soporte**: Comunicación con usuarios (en desarrollo)
- **Kill Switch**: Detener toda la automatización con un clic

## Instalación

```bash
cd apps/operator-panel
npm install
```

## Desarrollo

```bash
npm run dev
```

Con DevTools:
```bash
npm run dev -- --dev
```

## Build

```bash
# Para la plataforma actual
npm run build

# Para plataformas específicas
npm run build:win
npm run build:mac
npm run build:linux
```

## Configuración

Al iniciar la app, ir a Configuración y establecer:

1. **URL del Backend**: La URL de tu servidor backend (ej: `https://api.tudominio.com`)
2. **API Key**: La clave de API para operadores (configurada en el backend)

## Arquitectura

```
src/
├── main.js      # Proceso principal (Electron)
├── preload.js   # Bridge IPC seguro
├── index.html   # UI principal
├── styles.css   # Estilos
└── renderer.js  # Lógica de UI
```

## Comunicación

La app se conecta al backend via Socket.IO al namespace `/operator`:

### Eventos recibidos:
- `initial_data` - Datos iniciales al conectar
- `validation_failed` - Nueva validación fallida
- `job_failed` - Trabajo de bot fallido
- `job_status` - Actualización de estado de trabajo
- `new_message` - Nuevo mensaje de chat
- `stats_update` - Actualización de estadísticas
- `kill_switch` - Estado del kill switch

### Eventos emitidos:
- `get_initial_data` - Solicitar datos iniciales
- `approve_failure` - Aprobar un fallo
- `reject_failure` - Rechazar un fallo
- `send_message` - Enviar mensaje de chat
- `set_kill_switch` - Activar/desactivar kill switch
- `mark_read` - Marcar chat como leído

## Notas

- La app minimiza a la bandeja del sistema en lugar de cerrarse
- Las notificaciones de fallos son de tipo "crítico" y requieren interacción
- El kill switch detiene TODA la automatización inmediatamente
- No hay autenticación de usuario - es una app de uso compartido por el equipo de operadores
