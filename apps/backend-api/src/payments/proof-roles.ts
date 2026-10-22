/**
 * Quién paga y quién cobra en el texto de un comprobante.
 *
 * El chequeo de destinatario buscaba nuestros datos (CBU, alias, DNI, nombre) en
 * TODO el comprobante. Con eso pasaban dos cosas (auditoría 2026-10-21):
 *  - una billetera cargada con titular "Enzo Emanuel Montecino - Mercado Pago"
 *    coincidía con cualquier comprobante de MP por las palabras "Mercado" y "Pago":
 *    4.940 cargas "verificadas" así en dos meses, 4 de ellas pagadas a terceros;
 *  - un comprobante de un premio que pagamos NOSOTROS (nuestra cuenta como
 *    origen) pasaba como pago a una cuenta nuestra. Ese comprobante le llega al
 *    ganador por el chat: 5 de 8 premios reales de una semana pasaban el chequeo.
 *
 * Acá se ubica el tramo del texto que corresponde al que PAGA. Un dato nuestro que
 * sólo aparece ahí no prueba que la plata nos llegó: prueba que salió de nosotros.
 * Todo se calcula sobre el texto normalizado (minúsculas, sin acentos, espacios
 * simples), así que las posiciones de distintas funciones son comparables.
 */

export interface WalletTarget {
  id: string;
  label: string;
  holderName: string;
  holderLegalName: string | null;
  holderDni: string | null;
  alias?: string;
  cbu?: string;
  cvu?: string;
}

export interface WalletHit {
  wallet: WalletTarget;
  field: string;
  /** Posición en el texto normalizado. */
  pos: number;
}

export type WalletLocation =
  /** Un dato nuestro aparece del lado del que cobra (o el formato no marca roles). */
  | { verdict: 'payee'; hit: WalletHit }
  /** Nuestros datos aparecen, pero sólo como el que paga. */
  | { verdict: 'payer-only'; hit: WalletHit }
  | { verdict: 'none' };

/**
 * Palabras que están en cualquier comprobante o que nombran a la entidad, no a una
 * persona. No cuentan para reconocer a un titular por su nombre: con ellas
 * "Enzo Emanuel Montecino - Mercado Pago" coincidía con todo comprobante de MP.
 */
const GENERIC_NAME_TOKENS = new Set([
  'mercado',
  'pago',
  'pagos',
  'banco',
  'bank',
  'cuenta',
  'billetera',
  'naranja',
  'personal',
  'pay',
  'digital',
  'nacion',
  'provincia',
  'galicia',
  'santander',
  'macro',
  'brubank',
  'uala',
  'prex',
  'astropay',
  'lemon',
  'fiwind',
  'ripio',
  'bna',
  'cvu',
  'cbu',
  'alias',
  'cuit',
  'cuil',
  'dni',
  'srl',
  'transferencia',
  'comprobante',
  'principal',
  'caja',
  'ahorro',
  'pesos',
]);

/** Distancia máxima entre nombre y apellido para considerarlos la misma persona. */
const NAME_WINDOW = 40;

export function normalizeProofText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Identificadores buscables de una billetera: números de cuenta (CBU/CVU/alias
 * numérico), alias alfanumérico, DNI/CUIT y nombres del titular.
 */
export function walletIdentifiers(
  wallet: WalletTarget,
): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  const push = (field: string, value?: string | null) => {
    const v = (value ?? '').trim();
    if (v) out.push({ field, value: v });
  };
  push('cbu', wallet.cbu);
  push('cvu', wallet.cvu);
  push('alias', wallet.alias);
  push('dni', wallet.holderDni);
  push('holderName', wallet.holderName);
  push('holderLegalName', wallet.holderLegalName);
  return out;
}

/** Tokens de un nombre que sirven para reconocer a la persona. */
export function personalNameTokens(name: string): string[] {
  return normalizeProofText(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !GENERIC_NAME_TOKENS.has(t));
}

