/**
 * Normaliza el URL de un comprobante para que un `<img>` lo pueda mostrar.
 *
 * Los comprobantes viven en Cloudinary. La cuenta tiene activado "Restricted media
 * types", asi que **pedir un PDF crudo devuelve 401** (verificado en produccion):
 *
 *   .../image/upload/v1788142358/proofs/<id>.pdf             -> 401
 *   .../image/upload/f_jpg,pg_1/v1788142358/proofs/<id>.pdf  -> 200 image/jpeg
 *
 * Cloudinary si entrega el *resultado de una transformacion*, asi que insertando
 * `f_jpg,pg_1` devuelve la primera pagina del PDF como JPEG. El ~14% de los
 * comprobantes son PDF: sin esto el operador ve un recuadro vacio.
 *
 * Vive como funcion pura (y no solo como metodo de `UploadsService`) porque los
 * gateways y services que emiten `proofUrl` no inyectan ese service, y meterlo ahi
 * invita a dependencias circulares — `OperatorGateway` ya necesita `forwardRef` para
 * `EventsGateway` y `ChatsGateway`.
 *
 * Idempotente. Devuelve la entrada tal cual si no es un PDF de Cloudinary.
 */
export function toDeliverableProofUrl(url: string, mimeType?: string): string {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com')) return url;

  const isPdf =
    mimeType === 'application/pdf' ||
    url.toLowerCase().endsWith('.pdf') ||
    url.includes('/raw/upload/');
  if (!isPdf) return url;

  if (url.includes('/f_jpg,pg_1/') || url.includes('/pg_1,f_jpg/')) {
    return url;
  }

  // Los assets viejos se subieron con resource_type='raw' y necesitan el swap
  // ademas de la transformacion; los nuevos ya son 'image'.
  let out = url.replace('/raw/upload/', '/image/upload/');
  out = out.replace('/image/upload/', '/image/upload/f_jpg,pg_1/');
  return out;
}

/**
 * Igual que `toDeliverableProofUrl` pero preserva el `null`: "sin comprobante" y
 * "no se pudo mostrar el comprobante" son dos cosas distintas para el operador.
 */
export function toDeliverableProofUrlOrNull(
  url: string | null | undefined,
  mimeType?: string,
): string | null {
  if (!url) return null;
  return toDeliverableProofUrl(url, mimeType);
}

/**
 * Saca el identificador con el que el archivo vive en Cloudinary a partir de su
 * URL: `.../image/upload/[transformaciones/]v1788142358/proofs/<uuid>.pdf` da
 * `proofs/<uuid>`. Es lo que hace falta para borrarlo — no se guarda en la base
 * (el `cloudinaryPublicId` que manda el cliente al confirmar se descarta), asi
 * que se deriva de la URL.
 *
 * Devuelve null si la URL no es de Cloudinary o no tiene la forma esperada:
 * ante la duda NO se borra nada.
 */
export function cloudinaryPublicIdFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url || !url.includes('res.cloudinary.com')) return null;

  const m = url.match(/\/(?:image|raw|video)\/upload\/(.+)$/);
  if (!m) return null;

  const partes = m[1].split('/');
  // Todo lo anterior a la version (`v123…`) son transformaciones; lo posterior
  // es el public_id, al que hay que sacarle la extension.
  const iVersion = partes.findIndex((p) => /^v\d+$/.test(p));
  const resto = iVersion === -1 ? partes : partes.slice(iVersion + 1);
  if (resto.length === 0) return null;

  const publicId = resto.join('/').replace(/\.[a-z0-9]+$/i, '');
  return publicId || null;
}

/**
 * Si el comprobante existió y ya se borró por antigüedad. Se deduce del estado
 * en vez de guardarse: una carga completada que registra cuándo se subió el
 * comprobante pero ya no tiene archivo sólo puede ser una vencida.
 *
 * Importa porque "esta carga no tiene comprobante" y "el comprobante venció"
 * llevan al operador a hacer cosas distintas.
 */
export function proofWasPurged(request: {
  status?: string | null;
  proofUrl?: string | null;
  proofUploadedAt?: Date | string | null;
}): boolean {
  return (
    request?.status === 'COMPLETED' &&
    !request?.proofUrl &&
    !!request?.proofUploadedAt
  );
}
