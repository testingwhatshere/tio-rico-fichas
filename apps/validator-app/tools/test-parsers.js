#!/usr/bin/env node
/**
 * Casos de regresión de los parsers, sobre texto OCR fijo.
 *
 * No hace OCR: arranca desde el texto que Tesseract devolvió en casos reales. Corre en
 * un segundo y no necesita ni imágenes ni corpus, así que se puede correr después de
 * cada cambio en los patterns. El corpus mide cobertura; esto blinda los casos que ya
 * costaron plata.
 *
 * Uso: node tools/test-parsers.js
 */

const { parseOCRText } = require('../src/ocr/parser');
const { parseAmount, extractAllAmounts, extractAmountDetailed, elegirMontoPorMayoria, extractDate, recortarPromo } = require('../src/ocr/patterns/_helpers');

const logger = require('../src/logger');
for (const m of ['info', 'warn', 'error', 'success', 'debug']) {
  if (typeof logger[m] === 'function') logger[m] = () => {};
}

let ok = 0;
const fallos = [];

function chequear(nombre, obtenido, esperado) {
  const igual = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (igual) { ok++; return; }
  fallos.push(`  ${nombre}\n      esperado: ${JSON.stringify(esperado)}\n      obtenido: ${JSON.stringify(obtenido)}`);
}

// ── El incidente del 30/08/2026 ──────────────────────────────────────────
// Dos comprobantes de Personal Pay por $1.000 se leyeron como $51.000 y se acreditaron.
// El `$` del titular sale como letra `s`, y hasta entonces ningún patrón lo reconocía:
// las 8 variantes que leían bien no aportaban monto y decidía la única que leía mal.
const personalPay1000 = `Detalle de operación
Enviaste dinero
s1.000
Fecha 30/08/2026
Hora 15:28 hs.
Envía Neves, Luis Alberto
CUIL/CUIT 20-32732011-5
Desde Personal Pay
Recibe Spikerman Adrian Kevin Angel
CUIL/CUIT 20-43855086-1
Banco/Billetera Mercado Pago
CBU/CVU 0000003100035632646979
N° de la operación 3039409140`;

const pp = parseOCRText(personalPay1000, 1000);
chequear('30/08: $1.000 de Personal Pay NO se lee como 51000', pp.extractedAmount, 1000);
chequear('30/08: se detecta como Personal Pay, no como MercadoPago', pp.detectedPlatform, 'personalpay');
chequear('30/08: remitente', pp.senderName, 'Neves, Luis Alberto');
chequear('30/08: destinatario', pp.recipientName, 'Spikerman Adrian Kevin Angel');
chequear('30/08: CUIT del que envía (no el del que recibe)', pp.senderDniCuit, '20327320115');
chequear('30/08: estado', pp.transactionStatus, 'Aprobada');
chequear('30/08: nro de operación', pp.transactionId, '3039409140');
chequear('30/08: confianza completa', pp.confidence, 1);

// El mismo comprobante SIN decirle cuánto esperábamos: tiene que leer 1000 igual.
// Si sólo acertara con el monto esperado en la mano, no estaría leyendo: estaría
// confirmando lo que ya creíamos.
chequear('30/08: sin monto esperado también da 1000', parseOCRText(personalPay1000, 0).extractedAmount, 1000);

// Y con un monto esperado FALSO no puede inventar la coincidencia.
chequear('30/08: pedir 51000 no hace aparecer 51000', parseOCRText(personalPay1000, 51000).extractedAmount, 1000);

// ── El símbolo de peso leído como letra ──────────────────────────────────
for (const [texto, esperado] of [
  ['s1.000', 1000], ['S 25.000,00', 25000], ['s100.000', 100000],
  ['s1.000.000', 1000000], ['s50.000', 50000], ['$1.000', 1000],
]) {
  chequear(`parseAmount(${JSON.stringify(texto)})`, parseAmount(texto), esperado);
}

// La sustitución interna de OCR tiene que seguir andando.
chequear('parseAmount("1.S00") sigue dando 1500', parseAmount('1.S00'), 1500);
chequear('parseAmount("1.OOO") sigue dando 1000', parseAmount('1.OOO'), 1000);
chequear('formato AR largo', parseAmount('$1.234.567,89'), 1234567.89);

