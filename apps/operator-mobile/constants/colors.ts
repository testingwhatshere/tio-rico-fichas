/**
 * Capa de compatibilidad. Los tokens reales viven en `constants/theme.ts`.
 *
 * Las pantallas viejas importan `colors` desde acá con nombres que ya no
 * describen nada (`buttonPrimaryHover`, `chipPending`, `feltGreen`, `surfaceLight`,
 * varios alias del mismo valor). Se mantienen mapeados al tema nuevo para no
 * romper nada, y se van borrando a medida que cada pantalla se migra a `theme`.
 *
 * En código nuevo: importar de `constants/theme`.
 */
import { colors as t, alpha } from './theme';

export const colors = {
  ...t,

  /** @deprecated usar `colors.borderSubtle` */
  borderLight: t.borderSubtle,
  /** @deprecated usar `colors.borderAccent` */
  borderGold: t.borderAccent,
  /** @deprecated usar `colors.warning` */
  chipPending: t.warning,
  /** @deprecated usar `colors.info` */
  chipProcessing: t.info,
  /** @deprecated usar `colors.success` */
  chipCompleted: t.success,
  /** @deprecated usar `colors.error` */
  chipFailed: t.error,
  /** @deprecated usar `colors.error` */
  inputError: t.error,
  /** @deprecated usar `colors.primaryDark` */
  buttonPrimary: t.primaryDark,
  /** @deprecated usar `colors.primaryHover` */
  buttonPrimaryHover: t.primaryHover,
  /** @deprecated usar `colors.backgroundSecondary` */
  buttonSecondary: t.backgroundSecondary,
  /** @deprecated usar `colors.backgroundTertiary` */
  buttonDisabled: t.backgroundTertiary,
  /** @deprecated usar `alpha(colors.background, 0.5)` */
  overlayLight: alpha(t.background, 0.5),
  /** @deprecated usar `alpha(colors.primaryDark, 0.15)` */
  primaryGlow: alpha(t.primaryDark, 0.15),
  /** @deprecated usar `alpha(colors.primaryDark, 0.3)` */
  goldGlow: alpha(t.primaryDark, 0.3),
  /** @deprecated usar `colors.primary` */
  gradientGoldStart: t.primary,
  /** @deprecated usar `colors.primaryDark` */
  gradientGoldMid: t.primaryDark,
  /** @deprecated usar `colors.surfaceElevated` */
  surfaceLight: t.surfaceElevated,
  /** @deprecated sin uso */
  feltGreen: '#1B5E3B',
  /** @deprecated usar `colors.onlineGreen` */
  feltGreenLight: t.onlineGreen,
};

export default colors;
