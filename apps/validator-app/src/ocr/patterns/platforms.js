/**
 * Platform configurations for OCR pattern detection.
 *
 * Each entry defines:
 * - id: unique identifier
 * - name: display name
 * - keywords: array of lowercase strings to match in OCR text
 * - antiKeywords: (optional) if any of these appear, skip this platform
 * - overrides: (optional) per-field custom extraction functions
 * - limpiarTexto: (optional) recorta del texto lo que no es parte del comprobante
 *   (publicidad) antes de extraer. Opt-in: sólo la plataforma que lo declara lo usa.
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
    if (m) return m[1].trim();
    // Comprobante nuevo (desde 2026-09-02): no hay etiqueta "De", las dos cuentas van
    // listadas bajo "Origen y destino" y la primera es siempre la que paga.
    const bloque = h.nombresOrigenDestino(text);
    if (bloque.origen) return bloque.origen;
    return h.extractSender(text);
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
    // Comprobante nuevo: segunda cuenta del bloque "Origen y destino".
    const bloque = h.nombresOrigenDestino(text);
    if (bloque.destino) return bloque.destino;
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
// Dos formatos según cómo lo lea el OCR:
//   - Columnas separadas: el nombre del remitente sale ANTES de la etiqueta ("ROMINA
//     ELIZABETH FORMILIANO \n Enviado por") y el resto es etiqueta-arriba/valor-abajo.
//   - "Prueba de pago" (modo oscuro, 2026-10) leído con la variante dark-stretch: etiqueta
//     y valor en la misma línea ("Enviado por ROMINA ...", "Receptor Angel Kevin ...").
// En los dos el bloque del remitente va antes que el del receptor, cada uno con su
// CUIT/CUIL de 11 dígitos y su CVU de 22.
const astropayOverrides = {
  senderName(text) {
    // Sin flag `i`: el nombre viene en mayúsculas y con `i` el patrón aceptaría
    // cualquier línea, arrastrando texto que no es el nombre.
    const enLinea = text.match(/[Ee]nviado\s+por[ \t]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ \t]{4,60})$/m);
    if (enLinea) return enLinea[1].trim().replace(/\s+/g, ' ');
    const arriba = text.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{5,50})\n\s*[Ee]nviado\s+por/);
    if (arriba) return arriba[1].trim().replace(/\s+/g, ' ');
    return h.extractSender(text);
  },

  recipientName(text) {
    // `[ \t]` y no `\s`: con `\s` el nombre se comería el salto y la línea "CUIT/CUIL".
    const m = text.match(
      /Receptor[ \t]*\n?[ \t]*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[ \t]+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/,
    );
    return m ? m[1].trim() : h.extractRecipient(text);
  },

  recipientAccount(text) {
    // La etiqueta CVU sale mal leída seguido ("CvuU", "cvuU"), así que no se ancla a
    // ella: se toma la última tira de 22 dígitos, que siempre es la del receptor porque
    // su bloque va después del remitente. Funciona aunque el OCR pierda las etiquetas.
    const cuentas = [...text.matchAll(/(?<![0-9])([0-9OoIl]{22})(?![0-9])/g)]
      .map((m) => h.normalizeOcrDigits(m[1]))
      .filter((c) => /^\d{22}$/.test(c));
    if (cuentas.length >= 2) return cuentas[cuentas.length - 1];
    return h.extractRecipientAccount(text);
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

// --- Cuenta DNI overrides ---
// Pantalla de confirmación del Banco Provincia. Estructura fija:
//   O Transferencia exitosa \n Le transferiste a: \n <destinatario>
//   CVU: <cvu> \n CUIL: <cuil> \n Agendar cuenta \n Importe \n $ 25.000,00
// No muestra remitente, ni fecha, ni número de operación: sólo destinatario y monto.
// Ojo: el CVU que aparece es del DESTINATARIO, no del que paga — importante para no
// repetir la confusión remitente/destinatario del incidente del 2026-08-20.
const cuentaDniOverrides = {
  recipientName(text) {
    // Sin flag `i` a propósito: con ella, [A-Z][a-z]+ también matchea minúsculas y
    // mayúsculas indistintamente, así que la línea siguiente ("CVU:") se colaba dentro
    // del nombre como si fuera otra palabra ("Spikerman CVU").
    const m = text.match(
      /[Ll]e\s+[Tt]ransferiste\s+a:?\s*\n\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,4})/,
    );
    return m ? m[1].trim() : h.extractRecipient(text);
  },

  recipientAccount(text) {
    const m = text.match(/Le\s+transferiste\s+a:[\s\S]{0,80}?C[VvUu]{2}[:\s]*([0-9OoIl]{22})/i);
    return m ? h.normalizeOcrDigits(m[1]) : h.extractRecipientAccount(text);
  },

  transactionStatus(text) {
    if (/transferencia\s+exitosa/i.test(text)) return 'Aprobada';
    return h.extractStatus(text);
  },

  bankName() {
    return 'Cuenta DNI - Banco Provincia';
  },
};

// --- Personal Pay overrides ---
// Pantalla "Detalle de operación". Etiqueta y valor van en la misma línea, pero el
// remitente viene como "Apellido, Nombre" y el estado no es ninguna de las palabras
// habituales — dice "Enviaste dinero" —, así que los helpers genéricos se quedaban sin
// remitente ni estado (2 de los 7 campos que definen si el comprobante se aprueba solo).
//
//   Enviaste dinero \n $1.000 \n Fecha 30/08/2026 \n Hora 15:28 hs.
//   Envía Neves, Luis Alberto \n CUIL/CUIT 20-32732011-5 \n Desde Personal Pay
//   Recibe Spikerman Adrian Kevin Angel \n CUIL/CUIT 20-43855086-1
//   Banco/Billetera Mercado Pago \n CBU/CVU 0000003100035632646979
//   N° de la operación 3039409140
//
// Ojo con "Banco/Billetera": es la billetera del QUE RECIBE, no la del comprobante. Es lo
// que hacía que estos comprobantes se contaran como MercadoPago y aplicaran overrides de
// otro formato — la misma confusión que ya había obligado a poner AstroPay antes que MP.

/**
 * Aparea etiquetas con valores cuando el OCR leyó el comprobante por columnas.
 *
 * Según cómo Tesseract segmente la imagen, el mismo comprobante sale de dos formas:
 *
 *   a) "Envía Neves, Luis Alberto"      ← etiqueta y valor en la misma línea
 *   b) "Fecha \n Hora \n Envía \n ..."  ← TODAS las etiquetas juntas,
 *      "30/08/2026 \n 14:51 hs. \n ..."   y después todos los valores en orden
 *
 * La forma (b) deja a los regex de "etiqueta seguida de valor" sin nada que agarrar, y es
 * la que tenía el segundo comprobante del incidente del 30/08. Como el orden de los
 * valores respeta el de las etiquetas, alcanza con aparearlos por posición.
 *
 * @returns {Array<{etiqueta: string, valor: string}>} vacío si no es el layout de columnas
 */
