/**
 * Shared helpers for OCR pattern modules.
 * Every platform-specific pattern can use these to avoid duplicating regex logic.
 */

// Parse number string. Handles AR ("1.234.567,89"), US ("1,234,567.89"),
// and plain ("500" or "500,00"). OCR-tolerant: O→0, I/l→1, S→5, B→8.
function parseAmount(str) {
  if (!str) return null;
  // Normalize OCR letter→digit artifacts (only when adjacent to digits, to avoid
  // mangling actual words). Common with bold/large fonts.
  let cleaned = String(str)
    .replace(/[Oo](?=[\d.,])|(?<=[\d.,])[Oo]/g, '0')
    .replace(/[IiLl](?=[\d.,])|(?<=[\d.,])[IiLl]/g, '1')
    .replace(/[Ss](?=[\d.,])|(?<=[\d.,])[Ss]/g, '5')
    .replace(/[Bb](?=[\d.,])|(?<=[\d.,])[Bb]/g, '8')
    .replace(/\s/g, '')
    .replace(/[^\d.,]/g, ''); // strip any other char ($, currency symbols, stray letters)

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (hasComma && hasDot) {
    // Whichever comes LAST is the decimal separator.
    if (lastComma > lastDot) {
      // AR style: "1.234.567,89" → dots are thousands, comma is decimal.
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US style: "1,234,567.89" → commas are thousands, dot is decimal.
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only commas. If exactly one comma with 1-2 digits after → AR decimal.
    // Otherwise treat all commas as thousands separators.
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      cleaned = parts[0] + '.' + parts[1];
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasDot) {
    // Only dots. Heuristic: if there are 2+ dots, OR a single dot followed by exactly
    // 3 digits (and not a 1-2 digit fractional like "5.5"), treat as thousand sep.
    const parts = cleaned.split('.');
    const multipleDots = parts.length > 2;
    const looksLikeThousands = parts.length === 2 && parts[1].length === 3;
    if (multipleDots || looksLikeThousands) {
      cleaned = cleaned.replace(/\./g, '');
    }
    // else: single dot with non-3-digit suffix → decimal, leave for parseFloat.
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Extract every plausible peso amount in the text, in order of confidence:
 *  1. Labeled with "monto / importe / total / transferiste / enviaste" (most likely the real one).
 *  2. ARS / pesos suffix.
 *  3. $ prefix with decimals.
 *  4. $ prefix integer.
 *  5. Standalone number line.
 * Returns an array of { amount, source } so callers can pick the right one
 * (e.g. preferring the one that matches expectedAmount exactly).
 *
 * IMPORTANT: do NOT discard duplicates here. If the same amount appears 3 times
 * with different labels we want all matches so callers can score by frequency.
 */
function extractAllAmounts(text) {
  const out = [];

  // OCR-tolerant digit: real digit OR letter that looks like one (O→0, I/l→1, S→5, B→8).
  // Both upper and lower case — Tesseract switches based on font weight.
  const D = '[0-9OoIiLlSsBb]';
  // Argentine/US number tolerant. Two alternatives:
  //  1. With thousand separators: 1-3 digits, then ONE OR MORE (.\d{3}/,\d{3}/<space>\d{3}) groups, optional decimals.
  //  2. Plain integer up to 8 digits, optional decimals.
  // Order matters: thousand-separated form FIRST so we don't capture only the leading group.
  const NUM = `(${D}{1,3}(?:[\\s.,]${D}{3})+(?:[.,]${D}{1,2})?|${D}{2,8}(?:[.,]${D}{1,2})?)`;

  // 1. High-confidence: amount that follows a label.
  // Currency prefix tolerates [$sS] — Tesseract often reads $ as s/S in custom fonts.
  const labeledRe = new RegExp(
    `(monto(?:\\s+transferido|\\s+enviado|\\s+recibido|\\s+total)?|importe|total|transferiste|enviaste|recibiste|cobraste|pagaste|abonaste)` +
    `\\s*[:\\s]*[\\$sS]?\\s*` +
    NUM,
    'gi'
  );
  let m;
  while ((m = labeledRe.exec(text)) !== null) {
    const amt = parseAmount(m[2]);
    if (amt != null && amt > 0) out.push({ amount: amt, source: 'labeled', label: m[1].toLowerCase() });
  }

  // 2. ARS / pesos suffix.
  const arsRe = new RegExp(`\\$?\\s*${NUM}\\s*(?:ARS|pesos|\\$\\s*ARS)\\b`, 'gi');
  while ((m = arsRe.exec(text)) !== null) {
    const amt = parseAmount(m[1]);
    if (amt != null && amt > 0) out.push({ amount: amt, source: 'ars_suffix' });
  }
  const arsPrefRe = new RegExp(`\\bARS\\s*${NUM}`, 'gi');
  while ((m = arsPrefRe.exec(text)) !== null) {
    const amt = parseAmount(m[1]);
    if (amt != null && amt > 0) out.push({ amount: amt, source: 'ars_prefix' });
  }

  // 3. $ prefix (headline figure — usually rendered in bold/large font).
  const dollarRe = new RegExp(`\\$\\s*${NUM}`, 'g');
  while ((m = dollarRe.exec(text)) !== null) {
    const amt = parseAmount(m[1]);
    if (amt != null && amt > 0) out.push({ amount: amt, source: 'dollar' });
  }

  // 4. Standalone number line.
  for (const line of text.split('\n').map(l => l.trim())) {
    // Standard AR/US patterns
    if (/^\d{1,3}(?:[\s.,]\d{3})+(?:[.,]\d{2})?$/.test(line) || /^\d{3,8}(?:[.,]\d{2})?$/.test(line)) {
      const amt = parseAmount(line);
      if (amt != null && amt >= 100 && amt <= 10_000_000) {
        out.push({ amount: amt, source: 'standalone' });
      }
      continue;
    }
    // OCR-tolerant: line that's *mostly* digits but with O/I/l/S confused
    if (new RegExp(`^${D}{3,12}(?:[.,]${D}{1,2})?$`).test(line)) {
      const amt = parseAmount(line);
      if (amt != null && amt >= 100 && amt <= 10_000_000) {
        out.push({ amount: amt, source: 'standalone_tolerant' });
      }
    }
  }
  return out;
}

/**
 * Pick a single best amount from a text. If `expected` is provided and at least one
 * extracted amount matches exactly, prefer that one — this defeats Tesseract noise
 * like "Saldo: $500.000" appearing before the actual "Monto: $1.000".
 *
 * Without `expected`, falls back to: highest priority source > first occurrence.
 */
function extractAmount(text, expected = null) {
  const all = extractAllAmounts(text);
  if (all.length === 0) return null;

  // 1. Exact match against expected (within 1 cent rounding) wins regardless of source.
  if (expected != null && Number.isFinite(expected) && expected > 0) {
    const exact = all.find(a => Math.abs(a.amount - expected) < 0.01);
    if (exact) return exact.amount;
  }

  // 2. Source priority: labeled > ars > dollar > standalone.
  const priority = { labeled: 4, ars_prefix: 3, ars_suffix: 3, dollar: 2, standalone: 1 };
  all.sort((a, b) => (priority[b.source] || 0) - (priority[a.source] || 0));
  return all[0].amount;
}

// Extract date in YYYY-MM-DD format
function extractDate(text) {
  const monthNames = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  };
  const monthAbbr = {
    ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
    jul: '07', ago: '08', sep: '09', sept: '09', oct: '10', nov: '11', dic: '12',
  };

  // DD de mes de YYYY
  const longMatch = text.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i);
  if (longMatch) {
    return `${longMatch[3]}-${monthNames[longMatch[2].toLowerCase()]}-${longMatch[1].padStart(2, '0')}`;
  }

  // DD/abbr (e.g. "13/may") — MP modern format, no year shown.
  // Assume current year. Caller will validate against date window.
  const abbrMatch = text.match(/(\d{1,2})[\/\s\-](ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\b/i);
  if (abbrMatch) {
    const year = new Date().getFullYear();
    return `${year}-${monthAbbr[abbrMatch[2].toLowerCase()]}-${abbrMatch[1].padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const shortMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (shortMatch) {
    return `${shortMatch[3]}-${shortMatch[2].padStart(2, '0')}-${shortMatch[1].padStart(2, '0')}`;
  }

  return null;
}

// Extract time HH:MM
function extractTime(text) {
  const m = text.match(/(\d{1,2}):(\d{2})(?:\s*(?:hs?|hrs?))?/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

// Extract CUIT/CUIL (11 digits) — handles OCR O→0 artifacts
function extractCuit(text) {
  // Clean match
  const m = text.match(/(?:CUIT|CUIL)[:\s/]*(\d{2}[\-\s]?\d{8}[\-\s]?\d{1})/i)
    || text.match(/(\d{2}-\d{8}-\d{1})/);
  if (m) return m[1].replace(/[\s\-]/g, '');

  // OCR-tolerant: allow O/o mixed with digits
  const ocrMatch = text.match(/(?:CUIT|CUIL)[:\s/]*([0-9Oo]{2}[\-\s]?[0-9Oo]{8}[\-\s]?[0-9Oo]{1})/i);
  if (ocrMatch) return normalizeOcrDigits(ocrMatch[1]).replace(/[\s\-]/g, '');

  return null;
}

// Normalize OCR artifacts in numeric strings (O→0, I→1, l→1, S→5, B→8)
function normalizeOcrDigits(str) {
  return str.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
}

// Extract CBU/CVU (22 digits) — handles OCR misreading O as 0, etc.
function extractCbu(text) {
  // Direct match (clean digits)
  const m = text.match(/(?:CBU|CVU|CvU|Cvu)[:\s]*(\d{22})/i) || text.match(/(\d{22})/);
  if (m) return m[1];

  // OCR-tolerant match: allow O/o mixed with digits (22 chars that look like digits)
  const ocrMatch = text.match(/(?:CBU|CVU|CvU|Cvu)[:\s]*([0-9Oo]{22})/i);
  if (ocrMatch) return normalizeOcrDigits(ocrMatch[1]);

  // Broader: any 22-char string of digit-like characters near CBU/CVU label
  const broadMatch = text.match(/(?:CBU|CVU|CvU|Cvu)[:\s]*([0-9OoIl]{22})/i);
  if (broadMatch) return normalizeOcrDigits(broadMatch[1]);

  return null;
}

// Extract sender name after common labels
function extractSender(text) {
  const m = text.match(/(?:De|Origen|Remitente|Ordenante|Titular)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/);
  return m ? m[1].trim() : null;
}

// Extract operation/transaction number
function extractOperationNumber(text) {
  const patterns = [
    /(?:operaci[oó]n|transacci[oó]n|comprobante)[:\s#]*(\d{6,20})/i,
    /(?:n[uú]mero de operaci[oó]n)[^\d]*(\d{6,20})/i,
    /operaci[oó]n[^\d]*?[\n\r]+\s*(\d{6,20})/i,
    /(?:n[uú]mero|numero)[:\s]*(\d{8,20})/i,
    /(?:referencia)[:\s#]*(\d{6,20})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

// Extract transaction status
function extractStatus(text) {
  const statusMap = [
    { search: 'comprobante de transferencia', normalized: 'Aprobada' },
    { search: 'transferencia enviada', normalized: 'Aprobada' },
    { search: 'transferencia realizada', normalized: 'Aprobada' },
    { search: 'transferencia exitosa', normalized: 'Aprobada' },
    { search: 'aprobada', normalized: 'Aprobada' },
    { search: 'aprobado', normalized: 'Aprobada' },
    { search: 'exitosa', normalized: 'Aprobada' },
    { search: 'completada', normalized: 'Aprobada' },
    { search: 'acreditada', normalized: 'Aprobada' },
    { search: 'rechazada', normalized: 'Rechazada' },
    { search: 'pendiente', normalized: 'Pendiente' },
  ];
  const lower = text.toLowerCase();
  for (const { search, normalized } of statusMap) {
    if (lower.includes(search)) return normalized;
  }
  return null;
}

// Extract recipient name (after "Para:", "Destino:", "Beneficiario:")
function extractRecipient(text) {
  const m = text.match(/(?:Para|Destino|Beneficiario|A)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/);
  return m ? m[1].trim() : null;
}

// Extract recipient account (alias or CBU/CVU from "Para" section)
function extractRecipientAccount(text) {
  // Look for alias after "Para" section
  const aliasMatch = text.match(/(?:Para|Destino)[\s\S]*?(?:alias|Alias)[:\s]*([a-zA-Z0-9._-]+)/i);
  if (aliasMatch) return aliasMatch[1];

  // Look for CVU/CBU in "Para" section (second occurrence after sender's)
  const sections = text.split(/(?:Para|Destino)/i);
  if (sections.length >= 2) {
    const paraSection = sections[1];
    // Clean digits match
    const cvuMatch = paraSection.match(/(?:CVU|CBU|CvU|Cvu)[:\s]*(\d{22})/i);
    if (cvuMatch) return cvuMatch[1];
    // OCR-tolerant match (O→0)
    const ocrMatch = paraSection.match(/(?:CVU|CBU|CvU|Cvu)[:\s]*([0-9OoIl]{22})/i);
    if (ocrMatch) return normalizeOcrDigits(ocrMatch[1]);
  }

  return null;
}

// Calculate confidence based on how many fields were extracted (out of total)
function calculateConfidence(fields, totalExpected = 7) {
  let found = 0;
  if (fields.extractedAmount) found++;
  if (fields.extractedDate) found++;
  if (fields.transactionStatus) found++;
  if (fields.senderName) found++;
  if (fields.senderDniCuit) found++;
  if (fields.bankName) found++;
  if (fields.transactionId) found++;
  if (fields.paymentMethod) found++;
  return Math.min(1, found / totalExpected);
}

module.exports = {
  parseAmount,
  extractAmount,
  extractAllAmounts,
  extractDate,
  extractTime,
  extractCuit,
  extractCbu,
  extractSender,
  extractRecipient,
  extractRecipientAccount,
  extractOperationNumber,
  extractStatus,
  calculateConfidence,
  normalizeOcrDigits,
};