// MercadoPago con los puntos leídos como comas: "$5,000,00" es $5.000,00, no $500.000.
// Un separador de miles nunca deja un grupo de 2 dígitos al final.
chequear('"5,000,00" es 5000, no 500000', parseAmount('5,000,00'), 5000);
chequear('"5.000.00" es 5000, no 500000', parseAmount('5.000.00'), 5000);
chequear('"1,234,567" sigue siendo miles US', parseAmount('1,234,567'), 1234567);
chequear('"1.234.567" sigue siendo miles AR', parseAmount('1.234.567'), 1234567);
chequear('"12,50" sigue siendo decimal', parseAmount('12,50'), 12.5);
chequear('formato US', parseAmount('1,234,567.89'), 1234567.89);

// ── Ambigüedad del 5 inicial ─────────────────────────────────────────────
// Los montos redondos que empiezan con 5 NO son ambiguos: sacarles el 5 no deja nada.
for (const m of [5000, 50000, 500000, 100000, 1000000]) {
  const det = extractAmountDetailed(`Importe $${m.toLocaleString('es-AR')}`, null);
  chequear(`$${m} no se marca ambiguo`, det.ambiguous, false);
}
// Estos sí: podrían ser el monto sin el símbolo.
for (const [m, alt] of [[51000, 1000], [55000, 5000], [510000, 10000]]) {
  const det = extractAmountDetailed(`Importe $${m.toLocaleString('es-AR')}`, null);
  chequear(`$${m} se marca ambiguo con alterno $${alt}`, [det.ambiguous, det.alternative], [true, alt]);
}

// Coincidir con lo pedido no puede ser prueba de nada cuando el valor es ambiguo:
// es exactamente la forma de fabricar el fraude (pedir $51.000 y pagar $1.000).
const det51 = extractAmountDetailed('Importe $51.000', 51000);
chequear('$51.000 pedido y leído sigue marcado como ambiguo', det51.ambiguous, true);

// ── Votación entre variantes ─────────────────────────────────────────────
// Reproduce lo que pasó el 30/08: 8 lecturas de la imagen vieron "s1.000" y una sola,
// la de peor confianza, vio "$51.000". La mayoría tiene que ganar.
const comoEl30de08 = [
  ...Array(8).fill(0).map((_, i) => ({ name: `buena-${i}`, text: 'Enviaste dinero\ns1.000\nFecha 30/08/2026' })),
  { name: 'number-focused', text: '1529\n$51.000\n30082026' },
];
chequear('la mayoria de variantes gana sobre la lectura suelta',
  elegirMontoPorMayoria(comoEl30de08).monto, 1000);

// Un solo voto no alcanza: confiar en una lectura suelta es lo que causó el incidente.
chequear('un solo voto no decide',
  elegirMontoPorMayoria([{ name: 'a', text: '$51.000' }]).monto, null);

// Empate tampoco resuelve nada.
chequear('empate va a revision',
  elegirMontoPorMayoria([
    { name: 'a', text: '$51.000' }, { name: 'b', text: '$51.000' },
    { name: 'c', text: '$1.000' }, { name: 'd', text: '$1.000' },
  ]).monto, null);

// Cuando el comprobante realmente dice $51.000, la mayoría lo confirma y se aprueba.
chequear('un $51.000 real se confirma por mayoria',
  elegirMontoPorMayoria(Array(5).fill(0).map((_, i) => ({ name: `v${i}`, text: 'Importe\ns51.000\n' }))).monto, 51000);

// ── No romper lo que ya andaba ───────────────────────────────────────────
const mpClasico = `Transferencia enviada
$ 5.000,00
De
Juan Perez
CUIT 20-12345678-9
Para
Maria Lopez
Número de operación de Mercado Pago
86537718327
30 de agosto de 2026`;
const mp = parseOCRText(mpClasico, 5000);
chequear('MP clásico: monto', mp.extractedAmount, 5000);
chequear('MP clásico: sigue detectándose como MercadoPago', mp.detectedPlatform, 'mercadopago');
chequear('MP clásico: nro de operación', mp.transactionId, '86537718327');

// Un comprobante de MercadoPago hacia una cuenta de Personal Pay tiene que seguir
// siendo MercadoPago: el formato lo define quien emite, no quien recibe.
const mpHaciaPP = `Transferencia enviada
$ 3.000,00
De
Juan Perez
Para
Maria Lopez
Banco/Billetera Personal Pay
Número de operación de Mercado Pago
86537718328`;
chequear('MP hacia Personal Pay sigue siendo MP', parseOCRText(mpHaciaPP, 3000).detectedPlatform, 'mercadopago');