/** Busca en `text` (normalizado) un nombre de persona: ≥2 tokens propios cerca. */
function findNameIn(text: string, name: string): number | null {
  const tokens = personalNameTokens(name);
  if (tokens.length < 2) return null;
  const positions: number[] = [];
  for (const t of tokens) {
    const re = new RegExp(`\\b${escapeRegExp(t)}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) positions.push(m.index);
  }
  positions.sort((a, b) => a - b);
  // Dos apariciones de tokens DISTINTOS a menos de NAME_WINDOW: nombre + apellido
  // juntos, no un "Maria" en el remitente y un "Lopez" en otra parte.
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (positions[j] - positions[i] > NAME_WINDOW) break;
      const a = text.slice(positions[i]).match(/^[a-z0-9]+/)?.[0];
      const b = text.slice(positions[j]).match(/^[a-z0-9]+/)?.[0];
      if (a && b && a !== b) return positions[i];
    }
  }
  return null;
}

/**
 * Todas las apariciones de datos de nuestras billeteras en el comprobante.
 *
 * Los números se buscan tolerando un separador entre dígitos (el OCR mete espacios,
 * puntos y guiones en los CBU) y con un mínimo de 8 dígitos para que un número
 * corto no coincida por casualidad.
 */
export function findWalletHits(
  ocrText: string,
  wallets: WalletTarget[],
): WalletHit[] {
  const text = normalizeProofText(ocrText);
  const hits: WalletHit[] = [];
  for (const wallet of wallets) {
    for (const { field, value } of walletIdentifiers(wallet)) {
      const numeric = value.replace(/\D/g, '');
      const compact = value.replace(/[\s.-]/g, '');
      if (numeric.length >= 8 && numeric.length === compact.length) {
        const re = new RegExp(numeric.split('').join('[\\s.\\-]?'), 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) hits.push({ wallet, field, pos: m.index });
        continue;
      }
      if (field === 'alias') {
        // Alias tipo "tiorico.fichas": literal, sin fuzzy.
        const alias = normalizeProofText(value).trim();
        if (alias.length >= 4) {
          let i = text.indexOf(alias);
          while (i >= 0) {
            hits.push({ wallet, field, pos: i });
            i = text.indexOf(alias, i + 1);
          }
        }
        continue;
      }
      const pos = findNameIn(text, value);
      if (pos !== null) hits.push({ wallet, field, pos });
    }
  }
  return hits.sort((a, b) => a.pos - b.pos);
}

const CUIT_RE = /\b(\d{2})[\s.-]?(\d{8})[\s.-]?(\d)\b/;
// CBU/CVU: 22 dígitos, a veces en grupos.
const ACCOUNT_RE = /\d(?:[\s.-]?\d){21}/;

const PAYER_ANCHOR =
  /cuenta (?:de )?origen|\borigen\b|\benvia\b|enviado por|\bremitente\b|\bordenante\b|\bde\s*:/;
const PAYEE_ANCHOR =
  /cuenta (?:de )?destino|\bdestino\b|\bpara\b|\brecibe\b|destinatari|\breceptor\b|beneficiari|envio de dinero a|transferiste a|le enviaste/;

/**
 * Tramo [desde, hasta) del texto normalizado que corresponde al que paga, o null
 * si el formato no lo marca (entonces no se puede afirmar quién es quién).
 */
export function payerSpan(ocrText: string): [number, number] | null {
  const text = normalizeProofText(ocrText);

  // Mercado Pago, "Origen y destino": dos personas seguidas, primero el que paga.
  // Su tramo termina cuando ya pasaron su CUIT y su CVU (el orden entre esos dos
  // cambia según la versión de la app).
  const oyd = text.search(/origen y destino/);
  if (oyd >= 0) {
    const start = oyd + 'origen y destino'.length;
    const rest = text.slice(start);
    const cuit = CUIT_RE.exec(rest);
    const acct = ACCOUNT_RE.exec(rest);
    const ends = [cuit, acct]
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => m.index + m[0].length);
    if (!ends.length) return null;
    return [oyd, start + Math.max(...ends)];
  }

  const payer = PAYER_ANCHOR.exec(text);
  if (!payer) return null;
  // El tramo del que paga termina en la próxima marca de destino. Si no hay ninguna
  // después (Brubank pone "Destino" primero y "Origen" al final), llega al final.
  const after = payer.index + payer[0].length;
  const payee = PAYEE_ANCHOR.exec(text.slice(after));
  if (payee) return [payer.index, after + payee.index];
  // Sin ninguna marca de destino en todo el texto no se sabe dónde termina el que
  // paga: el OCR pudo haber roto la palabra (Naranja X, 2026-09-29: "Destino" leído
  // "-Qstino", y el cobrador quedaba adentro del tramo del que paga).
  if (!PAYEE_ANCHOR.test(text.slice(0, payer.index))) return null;
  return [payer.index, text.length];
}

/** Dónde aparecen nuestros datos en el comprobante: como el que cobra, como el que paga, o en ningún lado. */
export function locateOurWallet(
  ocrText: string,
  wallets: WalletTarget[],
): WalletLocation {
  // El dato que se informa como prueba es el más fuerte: una cuenta identifica
  // sin dudas, un nombre puede repetirse.
  const hits = findWalletHits(ocrText, wallets).sort(
    (a, b) => fieldStrength(a.field) - fieldStrength(b.field) || a.pos - b.pos,
  );
  if (!hits.length) return { verdict: 'none' };
  const span = payerSpan(ocrText);
  if (!span) return { verdict: 'payee', hit: hits[0] };
  const outside = hits.find((h) => h.pos < span[0] || h.pos >= span[1]);
  if (outside) return { verdict: 'payee', hit: outside };
  return { verdict: 'payer-only', hit: hits[0] };
}

const FIELD_ORDER = [
  'cbu',
  'cvu',
  'alias',
  'dni',
  'holderName',
  'holderLegalName',
];
function fieldStrength(field: string): number {
  const i = FIELD_ORDER.indexOf(field);
  return i < 0 ? FIELD_ORDER.length : i;
}

/** CUIT/CUIL del que paga, leído de su tramo del comprobante (11 dígitos), o null. */
export function extractPayerCuit(ocrText: string): string | null {
  const span = payerSpan(ocrText);
  if (!span) return null;
  const text = normalizeProofText(ocrText).slice(span[0], span[1]);
  const m = CUIT_RE.exec(text);
  if (!m) return null;
  const cuit = `${m[1]}${m[2]}${m[3]}`;
  // Prefijos válidos de CUIT/CUIL (20/23/24/27 personas, 30/33/34 empresas).
  return /^(2[0347]|3[034])/.test(cuit) ? cuit : null;
}

/** ¿El nombre corresponde al titular de alguna de nuestras billeteras? */
export function isOurHolderName(
  name: string | null | undefined,
  wallets: WalletTarget[],
): boolean {
  if (!name) return false;
  const text = normalizeProofText(name);
  return wallets.some((w) =>
    [w.holderName, w.holderLegalName].some(
      (n) => !!n && findNameIn(text, n) !== null,
    ),
  );
}

/** ¿El DNI/CUIT corresponde al titular de alguna de nuestras billeteras? */
export function isOurHolderDni(
  dniOrCuit: string | null | undefined,
  wallets: WalletTarget[],
): boolean {
  const digits = (dniOrCuit ?? '').replace(/\D/g, '');
  if (digits.length < 7) return false;
  return wallets.some((w) => {
    const dni = (w.holderDni ?? '').replace(/\D/g, '');
    return dni.length >= 7 && digits.includes(dni);
  });
}
