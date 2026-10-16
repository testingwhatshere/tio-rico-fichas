/**
 * Transferencias de más que decide el jugador.
 *
 * Cuando el comprobante dice más de lo que el jugador pidió (y el monto está
 * bien leído), el chat web le pregunta si quiere cargar lo transferido. Acá se
 * traduce esa decisión a la etiqueta que ve el operador.
 */
import { colors } from '@/constants/theme';
import { formatMoney } from './amount';

export type OverpaidOffer = {
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  requestedAmount: number;
  offeredAmount: number;
};

export function overpaidOfferTag(
  offer?: OverpaidOffer | null,
): { label: string; color: string } | null {
  if (!offer?.status) return null;
  const pidio = formatMoney(Number(offer.requestedAmount));
  const transfirio = formatMoney(Number(offer.offeredAmount));
  switch (offer.status) {
    case 'ACCEPTED':
      return {
        label: `monto mayor aceptado por el jugador (pidió ${pidio}, cargó ${transfirio})`,
        color: colors.warning,
      };
    case 'PENDING':
      return {
        label: `esperando al jugador: transfirió ${transfirio}, pidió ${pidio}`,
        color: colors.info,
      };
    case 'REJECTED':
      return {
        label: `el jugador no quiso cargar ${transfirio} (pidió ${pidio})`,
        color: colors.warning,
      };
    case 'EXPIRED':
      return {
        label: `el jugador no contestó si cargaba ${transfirio} (pidió ${pidio})`,
        color: colors.warning,
      };
    default:
      return null;
  }
}