// El titular con símbolo mal leído no puede pisar un monto etiquetado.
const conEtiqueta = `Monto: $2.500,00\ns1.000\nComprobante`;
chequear('el monto etiquetado gana sobre el titular suelto', extractAmountDetailed(conEtiqueta, null).amount, 2500);

// ── El comprobante nuevo de MercadoPago (2026-09-02) ─────────────────────
//
// MP rediseñó el comprobante: la fecha pasó a llevar el mes en palabras y apareció un
// bloque de publicidad debajo. Resultado medido sobre 90 comprobantes del 2026-09-03:
// la fecha se extraía en el 15% y el remitente en el 6%.
const mpNuevo = `mercado
pago

Comprobante de transferencia
3/septiembre/2026 alas 0:18.

$ 15.000

Motivo: Varios

Origen y destino

< Monica Del Valle Cabana
Mercado Pago
CUIT/CUIL: 27-20557909-0
CVu: 0000003100089034505697

Spikerman Adrián Kevin Angel
Mercado Pago

CUIT/CUIL: 20-43855086-1

CVU: 0000003100035632646979

0

N.* de operación de Mercado Pago
176987601762

Mago, tu asistente

Hacé pagos y
transferencias por :
mensaje o audio Tranferi$ 3.000 para.

Alejandro

Hablar con Mago [. e Enviado!`;
const nuevo = parseOCRText(mpNuevo, 15000);
chequear('MP nuevo: monto', nuevo.extractedAmount, 15000);
chequear('MP nuevo: fecha con mes en palabras', nuevo.extractedDate, '2026-09-03');
chequear('MP nuevo: remitente del bloque Origen y destino', nuevo.senderName, 'Monica Del Valle Cabana');
chequear('MP nuevo: destinatario del bloque Origen y destino', nuevo.recipientName, 'Spikerman Adrián Kevin Angel');
chequear('MP nuevo: nro de operación', nuevo.transactionId, '176987601762');
chequear('MP nuevo: cuenta destino', nuevo.recipientAccount, '0000003100035632646979');

// El banner de "Mago" trae un monto de ejemplo fijo de $3.000. Sin recortar la promo,
// pedir $3.000 y pagar $15.000 (o cualquier otra cosa) se aprobaba solo: alcanzaba con
// que el número esperado apareciera en algún lugar del texto.
chequear('MP nuevo: el monto de la publicidad no puede hacerse pasar por el pagado',
  parseOCRText(mpNuevo, 3000).extractedAmount, 15000);
chequear('recortarPromo corta desde el banner', /Mago/.test(recortarPromo(mpNuevo)), false);
chequear('recortarPromo conserva el comprobante', /176987601762/.test(recortarPromo(mpNuevo)), true);
// Sin marcador de promo el texto no se toca, y un texto que quedaría vacío tampoco.
chequear('recortarPromo no toca un texto sin promo', recortarPromo(mpClasico), mpClasico);
// En algunos layouts el botón "Compartir comprobante" queda ANTES del bloque de cuentas
// y del número de operación. Cortar ahí se llevaba puestos los datos de la operación.
const mpBotonAlMedio = `$ 4.000
Lautaro Neyen Aranciaga
Transferencia enviada
25/ago - 23:50
O Aprobado
Compartir comprobante
Origen y destino
< Mercado Pago
CvU: 0000003100020186518565 + CUIL: 23459223649
N.* de operación
175662605328`;
chequear('recortarPromo no corta en un botón que está en el medio',
  recortarPromo(mpBotonAlMedio), mpBotonAlMedio);
chequear('MP: el comprobante con el botón al medio conserva el nro de operación',
  parseOCRText(mpBotonAlMedio, 4000).transactionId, '175662605328');
chequear('recortarPromo se abstiene si el corte deja el comprobante en nada',
  recortarPromo('Mago, tu asistente\n$ 5.000\nComprobante'), 'Mago, tu asistente\n$ 5.000\nComprobante');

