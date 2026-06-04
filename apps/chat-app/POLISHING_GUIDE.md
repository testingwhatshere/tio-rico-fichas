# UI Polishing Guide

## 🎨 Sistema de Diseño Implementado

Se han creado constantes y componentes para unificar el diseño de la app.

---

## 📦 Archivos Creados

### 1. **constants/colors.ts**
Paleta de colores centralizada:

```typescript
import colors from '@/constants/colors';

// Ejemplos de uso:
backgroundColor: colors.primary,      // #3b82f6
color: colors.textPrimary,           // #111827
borderColor: colors.border,          // #e5e7eb
```

**Colores disponibles:**
- Primary: `primary`, `primaryLight`, `primaryDark`
- Success: `success`, `successLight`, `successDark`
- Warning: `warning`, `warningLight`, `warningDark`
- Error: `error`, `errorLight`, `errorDark`
- Grays: `gray50` a `gray900`
- Text: `textPrimary`, `textSecondary`, `textTertiary`, `textInverse`

### 2. **constants/spacing.ts**
Escala de espaciado consistente:

```typescript
import spacing from '@/constants/spacing';

padding: spacing.md,        // 24
marginBottom: spacing.sm,   // 16
gap: spacing.xs,            // 8
```

**Escala:** xs(8) | sm(16) | md(24) | lg(32) | xl(48) | xxl(64)

### 3. **components/AnimatedButton.tsx**
Botón animado con scale effect:

```typescript
import AnimatedButton from '@/components/AnimatedButton';

<AnimatedButton
  title="Continuar"
  icon="arrow-forward"
  onPress={handleSubmit}
  variant="primary"
  disabled={isLoading}
/>
```

**Variantes:** `primary` | `secondary` | `danger`

---

## 🔄 Cómo Migrar Botones Existentes

### Antes:
```typescript
<TouchableOpacity style={styles.button} onPress={handlePress}>
  <Text style={styles.buttonText}>Continuar</Text>
</TouchableOpacity>

const styles = StyleSheet.create({
  button: {
    height: 56,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    padding: 24,
  },
  buttonText: {
    color: '#ffffff',
  },
});
```

### Después:
```typescript
import AnimatedButton from '@/components/AnimatedButton';
import colors from '@/constants/colors';
import spacing from '@/constants/spacing';

<AnimatedButton
  title="Continuar"
  icon="arrow-forward"
  onPress={handlePress}
  variant="primary"
/>

// O si querés personalizar más:
<TouchableOpacity style={styles.button}>
  <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
  <Text style={styles.buttonText}>Continuar</Text>
</TouchableOpacity>

const styles = StyleSheet.create({
  button: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
  },
  buttonText: {
    color: colors.textInverse,
  },
});
```

---

## ✨ Agregar Animaciones Simples

### 1. **Scale Animation (Press Effect)**

```typescript
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const MyButton = () => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <TouchableOpacity
        onPressIn={() => (scale.value = withSpring(0.95))}
        onPressOut={() => (scale.value = withSpring(1))}
      >
        <Text>Presioná acá</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};
```

### 2. **Fade In Animation**

```typescript
import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';

const FadeInView = ({ children }) => {
  const opacity = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 300 });
  }, []);

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
};
```

### 3. **Slide Up Animation**

```typescript
const SlideUpView = ({ children }) => {
  const translateY = useSharedValue(50);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    translateY.value = withSpring(0, {
      damping: 15,
      stiffness: 100,
    });
  }, []);

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
};
```

---

## 🎯 Botones que Necesitan Iconos

Revisá estas pantallas y agregá iconos a los botones:

### **Login/Register:**
- Login → `log-in`
- Register → `person-add`

### **Home (Request Form):**
- Continuar → `arrow-forward` ✅

### **Payment Instructions:**
- Copiar alias → `copy` ✅
- Subir comprobante → `cloud-upload`

### **Upload Screen:**
- Tomar foto → `camera` ✅
- Elegir archivo → `document` ✅
- Enviar → `send`

### **Profile:**
- Editar perfil → `create`
- Notificaciones → `notifications`
- Ayuda → `help-circle`
- Términos → `document-text`
- Cerrar sesión → `log-out` ✅

---

## 📝 Checklist de Polishing

Para cada pantalla, verificá:

- [ ] **Colores:** Reemplazá hex codes con `colors.xxx`
- [ ] **Espaciado:** Usá `spacing.xs/sm/md/lg` (8/16/24/32)
- [ ] **Botones:** Todos tienen iconos relevantes
- [ ] **Animaciones:** Botones principales tienen scale effect
- [ ] **Loading:** ActivityIndicator usa `colors.primary`
- [ ] **Borders:** Usá `colors.border` o `colors.borderDark`
- [ ] **Text:** Usá `colors.textPrimary/Secondary/Tertiary`

---

## 🚀 Ejemplo Completo: Login Button

```typescript
// Antes
<TouchableOpacity
  style={[styles.button, isLoading && styles.buttonDisabled]}
  onPress={handleLogin}
  disabled={isLoading}
>
  {isLoading ? (
    <ActivityIndicator color="#ffffff" />
  ) : (
    <Text style={styles.buttonText}>Iniciar Sesión</Text>
  )}
</TouchableOpacity>

const styles = StyleSheet.create({
  button: {
    height: 48,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#93c5fd',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});

// Después (Opción 1: AnimatedButton)
<AnimatedButton
  title="Iniciar Sesión"
  icon="log-in"
  onPress={handleLogin}
  disabled={isLoading}
  loading={isLoading}
  variant="primary"
/>

// Después (Opción 2: Con constantes)
import colors from '@/constants/colors';
import spacing from '@/constants/spacing';
import { Ionicons } from '@expo/vector-icons';

<TouchableOpacity
  style={[styles.button, isLoading && styles.buttonDisabled]}
  onPress={handleLogin}
  disabled={isLoading}
>
  {isLoading ? (
    <ActivityIndicator color={colors.textInverse} />
  ) : (
    <>
      <Ionicons name="log-in" size={20} color={colors.textInverse} style={styles.icon} />
      <Text style={styles.buttonText}>Iniciar Sesión</Text>
    </>
  )}
</TouchableOpacity>

const styles = StyleSheet.create({
  button: {
    height: 48,
    backgroundColor: colors.primary,
    borderRadius: 8,
    marginTop: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.primaryLight,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  icon: {
    marginRight: spacing.xs,
  },
});
```

---

## 📚 Documentación Adicional

Ver `docs/UI_GUIDELINES.md` para más ejemplos y buenas prácticas.
