# Validador de Comprobantes

Aplicacion de escritorio para validar comprobantes de pago usando IA local (Ollama).

## Requisitos

1. **Ollama** instalado en tu computadora
2. **Modelo de vision** descargado

## Instalacion Rapida

### Paso 1: Instalar Ollama

Descarga Ollama desde: https://ollama.com/download

- **Windows**: Descarga y ejecuta el instalador
- **Mac**: Descarga y arrastra a Aplicaciones

### Paso 2: Descargar el modelo de vision

Abre una terminal y ejecuta:

```bash
ollama pull llama3.2-vision
```

Esto descargara el modelo de IA (~4GB). Solo se hace una vez.

### Paso 3: Ejecutar el Validador

Ejecuta el archivo `Validador de Comprobantes.exe` (Windows) o `.app` (Mac).

## Configuracion

1. **URL del Backend**: La URL de tu servidor (ej: `https://tu-app.onrender.com`)
2. **API Key**: Tu clave de acceso (la misma que usa el bot)

## Uso

1. Abre la aplicacion
2. Ingresa la URL del backend y API Key
3. Click en "Conectar"
4. La app se minimiza a la bandeja del sistema
5. Cuando lleguen comprobantes, se validaran automaticamente

## Indicadores

- 🟢 Verde: Todo funcionando
- 🟡 Amarillo: Verificando/Procesando
- 🔴 Rojo: Error o desconectado

## Desarrollo

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Crear ejecutable
npm run build:win   # Windows
npm run build:mac   # Mac
npm run build:linux # Linux
```

## Solucion de Problemas

### "Ollama no detectado"
- Verifica que Ollama este instalado y corriendo
- En Windows, busca el icono de Ollama en la bandeja del sistema

### "Modelo de vision no encontrado"
- Ejecuta: `ollama pull llama3.2-vision`

### "Error de conexion"
- Verifica la URL del backend
- Verifica que la API Key sea correcta
- Verifica tu conexion a internet