// ── Fecha: los formatos que emiten las billeteras ────────────────────────
//
// No leer la fecha no es inocuo: el pipeline trata la fecha ausente como válida, así que
// un formato no soportado apaga el control de comprobante viejo sin avisar.
const anioActual = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCFullYear();
chequear('fecha: D/mes/AAAA (MP nuevo)', extractDate('3/septiembre/2026 alas 0:18.'), '2026-09-03');
chequear('fecha: D/mes/AAAA con hora pegada', extractDate('2/septiembre/2026 a las 23:58.'), '2026-09-02');
chequear('fecha: abreviatura en mayúsculas con basura OCR', extractDate('03;/SEP/2026- 00:06h'), '2026-09-03');
chequear('fecha: "D de mes de AAAA"', extractDate('30 de agosto de 2026'), '2026-08-30');
chequear('fecha: "setiembre" sin p', extractDate('11 de setiembre de 2026'), '2026-09-11');
chequear('fecha: abreviatura con punto', extractDate('Fecha 5 sept. 2025'), '2025-09-05');
chequear('fecha: DD/MM/AAAA', extractDate('11/08/2026 20:03:26'), '2026-08-11');
chequear('fecha: DD-MM-AAAA', extractDate('11-08-2026'), '2026-08-11');
chequear('fecha: año de dos dígitos', extractDate('30/08/26'), '2026-08-30');
// El año escrito manda: antes se lo pisaba con el año en curso.
chequear('fecha: no pisa el año escrito', extractDate('31/dic/2024'), '2024-12-31');
// El OCR lee la O del mes como cero (2026-10-13, 17 de 90 comprobantes sin fecha).
chequear('fecha: "0ctubre" con cero (MP)', extractDate('Comprobante de transferencia 11/0ctubre/2026 a las 1:49.'), '2026-10-11');
chequear('fecha: "0CT" con cero (Naranja X)', extractDate('Enviaste s 4.000" 12/0CT/2026-14:53h'), '2026-10-12');
chequear('fecha: "n0viembre" con cero', extractDate('3 de n0viembre de 2026'), '2026-11-03');
chequear('fecha: "ag0sto" con cero', extractDate('30/ag0sto/2026'), '2026-08-30');
// Un cero suelto pegado a un número no inventa un mes: "100ct" no es fecha sin día.
chequear('fecha: CUIT con 0 no se vuelve mes', extractDate('CUIT 20-38942924-5'), null);
// Sin año se asume el corriente, salvo que eso deje el comprobante en el futuro: un
// comprobante del 31 de diciembre leído el 2 de enero es del año pasado, no del que viene.
const sinAnio = extractDate('15 de enero');
chequear('fecha: sin año conserva día y mes', sinAnio && sinAnio.slice(4), '-01-15');
chequear('fecha: sin año nunca queda en el futuro', Number(sinAnio.slice(0, 4)) <= anioActual, true);
chequear('fecha: sin año no retrocede de más', Number(sinAnio.slice(0, 4)) >= anioActual - 1, true);
// Un CUIT es una tira de dígitos con guiones: no es una fecha.
// Casos reales del corpus que rompían el patrón de fecha. Los tres daban una fecha
// vieja de años y habrían disparado OLD_DATE sobre comprobantes del día.
chequear('fecha: el año con basura del OCR no se corta ("20?26")',
  extractDate('17:25/agosto/20?26 alas 13:43.'), '2026-08-25');
chequear('fecha: la hora que sigue al mes no es el año ("26/ago - 10:58")',
  extractDate('26/ago - 10:58'), '2026-08-26');
chequear('fecha: la barra de estado del celular no le gana al cuerpo del comprobante',
  extractDate('16:27 ENE ==.\n2/septiembre/2026 alas 16:27.'), '2026-09-02');
// El "año" no puede venir de la línea siguiente: la fecha vive en una sola línea.
chequear('fecha: no cruza el salto de línea', extractDate('25/ago\n2000 pesos'), '2026-08-25');
chequear('fecha: un CUIT no es una fecha', extractDate('CUIT/CUIL: 27-20557909-0'), null);
chequear('fecha: un CVU no es una fecha', extractDate('CVU: 0000003100035632646979'), null);
chequear('fecha: mes fuera de rango se descarta', extractDate('11/45/2026'), null);
chequear('fecha: sin fecha devuelve null', extractDate('Transferiste $ 55.000'), null);

