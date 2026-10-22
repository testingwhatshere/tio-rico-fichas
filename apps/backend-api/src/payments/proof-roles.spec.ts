import {
  WalletTarget,
  locateOurWallet,
  extractPayerCuit,
  payerSpan,
  isOurHolderName,
  isOurHolderDni,
  personalNameTokens,
} from './proof-roles';

/**
 * Textos con la forma exacta que devuelve el OCR para cada billetera (basura de
 * iconos incluida), con nombres y números inventados.
 */
const WALLETS: WalletTarget[] = [
  {
    id: 'w1',
    label: 'MP Lucas',
    holderName: 'Lucas Martin Ferreyra',
    holderLegalName: 'Lucas Martin Ferreyra',
    holderDni: '41222333',
    cbu: '0000003100011122233344',
  },
  {
    id: 'w2',
    label: 'MP Rosa',
    // Así estaba cargada la billetera que anuló el chequeo (2026-10-21): con la
    // entidad pegada al nombre.
    holderName: 'Rosa Ines Quiroga - Mercado Pago',
    holderLegalName: 'Rosa Ines Quiroga',
    holderDni: '38444555',
    alias: '0000003100055566677788',
  },
];

const MP = (payer: string, payee: string) =>
  'o mercado pago  Comprobante de transferencia 21/0ctubre/2026 a las 16:52.  $ 25.000  Motivo: Varios  ' +
  `Origen y destino  ${payer}  ${payee}  ` +
  'N.* de operación de Mercado Pago 185401837748  Mago, tu asistente  Hacé pagos y . Transferí $ 3.00 transferencias por para Alejandra 4:  mensaje o audio';

const MP_USUARIO =
  'GS Dora Beatriz Alcaraz Mercado Pago CvuU: 0000003100029780960759 CUIT/CUIL: 27-18218758-0';
const MP_NUESTRA =
  'EG Ferreyra Lucas Martin Mercado Pago CVvU: 0000003100011122233344 CUIT/CUIL: 20-41222333-4';

