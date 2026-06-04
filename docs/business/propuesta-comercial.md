<!--
==========================================================================
  INSTRUCCIONES DE DISEÑO PARA LA IA QUE GENERE EL PDF
==========================================================================

ESTILO VISUAL: Premium fintech / casino moderno
PALETA DE COLORES:
  - Fondo principal: Negro profundo (#0A0E0A) con sutil textura de fieltro
  - Acento primario: Dorado rico (#D4A020) — para títulos, bordes, highlights
  - Acento secundario: Verde esmeralda (#2D8B4E) — para badges, botones, éxito
  - Texto principal: Blanco humo (#F1F5F9)
  - Texto secundario: Gris claro (#94A3B8)
  - Error/alerta: Rojo rubí (#DC2626)

EFECTOS VISUALES:
  - Partículas flotantes de monedas/fichas doradas cayendo suavemente en el fondo
    de la portada y páginas de transición (estilo confetti dorado, sutil, no invasivo)
  - Iconos de fichas de casino ($) dispersos como marca de agua ultra sutil
  - Bordes dorados delgados en tablas y tarjetas
  - Gradiente sutil de negro a verde muy oscuro en fondos de sección
  - Sombras doradas tenues (glow) en títulos principales
  - Líneas divisorias doradas entre secciones
  - Efecto "brillo" sutil en números/métricas destacadas

TIPOGRAFÍA:
  - Títulos: Sans-serif bold, peso fuerte (estilo Montserrat/Poppins)
  - Cuerpo: Sans-serif limpia, alta legibilidad
  - Números destacados: Extra bold, tamaño grande, color dorado

LAYOUT:
  - Portada: Full-page, centrada, con partículas de monedas cayendo
  - Secciones: Fondo oscuro con tarjetas/cards con bordes dorados sutiles
  - Tablas: Fondo semi-transparente, headers dorados, filas alternadas
  - Flujos/pasos: Iconos circulares dorados numerados, conectados con líneas
  - Métricas: Números grandes dorados, subtítulo gris debajo
  - Comparación antes/después: Dos columnas, "antes" en rojo tenue, "después" en verde

PÁGINAS DE TRANSICIÓN (entre secciones grandes):
  - Fondo negro con una frase clave centrada en dorado grande
  - Partículas de fichas/monedas más visibles
  - Ejemplos de frases: "95% automático", "30 segundos", "Sin intervención humana"

ICONOGRAFÍA:
  - Usar iconos minimalistas estilo línea en dorado/blanco
  - Fichas de casino, escudo (seguridad), reloj (velocidad), robot (IA),
    celular (app), monitor (panel), ojo (validación), rayo (automatización)

SENSACIÓN GENERAL: Profesional, premium, confiable, tecnológico.
  Como un pitch deck de una fintech de alto nivel mezclado con la elegancia
  de un casino VIP. Nada infantil, nada genérico.
==========================================================================
-->

# Plataforma de Carga Automatizada de Fichas

### Sistema integral de gestión, validación y automatización para paneles de juego online

> **Pagá, validamos al instante, y las fichas llegan solas.**

---

## 1. El Problema

Cargar fichas en paneles de juego online es hoy un proceso **manual, lento y propenso a errores**:

- **Proceso tedioso**: El operador debe verificar cada comprobante de pago a ojo, buscar el usuario en el panel, y cargar las fichas manualmente.
- **Tiempos de espera**: El usuario puede esperar minutos u horas hasta que un operador procese su pedido.
- **Errores humanos**: Montos mal cargados, usuarios confundidos, comprobantes duplicados que pasan desapercibidos.
- **Falta de trazabilidad**: Sin registro claro de quién hizo qué, cuándo, y por qué.
- **Escalabilidad limitada**: Más usuarios = más operadores necesarios, costos crecientes.
- **Riesgo de detección**: Herramientas de automatización tradicionales (bots, scripts) son fácilmente detectables por los paneles.

---

## 2. La Solución

Una **plataforma completa** que automatiza el 95% del proceso de carga de fichas, dejando a los operadores solo para supervisar excepciones.

### Filosofía central:

> **"Casi 100% automático. Los humanos solo supervisan lo que falla."**

| Flujo normal (95% de los casos) | Flujo excepcional (5%) |
|---|---|
| Usuario pide fichas | Comprobante no se puede validar |
| IA valida el comprobante automáticamente | El bot falla al ejecutar la carga |
| Bot carga las fichas en el panel | Algo parece sospechoso |
| Usuario recibe confirmación | Operador revisa y decide |

---

<!-- PÁGINA DE TRANSICIÓN: Fondo negro, texto dorado centrado grande -->
<!-- "95% automático. El otro 5% lo supervisa un humano." -->
<!-- Partículas de fichas doradas cayendo, ambiente casino premium -->

---

## 3. Cómo Funciona — Experiencia del Usuario

El proceso completo toma **menos de 60 segundos** en la mayoría de los casos:

### Paso 1 — Elegir monto
El usuario abre la app, ingresa su nombre de usuario del panel de juego y selecciona el monto a cargar (montos preconfigurados o monto personalizado).

### Paso 2 — Realizar el pago
El sistema muestra los datos de pago (alias de MercadoPago, CBU o CVU) para que el usuario realice la transferencia desde su banco o billetera digital.

### Paso 3 — Subir comprobante
El usuario sube una foto o PDF del comprobante de pago directamente desde la cámara o galería de su celular.

### Paso 4 — Validación automática con IA
La inteligencia artificial analiza el comprobante: verifica el monto, la fecha, detecta duplicados, y asigna un puntaje de confianza. Si pasa el umbral, se aprueba automáticamente.

### Paso 5 — Carga automática
Un bot ejecuta la carga de fichas en el panel de juego, simulando comportamiento humano real para evitar cualquier detección.

### Paso 6 — Confirmación instantánea
El usuario recibe un mensaje en tiempo real confirmando que sus fichas fueron cargadas exitosamente.

---

## 4. Componentes del Sistema

La plataforma se compone de **8 aplicaciones** que trabajan en conjunto:

---

### 4.1 App del Usuario (Móvil y Web)

**Plataforma**: iOS, Android y Web (Progressive Web App)

La interfaz principal para los usuarios finales. Diseño estilo chat conversacional, simple e intuitivo.

**Funcionalidades principales:**
- Registro y login con nombre de usuario
- Chat en tiempo real con el sistema y operadores de soporte
- Selección de monto con opciones preconfiguradas ($1.000, $2.000, $5.000, $10.000) o monto personalizado
- Visualización de datos de pago (alias, CBU, CVU) con botón de copiar
- Subida de comprobante de pago (foto o PDF, hasta 10MB)
- Seguimiento en tiempo real del estado del pedido con indicadores visuales:
  - Validando comprobante...
  - Comprobante aprobado
  - Procesando carga de fichas...
  - Fichas cargadas exitosamente
- Cobro de premios (retiro de fichas)
- Soporte vía chat con operador humano
- Notificaciones push en tiempo real
- Funcionamiento offline con reconexión automática

**Experiencia de usuario:**
- Interfaz conversacional (estilo WhatsApp)
- Tarjetas interactivas dentro del chat (selector de monto, datos de pago, subida de comprobante, tracker de estado)
- Feedback háptico en acciones clave
- Animaciones de celebración al completar la carga
- Tema visual personalizable

---

### 4.2 Panel de Operadores (Desktop)

**Plataforma**: Windows, macOS, Linux (aplicación de escritorio)

Estación de trabajo completa para operadores. Centro de comando y control del sistema.

**Vistas principales:**

| Vista | Función |
|---|---|
| **Dashboard** | Métricas en tiempo real: pedidos completados, fallidos, en proceso. Gráfico de tendencia semanal. Estado del bot, validador y kill switch. |
| **Fallos** | Cola principal de trabajo del operador. Muestra comprobantes que la IA no pudo validar o cargas que el bot no pudo ejecutar. Acciones: aprobar manualmente o rechazar. |
| **Chats** | Conversaciones con usuarios. Respuestas rápidas configurables. Sugerencias de respuesta generadas por IA local. |
| **Jobs** | Cola de ejecución del bot. Estado de cada carga: en cola, procesando, completada, fallida. Opción de reintentar jobs fallidos. |
| **Wallets** | Gestión de billeteras de cobro (MercadoPago, CBU, CVU). Rotación automática cuando se alcanza el límite configurado. |
| **Usuarios** | Lista de usuarios registrados. Activar/bloquear cuentas. Crear usuarios en el panel de juego. Ver historial de cargas. |
| **Premios** | Gestión de reclamos de premios. Verificación de fichas, aprobación de pago, seguimiento de retiro. |
| **Actividad** | Log de auditoría completo. Todas las acciones de operadores registradas con timestamp. Exportable a CSV. |
| **Configuración** | Umbrales de validación, tiempos de espera, ventana de actividad del bot, respuestas rápidas, conexión con IA local. |

**Inteligencia Artificial integrada:**
- Respuestas sugeridas para el chat (generadas por IA local)
- Análisis automático de fallos (explica por qué la validación falló)
- Bot conversacional que responde a usuarios automáticamente
- Todo procesado localmente — sin dependencias de servicios en la nube

---

### 4.3 App de Operadores (Móvil)

**Plataforma**: Android (APK nativo)

Versión móvil del panel de operadores para supervisión sobre la marcha.

**Funcionalidades:**
- Dashboard con métricas en tiempo real
- Cola de fallos con aprobación/rechazo por swipe
- Chat con usuarios (respuestas rápidas incluidas)
- Monitoreo de jobs en tiempo real
- Gestión de wallets (crear, editar, rotar, vaciar)
- Gestión de usuarios (activar/bloquear, crear en panel)
- Gestión de premios
- Log de actividad
- Kill switch de emergencia
- Configuración del sistema
- Notificaciones push
- Feedback háptico en acciones clave

---

### 4.4 Validador de Comprobantes (Desktop + IA)

**Plataforma**: Windows, macOS, Linux (aplicación de escritorio)

Aplicación dedicada que usa inteligencia artificial local para validar comprobantes de pago.

**Proceso de validación:**
1. Recibe el comprobante (imagen o PDF) del servidor
2. Procesa la imagen con modelos de visión por IA (OCR + análisis)
3. Extrae: monto, fecha, hora, método de pago, ID de transacción, nombres de emisor/receptor
4. Verifica:
   - El monto coincide con lo solicitado
   - La fecha es reciente (ventana configurable, por defecto 7 días)
   - No es un comprobante duplicado (hash de imagen + ID de transacción)
   - El comprobante parece auténtico
5. Asigna un puntaje de confianza (0 a 1)
6. Si supera el umbral (configurable, por defecto 0.80): aprobación automática
7. Si no supera: envía a la cola de revisión del operador

**Características técnicas:**
- Modelos de IA ejecutan 100% local (sin envío de datos a la nube)
- Cola offline con persistencia en disco (sigue validando si pierde conexión)
- Reconexión automática con backoff exponencial
- Soporte para PDF e imágenes (PNG, JPG)
- Detección de fraude: comprobantes duplicados, montos alterados, fechas sospechosas

---

### 4.5 Bot de Automatización

**Plataforma**: Extensión de navegador Chrome real

El componente que ejecuta la carga de fichas en el panel de juego, simulando comportamiento humano real.

**Por qué una extensión de Chrome (y no un bot tradicional):**
- Ejecuta en un navegador Chrome real con fingerprint legítimo
- Prácticamente indetectable por sistemas de seguridad y protección anti-bot
- Cookies y sesión persistentes (no requiere login frecuente)
- Contexto de navegación idéntico al de un usuario humano real

**Comportamiento humanizado:**
- Escritura carácter por carácter con velocidad variable (simulando tipeo humano)
- Pausas aleatorias entre acciones (2 a 7 segundos, configurable)
- Movimientos de mouse antes de cada click
- Clicks en posiciones ligeramente aleatorias del botón
- Espera inteligente por elementos (no demoras fijas)

**Flujo de ejecución:**
1. Recibe job del servidor (vía WebSocket o polling HTTP)
2. Verifica sesión activa en el panel (auto-login si expiró)
3. Verifica saldo disponible en el panel
4. Navega a la sección de usuarios
5. Busca al usuario por nombre
6. Abre el formulario de carga de fichas
7. Ingresa el monto con tipeo humanizado
8. Confirma la operación
9. Verifica el mensaje de éxito
10. Reporta resultado al servidor

**Reglas de seguridad:**
- Solo UN job a la vez (nunca en paralelo)
- Período de enfriamiento entre jobs (30+ segundos)
- Si falla, se detiene inmediatamente (sin reintentos automáticos)
- Captura de pantalla automática en cada error
- Kill switch global para detener toda automatización al instante
- Ventana de actividad configurable (ej: solo entre 8:00 y 23:00)
- Log detallado de cada acción con timestamp

---

### 4.6 Servidor Backend (API)

**Tecnología**: NestJS (Node.js) + PostgreSQL + Redis

El cerebro del sistema. Orquesta toda la operación.

**Capacidades principales:**
- API REST completa con autenticación JWT y roles (Cliente, Operador, Operador Senior, Admin)
- Comunicación en tiempo real vía WebSocket (Socket.IO) con 4 canales dedicados
- Cola de jobs con ejecución secuencial y control de cooldown
- Gestión de balance atómica (previene errores de concurrencia)
- Detección de jobs trabados con auto-recuperación
- Rotación automática de wallets al alcanzar límites
- Sistema de notificaciones (push + Telegram)
- Logging completo: auditoría, sesiones de bot, validaciones, screenshots
- Detección de duplicados en comprobantes (hash + ID de transacción)
- Soporte multi-panel (múltiples paneles de juego simultáneos)
- Descubrimiento automático de usuarios entre paneles
- Métricas por hora (requests, jobs, validaciones, tiempos promedio)

---

### 4.7 Dashboard del Dueño (Web)

**Plataforma**: Navegador web (acceso privado)

Panel exclusivo para el dueño/inversor del negocio con visión ejecutiva de toda la operación.

**Funcionalidades:**
- Resumen financiero: ingresos, egresos, márgenes
- Volumen de operaciones por período
- Estado de salud del sistema de un vistazo
- Métricas de rendimiento del equipo de operadores
- Acceso independiente del panel de operadores

---

### 4.8 Landing Page (Web)

**Plataforma**: Sitio web estático, desplegable en cualquier hosting

Página de presentación pública para atraer nuevos usuarios.

**Secciones:**
- Hero con llamada a la acción y descarga de la app
- Flujo de 3 pasos (elegir monto → pagar → fichas cargadas)
- Estadísticas animadas (usuarios activos, fichas cargadas, tiempo promedio)
- Sección de confianza (pagos seguros, validación con IA, soporte 24/7)
- Detección automática de dispositivo (Android → APK, iOS → Web App)
- Diseño responsive y optimizado para móvil
- Completamente personalizable con la marca del cliente

---

<!-- PÁGINA DE TRANSICIÓN: Fondo negro, texto dorado centrado -->
<!-- "30 segundos. De pago a fichas cargadas." -->
<!-- Icono de reloj dorado grande, partículas de monedas -->

---

## 5. Cobro de Premios

Los usuarios también pueden **retirar fichas/premios** a través de la misma plataforma:

### Flujo de retiro:

1. **Usuario solicita cobro** — Desde la app, elige el monto a retirar
2. **Ingresa datos de pago** — CBU, alias o CVU donde quiere recibir el dinero
3. **Verificación de fichas** — El bot verifica en el panel que el usuario tiene las fichas declaradas
4. **Operador aprueba** — Revisa la solicitud y confirma el retiro
5. **Bot retira fichas** — El bot ejecuta el retiro de fichas en el panel de juego
6. **Operador confirma pago** — Realiza la transferencia bancaria y marca como pagado
7. **Usuario notificado** — Recibe confirmación de que el pago fue enviado

---

## 6. Seguridad y Confiabilidad

### Anti-detección
- Navegador Chrome real (no headless/Puppeteer/Playwright)
- Fingerprint legítimo e indistinguible de un usuario real
- Comportamiento humanizado en todas las interacciones
- Sesiones persistentes (login único, sin patrones sospechosos)
- Sin reintentos automáticos (evita patrones repetitivos)
- Escala por cantidad de operadores, no por velocidad del bot

### Control operativo
- **Kill Switch**: Botón de emergencia que detiene toda automatización al instante (accesible desde panel, app móvil y extensión)
- **Ventana de actividad**: Configurable para que el bot solo opere en horarios normales
- **Cooldown entre operaciones**: Tiempo mínimo entre cargas para simular uso natural

### Validación y anti-fraude
- IA local valida autenticidad de comprobantes
- Detección de comprobantes duplicados (hash de imagen + ID de transacción)
- Verificación de coincidencia de montos
- Verificación de fechas recientes
- Score de confianza con umbral configurable

### Auditoría completa
- Cada acción de operador queda registrada con timestamp
- Historial completo de cambios de estado por pedido
- Capturas de pantalla automáticas en errores
- Logs de sesión del bot paso a paso
- Logs del validador
- Exportación a CSV para análisis externo

### Datos seguros
- Credenciales del panel encriptadas
- Autenticación JWT con roles y permisos
- Los operadores nunca ven las contraseñas del panel
- Balance manejado con operaciones atómicas (sin errores de concurrencia)
- Procesamiento de IA 100% local (sin envío de comprobantes a la nube)

---

<!-- PÁGINA DE TRANSICIÓN: Fondo negro, texto dorado centrado -->
<!-- "Seguro. Auditable. Indetectable." -->
<!-- Icono de escudo dorado, partículas sutiles -->

---

## 7. Métricas Clave del Sistema

| Métrica | Valor |
|---|---|
| **Tasa de éxito de cargas** | 95%+ |
| **Tiempo promedio de carga** | ~30 segundos |
| **Intervención humana requerida** | Menos del 5% de los pedidos |
| **Validación automática exitosa** | 90%+ de los comprobantes |
| **Fallos por sesión expirada** | Menos del 5% (auto-recuperación) |
| **Disponibilidad del sistema** | 24/7 (con ventana de actividad configurable) |

### Comparación: Antes vs Después

| | Proceso Manual | Con la Plataforma |
|---|---|---|
| **Tiempo por carga** | 5-15 minutos | ~30 segundos |
| **Errores humanos** | Frecuentes | Prácticamente eliminados |
| **Verificación de comprobantes** | Manual, a ojo | Automática con IA |
| **Trazabilidad** | Poca o nula | 100% auditable |
| **Escalabilidad** | Lineal (más gente = más costo) | Alta (misma infra soporta muchos más usuarios) |
| **Detección por el panel** | Alto riesgo con bots comunes | Mínimo (navegador real) |
| **Horario de operación** | Limitado al operador | 24/7 automatizado |

---

## 8. Stack Tecnológico

| Componente | Tecnología |
|---|---|
| **App del Usuario** | React Native (Expo) — iOS, Android, Web |
| **Panel de Operadores** | Electron (Desktop) — Windows, macOS, Linux |
| **App de Operadores** | React Native (Expo) — Android |
| **Validador** | Electron + Ollama (IA local) |
| **Bot de Automatización** | Extensión Chrome nativa |
| **Backend** | NestJS (Node.js/TypeScript) |
| **Base de datos** | PostgreSQL |
| **Cache y colas** | Redis |
| **Comunicación real-time** | WebSocket (Socket.IO) |
| **IA / OCR** | Modelos de visión locales (Ollama) |
| **Notificaciones** | Push nativo + Telegram |

---

## 9. Escalabilidad

La plataforma está diseñada para crecer:

- **Multi-panel**: Soporte simultáneo para múltiples paneles de juego. El sistema descubre automáticamente en qué panel está cada usuario.
- **Multi-operador**: Varios operadores trabajando en paralelo, cada uno con su app móvil o panel desktop.
- **Multi-wallet**: Múltiples billeteras de cobro con rotación automática cuando se alcanza el límite acumulado.
- **Multi-bot**: Se puede agregar un bot por panel, cada uno en su propia instancia de Chrome.
- **Configuración centralizada**: Todos los umbrales, tiempos y límites se ajustan desde el panel sin tocar código.

---

## 10. Soporte y Monitoreo en Tiempo Real

- **Chat en vivo**: Los usuarios pueden escribir al soporte desde la misma app. El operador responde desde el panel desktop o la app móvil.
- **IA conversacional**: Un bot responde automáticamente las consultas más comunes en español argentino natural.
- **Notificaciones Telegram**: Alertas instantáneas a operadores sobre fallos, nuevos pedidos y eventos críticos.
- **Dashboard en tiempo real**: Métricas actualizadas al segundo — jobs, fallos, chats activos, estado del bot.
- **Indicadores de estado**: Conexión del bot, disponibilidad del validador, estado del kill switch — todo visible de un vistazo.

---

## 11. Personalización

La plataforma es **100% white-label** — se adapta completamente a la marca del cliente:

- **Nombre y logo**: Se reemplaza en todas las apps (usuario, operador, landing)
- **Paleta de colores**: Tema visual configurable (colores primarios, fondos, acentos)
- **Datos de pago**: Wallets propias del cliente (MercadoPago, CBU, CVU)
- **Dominio y hosting**: Se despliega bajo el dominio del cliente
- **Panel de juego**: Se configura para cualquier panel compatible (selectores adaptables)
- **Idioma del bot**: Personalizable (por defecto español argentino)
- **Montos preconfigurados**: Ajustables según el negocio
- **Umbrales y límites**: Todos configurables sin tocar código

---

## 12. Entregables

| # | Entregable | Formato |
|---|---|---|
| 1 | App del Usuario | APK (Android) + Web App (PWA) + iOS (compilable) |
| 2 | Panel de Operadores | Instalador Windows (.exe) + macOS + Linux |
| 3 | App de Operadores | APK (Android) |
| 4 | Validador de Comprobantes | Instalador Windows (.exe) + macOS + Linux |
| 5 | Bot de Automatización | Extensión Chrome (archivo .zip) |
| 6 | Servidor Backend | Docker / Deploy en servidor |
| 7 | Dashboard del Dueño | Aplicación web privada |
| 8 | Landing Page | Sitio web estático desplegable |
| 9 | Código fuente completo | Repositorio Git con documentación |

---

<!-- PÁGINA DE TRANSICIÓN: Fondo negro, texto dorado centrado -->
<!-- "Todo incluido. Listo para operar." -->
<!-- Iconos de los 8 entregables en fila, estilo dorado minimalista -->

---

## 13. Resumen

Esta plataforma transforma un proceso manual, lento y riesgoso en una operación **casi completamente automática**, donde:

- Los **usuarios** cargan fichas en segundos desde su celular
- La **IA** valida comprobantes sin intervención humana
- El **bot** ejecuta las cargas de forma indetectable
- Los **operadores** solo intervienen cuando algo falla (menos del 5% de los casos)
- Todo queda **registrado y auditable**

> **Menos trabajo manual. Más velocidad. Más seguridad. Más escala.**

---

*Documento generado para presentación comercial. Todos los valores y métricas están basados en el rendimiento real del sistema en producción.*
