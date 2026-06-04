# Tio Rico Fichas - Landing Page

Landing page estática para la distribución del APK de Tio Rico Fichas.

## 📁 Estructura

```
landing-page/
├── index.html          # Página principal
├── styles.css          # Estilos responsivos
├── script.js           # Device detection + interactividad
├── vercel.json         # Configuración de Vercel
├── app-icon.png        # Ícono de la app
├── tio-rico-logo.svg   # Logo de Tio Rico
├── public/
│   └── tio-rico-fichas.apk  # APK para descargar
└── README.md           # Este archivo
```

## 📱 Device Detection

La landing page detecta automáticamente el dispositivo:

- **iPhone/iPad**: Muestra botón "Abrir App Web" → redirige a versión web
- **Android**: Muestra botón "Descargar APK" → descarga el APK
- **Desktop**: Muestra ambas opciones (APK + Web)

Esto asegura que cada usuario vea la opción más apropiada para su dispositivo.

## ✨ Características de la Landing Page

### 🔄 Loading Animation
Animación de carga mientras detecta el dispositivo del usuario.

### 🔒 Trust Badges
4 badges de confianza:
- Pagos Seguros
- Validación Instantánea
- Soporte 24/7
- +1000 Usuarios

### 📊 Social Proof
Estadísticas de uso:
- 1,000+ Usuarios activos
- 5,000+ Cargas realizadas

### 💳 Métodos de Pago
Muestra los métodos de pago aceptados:
- MercadoPago
- Transferencia
- CBU/CVU

### ⭐ Testimonios
3 testimonios breves de usuarios reales.

### 📱 Screenshots Carousel
Carousel horizontal con 3 screenshots de la app (opcional - las imágenes deben agregarse manualmente).

## ⚙️ Configuración Inicial

### Actualizar URL de la App Web

Antes de desplegar, editar `script.js` y actualizar la URL de la app web:

```javascript
const WEB_APP_URL = 'https://tu-chat-app.vercel.app'; // Cambiar esto!
```

Esta URL se muestra a usuarios de iPhone para que usen la versión web.

## 🚀 Deployment

### Opción 1: Vercel (Recomendado)

**Primera vez**:
```bash
# Instalar Vercel CLI si no lo tenés
npm install -g vercel

# Navegar al directorio
cd apps/landing-page

# Login a Vercel
vercel login

# Desplegar
vercel
```

**Deployments posteriores**:
```bash
cd apps/landing-page
vercel --prod
```

**Configurar dominio custom** (opcional):
```bash
# Agregar dominio
vercel domains add tioricofichas.com

# Asignar alias
vercel alias <deployment-url> tioricofichas.com
```

### Opción 2: Netlify

1. Ir a https://app.netlify.com
2. Drag & drop la carpeta `apps/landing-page`
3. Listo! URL: `tioricofichas.netlify.app`

### Opción 3: GitHub Pages

```bash
cd apps/landing-page
git init
git add .
git commit -m "Initial landing page"
git remote add origin https://github.com/yourusername/tioricofichas-landing.git
git push -u origin main

# Habilitar GitHub Pages en settings del repo
# Settings → Pages → Source: main branch
```

## 📲 Actualizar APK

Cuando tenés una nueva versión de la app:

### 1. Actualizar versión en app.json
```bash
cd apps/chat-app
# Editar app.json: cambiar "version": "1.1.0"
```

### 2. Construir APK
```bash
cd apps/chat-app
eas build --platform android --profile production
```

Esperar ~10-15 minutos que termine el build.

### 3. Descargar APK
1. Ir a https://expo.dev/accounts/[tu-cuenta]/projects/tioricofichas/builds
2. Descargar el APK cuando esté listo

### 4. Reemplazar APK en landing page
```bash
cp ~/Downloads/build-*.apk apps/landing-page/public/tio-rico-fichas.apk
```

### 5. Actualizar versión en HTML
Editar `apps/landing-page/index.html`:
```html
<p class="version">Versión 1.1.0</p>
```

### 6. Re-desplegar
```bash
cd apps/landing-page
vercel --prod
```

## 🎨 Personalización

### Colores
Editar variables CSS en `styles.css`:
```css
:root {
  --primary: #D4AF37;        /* Dorado */
  --background: #121212;     /* Fondo oscuro */
  --text-primary: #FFFFFF;   /* Texto */
}
```

### Contenido
- **Título y tagline**: Editar en `index.html` sección `.hero`
- **Features**: Modificar lista en sección `.features`
- **FAQ**: Agregar/editar `<details>` en sección `.faq`
- **Contacto**: Cambiar email en `<footer>`

## ✅ Testing Checklist

### Pre-Deployment
- [ ] El botón de descarga funciona
- [ ] Las imágenes cargan correctamente
- [ ] FAQ se expande/colapsa
- [ ] Responsive en mobile (Chrome DevTools)
- [ ] No hay errores en consola

### Post-Deployment
- [ ] Landing page carga en la URL de Vercel
- [ ] APK se descarga correctamente
- [ ] APK se instala en Android
- [ ] Tamaño del archivo aparece correctamente
- [ ] Dominio custom funciona (si aplica)

## 🔧 Comandos Útiles

```bash
# Ver APK en carpeta public
ls -lh public/

# Verificar tamaño del APK
du -h public/tio-rico-fichas.apk

# Servir localmente (necesita un web server)
python3 -m http.server 8000
# Abrir: http://localhost:8000

# O con npx
npx serve .
```

## 📊 Analytics (Opcional)

Para trackear descargas, descomentá en `script.js`:
```javascript
fetch('/api/track-download', { method: 'POST' })
```

Y creá un endpoint en el backend para registrar las descargas.

## 🌐 SEO (Opcional)

Para mejorar el posicionamiento, agregar a `index.html`:
```html
<meta name="keywords" content="tio rico fichas, android app, carga fichas">
<meta property="og:image" content="https://tu-dominio.com/app-icon.png">
```

## 🆘 Troubleshooting

**APK no descarga**:
- Verificar que el archivo existe en `public/tio-rico-fichas.apk`
- Revisar permisos del archivo: `chmod 644 public/tio-rico-fichas.apk`

**Estilos no cargan**:
- Verificar que `styles.css` esté en la raíz de landing-page
- Limpiar caché del navegador (Ctrl+F5)

**Vercel deployment falla**:
- Verificar que `vercel.json` tenga formato JSON válido
- Ejecutar `vercel --debug` para más info

## 📝 Notas

- **APK inicial**: Necesitás construir el APK con EAS Build y colocarlo en `public/` antes del primer deployment
- **Tamaño**: El APK típicamente pesa 20-40 MB
- **Actualizaciones**: Los usuarios deben desinstalar la versión vieja e instalar la nueva manualmente
- **Seguridad**: Recordá a los usuarios habilitar "Instalar desde fuentes desconocidas"
- **Screenshots (Opcional)**: Para mostrar el carousel de screenshots, agregá las imágenes:
  - `screenshot-1.png` - Pantalla principal
  - `screenshot-2.png` - Chat con soporte
  - `screenshot-3.png` - Validación de pago
  - Tamaño recomendado: 1080x2340px (proporción de celular típico)
  - Si no agregás las imágenes, los placeholders se ocultarán automáticamente (error handling)

## 🔗 Links Útiles

- Vercel Dashboard: https://vercel.com/dashboard
- EAS Build: https://expo.dev/accounts/[tu-cuenta]/projects/tioricofichas/builds
- Netlify: https://app.netlify.com

---

¿Preguntas? Contactá a soporte@tioricofichas.com
