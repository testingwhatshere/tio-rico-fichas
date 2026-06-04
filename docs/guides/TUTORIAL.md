# Tutorial de Configuracion

Plataforma para cargar fichas automaticamente en un panel de juego. El sistema valida comprobantes de pago con IA, encola las solicitudes y ejecuta la carga mediante una extension de Chrome, con supervision humana solo cuando algo falla.
 
---

## 1. Panel de Operadores (Desktop)

App de escritorio para supervisar fallos de validacion, errores del bot y chat de soporte.

**Configuracion desde la UI** (pantalla de settings):

| Campo | Descripcion |
|-------|-------------|
| URL del backend | `https://game-automation-platform.onrender.com` |
| API Key | Debe coincidir con `Narciso` del backend |

---

## 2. Validador (Desktop)

App de escritorio con IA local (Ollama) que valida automaticamente los comprobantes de pago.

**Configuracion desde la UI** (wizard inicial o settings):

| Campo | Descripcion |
|-------|-------------|
| URL del backend | `https://game-automation-platform.onrender.com` (o URL de produccion) |
| API Key | Debe coincidir con `Narciso` del backend |
| URL de Ollama | `http://localhost:11434` (default) |
| Modelo | `llama3.2-vision` (default, se descarga `llava` si no hay modelo) |

**Requisito:** Tener [Ollama](https://ollama.ai) instalado y corriendo con un modelo de vision.

---

## 3. Extension de Automatizacion (Chrome)

Extension de Chrome que ejecuta la carga de fichas en el panel de juego, simulando comportamiento humano.

**Instalacion:**
1. Abrir `chrome://extensions`
2. Activar "Modo desarrollador"
3. Click en "Cargar descomprimida" y seleccionar `apps/automation-extension/`

**Configuracion desde la Options Page** de la extension:

| Campo | Descripcion | Default |
|-------|-------------|---------|
| URL del backend | `https://game-automation-platform.onrender.com` | — |
| API Key | Debe coincidir con `Narciso` del backend | — |
| URL del panel | URL del panel de juego (`https://tioricojuegos.com`) | — |
| Usuario del panel | Credenciales de acceso al panel | — |
| Contraseña del panel | Credenciales de acceso al panel | — |
| Delay minimo | Milisegundos entre acciones | `2000` |
| Delay maximo | Milisegundos entre acciones | `7000` |

---

## Notas Importantes

- **Las API keys deben coincidir**: cada app tiene su clave que debe ser identica a la configurada en el backend (Siempre la clave es `Narciso`).
- **Ollama** debe estar corriendo antes de iniciar el validador.
- El backend expone un **kill switch** accesible desde el panel de operadores y la extension para detener toda automatizacion de emergencia.