function aparearColumnas(text) {
  const ETIQUETAS = ['fecha', 'hora', 'envia', 'envía', 'cuil/cuit', 'cuit/cuil', 'desde', 'recibe', 'banco/billetera', 'cbu/cvu'];
  const normalizar = (l) => l.toLowerCase().replace(/[:.]$/, '').trim();

  const lineas = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const esEtiqueta = (l) => ETIQUETAS.includes(normalizar(l));

  // La corrida más larga de etiquetas seguidas. Con menos de 3 no hay layout de columnas:
  // es una etiqueta suelta cuyo valor quedó en la misma línea.
  let mejorInicio = -1;
  let mejorLargo = 0;
  for (let i = 0; i < lineas.length; i++) {
    if (!esEtiqueta(lineas[i])) continue;
    let j = i;
    while (j < lineas.length && esEtiqueta(lineas[j])) j++;
    if (j - i > mejorLargo) { mejorLargo = j - i; mejorInicio = i; }
    i = j;
  }
  if (mejorLargo < 3) return [];

  const etiquetas = lineas.slice(mejorInicio, mejorInicio + mejorLargo).map(normalizar);
  // Los valores son las líneas que siguen, salteando las que son otra etiqueta suelta.
  const valores = lineas.slice(mejorInicio + mejorLargo).filter((l) => !esEtiqueta(l));

  return etiquetas.map((etiqueta, i) => ({ etiqueta, valor: valores[i] || null }))
    .filter((p) => p.valor);
}

/** Valor de la n-ésima aparición de una etiqueta en el layout de columnas. */
function valorColumna(text, etiquetas, ocurrencia = 0) {
  const pares = aparearColumnas(text);
  let vistas = 0;
  for (const p of pares) {
    if (!etiquetas.includes(p.etiqueta)) continue;
    if (vistas === ocurrencia) return p.valor;
    vistas++;
  }
  return null;
}

