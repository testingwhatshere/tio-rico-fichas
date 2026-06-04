# 📱 Guía de Testing en Teléfono

## ✅ Configuración Completada

- ✅ IP Local configurada: **192.168.100.19**
- ✅ Expo Dev Server corriendo en: **http://localhost:19000**
- ✅ App lista para testing mobile

---

## 📲 Cómo Probar en tu Teléfono

### Opción 1: Con Expo Go (Recomendado)

1. **Instalar Expo Go en tu teléfono**:
   - Android: https://play.google.com/store/apps/details?id=host.exp.exponent
   - iOS: https://apps.apple.com/app/expo-go/id982107779

2. **Conectar a la misma WiFi**:
   - Asegurate que tu teléfono esté en la **misma red WiFi** que tu computadora
   - Red WiFi actual: 192.168.100.x

3. **Escanear QR Code**:
   - Abrí tu navegador en: http://localhost:19000
   - Vas a ver un QR code grande
   - Abrí Expo Go en tu teléfono
   - Escaneá el QR code

4. **¡Listo!**:
   - La app se va a compilar en tu teléfono
   - Puede tardar 1-2 minutos la primera vez
   - Vas a ver la pantalla de login

---

## 🔥 Hot Reload Activado

Cada vez que guardes un archivo, la app se actualiza automáticamente en tu teléfono!

---

## 🐛 Troubleshooting

### "No se puede conectar"
1. Verificá que ambos estén en la misma WiFi
2. Verificá que tu firewall no bloquee el puerto 19000
3. Probá reiniciar el dev server: cerrar y volver a correr `npm start`

### "Timeout al cargar"
1. La primera carga tarda más
2. Si tarda más de 3 minutos, cerrá Expo Go y volvé a escanear

### "Error de red en las pantallas"
El backend debe estar corriendo en puerto 3000:
```bash
# En otra terminal
cd apps/backend-api
npm run start:dev
```

---

## 📱 Testing con Backend Local

**IMPORTANTE**: El backend debe estar corriendo para que funcione login/registro/requests.

La app está configurada para conectarse a:
- **API**: http://192.168.100.19:3000
- **WebSocket**: http://192.168.100.19:3000

Si el backend NO está corriendo, vas a ver errores de conexión en login.

---

## 🎯 Plan de Testing

Seguí el `TESTING_PLAN.md` para probar todos los flujos:

1. **Flujo básico**:
   - Register con email/password
   - Login
   - Crear request (username + amount)
   - Ver instrucciones de pago
   - Subir comprobante (foto o PDF)
   - Ver estado
   - Success screen

2. **Edge cases**:
   - Modo offline (activar modo avión)
   - Errores de validación (inputs vacíos)
   - Pull-to-refresh en listas
   - Logout

---

## ⚡ Comandos Útiles

```bash
# Iniciar el dev server
cd apps/chat-app
npm start

# Abrir en Android emulator (si tenés uno)
npm run android

# Abrir en iOS simulator (solo Mac)
npm run ios

# Ver logs en tiempo real
npx expo start --port 19000

# Limpiar cache si hay problemas
npx expo start --clear
```

---

## 📊 ¿Qué esperar?

Cuando abras la app en tu teléfono, deberías ver:

1. **Splash screen** (1-2 segundos)
2. **Pantalla de Login**:
   - Input de email
   - Input de password
   - Botón "Iniciar Sesión"
   - Link "Registrarse"

Si ves eso, ¡está funcionando!

---

## 🚀 Siguiente Paso

Una vez que la app cargue en tu teléfono:
1. Registrate con un email de prueba (test@example.com)
2. Probá crear un request
3. Revisá que el UI se vea bien
4. Probá todas las interacciones

**Cualquier bug que encuentres, anotalo y lo arreglamos!**

---

**Última actualización**: 2026-01-07
**Dev Server**: http://localhost:19000
