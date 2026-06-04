# 📋 Testing Plan - Chat App

## 🔄 Flujo Principal (Happy Path)

### 1. **Registro de Usuario**
- [ ] Abrir app → Debe redirigir a Login
- [ ] Tap en "Registrarse"
- [ ] Ingresar email válido: `test@example.com`
- [ ] Ingresar password: `password123`
- [ ] Confirmar password: `password123`
- [ ] Tap "Registrarse"
- [ ] **Esperado**: Loading overlay → Navega a tabs → Socket conecta

**Bugs potenciales:**
- ¿Socket se conecta después del registro?
- ¿Token se guarda en SecureStore?
- ¿Redirección automática funciona?

---

### 2. **Crear Request**
- [ ] En tab Home, llenar formulario:
  - Username: `player123`
  - Amount: `50`
- [ ] Tap "Continuar"
- [ ] **Esperado**: Loading overlay → Navega a `/request/[id]/payment`

**Bugs potenciales:**
- ¿Validación funciona correctamente?
- ¿API crea el request?
- ¿Navegación usa el ID correcto?

---

### 3. **Ver Instrucciones de Pago**
- [ ] Verificar que muestra:
  - Proveedor
  - Alias
  - Monto correcto ($50)
  - Referencia (ID del request)
- [ ] Tap "Copiar" alias
- [ ] **Esperado**: Alert "Copiado!"
- [ ] Tap "Ya pagué, subir comprobante"
- [ ] **Esperado**: Navega a `/request/[id]/upload`

**Bugs potenciales:**
- ¿Clipboard funciona?
- ¿Datos se cargan correctamente?

---

### 4. **Subir Comprobante**
- [ ] Tap "Tomar Foto"
- [ ] **Esperado**: Pide permisos de cámara
- [ ] Aprobar permisos
- [ ] Tomar foto
- [ ] **Esperado**: Preview se muestra
- [ ] Tap "Enviar Comprobante"
- [ ] **Esperado**: Loading overlay → Navega a `/request/[id]/status`

**Bugs potenciales:**
- ¿Permisos se manejan correctamente?
- ¿Preview funciona para PDF y fotos?
- ¿Upload multipart funciona?

---

### 5. **Pantalla de Status**
- [ ] Verificar que muestra:
  - Pasos con indicadores
  - Polling cada 3 segundos
- [ ] Simular cambio de status a COMPLETED
- [ ] **Esperado**: Navega a `/request/[id]/success`

**Bugs potenciales:**
- ¿Polling se limpia al desmontar?
- ¿Navegación automática funciona?
- ¿Indicadores visuales son correctos?

---

### 6. **Pantalla de Éxito**
- [ ] Verificar que muestra:
  - Checkmark verde con animación
  - Mensaje: "¡$50 cargados a player123!"
- [ ] Tap "Nueva Carga"
- [ ] **Esperado**: Navega a Home
- [ ] Volver y tap "Ver Historial"
- [ ] **Esperado**: Navega a tab Requests

**Bugs potenciales:**
- ¿Animación se reproduce?
- ¿Datos correctos se muestran?

---

## 📱 Tabs y Navegación

### 7. **Tab Requests (Mis Cargas)**
- [ ] Verificar lista de requests
- [ ] Pull to refresh
- [ ] Tap en un request
- [ ] **Esperado**: Navega a `/request/[id]`

**Bugs potenciales:**
- ¿Skeletons se muestran al cargar?
- ¿Pull to refresh funciona?
- ¿Badge de chat se muestra?

---

### 8. **Tab Chat (Mensajes)**
- [ ] Verificar botón "Soporte" arriba
- [ ] Verificar lista de requests con último mensaje
- [ ] Tap "Soporte"
- [ ] **Esperado**: Navega a `/chat/support`

**Bugs potenciales:**
- ¿Último mensaje se muestra?
- ¿Indicador de no leídos funciona?

---

### 9. **Chat de Soporte**
- [ ] Escribir mensaje: "Hola, necesito ayuda"
- [ ] Tap enviar
- [ ] **Esperado**: Mensaje aparece, se limpia input, auto-scroll

**Bugs potenciales:**
- ¿WebSocket envía mensaje?
- ¿Mensajes se muestran correctamente?
- ¿FlatList invertido funciona?

---

### 10. **Request Detail con Chat**
- [ ] Desde tab Requests, tap en un request
- [ ] Verificar card de status arriba
- [ ] Verificar chat abajo
- [ ] Escribir mensaje
- [ ] **Esperado**: Mensaje aparece

