/**
 * Primitivas compartidas por fondos, efectos y plantillas de los estados.
 * Todo se dibuja sobre un lienzo fijo de 1080×1920 (9:16, el tamaño de un
 * estado de WhatsApp).
 */

export const W = 1080;
export const H = 1920;

/** WhatsApp tapa ~250px arriba (barra de progreso, nombre) y abajo (responder). */
export const SAFE_TOP = 250;
export const SAFE_BOTTOM = H - 250;

export const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const GOLD = {
  light: '#FFE7A8',
  400: '#FBD38D',
  500: '#F6AD55',
  600: '#D4A017',
  700: '#B8860B',
};

export type Rng = () => number;

/** PRNG con semilla: la preview y el PNG descargado tienen que salir idénticos. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
export const pick = <T,>(rng: Rng, list: T[]): T => list[Math.floor(rng() * list.length)];

/** `ctx.roundRect` no existe en Safari viejo. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function font(size: number, weight = 800) {
  return `${weight} ${Math.round(size)}px ${FONT}`;
}

export function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${px}px`;
}

/** Achica la fuente hasta que el texto entre en `maxWidth`. */
export function fitFont(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxSize: number,
  weight = 900,
  minSize = 40,
): number {
  let size = maxSize;
  ctx.font = font(size, weight);
  while (size > minSize && ctx.measureText(value).width > maxWidth) {
    size -= 4;
    ctx.font = font(size, weight);
  }
  return size;
}

/** Corta por palabras; como mucho `maxLines`, con "…" si sobra. */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines = 3,
): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

/** Texto centrado con sombra suave para que se lea sobre cualquier fondo. */
export function centerText(
  ctx: CanvasRenderingContext2D,
  value: string,
  y: number,
  opts: { size: number; weight?: number; color?: string; spacing?: number; shadow?: boolean },
) {
  ctx.save();
  ctx.font = font(opts.size, opts.weight ?? 800);
  setSpacing(ctx, opts.spacing ?? 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
  }
  ctx.fillStyle = opts.color ?? '#FFFFFF';
  ctx.fillText(value, W / 2, y);
  ctx.restore();
}

/** Dorado metálico para montos: degradé vertical claro → oscuro → claro. */
export function goldFill(ctx: CanvasRenderingContext2D, y: number, size: number) {
  const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  g.addColorStop(0, GOLD.light);
  g.addColorStop(0.45, GOLD[500]);
  g.addColorStop(0.55, GOLD[600]);
  g.addColorStop(1, GOLD[400]);
  return g;
}

/** Monto grande, auto-ajustado al ancho. `glow` agrega el halo dorado. */
export function drawAmount(
  ctx: CanvasRenderingContext2D,
  value: string,
  y: number,
  opts: { maxSize: number; maxWidth?: number; glow: boolean },
) {
  ctx.save();
  const size = fitFont(ctx, value, opts.maxWidth ?? W - 140, opts.maxSize, 900);
  setSpacing(ctx, -2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.glow) {
    ctx.shadowColor = 'rgba(246, 173, 85, 0.9)';
    ctx.shadowBlur = 60;
    ctx.fillStyle = GOLD[500];
    ctx.fillText(value, W / 2, y);
  }
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = goldFill(ctx, y, size);
  ctx.fillText(value, W / 2, y);
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(120, 70, 0, 0.55)';
  ctx.strokeText(value, W / 2, y);
  ctx.restore();
  return size;
}

// Logo de Tío Rico (mismo vector que landing-page/public/tio-rico-logo.svg),
// dibujado con Path2D para no depender de cargar un asset.
const LOGO_BUBBLE =
  'M256 384C256 331.206 298.206 289 351 289H673C725.794 289 768 331.206 768 384V576C768 628.794 725.794 671 673 671H480L352 767V671C298.206 671 256 628.794 256 576V384Z';
const LOGO_DOLLAR =
  'M512 360V600M462 400C462 377.909 479.909 360 502 360H532C554.091 360 572 377.909 572 400C572 422.091 554.091 440 532 440H492C469.909 440 452 457.909 452 480V480C452 502.091 469.909 520 492 520H532C554.091 520 572 537.909 572 560C572 582.091 554.091 600 532 600H502C479.909 600 462 582.091 462 560';

export function drawLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 1024, size / 1024);

  ctx.shadowColor = 'rgba(246, 173, 85, 0.55)';
  ctx.shadowBlur = 80;
  roundRect(ctx, 0, 0, 1024, 1024, 180);
  ctx.fillStyle = '#1A202C';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 18;
  ctx.strokeStyle = GOLD[500];
  ctx.stroke();

  ctx.fillStyle = GOLD[500];
  ctx.fill(new Path2D(LOGO_BUBBLE));
  ctx.beginPath();
  ctx.arc(512, 480, 140, 0, Math.PI * 2);
  ctx.fillStyle = '#2D3748';
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 32;
  ctx.strokeStyle = GOLD[500];
  ctx.stroke(new Path2D(LOGO_DOLLAR));
  ctx.restore();
}

/** Logo + "TÍO RICO" debajo. Devuelve la y donde termina el bloque. */
export function drawBrand(ctx: CanvasRenderingContext2D, top: number, logoSize: number): number {
  drawLogo(ctx, W / 2, top + logoSize / 2, logoSize);
  const wordY = top + logoSize + 56;
  centerText(ctx, 'TÍO RICO', wordY, { size: logoSize * 0.36, weight: 900, color: GOLD[400], spacing: 10 });
  return wordY + logoSize * 0.2;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "Hoy", "Ayer" o "12 de octubre". Sin hora: no hace falta y achica lo identificable. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}
