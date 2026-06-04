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
    // MP: "Número de operación de Mercado Pago\n86537718327"
    const m = text.match(/operaci[oó]n\s+de\s+Mercado\s+Pago\s*\n\s*(\d{8,20})/i)
      || text.match(/operaci[oó]n[^\d]*?(\d{8,20})/i);
    return m ? m[1] : h.extractOperationNumber(text);
  },

  recipientName(text) {
    // MP: "Para\n  Nombre Apellido" with line break
    const m = text.match(/(?:\*\s*)?Para\s*\n\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/);
    return m ? m[1].trim() : h.extractRecipient(text);
  },

  recipientAccount(text) {
    // MP shows CVU with OCR artifacts — find the SECOND CVU (first is sender's)
    const base = h.extractRecipientAccount(text);
    if (base) return base;

    const allCvus = [...text.matchAll(/(?:CVU|CvU|Cvu|cvu)[:\s]*([0-9OoIl]{22})/gi)];
    if (allCvus.length >= 2) {
      return h.normalizeOcrDigits(allCvus[1][1]);
    }
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

// --- Platform registry ---
const PLATFORMS = [
  // Wallets / fintechs (more specific, check first)
  { id: 'mercadopago', name: 'MercadoPago', keywords: ['mercado pago', 'mercadopago'], overrides: mercadopagoOverrides },
  { id: 'uala', name: 'Ualá', keywords: ['uala', 'ualá'] },
  { id: 'brubank', name: 'Brubank', keywords: ['brubank'] },
  { id: 'naranjax', name: 'Naranja X', keywords: ['naranja x', 'naranjax'] },
  { id: 'personalpay', name: 'Personal Pay', keywords: ['personal pay', 'personalpay'] },
  { id: 'cuentadni', name: 'Cuenta DNI', keywords: ['cuenta dni', 'cuentadni'] },
  { id: 'bna', name: 'BNA+', keywords: ['bna+', 'bna +'] },
  { id: 'modo', name: 'MODO', keywords: ['modo'], antiKeywords: ['comod'] },
  { id: 'prex', name: 'Prex', keywords: ['prex'] },
  { id: 'fiwind', name: 'Fiwind', keywords: ['fiwind'] },
  { id: 'ripio', name: 'Ripio', keywords: ['ripio'] },
  { id: 'lemoncash', name: 'Lemon Cash', keywords: ['lemon cash', 'lemon'] },
  { id: 'belo', name: 'Belo', keywords: ['belo'] },
  { id: 'buenbit', name: 'Buenbit', keywords: ['buenbit'] },

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
  { id: 'rapipago', name: 'Rapipago', keywords: ['rapipago'] },
  { id: 'pagofacil', name: 'Pago Fácil', keywords: ['pago facil', 'pago fácil', 'pagofacil'] },
];

module.exports = { PLATFORMS };
