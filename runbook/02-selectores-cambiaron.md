# Selectores del casino cambiaron

## Sintomas
- Alerta de Telegram: "SELECTORES ROTOS"
- Jobs fallan con error "Elemento no encontrado"
- El selector health check reporta fallos

## Diagnostico

### 1. Identificar que selectores fallaron
- Revisar la alerta de Telegram: lista los selectores que no matchean
- En Aurum → Monitoring → cliente → los logs mostraran el detalle

### 2. Verificar visualmente
- Abrir el panel del casino en Chrome
- Abrir DevTools (F12)
- Probar los selectores fallidos en la consola: `document.querySelector('SELECTOR')`
- Si devuelve null: el casino cambio su HTML

## Solucion

### Actualizar selectores
1. Abrir Aurum → cliente → Selectores CSS
2. Cargar un MHTML actualizado del panel del casino
   - En Chrome: ir al panel → Ctrl+S → guardar como MHTML
3. Click en los elementos que cambiaron
4. Asignar los nuevos selectores a los slots correspondientes
5. Guardar

### Aplicar al deployment
1. Guardar el perfil en Aurum
2. El archivo `panel-profile.json` se actualiza en `clients/<id>/`
3. Copiar el JSON al Chrome storage de la extension:
   - Extension Options → pegar el JSON en "Panel Profile"
   - O configurar la URL remota del perfil

### Verificar
1. Forzar un selector check desde la extension (o esperar 1 hora)
2. Verificar que el check reporta todo OK
3. Ejecutar un job de prueba

## Prevencion
- El selector health check corre cada hora automaticamente
- Usar selectores robustos (aria-label, name) en vez de clases CSS
- Tener selectores alternativos (comma-separated) como fallback
