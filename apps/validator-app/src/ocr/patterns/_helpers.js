/**
 * Shared helpers for OCR pattern modules.
 * Every platform-specific pattern can use these to avoid duplicating regex logic.
 */

// Parse number string. Handles AR ("1.234.567,89"), US ("1,234,567.89"),
// and plain ("500" or "500,00"). OCR-tolerant: O→0, I/l→1, S→5, B→8.
function parseAmount(str) {
  if (!str) return null;

  // El símbolo de peso al principio, cuando Tesseract lo devolvió como letra.
  //
  // En los comprobantes donde el monto es el título grande ("$1.000" en azul, con los
  // centavos en superíndice) el `$` sale casi siempre como `s`/`S`: es una letra, no un
  // dígito, y ahí está toda la información. Si se la deja pasar a la sustitución de más
  // abajo, `[Ss]→5` la convierte en un 5 y "s1.000" se vuelve 51.000 — un comprobante de
  // mil pesos leído como cincuenta y un mil. Pasó en producción el 30/08/2026, dos veces,
  // con el mismo remitente.
  //
  // Un 5 real llega como dígito `5`, no como letra, así que descartar la letra inicial no
  // pierde ningún monto legítimo. La sustitución interna ("1.S00" → 1.500) se mantiene.
  let str2 = String(str).replace(/^\s*[sS$](?=\s*[\d.,])/, '');

  // Normalize OCR letter→digit artifacts (only when adjacent to digits, to avoid
  // mangling actual words). Common with bold/large fonts.
  //
  // Se repite hasta que deje de cambiar porque las sustituciones se habilitan entre sí:
  // en "1.OOO" sólo la primera O está pegada a un dígito, así que en una sola pasada
  // quedaba "1.0OO" → 1. Cada vuelta convierte una letra más y destraba la siguiente.
  let cleaned = str2;
  for (let i = 0; i < 8; i++) {
    const antes = cleaned;
    cleaned = cleaned
      .replace(/[Oo](?=[\d.,])|(?<=[\d.,])[Oo]/g, '0')
      .replace(/[IiLl](?=[\d.,])|(?<=[\d.,])[IiLl]/g, '1')
      .replace(/[Ss](?=[\d.,])|(?<=[\d.,])[Ss]/g, '5')
      .replace(/[Bb](?=[\d.,])|(?<=[\d.,])[Bb]/g, '8');
    if (cleaned === antes) break;
  }
  cleaned = cleaned
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
    } else if (parts.length > 2 && parts[parts.length - 1].length === 2) {
      // "5,000,00": es $5.000,00 con los puntos leídos como comas. Tomar las tres comas
      // como miles daba $500.000 — cien veces el monto real. Un separador de miles nunca
      // deja un grupo de 2 dígitos al final, así que ese último grupo son los centavos.
      cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasDot) {
    // Only dots. Heuristic: if there are 2+ dots, OR a single dot followed by exactly
    // 3 digits (and not a 1-2 digit fractional like "5.5"), treat as thousand sep.
    const parts = cleaned.split('.');
    const multipleDots = parts.length > 2;
    const looksLikeThousands = parts.length === 2 && parts[1].length === 3;
    if (multipleDots && parts[parts.length - 1].length === 2) {
      // Mismo caso que arriba pero al revés ("5.000.00"): el último grupo son centavos.
      cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    } else if (multipleDots || looksLikeThousands) {
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
    // El símbolo de peso sale mal leído seguido: como s/S en fuentes finas y como 5 en
    // las gruesas. El 5 sólo cuenta como símbolo si le sigue un espacio ("Importe\n5
    // 25.000,00" del comprobante de MP), así que "Importe 5000" se sigue leyendo 5000
    // y no 000.
    `\\s*[:\\s]*(?:[\\$sS]|5(?=\\s))?\\s*` +
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

  // 3b. Titular con el símbolo de peso leído como letra: "s1.000", "S 25.000".
  //
  // Es el monto grande del encabezado, el dato más confiable del comprobante, y hasta
  // ahora se perdía entero: `dollar` exige un `$` literal y `standalone` exige que la
  // línea arranque con un dígito, así que "s1.000" no lo agarraba nadie. El resultado era
  // que las variantes que leían BIEN el comprobante no aportaban ningún monto, y decidía
  // la única que lo leía mal.
  //
  // Se pide separador de miles en la forma global para no confundir códigos ("s12345")
  // con montos; en una línea que es sólo el monto eso no hace falta.
  const curGlobalRe = new RegExp(`(?:^|\\s)[sS]\\s?(${D}{1,3}(?:[\\s.,]${D}{3})+(?:[.,]${D}{1,2})?)`, 'gm');
  while ((m = curGlobalRe.exec(text)) !== null) {
    const amt = parseAmount(m[1]);
    if (amt != null && amt >= 100 && amt <= 10_000_000) out.push({ amount: amt, source: 'currency_letter' });
  }

  // 4. Standalone number line.
  for (const line of text.split('\n').map(l => l.trim())) {
    // Línea que es sólo el titular con el símbolo mal leído. Tolera la basura que suele
    // dejar el superíndice de los centavos ("s1.000”", "S 1.000 00").
    const curLine = line.match(new RegExp(`^[sS$]\\s?(${D}{1,3}(?:[\\s.,]${D}{3})+(?:[.,]${D}{1,2})?|${D}{3,8})\\s*["'”’]{0,2}$`));
    if (curLine) {
      const amt = parseAmount(curLine[1]);
      if (amt != null && amt >= 100 && amt <= 10_000_000) {
        out.push({ amount: amt, source: 'currency_letter' });
        continue;
      }
    }
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
  // Marcar los candidatos donde el 5 inicial puede ser el símbolo de peso.
  //
  // Cuando el `$` sale como dígito en vez de letra (pasa con la whitelist de la variante
  // `number-focused`, que no incluye la `s`), "$10.000" se vuelve "510.000": un número
  // perfectamente bien formado y diez veces más grande. No hay forma de distinguirlo del
  // texto solo — un $510.000 real se ve idéntico —, así que acá no se decide nada: se
  // anota el valor alternativo y decide quien tenga más contexto (el pipeline, comparando
  // lo que leyeron las demás variantes de la imagen).
  for (const c of out) {
    const alt = montoSinSimboloInicial(c.amount);
    if (alt != null) c.alt = alt;
  }

  return out;
}

/**
 * Resuelve un monto dudoso haciendo votar a las distintas lecturas de la misma imagen.
 *
 * Cada variante de preprocesamiento leyó el comprobante por su cuenta. Si la mayoría vio
 * el mismo número, ese es el monto: que una sola variante haya visto otra cosa dice más
 * de esa variante que del comprobante.
 *
 * Se extrae SIN monto esperado a propósito. Pasárselo haría que cada variante prefiera el
 * candidato que coincide, y entonces no estarían leyendo el comprobante sino confirmando
 * lo que ya se creía — que es exactamente como se cuela un comprobante adulterado.
 *
 * @param {Array<{name: string, text: string}>} textos — una entrada por variante
 * @returns {{ monto: number|null, votos: number, detalle: string }} monto null = sin mayoría
 */
function elegirMontoPorMayoria(textos) {
  const conteo = new Map();
  for (const t of textos || []) {
    const det = extractAmountDetailed(t.text, null);
    if (det.amount == null) continue;
    conteo.set(det.amount, (conteo.get(det.amount) || 0) + 1);
  }
  const ranking = [...conteo.entries()].sort((a, b) => b[1] - a[1]);
  const detalle = ranking.map(([monto, n]) => `${monto}×${n}`).join(', ');

  // Hace falta mayoría estricta: con empate no hay nada resuelto, y con un solo voto
  // estaríamos confiando en una lectura suelta — justo lo que causó el incidente.
  const hayMayoria = ranking.length > 0 && ranking[0][1] >= 2 &&
    (ranking.length === 1 || ranking[0][1] > ranking[1][1]);

  return {
    monto: hayMayoria ? ranking[0][0] : null,
    votos: ranking.length ? ranking[0][1] : 0,
    detalle: detalle || 'ninguno',
  };
}

/**
 * Si el primer dígito de `amount` fuera en realidad el símbolo de peso, ¿qué monto sería?
 * Devuelve null cuando sacarlo no deja un monto plausible.
 */
function montoSinSimboloInicial(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const entero = Math.floor(amount);
  const s = String(entero);
  // Sólo el 5: es el único dígito que Tesseract confunde con `$`.
  if (s[0] !== '5' || s.length < 4) return null;
  const resto = Number(s.slice(1)) + (amount - entero);
  // Un monto de 3 dígitos o menos no es plausible como titular de un comprobante,
  // y sin este piso "5100" generaría un alterno de 100.
  return resto >= 1000 ? resto : null;
}

/**
 * Pick a single best amount from a text. If `expected` is provided and at least one
 * extracted amount matches exactly, prefer that one — this defeats Tesseract noise
 * like "Saldo: $500.000" appearing before the actual "Monto: $1.000".
 *
 * Without `expected`, falls back to: highest priority source > first occurrence.
 */
function extractAmount(text, expected = null) {
  return extractAmountDetailed(text, expected).amount;
}

/**
 * Igual que extractAmount, pero además dice si el monto elegido es dudoso.
 *
 * `ambiguous` marca el caso en que el primer dígito del monto podría ser el símbolo de
 * peso mal leído ($10.000 → "510.000"). El texto solo no alcanza para desempatar, así que
 * el llamador tiene que resolverlo con más información — comparar contra lo que leyeron
 * las otras variantes de la imagen — o mandarlo a revisión manual.
 *
 * @returns {{ amount: number|null, source: string|null, ambiguous: boolean, alternative: number|null }}
 */
function extractAmountDetailed(text, expected = null) {
  const vacio = { amount: null, source: null, ambiguous: false, alternative: null };
  const all = extractAllAmounts(text);
  if (all.length === 0) return vacio;

  const armar = (c, ambiguo) => ({
    amount: c.amount,
    source: c.source,
    ambiguous: !!ambiguo,
    alternative: c.alt ?? null,
  });

  // 1. Exact match against expected (within 1 cent rounding) wins regardless of source.
  if (expected != null && Number.isFinite(expected) && expected > 0) {
    const exact = all.find(a => Math.abs(a.amount - expected) < 0.01);
    if (exact) {
      // Coincide con lo pedido, pero su alterno también es un monto posible: es
      // justamente el caso que se puede fabricar (pedir $51.000 y pagar $1.000), así que
      // coincidir con lo esperado no puede ser la prueba de que se leyó bien.
      return armar(exact, exact.alt != null);
    }
    // Ningún candidato coincide, pero el alterno de alguno sí: el símbolo de peso se
    // coló como dígito. Se propone ese valor, marcado como dudoso.
    const porAlterno = all.find(a => a.alt != null && Math.abs(a.alt - expected) < 0.01);
    if (porAlterno) {
      return { amount: porAlterno.alt, source: `${porAlterno.source}_sin_simbolo`, ambiguous: true, alternative: porAlterno.amount };
    }
  }

  // 2. Source priority: labeled > ars > dollar/titular > standalone.
  const priority = {
    labeled: 4, ars_prefix: 3, ars_suffix: 3, dollar: 2, currency_letter: 2,
    standalone: 1, standalone_tolerant: 0,
  };
  const ordenados = [...all].sort((a, b) => (priority[b.source] || 0) - (priority[a.source] || 0));
  const ganador = ordenados[0];
  return armar(ganador, ganador.alt != null);
}

// ── Fecha ────────────────────────────────────────────────────────────────
//
// Meses en español con sus abreviaturas. Se busca sobre el texto sin tildes, así que
// las claves van sin tilde y en minúscula. "setiembre" es la grafía sin p, válida en
// español y que además es lo que devuelve el OCR cuando se come la p.
const MESES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sept: '09', sep: '09', set: '09', oct: '10', nov: '11', dic: '12',
};
// Alternancia ordenada de más largo a más corto: si "sep" fuera primero, "septiembre"
// matchearía como "sep" y el resto ("tiembre") rompería el separador que viene después.
//
// Cada "o" acepta también un cero: el OCR lee la O de "octubre" como 0
// ("11/0ctubre/2026", "12/0CT/2026"). Sin esto la fecha de esos comprobantes no se
// leía nunca: el control de comprobante viejo quedaba apagado y el corte temprano
// del OCR, que exige fecha, no se daba (17 de 90 comprobantes en la muestra del
// 2026-10-13, todos corriendo las 10 pasadas).
//
// Y a veces lee la O DOS veces, letra y cero: "14/o0ctubre/2026" (7 de 106 en prod el
// 2026-10-14). Ningún mes lleva "oo", así que aceptar uno o dos no confunde meses.
const MESES_ALT = Object.keys(MESES)
  .sort((a, b) => b.length - a.length)
  .map((m) => m.replace(/o/g, '[o0]{1,2}'))
  .join('|');
/** Clave de MESES para lo que matcheó MESES_ALT ("o0ctubre" → "octubre"). */
const mesNormalizado = (m) => m.replace(/[o0]+/g, 'o');

/** Minúsculas y sin tildes, para poder escribir un solo patrón por formato. */
function sinTildes(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Arma la fecha si los tres componentes son plausibles; null si no.
 *
 * Sin esta validación, patrones como DD-MM-YY se cuelgan de cualquier tira de dígitos
 * separada por guiones (un CUIT, por ejemplo) y devuelven una fecha inventada.
 */
function armarFecha(dia, mes, anio) {
  const d = Number(dia), m = Number(mes), a = Number(anio);
  if (!(d >= 1 && d <= 31) || !(m >= 1 && m <= 12)) return null;
  if (!(a >= 2000 && a <= 2100)) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Completa el año cuando el comprobante no lo muestra.
 *
 * MercadoPago emite fechas sin año ("3 de septiembre"). Se asume el año en curso, salvo
 * que eso deje la fecha en el futuro — un comprobante del 31 de diciembre mirado el 2 de
 * enero es del año pasado, no del que viene. Se toleran 2 días de futuro por husos y por
 * relojes desfasados.
 */
function anioInferido(dia, mes) {
  const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000); // ART = UTC-3
  const anio = hoy.getUTCFullYear();
  const candidata = Date.UTC(anio, Number(mes) - 1, Number(dia));
  const limite = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) + 2 * 86400000;
  return candidata > limite ? anio - 1 : anio;
}

/**
 * Extrae la fecha del comprobante en formato YYYY-MM-DD.
 *
 * Tolera los tres formatos que emiten las billeteras argentinas y la basura que el OCR
 * mete entre medio ("03;/SEP/2026-"), porque el separador nunca aporta información:
 * lo único que importa es día, mes y año en ese orden.
 *
 * Devolver null NO es inocuo: el pipeline trata la fecha ausente como válida, así que un
 * formato no soportado equivale a desactivar el control de comprobante viejo sin que
 * nadie se entere. Fue exactamente lo que pasó cuando MP pasó a escribir el mes en
 * palabras (2026-09-02): la fecha se extraía en el 15% de los comprobantes.
 */
function extractDate(text) {
  if (!text) return null;
  const norm = sinTildes(text);

  // 1) Día + mes en palabras. El separador es cualquier cosa que no sea letra ni dígito
  //    (" de ", "/", "-", ".", ";", o nada), y el año es OPCIONAL.
  //
  //    El año tolera basura en el medio ("20?26"): el OCR mete un carácter suelto y sin
  //    esto se capturaba sólo el "20", que da el año 2020 y dispara OLD_DATE sobre un
  //    comprobante del día. Y no puede terminar en ":" — en "26/ago - 10:58" el año
  //    candidato es la hora, no un año.
  // Todo el patrón vive dentro de UNA línea (`[ \t]` en vez de `\s`): con `\s` el
  // separador se comía el salto de línea y el "año" terminaba siendo el primer dígito
  // de la línea siguiente, además de tragarse la fecha real que venía ahí.
  const H = '[ \\t]';
  const rePalabra = new RegExp(
    `(?<![0-9])([0-9]{1,2})${H}*[^a-z0-9\\n]{0,3}${H}*(?:de${H}+)?(${MESES_ALT})\\b\\.?` +
    `${H}*[^a-z0-9\\n]{0,3}${H}*(?:del?${H}+)?([0-9]{1,4}(?:[^a-z0-9\\n:][0-9]{1,4})?)?(?![0-9:])`,
    'g',
  );
  // Se juntan TODOS los candidatos en vez de quedarse con el primero: la barra de estado
  // del celular entra en el OCR ("16:27 ENE") y parece una fecha sin año, así que el
  // primer match no siempre es la fecha del comprobante.
  const candidatos = [];
  let mp;
  while ((mp = rePalabra.exec(norm)) !== null) {
    const mes = MESES[mesNormalizado(mp[2])];
    const digitos = (mp[3] || '').replace(/[^0-9]/g, '');
    let anio = null;
    if (digitos.length === 4) anio = digitos;
    else if (digitos.length === 2) anio = `20${digitos}`;
    const explicito = anio !== null;
    if (!explicito) anio = String(anioInferido(mp[1], mes));
    const fecha = armarFecha(mp[1], mes, anio);
    if (fecha) candidatos.push({ fecha, explicito });
  }
  if (candidatos.length) {
    // Un año escrito en el comprobante vale más que uno deducido: entre "27 ENE" de la
    // barra de estado y "2/septiembre/2026" del cuerpo, gana el que trae el año.
    const conAnio = candidatos.find((c) => c.explicito);
    return (conAnio || candidatos[0]).fecha;
  }

  // 2) DD/MM/YYYY, DD-MM-YYYY y sus variantes con año de dos dígitos.
  //    Los lookarounds evitan engancharse a un CUIT o a un CBU partido por guiones.
  const reNum = /(?<![0-9])([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})(?![0-9])/g;
  let mn;
  while ((mn = reNum.exec(norm)) !== null) {
    let anio = mn[3];
    if (anio.length === 3) continue;
    if (anio.length === 2) anio = `20${anio}`;
    const fecha = armarFecha(mn[1], mn[2], anio);
    if (fecha) return fecha;
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
//
// El label se busca case-insensitive porque el OCR devuelve "PARA"/"para" seguido, pero
// el nombre en sí SIGUE exigiendo capitalización — es lo único que lo distingue del ruido
// circundante. Por eso son dos regex y no una con /i: el flag /i aplicaría también a
// [A-ZÁÉÍÓÚÑ] y entonces cualquier palabra suelta pasaría por nombre.
//
// "A" salió de la lista de labels: con \b y case-insensitive matcheaba cualquier "a"
// seguida de una palabra capitalizada, y es de donde salían destinatarios basura tipo
// "Entidad" o "Agendar".
const RECIPIENT_LABEL_RE = /\b(?:para|destino|beneficiario|destinatario)\b[:\s]+/i;
const RECIPIENT_NAME_RE = /^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/;

function extractRecipient(text) {
  const label = text.match(RECIPIENT_LABEL_RE);
  if (!label) return null;
  const after = text.slice(label.index + label[0].length);
  const m = after.match(RECIPIENT_NAME_RE);
  return m ? m[1].trim() : null;
}

// Extract recipient account (alias or CBU/CVU from "Para" section)
function extractRecipientAccount(text) {
  // Look for alias after "Para" section
  const aliasMatch = text.match(/(?:Para|Destino)[\s\S]*?(?:alias|Alias)[:\s]*([a-zA-Z0-9._-]+)/i);
  if (aliasMatch) return aliasMatch[1];

  // Si hay dos o mas cuentas listadas, la ultima es la del destinatario (todos los
  // comprobantes listan origen antes que destino). Esto va primero porque el split
  // de abajo se rompe con encabezados tipo "Origen y destino": la seccion [1]
  // arranca en el REMITENTE y devolvia su cuenta como destino.
  const allAccounts = [...text.matchAll(/(?:CVU|CBU|CvU|Cvu|cvu|cbu)[:\s]*([0-9OoIl]{22})/gi)];
  if (allAccounts.length >= 2) {
    return normalizeOcrDigits(allAccounts[allAccounts.length - 1][1]);
  }

  // Look for CVU/CBU in "Para" section (second occurrence after sender's)
  // Se saca el encabezado "Origen y destino" para que no cuente como separador.
  text = text.replace(/Origen\s+y\s+destino/gi, 'Origen-y-destino');
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

// ── Bloque "Origen y destino" ────────────────────────────────────────────
//
// El comprobante nuevo de MercadoPago no etiqueta "De" ni "Para": lista las dos cuentas
// una debajo de la otra bajo el encabezado "Origen y destino", siempre en ese orden.
// Sin esto el remitente no se extraía casi nunca (6% del corpus del 2026-09-03), y el
// remitente es lo que permite ver que el que pagó no es el que pide la carga.

// Conectores que van en minúscula dentro de un nombre propio ("Monica Del Valle Cabana"
// aparece con Del capitalizado, pero "Maria de los Angeles" no).
const CONECTORES_NOMBRE = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'di', 'van', 'von'];

/**
 * Si la línea es un nombre de persona, lo devuelve limpio; si no, null.
 *
 * Descarta explícitamente las líneas de la ficha de la cuenta (banco, CUIT, CVU, motivo):
 * "Mercado Pago" tiene exactamente la misma forma que un nombre y apellido.
 */
function lineaComoNombre(linea) {
  if (!linea) return null;
  // El OCR arrastra el ícono del contacto y flechas de la UI: "< Monica ... < )".
  let s = linea.replace(/^[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]+/, '').replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]+$/, '').trim();
  if (!s) return null;
  // MercadoPago dibuja un avatar con las iniciales; Tesseract las lee como una palabra
  // suelta en mayúsculas pegada al nombre ("GS Agustin Nicolas Salinas").
  s = s.replace(/^[A-ZÁÉÍÓÚÑ]{1,3}\s+(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ])/, '');
  if (/[0-9:]/.test(s)) return null;
  const palabras = s.split(/\s+/);
  if (palabras.length < 2 || palabras.length > 5) return null;
  if (!/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(palabras[0])) return null;
  const ok = palabras.every((p) =>
    /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(p) || CONECTORES_NOMBRE.includes(sinTildes(p)));
  if (!ok) return null;
  // Una billetera escrita en dos palabras capitalizadas pasa todos los filtros de arriba.
  const { detectBankFromText } = require('./generic');
  if (detectBankFromText(s)) return null;
  return s;
}

