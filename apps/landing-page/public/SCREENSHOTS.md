# Screenshots (Opcional)

Para mostrar el carousel de screenshots en la landing page, agregá las siguientes imágenes en este directorio:

## Archivos Necesarios

1. **screenshot-1.png**
   - Descripción: Pantalla principal de la app
   - Muestra: Selector de monto y formulario de carga

2. **screenshot-2.png**
   - Descripción: Chat con soporte
   - Muestra: Conversación con el bot/operador

3. **screenshot-3.png**
   - Descripción: Validación de pago
   - Muestra: Pantalla de confirmación o detalles de pago

## Especificaciones

- **Formato**: PNG o JPG
- **Tamaño recomendado**: 1080x2340px (proporción típica de celular)
- **Peso**: Optimizá para web (< 500KB por imagen)

## Cómo Obtener Screenshots

### Opción 1: Desde la App Real
1. Abrí la app en un dispositivo Android o simulador
2. Tomá screenshots de las pantallas clave
3. Transferí las imágenes a tu computadora
4. Copiá a `apps/landing-page/`

### Opción 2: Desde Expo Web
1. Abrí la app en modo web: `cd apps/chat-app && bun run web`
2. Abrí las DevTools de Chrome
3. Cambiá a vista mobile (Responsive Design Mode)
4. Tomá screenshots
5. Guardá en `apps/landing-page/`

## Nota

Si NO agregás las imágenes, el carousel se mostrará pero las imágenes que no existan se ocultarán automáticamente gracias al handler `onerror="this.style.display='none'"`.

Esto significa que la landing page funciona perfectamente con o sin screenshots, pero se verá mejor con ellos.