describe('proof-roles', () => {
  describe('locateOurWallet', () => {
    it('MP "Origen y destino": nuestra cuenta como destino → verificado', () => {
      const v = locateOurWallet(MP(MP_USUARIO, MP_NUESTRA), WALLETS);
      expect(v.verdict).toBe('payee');
    });

    it('MP "Origen y destino": nuestra cuenta como ORIGEN (pago de un premio) → payer-only', () => {
      const v = locateOurWallet(MP(MP_NUESTRA, MP_USUARIO), WALLETS);
      expect(v.verdict).toBe('payer-only');
    });

    it('MP con el CUIT antes del CVU (otra versión de la app)', () => {
      const payer =
        'Dora Beatriz Alcaraz Mercado Pago CUIT/CUIL: 27-18218758-0 CVU: 0000003100029780960759';
      const payee =
        'Lucas Martin Ferreyra Mercado Pago CUIT/CUIL: 20-41222333-4 CVU: 0000003100011122233344';
      expect(locateOurWallet(MP(payer, payee), WALLETS).verdict).toBe('payee');
      expect(locateOurWallet(MP(payee, payer), WALLETS).verdict).toBe(
        'payer-only',
      );
    });

    it('"Mercado Pago" en el nombre de una billetera no coincide con cualquier comprobante de MP', () => {
      const ajeno =
        'GS Pablo Ruben Toledo Mercado Pago CVU: 0000003100099988877766 CUIT/CUIL: 20-30111222-3';
      const v = locateOurWallet(MP(MP_USUARIO, ajeno), WALLETS);
      expect(v.verdict).toBe('none');
    });

    it('el nombre necesita nombre y apellido juntos, no palabras sueltas', () => {
      const text =
        'Enviaste $5.000 Para Lucas Gomez CVU 0000003100099988877766 Origen Ana Ferreyra';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('none');
    });

    it('Brubank: "Destino" primero y "Origen" al final', () => {
      const text =
        'brubank Envío de dinero a Lucas Martin Ferreyra 21 de octubre de 2026 - 16:04 $ 1.500,00 (Y) Transferencia enviada ' +
        'Destino Entidad “á» MercadoPago cBU / CVU 0000003100011122233344 CUIT / CUIL 20-41222333-4 ' +
        'Origen Titular Jonatan Jose Perea CUIT / CUIL 20-29600488-0 Banco O Brubank Origen Caja de ahorro en Pesos';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('Naranja X: "Cuenta origen" / "Cuenta destino"', () => {
      const text =
        'Naranja X  Comprobante de transferencia  Enviaste  s4.500”  21/0CT/2026-16:10 h  Cuenta origen  NX Sandra Mabel Finoli Naranja X  ' +
        'CBU 4530000800018319364285  CUIL 27-34323515-7  Cuenta destino  S Rosa Ines Quiroga Mercado Pago  Cvu 0000003100055566677788  CUIL 27-38444555-4';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('Personal Pay: "Envía" / "Recibe"', () => {
      const text =
        'personal pay Enviaste dinero $50.000 00 Fecha 03/09/2026 Hora 12:31 hs. Envía Martinez, Ricardo Adrian CUIL/CUIT 20-27366830-7 ' +
        'Desde Personal Pay Recibe Ferreyra Lucas Martin CUIL/CUIT 20-41222333-4 Banco/Billetera Mercado Pago CBU/CVU 0000003100011122233344';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('Cuenta DNI: "Origen" / "Para"', () => {
      const text =
        'Cuenta DNI Comprobante de transferencia Importe S 6.000,00 Origen Facundo Miguel Pontes 35.411.749 ' +
        'Para Lucas Martin Ferreyra CVuU: 0000003100011122233344 CUIL: 20412223334 Motivo Varios';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('Lemon: "Enviado por" / "Persona destinataria"', () => {
      const text =
        'ARS 5,000.00 21 octubre 2026 15:42 hs  Enviado por Romina Soledad De Oliva Persona destinataria  Nombre Rosa Ines Quiroga ' +
        'CUIT 27384445554 CBU 0000003100055566677788 Banco destino Mercado Pago';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('AstroPay: "Enviado por" / "Receptor"', () => {
      const text =
        'AstroPay 21/10/26 - 08:01 hs ARS 5000.00 Enviado por ROMINA ELIZABETH FORMI CUIT/CUIL 27339900693 Entidad AstroPay Alias Zaimon.26 0000177500093891511210 ' +
        'Receptor Rosa Ines Quiroga CUIT/CUIL 27384445554 Entidad Mercado Pago cvuU 0000003100055566677788';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('si el OCR rompe la palabra "Destino", no se afirma que seamos el que paga', () => {
      // Naranja X real: "Destino" salió como "-Qstino" y el nombre a medias.
      const text =
        'Naranja X  Comprobante de transferencia  Enviaste  s 5.000”  29/SEP/2026-22:22h  Cuenta origen  NX Sandra Mabel Finoli  Naranja X  ' +
        'CBU 4530000800018319364285  CUIL 27-34323515-7  -Qstino  E ¡el Martin Ferreyra - Pago  Nose  Compartir';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('formato sin marcas de rol: alcanza con que aparezca un dato nuestro', () => {
      const text =
        'Detalle de movimiento Transferencia exitosa —$1.000,00 a Lucas Martin Ferreyra Operación Transferencia Destino Mercado Pago Cvu';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });

    it('números de cuenta con espacios metidos por el OCR', () => {
      const text =
        'Transferencia enviada CVU 0000 0031 0001 1122 2333 44 Monto $5.000';
      expect(locateOurWallet(text, WALLETS).verdict).toBe('payee');
    });
  });

  describe('payerSpan', () => {
    it('devuelve null si el formato no marca quién paga', () => {
      expect(
        payerSpan('Transferencia exitosa a Lucas Martin Ferreyra $1.000'),
      ).toBeNull();
    });
  });

  describe('extractPayerCuit', () => {
    it('MP: el CUIT de la PRIMERA persona, no el de la segunda', () => {
      expect(extractPayerCuit(MP(MP_USUARIO, MP_NUESTRA))).toBe('27182187580');
    });

    it('Brubank: el CUIT del bloque "Origen", aunque venga al final', () => {
      const text =
        'brubank Envío de dinero a Lucas Martin Ferreyra $ 1.500,00 Destino Entidad MercadoPago cBU / CVU 0000003100011122233344 ' +
        'CUIT / CUIL 20-41222333-4 Origen Titular Jonatan Jose Perea CUIT / CUIL 20-29600488-0 Banco O Brubank';
      expect(extractPayerCuit(text)).toBe('20296004880');
    });

    it('null si no hay tramo del que paga', () => {
      expect(
        extractPayerCuit('Transferencia a Lucas 20-41222333-4'),
      ).toBeNull();
    });
  });

  describe('titulares', () => {
    it('reconoce el nombre de un titular aunque esté invertido', () => {
      expect(isOurHolderName('Ferreyra Lucas Martin', WALLETS)).toBe(true);
      expect(isOurHolderName('Mercado Pago', WALLETS)).toBe(false);
      expect(isOurHolderName('Lucas Gomez', WALLETS)).toBe(false);
    });

    it('reconoce el DNI dentro de un CUIT', () => {
      expect(isOurHolderDni('20412223334', WALLETS)).toBe(true);
      expect(isOurHolderDni('27182187580', WALLETS)).toBe(false);
      expect(isOurHolderDni(null, WALLETS)).toBe(false);
    });

    it('las palabras de la entidad no cuentan como nombre', () => {
      expect(personalNameTokens('Rosa Ines Quiroga - Mercado Pago')).toEqual([
        'rosa',
        'ines',
        'quiroga',
      ]);
    });
  });
});
