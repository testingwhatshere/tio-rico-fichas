/**
 * Platform configurations for OCR pattern detection.
 *
 * Each entry defines:
 * - id: unique identifier
 * - name: display name
 * - keywords: array of lowercase strings to match in OCR text
 * - antiKeywords: (optional) if any of these appear, skip this platform
 * - overrides: (optional) per-field custom extraction functions
 *
 * The generic extractor (_helpers.js) handles ALL field extraction.
 * Overrides are only needed when a platform has a unique receipt format
 * that the generic helpers can't parse correctly.
 */

const h = require('./_helpers');

// --- MercadoPago overrides (the only platform with custom logic today) ---
const mercadopagoOverrides = {
  senderName(text) {
    // MP shows "De\n  Nombre Apellido" with line break after "De"
    const m = text.match(/(?:\*\s*)?De\s*\n\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/);
    return m ? m[1].trim() : h.extractSender(text);
  },

  transactionId(text) {
    // MP classic: "Número de operación de Mercado Pago\n86537718327" (all digits)
    // MP modern:  "N.* de movimiento\nB32QK1HXEN39MWCM1" (alphanumeric)
    const m = text.match(/operaci[oó]n\s+de\s+Mercado\s+Pago\s*\n\s*(\d{8,20})/i)
      || text.match(/n[^\w\n]{0,5}de\s+movimiento\s*\n?\s*([A-Z0-9]{10,30})/i)
      || text.match(/operaci[oó]n[^\d]*?(\d{8,20})/i);
    return m ? m[1] : h.extractOperationNumber(text);
  },

  recipientName(text) {
    // MP classic: "Para\n  Nombre Apellido" with line break
    const labeled = text.match(/(?:\*\s*)?Para\s*\n\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/);
    if (labeled) return labeled[1].trim();
    // MP modern: amount on first line, then recipient name, then "Transferencia enviada/recibida".
    // Capture the Capitalized name line right before that label.
    const modern = text.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4})\s*\n\s*Transferencia\s+(?:enviada|recibida|confirmada)/i);
    if (modern) return modern[1].trim();
    return h.extractRecipient(text);
  },

  recipientAccount(text) {
    // El bloque "Origen y destino" de MP lista SIEMPRE origen primero y destino
    // segundo. Cuando hay dos cuentas, la ultima es la del destinatario.
    //
    // Esto va ANTES del helper generico a proposito: el generico parte el texto por
    // /Destino/i, y con el encabezado "Origen y destino" la primera seccion arranca
    // en el REMITENTE, asi que devolvia el CVU del que paga y marcaba mismatch en
    // cargas legitimas (caso darian88, 2026-08-20).
    const allAccounts = [...text.matchAll(/(?:CVU|CBU|CvU|Cvu|cvu|cbu)[:\s]*([0-9OoIl]{22})/gi)];
    if (allAccounts.length >= 2) {
      return h.normalizeOcrDigits(allAccounts[allAccounts.length - 1][1]);
    }

    const base = h.extractRecipientAccount(text);
    if (base) return base;

    const allCvus = allAccounts;
    if (allCvus.length === 1) {
      // Only one CVU — check if it's in "Para" section (recipient's)
      const paraIdx = text.toLowerCase().indexOf('para');
      const cvuIdx = text.toLowerCase().lastIndexOf('cvu');
      if (paraIdx >= 0 && cvuIdx > paraIdx) {
        return h.normalizeOcrDigits(allCvus[0][1]);
      }
    }
    return null;
  },
};

// --- BNA+ overrides ---
// Su comprobante pone cada etiqueta en una línea y el valor en la siguiente:
//   Destinatario \n Lautaro Neyen \n CUIT \n 23459223649 \n Monto \n $15.000,00
//   Número de transacción \n 86VRPQ2GXE83G40Y9GLYOM \n Fecha \n 11/08/2026 20:03:26
// Los helpers genéricos buscan "etiqueta: valor" en la misma línea, así que sin esto
// no sacan nada aunque el texto esté perfectamente legible.
const bnaOverrides = {
  transactionId(text) {
    const m = text.match(/n[uú]mero\s+de\s+transacci[oó]n\s*\n\s*([A-Z0-9]{8,30})/i);
    return m ? m[1] : h.extractOperationNumber(text);
  },

  recipientName(text) {
    const m = text.match(
      /Destinatario\s*\n\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/,
    );
    return m ? m[1].trim() : h.extractRecipient(text);
  },

  transactionStatus(text) {
    // No imprime "Aprobada" en ningún lado: el propio comprobante emitido ya es el
    // acuse de la transferencia hecha.
    if (/transferencia/i.test(text)) return 'Aprobada';
    return h.extractStatus(text);
  },

  bankName() {
    return 'Banco de la Nación Argentina';
  },
};

