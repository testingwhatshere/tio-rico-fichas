import { useWindowDimensions } from 'react-native';
import { DESKTOP_BREAKPOINT } from '@/constants/theme';

/**
 * Ancho de ventana reactivo.
 *
 * Existe porque media docena de archivos hacían `Dimensions.get('window')` al
 * importar el módulo: el valor quedaba congelado al primer render y nunca
 * reaccionaba al resize del browser (los chat bubbles quedaban al 78% del ancho
 * que la ventana tenía al abrir la página).
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isDesktop: width >= DESKTOP_BREAKPOINT,
    isNarrow: width < DESKTOP_BREAKPOINT,
  };
}

export default useLayout;
