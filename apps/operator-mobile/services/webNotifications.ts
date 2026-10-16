import { Platform } from 'react-native';

/**
 * Avisos en el panel web.
 *
 * `services/notifications.ts` sólo vibra, y en web arranca con
 * `if (Platform.OS === 'web') return`: el operador con el panel abierto en otra
 * pestaña no se enteraba de nada. Un pedido de premio aparecía en la lista y
 * ahí se quedaba hasta que alguien mirara.
 *
 * Tres avisos, de menor a mayor intrusión:
 *  - sonido corto,
 *  - notificación del sistema (la única que funciona con la pestaña de fondo),
 *  - contador en el título de la pestaña, para cuando el navegador tiene las
 *    notificaciones bloqueadas.
 */

const isWeb = Platform.OS === 'web';
const PREF_KEY = 'operator_prize_alerts';

/** El título que puso el HTML. Se captura una vez para poder restaurarlo tal
 *  cual: pisarlo con una constante propia cambiaría el nombre de la pestaña. */
let baseTitle: string | null = null;
function getBaseTitle(): string {
  if (baseTitle === null) {
    baseTitle = (isWeb && document.title) || 'Tío Rico · Operadores';
  }
  return baseTitle;
}

let audioCtx: AudioContext | null = null;
let unseen = 0;
let titleWatcherReady = false;

// ── Preferencia ───────────────────────────────────────────────────────────────

/** Prendido por defecto: el operador que no lo quiera lo apaga en Ajustes. */
export function prizeAlertsEnabled(): boolean {
  if (!isWeb) return false;
  try {
    return window.localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setPrizeAlertsEnabled(enabled: boolean) {
  if (!isWeb) return;
  try {
    window.localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage bloqueado: queda prendido en esta sesión y listo.
  }
  if (enabled) void requestNotificationPermission();
}

// ── Sonido ────────────────────────────────────────────────────────────────────

/**
 * Habilita el audio. **Tiene que llamarse desde un gesto del usuario**: los
 * navegadores dejan el AudioContext suspendido hasta que hay un click, así que
 * sin esto el primer aviso —y a veces todos— salen mudos. Se llama al entrar
 * al panel, que es un click garantizado.
 */
export function primeAudio() {
  if (!isWeb) return;
  try {
    const Ctor =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx || new Ctor();
    if (audioCtx?.state === 'suspended') void audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

/** Dos tonos cortos. Sintetizado: un archivo de audio sería un asset más que
 *  bajar y que puede fallar justo cuando hace falta. */
function playChime() {
  if (!audioCtx) primeAudio();
  const ctx = audioCtx;
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    [
      { freq: 880, at: 0 },
      { freq: 1174.7, at: 0.16 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Envolvente: sin esto el corte seco suena a click.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.3);
    });
  } catch {
    // Sin audio quedan la notificación y el título.
  }
}

// ── Notificación del sistema ──────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isWeb || typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function notificationPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!isWeb || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as 'granted' | 'denied' | 'default';
}

// ── Título de la pestaña ──────────────────────────────────────────────────────

function updateTitle() {
  if (!isWeb) return;
  document.title = unseen > 0 ? `(${unseen}) Premio nuevo` : getBaseTitle();
}

function watchTitle() {
  if (!isWeb || titleWatcherReady) return;
  titleWatcherReady = true;
  // Volver a la pestaña cuenta como "ya lo vi".
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clearPrizeAlerts();
  });
}

export function clearPrizeAlerts() {
  unseen = 0;
  updateTitle();
}

// ── El aviso ──────────────────────────────────────────────────────────────────

/**
 * Avisa que llegó un pedido de premio.
 *
 * `claimId` va como `tag` de la notificación: el backend emite el mismo premio
 * varias veces (al crearse, al recibir los datos de cobro, al verificar las
 * fichas) y sin eso el operador vería tres avisos del mismo caso.
 */
export function notifyPrizeClaim(claim: {
  id?: string;
  username?: string;
  amount?: number | string;
}) {
  if (!isWeb || !prizeAlertsEnabled()) return;

  watchTitle();
  unseen += 1;
  updateTitle();
  playChime();

  if (notificationPermission() !== 'granted') return;

  const amount = Number(claim.amount);
  const monto = Number.isFinite(amount) && amount > 0
    ? `$${amount.toLocaleString('es-AR')}`
    : '';
  try {
    const notif = new Notification('Nuevo pedido de premio', {
      body: [claim.username, monto].filter(Boolean).join(' · ') || 'Un usuario pidió cobrar',
      tag: claim.id ? `prize-${claim.id}` : undefined,
      // Sin `renotify`: si el mismo premio se re-emite, la notificación se
      // reemplaza en silencio en vez de volver a saltar.
    });
    notif.onclick = () => {
      window.focus();
      clearPrizeAlerts();
      // Ruta directa: expo-router escucha el history del browser.
      window.history.pushState({}, '', '/prizes');
      window.dispatchEvent(new PopStateEvent('popstate'));
      notif.close();
    };
  } catch {
    // El sonido y el título ya avisaron.
  }
}

/** Para el botón "probar" de Ajustes. */
export function testPrizeAlert() {
  if (!isWeb) return;
  primeAudio();
  playChime();
  if (notificationPermission() === 'granted') {
    try {
      new Notification('Así se ve el aviso', {
        body: 'Nuevo pedido de premio · $50.000',
        tag: 'prize-test',
      });
    } catch {
      // Nada que hacer.
    }
  }
}
