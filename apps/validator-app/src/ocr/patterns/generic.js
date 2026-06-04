/**
 * Generic receipt extractor — THE single extractor for all platforms.
 *
 * Uses shared helpers from _helpers.js for each field. Platform-specific
 * overrides (from platforms.js) replace individual field extractors when
 * a platform has a unique receipt format.
 */

const h = require('./_helpers');

/**
 * Extract structured payment data from OCR text.
 * @param {string} text — Raw OCR text
 * @param {object} [overrides] — Per-field custom extractors from platform config
 * @param {string} [bankName] — Platform display name (null for unknown)
 * @returns {object} Extracted fields with confidence score
 */
function extract(text, overrides = {}, bankName = null, expectedAmount = null) {
  const get = (field, defaultFn) => {
    if (overrides[field]) return overrides[field](text, expectedAmount);
    return defaultFn(text);
  };

  const fields = {
    // Pass expectedAmount through so the helper can pick the closest match when
    // multiple peso amounts appear in the same receipt.
    extractedAmount: overrides.extractedAmount
      ? overrides.extractedAmount(text, expectedAmount)
      : h.extractAmount(text, expectedAmount),
    extractedDate: get('extractedDate', h.extractDate),
    extractedTime: get('extractedTime', h.extractTime),
    transactionStatus: get('transactionStatus', h.extractStatus),
    senderName: get('senderName', h.extractSender),
    senderDniCuit: get('senderDniCuit', h.extractCuit),
    recipientName: get('recipientName', h.extractRecipient),
    recipientAccount: get('recipientAccount', h.extractRecipientAccount),
    bankName: bankName,
    transactionId: get('transactionId', h.extractOperationNumber),
    paymentMethod: bankName,
    confidence: 0,
  };

  // Auto-detect bank if not provided
  if (!fields.bankName) {
    const detected = detectBankFromText(text);
    fields.bankName = detected;
    fields.paymentMethod = detected;
  }

  // Fallback payment method
  if (!fields.paymentMethod && text.toLowerCase().includes('transferencia')) {
    fields.paymentMethod = 'Transferencia Bancaria';
  }

  fields.confidence = h.calculateConfidence(fields);
  return fields;
}

/**
 * Detect bank/wallet name from text using keyword search.
 */
function detectBankFromText(text) {
  const lower = text.toLowerCase();
  const banks = [
    { s: 'mercado pago', n: 'MercadoPago' }, { s: 'mercadopago', n: 'MercadoPago' },
    { s: 'banco galicia', n: 'Banco Galicia' }, { s: 'galicia', n: 'Banco Galicia' },
    { s: 'santander', n: 'Santander' }, { s: 'bbva', n: 'BBVA' },
    { s: 'macro', n: 'Banco Macro' }, { s: 'banco nacion', n: 'Banco Nación' },
    { s: 'nacion', n: 'Banco Nación' }, { s: 'provincia', n: 'Banco Provincia' },
    { s: 'ciudad', n: 'Banco Ciudad' }, { s: 'hsbc', n: 'HSBC' },
    { s: 'icbc', n: 'ICBC' }, { s: 'itau', n: 'Itaú' }, { s: 'itaú', n: 'Itaú' },
    { s: 'patagonia', n: 'Patagonia' }, { s: 'supervielle', n: 'Supervielle' },
    { s: 'comafi', n: 'Comafi' }, { s: 'brubank', n: 'Brubank' },
    { s: 'hipotecario', n: 'Hipotecario' }, { s: 'bind', n: 'BIND' },
    { s: 'uala', n: 'Ualá' }, { s: 'ualá', n: 'Ualá' },
    { s: 'naranja', n: 'Naranja X' }, { s: 'personal pay', n: 'Personal Pay' },
    { s: 'cuenta dni', n: 'Cuenta DNI' }, { s: 'modo', n: 'MODO' },
    { s: 'prex', n: 'Prex' }, { s: 'fiwind', n: 'Fiwind' },
    { s: 'ripio', n: 'Ripio' }, { s: 'lemon', n: 'Lemon Cash' },
    { s: 'belo', n: 'Belo' }, { s: 'buenbit', n: 'Buenbit' },
    { s: 'credicoop', n: 'Credicoop' }, { s: 'rapipago', n: 'Rapipago' },
    { s: 'pago facil', n: 'Pago Fácil' },
  ];
  for (const { s, n } of banks) {
    if (lower.includes(s)) return n;
  }
  return null;
}

module.exports = { extract, detectBankFromText };
