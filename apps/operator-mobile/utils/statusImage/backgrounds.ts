import { H, W, Rng, between, font, pick } from './draw';

export type BackgroundKind = 'gold' | 'rays' | 'casino' | 'fire' | 'neon' | 'solid' | 'photo';

export const BACKGROUNDS: { key: BackgroundKind; label: string }[] = [
  { key: 'gold', label: 'Noche dorada' },
  { key: 'rays', label: 'Rayos' },
  { key: 'casino', label: 'Casino' },
  { key: 'fire', label: 'Fuego' },
  { key: 'neon', label: 'Neón' },
  { key: 'solid', label: 'Color' },
  { key: 'photo', label: 'Imagen propia' },
];

/** Todos oscuros: el texto del estado es blanco y dorado. */
export const SOLID_SWATCHES = ['#0A0A0C', '#1A365D', '#1C4532', '#63171B', '#44337A', '#7B341E'];

export type BackgroundOpts = {
  kind: BackgroundKind;
  solidColor: string;
  photo: HTMLImageElement | null;
};

function radialGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function linear(ctx: CanvasRenderingContext2D, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [at, c] of stops) g.addColorStop(at, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function vignette(ctx: CanvasRenderingContext2D, strength = 0.55) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawGold(ctx: CanvasRenderingContext2D) {
  linear(ctx, [[0, '#18181D'], [0.5, '#0C0C0F'], [1, '#050506']]);
  radialGlow(ctx, W / 2, H * 0.47, 900, 'rgba(246, 173, 85, 0.32)');
  radialGlow(ctx, W / 2, H * 0.47, 380, 'rgba(255, 231, 168, 0.12)');
}

function drawRays(ctx: CanvasRenderingContext2D, rng: Rng) {
  linear(ctx, [[0, '#1C1004'], [0.5, '#2E1B05'], [1, '#0D0802']]);
  const cx = W / 2;
  const cy = H * 0.5;
  const count = 28;
  const offset = rng() * Math.PI;
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < count; i++) {
    if (i % 2) continue;
    const a0 = offset + (i / count) * Math.PI * 2;
    const a1 = offset + ((i + 1) / count) * Math.PI * 2;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, H);
    g.addColorStop(0, 'rgba(255, 215, 120, 0.38)');
    g.addColorStop(0.6, 'rgba(246, 173, 85, 0.10)');
    g.addColorStop(1, 'rgba(246, 173, 85, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, H * 1.2, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  radialGlow(ctx, cx, cy, 520, 'rgba(255, 220, 140, 0.35)');
}

function drawCasino(ctx: CanvasRenderingContext2D, rng: Rng) {
  const g = ctx.createRadialGradient(W / 2, H * 0.45, 100, W / 2, H * 0.5, H * 0.8);
  g.addColorStop(0, '#1F7A43');
  g.addColorStop(0.6, '#0F4426');
  g.addColorStop(1, '#06200F');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Palos de póker apenas visibles, en grilla con un poco de desorden.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(84, 700);
  const suits = ['♠', '♥', '♦', '♣'];
  for (let y = 60; y < H; y += 180) {
    for (let x = 60 + ((y / 180) % 2) * 90; x < W; x += 180) {
      ctx.save();
      ctx.translate(x + between(rng, -14, 14), y + between(rng, -14, 14));
      ctx.rotate(between(rng, -0.4, 0.4));
      ctx.fillStyle = `rgba(255,255,255,${between(rng, 0.04, 0.08)})`;
      ctx.fillText(pick(rng, suits), 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
  radialGlow(ctx, W / 2, H * 0.47, 600, 'rgba(246, 173, 85, 0.14)');
}

function drawFire(ctx: CanvasRenderingContext2D, rng: Rng) {
  linear(ctx, [[0, '#120300'], [0.45, '#4A0D00'], [0.8, '#A32A05'], [1, '#E0651A']]);
  // Lenguas de fuego: elipses difusas que suben desde abajo.
  for (let i = 0; i < 14; i++) {
    const x = between(rng, 0, W);
    const r = between(rng, 180, 420);
    const y = H - between(rng, 0, 380);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255, ${Math.floor(between(rng, 140, 200))}, 60, 0.35)`);
    g.addColorStop(1, 'rgba(255, 80, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  radialGlow(ctx, W / 2, H * 0.48, 600, 'rgba(255, 190, 90, 0.18)');
}

function drawNeon(ctx: CanvasRenderingContext2D) {
  linear(ctx, [[0, '#07021A'], [0.55, '#1A0838'], [1, '#2B0A4A']]);
  radialGlow(ctx, W * 0.2, H * 0.18, 700, 'rgba(0, 220, 255, 0.22)');
  radialGlow(ctx, W * 0.85, H * 0.4, 700, 'rgba(255, 0, 200, 0.20)');

  // Grilla en perspectiva en la mitad de abajo, estilo synthwave.
  const horizon = H * 0.62;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 60, 220, 0.45)';
  ctx.shadowColor = 'rgba(255, 60, 220, 0.9)';
  ctx.shadowBlur = 14;
  ctx.lineWidth = 3;
  for (let i = -12; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 30, horizon);
    ctx.lineTo(W / 2 + i * 260, H);
    ctx.stroke();
  }
  for (let k = 1; k < 14; k++) {
    const y = horizon + Math.pow(k / 13, 2) * (H - horizon);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0, 230, 255, 0.9)';
  ctx.shadowColor = 'rgba(0, 230, 255, 1)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(W, horizon);
  ctx.stroke();
  ctx.restore();
}

function drawSolid(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  radialGlow(ctx, W / 2, H * 0.45, 800, 'rgba(255, 255, 255, 0.08)');
}

/** Imagen propia en modo "cover", oscurecida para que el monto se lea. */
function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  linear(ctx, [[0, 'rgba(0,0,0,0.55)'], [0.5, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0.7)']]);
}

export function drawBackground(ctx: CanvasRenderingContext2D, rng: Rng, opts: BackgroundOpts) {
  switch (opts.kind) {
    case 'rays':
      drawRays(ctx, rng);
      break;
    case 'casino':
      drawCasino(ctx, rng);
      break;
    case 'fire':
      drawFire(ctx, rng);
      break;
    case 'neon':
      drawNeon(ctx);
      break;
    case 'solid':
      drawSolid(ctx, opts.solidColor);
      break;
    case 'photo':
      if (opts.photo) drawPhoto(ctx, opts.photo);
      else drawGold(ctx);
      break;
    default:
      drawGold(ctx);
  }
  vignette(ctx, opts.kind === 'photo' ? 0.4 : 0.55);
}