/**
 * Nombres de las dos partes cuando el comprobante los lista en bloque.
 *
 * Cubre las dos formas vistas: un solo encabezado "Origen y destino" con las cuentas
 * en orden, y encabezados separados "Cuenta origen" / "Cuenta destino".
 *
 * @returns {{ origen: string|null, destino: string|null }}
 */
function nombresOrigenDestino(text) {
  const vacio = { origen: null, destino: null };
  if (!text) return vacio;
  const lineas = text.split('\n');
  const norm = lineas.map((l) => sinTildes(l).trim());

  const idxDestino = norm.findIndex((l) => /^cuenta\s+destino\b/.test(l));
  const idxOrigen = norm.findIndex((l) => /^cuenta\s+origen\b/.test(l));
  if (idxOrigen >= 0 && idxDestino > idxOrigen) {
    const nombreEn = (desde, hasta) => {
      for (let i = desde + 1; i < hasta && i < lineas.length; i++) {
        const n = lineaComoNombre(lineas[i]);
        if (n) return n;
      }
      return null;
    };
    return {
      origen: nombreEn(idxOrigen, idxDestino),
      destino: nombreEn(idxDestino, lineas.length),
    };
  }

  const idxBloque = norm.findIndex((l) => /^origen\s+y\s+destino\b/.test(l));
  if (idxBloque < 0) return vacio;
  const nombres = [];
  for (let i = idxBloque + 1; i < lineas.length && nombres.length < 2; i++) {
    const n = lineaComoNombre(lineas[i]);
    if (n) nombres.push(n);
  }
  return { origen: nombres[0] || null, destino: nombres[1] || null };
}