const personalPayOverrides = {
  senderName(text) {
    // Primero el layout de columnas; después "Envía Neves, Luis Alberto" en una línea
    // (con coma, y a veces sin la tilde porque el OCR se la come).
    const col = valorColumna(text, ['envia', 'envía']);
    if (col && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(col)) return col.replace(/\s+/g, ' ').trim();
    const m = text.match(
      /Env[ií]a\s*:?\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,?(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4})/,
    );
    return m ? m[1].trim().replace(/\s+/g, ' ') : h.extractSender(text);
  },

  recipientName(text) {
    const col = valorColumna(text, ['recibe']);
    if (col && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(col)) return col.replace(/\s+/g, ' ').trim();
    const m = text.match(
      /Recibe\s*:?\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,?(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4})/,
    );
    return m ? m[1].trim().replace(/\s+/g, ' ') : h.extractRecipient(text);
  },

  senderDniCuit(text) {
    // Hay dos CUIL/CUIT y el que importa es el PRIMERO, el del que envía: el segundo es
    // del destinatario. El helper genérico agarra el que encuentre.
    const col = valorColumna(text, ['cuil/cuit', 'cuit/cuil'], 0);
    if (col && /\d{7}/.test(col)) return h.normalizeOcrDigits(col.replace(/[-\s]/g, ''));
    const m = text.match(/Env[ií]a[\s\S]{0,60}?CUIL\/CUIT\s*:?\s*([\d\-Oo]{11,15})/i);
    return m ? h.normalizeOcrDigits(m[1].replace(/-/g, '')) : h.extractCuit(text);
  },

  recipientAccount(text) {
    // El CBU/CVU que aparece es el del destinatario (va después de "Recibe").
    const m = text.match(/CBU\/CVU\s*:?\s*([0-9OoIl]{22})/i);
    if (m) return h.normalizeOcrDigits(m[1]);
    const col = valorColumna(text, ['cbu/cvu']);
    if (col && /[0-9OoIl]{22}/.test(col)) return h.normalizeOcrDigits(col.match(/[0-9OoIl]{22}/)[0]);
    return h.extractRecipientAccount(text);
  },

  transactionId(text) {
    const m = text.match(/N[°ºo.]?\s*de\s+la\s+operaci[oó]n\s*:?\s*(\d{8,20})/i);
    return m ? m[1] : h.extractOperationNumber(text);
  },

  transactionStatus(text) {
    // No imprime "Aprobada": el título de la pantalla ya es el acuse.
    if (/enviaste\s+dinero|detalle\s+de\s+operaci[oó]n/i.test(text)) return 'Aprobada';
    return h.extractStatus(text);
  },

  bankName() {
    return 'Personal Pay';
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
  // Personal Pay también va antes que MercadoPago, y por el mismo motivo que AstroPay:
  // su comprobante lista "Banco/Billetera: Mercado Pago" para el destinatario, así que
  // caía en MP y se le aplicaban overrides de otro formato. La palabra clave es "desde
  // personal pay" —el campo que dice de dónde salió la plata— y no "personal pay" a
  // secas, que también aparecería en un comprobante de MP hacia una cuenta de Personal
  // Pay: ahí el formato es el de MP y tiene que seguir ganando MP.
  {
    id: 'personalpay',
    name: 'Personal Pay',
    keywords: ['desde personal pay'],
    // La palabra clave no alcanza: según cómo Tesseract segmente la imagen, la etiqueta
    // "Desde" puede quedar lejos de su valor (el layout de columnas) o perderse. Lo que
    // sí se sostiene es la distinción de rol: "Personal Pay" como banco/billetera es el
    // que RECIBE — ahí el comprobante lo emitió otro y el formato es de otro. En
    // cualquier otra posición, el comprobante es de Personal Pay.
    matches: (t) =>
      t.includes('personal pay') &&
      !t.includes('banco/billetera personal pay') &&
      !t.includes('billetera: personal pay'),
    overrides: personalPayOverrides,
  },
  // Brubank también va antes que MercadoPago: su comprobante pone "Entidad: MercadoPago"
  // cuando la cuenta destino es de MP, y caía en MP (con su recorte de publicidad). Se
  // reconoce por lo que es SUYO: el logo arriba de todo ("brubank" como primera palabra)
  // o el título "Envío de dinero a". Un comprobante de otro banco hacia una cuenta de
  // Brubank nombra a Brubank como destino, no como encabezado, y sigue yendo a su banco.
  {
    id: 'brubank',
    name: 'Brubank',
    keywords: ['brubank'],
    matches: (t) =>
      t.includes('brubank') &&
      (/^\W*brubank\b/.test(t.trim()) || /env[ií]o de dinero a/.test(t)),
  },
  // Wallets / fintechs (more specific, check first)
  { id: 'mercadopago', name: 'MercadoPago', keywords: ['mercado pago', 'mercadopago'], overrides: mercadopagoOverrides, limpiarTexto: h.recortarPromo },
  { id: 'uala', name: 'Ualá', keywords: ['uala', 'ualá'] },
  // Los demás textos que nombran a Brubank (sin su encabezado) siguen cayendo acá, como antes.
  { id: 'brubank', name: 'Brubank', keywords: ['brubank'] },
  { id: 'naranjax', name: 'Naranja X', keywords: ['naranja x', 'naranjax'] },
  // Personal Pay sin el campo "Desde" (otros formatos suyos). Mismos overrides: si el
  // comprobante es de Personal Pay, el formato es el de Personal Pay.
  { id: 'personalpay', name: 'Personal Pay', keywords: ['personal pay', 'personalpay'], overrides: personalPayOverrides },
  // Su pantalla de confirmación NO dice "Cuenta DNI" en ningún lado, así que con sólo
  // esa palabra clave nunca matcheaba y caía a extracción genérica (5 de 7 en el corpus).
  // Se reconoce por el texto propio de esa pantalla, que es idéntico en todos.
  {
    id: 'cuentadni',
    name: 'Cuenta DNI',
    keywords: [
      'cuenta dni',
      'cuentadni',
      'le transferiste a',
      'agendar cuenta',
    ],
    overrides: cuentaDniOverrides,
  },
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