**Bugs potenciales:**
- ¿Chat se carga correctamente?
- ¿Messages del store se usan?
- ¿Auto-scroll funciona?

---

### 11. **Tab Profile**
- [ ] Verificar estadísticas se cargan
- [ ] Verificar versión de app se muestra
- [ ] Tap "Cerrar Sesión"
- [ ] **Esperado**: Dialog → Loading overlay → Socket desconecta → Navega a login

**Bugs potenciales:**
- ¿Socket se desconecta?
- ¿Token se borra?
- ¿Redirección funciona?

---

## ⚠️ Edge Cases

### 12. **Modo Offline**
- [ ] Activar modo avión
- [ ] **Esperado**: Banner rojo "Sin conexión" arriba
- [ ] Intentar crear request
- [ ] **Esperado**: Botón deshabilitado, dice "Sin conexión"
- [ ] Ir a chat, intentar enviar mensaje
- [ ] **Esperado**: Input deshabilitado, placeholder "Sin conexión..."
- [ ] Desactivar modo avión
- [ ] **Esperado**: Banner desaparece, WebSocket reconecta

**Bugs potenciales:**
- ¿useNetwork detecta cambios?
- ¿Reconexión automática funciona?
- ¿Banner se anima correctamente?

---

### 13. **Errores de Red**
- [ ] Simular timeout (apagar backend)
- [ ] Intentar cargar Requests
- [ ] **Esperado**: ErrorView con "Sin conexión. Revisá tu internet."
- [ ] Tap "Reintentar"
- [ ] **Esperado**: Vuelve a intentar cargar

**Bugs potenciales:**
- ¿getErrorMessage maneja todos los casos?
- ¿ErrorView se muestra correctamente?
- ¿Retry funciona?

---

### 14. **Validación de Formularios**
- [ ] Home: Dejar username vacío → Tap Continuar
- [ ] **Esperado**: Error "El nombre de usuario es requerido"
- [ ] Username: "ab" (menos de 3 chars)
- [ ] **Esperado**: Error "Mínimo 3 caracteres"
- [ ] Username: "user@invalid" (caracteres no permitidos)
- [ ] **Esperado**: Error "Solo letras, números, _ y -"
- [ ] Amount: "0"
- [ ] **Esperado**: Error "Mínimo $1"
- [ ] Amount: "2000"
- [ ] **Esperado**: Error "Máximo $1000"

**Bugs potenciales:**
- ¿Todas las validaciones funcionan?
- ¿Errores se limpian al escribir?

---

### 15. **Estados de Loading**
- [ ] Verificar que todos los botones muestran spinner al cargar:
  - Login/Register
  - Crear request
  - Enviar comprobante
  - Enviar mensaje
  - Logout
- [ ] Verificar LoadingOverlay se muestra
- [ ] Verificar Skeletons en listas

**Bugs potenciales:**
- ¿Todos los loading states están implementados?
- ¿Botones se deshabilitan mientras cargan?

---

### 16. **Memoria y Performance**
- [ ] Navegar entre tabs rápidamente
- [ ] Abrir y cerrar requests múltiples veces
- [ ] Verificar que interval de polling se limpia
- [ ] Verificar que WebSocket no se duplica

**Bugs potenciales:**
- ¿Memory leaks en useEffect?
- ¿Intervals se limpian?
- ¿Socket se desconecta correctamente?

---

## 🐛 Bugs Encontrados

### 🔴 Críticos
- [x] **Bug #1**: Syntax error en `upload.tsx` línea 14 - `import * * DocumentPicker` debe ser `import * as DocumentPicker`
- [x] **Bug #2**: Array mutation en `support.tsx` línea 53 - `.reverse()` muta el array original, debe usar spread operator

### 🟡 Medianos
- [x] **Bug #3**: Error al restaurar messageText en `support.tsx` línea 99 - intenta restaurar después de limpiar, debe guardar valor original
- [x] **Bug #4**: Performance issue en `chat.tsx` línea 69 - useEffect se ejecuta cada vez que messagesFromStore cambia, podría causar re-renders excesivos

### 🟢 Menores
- [x] **Bug #5**: Falta disconnect del WebSocket cuando se va offline en `useNetwork.ts` - solo reconecta al volver online

---

## ✅ Checklist Final

- [ ] Flujo completo funciona
- [ ] Offline mode funciona
- [ ] Error handling funciona
- [ ] Loading states en todos lados
- [ ] Validaciones correctas
- [ ] No hay memory leaks
- [ ] WebSocket conecta/desconecta correctamente
- [ ] Animaciones se ven bien
- [ ] UI es consistente (colores, spacing)
- [ ] Todos los botones tienen iconos
