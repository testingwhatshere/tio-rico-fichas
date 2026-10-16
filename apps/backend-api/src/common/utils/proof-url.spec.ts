import {
  toDeliverableProofUrl,
  toDeliverableProofUrlOrNull,
  cloudinaryPublicIdFromUrl,
} from './proof-url';

/**
 * El caso real: Cloudinary devuelve 401 al pedir un PDF crudo (comprobada la
 * respuesta contra produccion) y el operador ve un recuadro vacio. Con
 * `f_jpg,pg_1` devuelve 200 image/jpeg.
 */
describe('toDeliverableProofUrl', () => {
  const PDF =
    'https://res.cloudinary.com/dbkcb1zbe/image/upload/v1788142358/proofs/009a18c4.pdf';
  const JPG =
    'https://res.cloudinary.com/dbkcb1zbe/image/upload/v1789612325/proofs/0019e6d4.jpg';

  it('inserta la transformacion en un PDF subido como image', () => {
    expect(toDeliverableProofUrl(PDF)).toBe(
      'https://res.cloudinary.com/dbkcb1zbe/image/upload/f_jpg,pg_1/v1788142358/proofs/009a18c4.pdf',
    );
  });

  it('convierte los PDF legacy subidos como raw', () => {
    const raw =
      'https://res.cloudinary.com/dbkcb1zbe/raw/upload/v1/proofs/abc.pdf';
    expect(toDeliverableProofUrl(raw)).toBe(
      'https://res.cloudinary.com/dbkcb1zbe/image/upload/f_jpg,pg_1/v1/proofs/abc.pdf',
    );
  });

  it('usa el mimeType cuando la URL no termina en .pdf', () => {
    const noExt =
      'https://res.cloudinary.com/dbkcb1zbe/image/upload/v1/proofs/abc';
    expect(toDeliverableProofUrl(noExt, 'application/pdf')).toContain(
      '/f_jpg,pg_1/',
    );
    expect(toDeliverableProofUrl(noExt)).toBe(noExt);
  });

  it('no toca imagenes (el 85% de los comprobantes)', () => {
    expect(toDeliverableProofUrl(JPG)).toBe(JPG);
  });

  it('es idempotente', () => {
    const once = toDeliverableProofUrl(PDF);
    expect(toDeliverableProofUrl(once)).toBe(once);
  });

  it('no toca URLs que no son de Cloudinary', () => {
    const other = 'https://ejemplo.com/comprobante.pdf';
    expect(toDeliverableProofUrl(other)).toBe(other);
  });

  it('tolera vacio y valores raros', () => {
    expect(toDeliverableProofUrl('')).toBe('');
    expect(toDeliverableProofUrl(null as any)).toBeNull();
  });
});

describe('toDeliverableProofUrlOrNull', () => {
  it('preserva el null: "sin comprobante" no es "no se pudo mostrar"', () => {
    expect(toDeliverableProofUrlOrNull(null)).toBeNull();
    expect(toDeliverableProofUrlOrNull(undefined)).toBeNull();
    expect(toDeliverableProofUrlOrNull('')).toBeNull();
  });

  it('transforma igual que la version pura', () => {
    const pdf =
      'https://res.cloudinary.com/dbkcb1zbe/image/upload/v1/proofs/x.pdf';
    expect(toDeliverableProofUrlOrNull(pdf)).toBe(toDeliverableProofUrl(pdf));
  });
});

describe('cloudinaryPublicIdFromUrl', () => {
  it('saca el id de una URL simple', () => {
    expect(
      cloudinaryPublicIdFromUrl(
        'https://res.cloudinary.com/dbkcb1zbe/image/upload/v1789612325/proofs/0019e6d4.png',
      ),
    ).toBe('proofs/0019e6d4');
  });

  it('ignora las transformaciones', () => {
    expect(
      cloudinaryPublicIdFromUrl(
        'https://res.cloudinary.com/dbkcb1zbe/image/upload/f_jpg,pg_1,c_limit,w_128/v1788142358/proofs/009a18c4.pdf',
      ),
    ).toBe('proofs/009a18c4');
  });

  it('soporta los raw legacy', () => {
    expect(
      cloudinaryPublicIdFromUrl(
        'https://res.cloudinary.com/dbkcb1zbe/raw/upload/v1/proofs/abc.pdf',
      ),
    ).toBe('proofs/abc');
  });

  it('devuelve null si no puede estar seguro — ante la duda no se borra', () => {
    expect(cloudinaryPublicIdFromUrl(null)).toBeNull();
    expect(cloudinaryPublicIdFromUrl('')).toBeNull();
    expect(cloudinaryPublicIdFromUrl('https://ejemplo.com/x.pdf')).toBeNull();
    expect(
      cloudinaryPublicIdFromUrl('https://res.cloudinary.com/dbkcb1zbe/algo'),
    ).toBeNull();
  });
});