// ── AstroPay "Prueba de pago" en modo oscuro (2026-10) ───────────────────
// Etiquetas y fecha en gris sobre negro: el OCR viejo no las veía y todos estos
// comprobantes caían a revisión manual con confianza 0,43. Este es el texto que sale
// con la variante dark-stretch (ver preprocess.js), etiqueta y valor en la misma línea.
// La etiqueta CVU sale como "CvuU": la cuenta no se puede anclar a ella.
const astroOscuro = `AstroPay
Comprobante de Transferencia
07/10/26 - 13:33 hs
ARS 10000.00
Enviado por ROMINA ELIZABETH FORMILIANO
CUIT/CUIL 27339900693
Entidad AstroPay
Alias Zaimon.26
CvuU 0000177500093891511210
Receptor Angel Kevin Adrian Spikerman
CUIT/CUIL 20438550861
Entidad Mercado Pago
Alias Adrian.mp.camel
cvu 0000003100035632646979
Coelsa 1D
PDX4O0GNY40OP0QW420L6E Y`;

const ao = parseOCRText(astroOscuro, 10000);
chequear('astropay oscuro: plataforma', ao.detectedPlatform, 'astropay');
chequear('astropay oscuro: monto', ao.extractedAmount, 10000);
chequear('astropay oscuro: fecha con año de 2 dígitos', ao.extractedDate, '2026-10-07');
chequear('astropay oscuro: remitente con la etiqueta en la misma línea', ao.senderName, 'ROMINA ELIZABETH FORMILIANO');
chequear('astropay oscuro: CUIT del que envía', ao.senderDniCuit, '27339900693');
chequear('astropay oscuro: receptor sin arrastrar la línea siguiente', ao.recipientName, 'Angel Kevin Adrian Spikerman');
chequear('astropay oscuro: cuenta destino es la del receptor, no la del remitente', ao.recipientAccount, '0000003100035632646979');
chequear('astropay oscuro: Coelsa ID', ao.transactionId, 'PDX4O0GNY40OP0QW420L6E');
chequear('astropay oscuro: confianza completa', ao.confidence, 1);

// El mismo comprobante leído sin las etiquetas (como lo leía el OCR antes del fix): la
// cuenta destino tiene que salir igual, porque la verificación de billetera depende de ella.
const astroSinEtiquetas = `Prueba de pago
AstroPay
ARS 10000.00
ROMINA ELIZABETH FORMILIANO
27339900693
AstroPay
Zaimon.26
0000177500093891511210
Angel Kevin Adrian Spikermar
20438550861
Mercado Pago
Adrian.mp.camel
0000003100035632646979
PDX40GNY400POQW420L6E Y`;
const ase = parseOCRText(astroSinEtiquetas, 10000);
chequear('astropay sin etiquetas: monto', ase.extractedAmount, 10000);
chequear('astropay sin etiquetas: cuenta destino', ase.recipientAccount, '0000003100035632646979');

// ── Brubank hacia una cuenta de Mercado Pago (2026-10-14) ────────────────
// El comprobante dice "Entidad: MercadoPago" (es el banco del que recibe) y caía en MP.
// La fecha va en gris claro: sólo la lee la variante light-gray; acá se prueba el texto.
const brubankAMp = `brubank
Envío de dinero a
Angel Kevin Adrian
Spikerman
13 de octubre de 2026 - 22:27
$ 1.000,00
(Y) Transferencia enviada
Destino
Entidad <> MercadoPago
CBU / CVU 0000003100035632646979
CUIT / CUIL 20-43855086-1
Origen
Titular Jonatan Jose Castrege
CUIT / CUIL 20-29600488-0
Banco (6) Brubank
Origen Caja de ahorro en Pesos`;
{
  const r = parseOCRText(brubankAMp, 1000);
  chequear('Brubank a MP: se detecta como Brubank', r.detectedPlatform, 'brubank');
  chequear('Brubank a MP: monto', r.extractedAmount, 1000);
  chequear('Brubank a MP: fecha', r.extractedDate, '2026-10-13');
}
// Un comprobante de Mercado Pago HACIA una cuenta de Brubank sigue siendo de MP.
{
  const r = parseOCRText(`Comprobante de transferencia
Mercado Pago
$ 2.000
Viernes, 10 de octubre de 2026 a las 21:54 hs
De Juan Perez
Para Maria Gomez
Banco Brubank
CVU 1430001713000000000001`, 2000);
  chequear('MP hacia Brubank: sigue siendo MercadoPago', r.detectedPlatform, 'mercadopago');
}

// ── Resultado ────────────────────────────────────────────────────────────
console.log(`\n${ok} casos OK, ${fallos.length} fallidos\n`);
if (fallos.length) {
  console.log('FALLOS:');
  console.log(fallos.join('\n'));
  process.exit(1);
}
console.log('Todo verde.');
// El require del logger deja un handle abierto y el proceso no cierra solo.
process.exit(0);