// ── Publicidad dentro del comprobante ────────────────────────────────────
//
// Desde el 2026-09-02 MercadoPago mete un bloque promocional debajo del comprobante.
// El de "Mago" trae un monto de ejemplo FIJO —"Tranferi$ 3.000 para. Alejandro"— que el
// extractor de montos ve igual que al monto real: aparecía en 5 de cada 35 comprobantes
// del corpus del 2026-09-03. Con eso, un pedido de $3.000 pagado con menos se aprobaba
// solo, porque alcanzaba con que el número esperado apareciera en algún lado del texto.
//
// La promo va siempre DESPUÉS del comprobante, así que se corta desde ahí en vez de
// filtrar campo por campo: lo que viene después no es dato de la operación.
// Sólo texto inequívocamente publicitario. Los botones de la app ("Compartir
// comprobante", "Hacer otra transferencia") NO sirven de marcador: en algunos layouts
// aparecen en el medio, antes del bloque "Origen y destino" y del número de operación.
const MARCADORES_PROMO = [
  'mago, tu asistente',
  'hablar con mago',
  'hace pagos y',          // "Hacé pagos y transferencias por mensaje o audio"
  'ver productos',
  'ver ofertas',
  'ver promociones',
  'saber mas',
  '% off',
];

/**
 * Devuelve el texto sin el bloque promocional del final.
 *
 * Conservador a propósito: si el corte deja algo que ya no parece un comprobante (muy
 * corto, o sin ningún monto), se descarta y se devuelve el texto entero. Perder el
 * comprobante es peor que arrastrar ruido — el ruido lo resuelven los demás patrones.
 */
function recortarPromo(text) {
  if (!text) return text;
  const lineas = text.split('\n');
  const idx = lineas.findIndex((l) => {
    const s = sinTildes(l).trim();
    return MARCADORES_PROMO.some((m) => s.includes(m));
  });
  if (idx <= 0) return text;

  const recortado = lineas.slice(0, idx).join('\n');
  if (recortado.trim().length < 40) return text;
  // El corte no puede llevarse datos duros de la operación. Si los pierde, el marcador
  // no estaba al final del comprobante y este recorte no es de fiar.
  const conserva = (fn) => !fn(text) || !!fn(recortado);
  if (extractAllAmounts(recortado).length === 0 && extractAllAmounts(text).length > 0) return text;
  if (!conserva(extractCuit) || !conserva(extractCbu) || !conserva(extractOperationNumber)) return text;
  return recortado;
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
  extractAmountDetailed,
  elegirMontoPorMayoria,
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
  recortarPromo,
  nombresOrigenDestino,
  lineaComoNombre,
};