// --- AstroPay overrides ---
// Formato: el nombre del remitente va ANTES de la etiqueta ("ROMINA ELIZABETH FORMILIANO
// \n Enviado por"), y el resto es etiqueta-arriba/valor-abajo:
//   Receptor \n Lautaro Neyen \n CUIT/CUIL \n 23459223649 \n ... \n Coelsa ID \n RD06ZO9W...
const astropayOverrides = {
  senderName(text) {
    // El nombre en mayúsculas justo encima de "Enviado por".
    const m = text.match(
      /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{5,50})\n\s*Enviado\s+por/i,
    );
    if (m) return m[1].trim().replace(/\s+/g, ' ');
    return h.extractSender(text);
  },

  recipientName(text) {
    const m = text.match(
      /Receptor\s*\n\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/,
    );
    return m ? m[1].trim() : h.extractRecipient(text);
  },

  transactionId(text) {
    // "Coelsa ID" (el OCR suele leerlo "Coelsa 1D").
    const m = text.match(/Coelsa\s*[I1l]D\s*\n\s*([A-Z0-9]{10,30})/i);
    return m ? m[1] : h.extractOperationNumber(text);
  },

  transactionStatus(text) {
    if (/comprobante\s+de\s+transferencia|enviado\s+por/i.test(text)) {
      return 'Aprobada';
    }
    return h.extractStatus(text);
  },

  bankName() {
    return 'AstroPay';
  },
};

// --- Platform registry ---
const PLATFORMS = [
  // AstroPay va ANTES que MercadoPago a propósito: sus comprobantes nombran a Mercado
  // Pago como "Entidad" del receptor, así que caían en el pattern de MP y se les
  // aplicaban sus overrides (que buscan "Para\nNombre" y el último CVU) sobre un
  // formato distinto — la misma clase de confusión remitente/destinatario del
  // incidente del 2026-08-20. Gana el primero que matchea.
  {
    id: 'astropay',
    name: 'AstroPay',
    keywords: ['astropay', 'astro pay'],
    overrides: astropayOverrides,
  },
  // Wallets / fintechs (more specific, check first)
  { id: 'mercadopago', name: 'MercadoPago', keywords: ['mercado pago', 'mercadopago'], overrides: mercadopagoOverrides },
  { id: 'uala', name: 'Ualá', keywords: ['uala', 'ualá'] },
  { id: 'brubank', name: 'Brubank', keywords: ['brubank'] },
  { id: 'naranjax', name: 'Naranja X', keywords: ['naranja x', 'naranjax'] },
  { id: 'personalpay', name: 'Personal Pay', keywords: ['personal pay', 'personalpay'] },
  { id: 'cuentadni', name: 'Cuenta DNI', keywords: ['cuenta dni', 'cuentadni'] },
  // El logo dice "BNA+", pero el OCR lee esa cruz como asterisco ("BNA*") casi siempre:
  // con sólo 'bna+' en la lista, 20 comprobantes reales del corpus caían a extracción
  // genérica y no sacaban ningún campo.
  {
    id: 'bna',
    name: 'BNA+',
    keywords: ['bna+', 'bna +', 'bna*', 'bna *', 'transferencia bna'],
    overrides: bnaOverrides,
  },
  { id: 'modo', name: 'MODO', keywords: ['modo'], antiKeywords: ['comod'] },
  { id: 'prex', name: 'Prex', keywords: ['prex'] },
  { id: 'fiwind', name: 'Fiwind', keywords: ['fiwind'] },
  { id: 'ripio', name: 'Ripio', keywords: ['ripio'] },
  { id: 'lemoncash', name: 'Lemon Cash', keywords: ['lemon cash', 'lemon'] },
  { id: 'belo', name: 'Belo', keywords: ['belo'] },
  { id: 'buenbit', name: 'Buenbit', keywords: ['buenbit'] },
  { id: 'credicuotas', name: 'Credicuotas', keywords: ['credicuotas'] },

  // Traditional banks
  { id: 'galicia', name: 'Banco Galicia', keywords: ['banco galicia', 'galicia'] },
  { id: 'santander', name: 'Santander', keywords: ['santander'] },
  { id: 'bbva', name: 'BBVA', keywords: ['bbva'] },
  { id: 'macro', name: 'Banco Macro', keywords: ['macro'] },
  { id: 'nacion', name: 'Banco Nación', keywords: ['banco nacion', 'banco nación', 'nacion', 'nación'] },
  { id: 'provincia', name: 'Banco Provincia', keywords: ['banco provincia', 'provincia'] },
  { id: 'ciudad', name: 'Banco Ciudad', keywords: ['banco ciudad', 'ciudad'] },
  { id: 'hsbc', name: 'HSBC', keywords: ['hsbc'] },
  { id: 'icbc', name: 'ICBC', keywords: ['icbc'] },
  { id: 'itau', name: 'Itaú', keywords: ['itau', 'itaú'] },
  { id: 'patagonia', name: 'Patagonia', keywords: ['patagonia'] },
  { id: 'supervielle', name: 'Supervielle', keywords: ['supervielle'] },
  { id: 'comafi', name: 'Comafi', keywords: ['comafi'] },
  { id: 'hipotecario', name: 'Hipotecario', keywords: ['hipotecario'] },
  { id: 'bind', name: 'BIND', keywords: ['bind'] },
  { id: 'credicoop', name: 'Credicoop', keywords: ['credicoop'] },
  // Nuevo Banco del Chaco. Apareció en el corpus del 2026-08-28 como el único banco
  // real que caía a extracción genérica (su comprobante dice "NBCH ONLINE BANKING").
  {
    id: 'nbch',
    name: 'Nuevo Banco del Chaco',
    keywords: ['nbch', 'nuevo banco del chaco'],
  },
  { id: 'rapipago', name: 'Rapipago', keywords: ['rapipago'] },
  { id: 'pagofacil', name: 'Pago Fácil', keywords: ['pago facil', 'pago fácil', 'pagofacil'] },
];

module.exports = { PLATFORMS };
