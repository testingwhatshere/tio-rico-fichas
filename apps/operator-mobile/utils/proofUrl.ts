/**
 * Miniaturas de comprobantes.
 *
 * En las listas el comprobante se muestra en un recuadro de ~44 px, pero se
 * descarga entero: 257 KB promedio. Pedirle a Cloudinary una versión de 128 px
 * baja eso a ~8 KB.
 *
 * El cálculo no es gratis y conviene tenerlo escrito: cada versión nueva cuesta
 * 1 transformación (0,001 crédito ≈ 1 MB de tráfico), y se genera UNA vez por
 * comprobante, no por vez que se muestra. Ahorra 0,25 MB por entrega, así que
 * empieza a convenir a partir de la cuarta vez que ese mismo comprobante se
 * dibuja en una lista — que es lo normal con los de los últimos días, que el
 * operador ve una y otra vez.
 *
 * Por eso mismo: UN solo tamaño y UN solo formato para todas las listas. Nada de
 * `f_auto` ni de varios anchos — ahí es donde se dispara la cuenta (cada
 * combinación es una versión nueva por archivo).
 */

const THUMB = 'c_limit,w_128,q_auto:eco';

export function proofThumbUrl(url?: string | null): string | null {
  if (!url || !url.includes('res.cloudinary.com')) return url ?? null;
  if (url.includes(THUMB)) return url;

  const marker = '/image/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const head = url.slice(0, at + marker.length);
  const tail = url.slice(at + marker.length);
  const slash = tail.indexOf('/');
  const first = slash === -1 ? '' : tail.slice(0, slash);

  // Lo que sigue a `upload/` puede ser la versión (`v1788142358/…`) o una
  // transformación ya puesta por el backend (`f_jpg,pg_1/…` para los PDF). En el
  // segundo caso hay que sumar el recorte a ESA transformación y no encadenar
  // otra: encadenar genera una versión extra por archivo, que es justo lo que se
  // quiere evitar.
  const isVersion = /^v\d+$/.test(first);
  if (!isVersion && first) {
    return `${head}${first},${THUMB}/${tail.slice(slash + 1)}`;
  }
  return `${head}${THUMB}/${tail}`;
}
