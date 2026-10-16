/**
 * Tokens de diseño del panel de operadores.
 *
 * Fuente única de verdad. Antes cada pantalla inventaba sus propios valores:
 * 41 StyleSheet.create con radios de 10/12/14/16 mezclados, headers en 4 tamaños
 * distintos, y opacidad hecha concatenando strings (`color + '20'`), que rompe
 * cuando el color base viene en rgba().
 *
 * Regla: ningún valor de espaciado, tamaño de fuente, radio o sombra se escribe
 * a mano en una pantalla. Sale de acá.
 */

// ── Paleta base ───────────────────────────────────────────────────────────────
// El dorado es la identidad de Tio Rico, pero como acento: define QUÉ mirar.
// Si todo brilla, nada resalta. Las superficies son neutras y frías; el dorado
// queda para lo activo y lo accionable.

const gold = {
  400: '#FBD38D',
  500: '#F6AD55',
  600: '#D4A017',
  700: '#B8860B',
};

const neutral = {
  0: '#0A0A0C', // fondo de la app
  50: '#0F0F12', // sidebar y barras
  100: '#141417', // tarjetas y filas
  200: '#1C1C21', // superficie elevada, inputs, hover
  300: '#26262C', // bordes
  400: '#6E6E76', // texto apagado
  500: '#9B9BA3', // texto secundario
  900: '#F2F2F4', // texto principal
};

const status = {
  success: '#48BB78',
  error: '#F56565',
  warning: '#ED8936',
  info: '#4299E1',
};

/**
 * Aplica opacidad a un color del tema.
 * Reemplaza el patrón `color + '20'`, que sólo funcionaba con hex de 6 dígitos
 * y producía colores inválidos silenciosamente con cualquier otra notación.
 */
export function alpha(color: string, opacity: number): string {
  const o = Math.max(0, Math.min(1, opacity));
  const hex = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${o})`;
  }
  const rgb = hex.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((n) => n.trim());
    return `rgba(${r}, ${g}, ${b}, ${o})`;
  }
  return hex;
}

export const colors = {
  // Acento
  primary: gold[500],
  primaryDark: gold[600],
  primaryLight: gold[400],
  primaryHover: gold[700],

  // Superficies, de atrás hacia adelante
  background: neutral[0],
  backgroundSecondary: neutral[50],
  backgroundTertiary: neutral[200],
  cardBackground: neutral[100],
  surfaceElevated: neutral[200],

  // Texto
  textPrimary: neutral[900],
  textSecondary: neutral[500],
  textMuted: neutral[400],
  textOnPrimary: '#1A202C',

  // Estado
  ...status,

  // Bordes: neutros. Antes eran dorados translúcidos, lo que teñía de oro
  // cada borde de la app y competía con el acento real.
  border: neutral[300],
  borderSubtle: alpha(neutral[300], 0.5),
  borderStrong: neutral[400],
  borderAccent: alpha(gold[600], 0.4),
  separator: alpha(neutral[300], 0.6),

  // Inputs
  input: neutral[200],
  inputBorder: neutral[300],
  inputFocus: gold[600],
  placeholder: neutral[400],

  // Overlays
  overlay: alpha(neutral[0], 0.8),
  shadow: 'rgba(0, 0, 0, 0.4)',

  // Puntuales
  unreadBadge: '#EF4444',
  onlineGreen: '#22C55E',
  white: '#FFFFFF',
  black: '#000000',
} as const;

// ── Escalas ───────────────────────────────────────────────────────────────────
// Espaciado en múltiplos de 4. Todo el layout se compone con estos.

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  full: 999,
} as const;

/**
 * Tipografía. Menos tamaños y más contraste entre ellos: el problema del panel
 * viejo no era que faltaran tamaños sino que había 4 casi iguales (20/24/26/28)
 * y ninguno se leía como jerarquía.
 */
export const text = {
  display: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 14, fontWeight: '500' },
  bodyStrong: { fontSize: 14, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600' },
  caption: { fontSize: 11, fontWeight: '500' },
  mono: { fontSize: 12, fontWeight: '500', fontFamily: 'Menlo, Consolas, monospace' },
} as const;

/** Sombras. En web `elevation` no hace nada, así que va boxShadow explícito. */
export const shadow = {
  sm: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

/**
 * Ancho a partir del cual dejamos de tratar la pantalla como un celular.
 * Se consulta con useLayout(), nunca con Dimensions capturado al importar
 * (eso no reacciona al resize del browser).
 */
export const DESKTOP_BREAKPOINT = 900;

export const SIDEBAR_WIDTH = 216;

export const theme = { colors, space, radius, text, shadow, alpha };
export default theme;
