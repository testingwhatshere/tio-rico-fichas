import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInbox, DEFAULT_RANGE } from '@/hooks/useInbox';
import { usePendingPrizeCount } from '@/hooks/usePrizes';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

export type NavItem = {
  route: string;
  label: string;
  icon: IoniconsName;
  badge?: number;
};

/**
 * Navegación.
 *
 * Vive en un hook y no dentro de `(tabs)/_layout.tsx` porque la pantalla "Más"
 * del celular tiene que listar exactamente los mismos destinos secundarios. Con
 * el menú escrito a mano en dos lados se desincronizó: `more.tsx` quedó
 * ofreciendo Pagos, Jobs, Solicitudes y Paneles —rutas que ya no están en la
 * navegación— y sin Recontacto, Historial, Mensajes ni Ajustes.
 *
 * Las viejas pestañas Fallos / Chats / Pagos ya no están en el menú: su
 * contenido se unificó en la bandeja. Las rutas siguen existiendo para no
 * romper links directos, y el detalle de cada caso se abre desde ahí.
 *
 * Premios sí tiene la suya: es el único flujo donde el operador maneja plata
 * que ya salió del panel y todavía no llegó al usuario.
 *
 * `dashboard` no está: eran cuatro números y dos botones que duplicaban la
 * navegación. El estado del sistema (bots, validador) se sacó del pie de la
 * sidebar el 2026-08-30: el punto de color mentía seguido y nadie tomaba una
 * decisión con él. El estado real de cada panel está en Paneles.
 */
export function useNav() {
  // Mismo cálculo que la bandeja, mismo rango: el badge nunca puede decir un
  // número distinto al que el operador ve al entrar.
  const { total } = useInbox(DEFAULT_RANGE);
  // Sin corte por fecha, a diferencia de la bandeja: un premio sin pagar de
  // hace tres días no se archiva, sigue siendo plata que alguien espera.
  const prizes = usePendingPrizeCount();

  // El trabajo diario entra por la bandeja y el tablero de premios. Seguimiento
  // va al lado porque contesta la otra pregunta del turno: no "qué se rompió"
  // sino "cómo viene lo que está andando".
  const primary: NavItem[] = [
    { route: 'inbox', label: 'Bandeja', icon: 'albums-outline', badge: total },
    { route: 'prizes', label: 'Premios', icon: 'trophy-outline', badge: prizes },
    // Sin badge: el seguimiento se mira, no se resuelve.
    { route: 'tracking', label: 'Seguimiento', icon: 'git-branch-outline' },
  ];

  // Lo ocasional: gestión y consulta, no operación. En escritorio va abajo de
  // la sidebar; en celular, detrás de "Más".
  const secondary: NavItem[] = [
    // Temporal: la ronda de avisos por el cambio de servidor del 2026-08-29.
    { route: 'recontacto', label: 'Recontacto', icon: 'megaphone-outline' },
    { route: 'historial', label: 'Historial', icon: 'time-outline' },
    // Imágenes para estados de WhatsApp con premios pagados, sin datos del cliente.
    { route: 'estados', label: 'Estados', icon: 'image-outline' },
    { route: 'users', label: 'Usuarios', icon: 'people-outline' },
    { route: 'messages', label: 'Mensajes', icon: 'chatbubbles-outline' },
    { route: 'wallets', label: 'Billeteras', icon: 'wallet-outline' },
    { route: 'extensions', label: 'Extensión del bot', icon: 'extension-puzzle-outline' },
    { route: 'settings', label: 'Ajustes', icon: 'settings-outline' },
  ];

  return { primary, secondary };
}

export default useNav;
