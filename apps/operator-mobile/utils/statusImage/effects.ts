import { GOLD, H, W, Rng, between, font, pick, roundRect } from './draw';

export type EffectKind = 'sparkles' | 'confetti' | 'coins' | 'bokeh' | 'glow' | 'frame';
export type Intensity = 'low' | 'mid' | 'high';

export const EFFECTS: { key: EffectKind; label: string }[] = [
  { key: 'sparkles', label: 'Destellos' },
  { key: 'confetti', label: 'Confeti' },
  { key: 'coins', label: 'Monedas' },
  { key: 'bokeh', label: 'Luces' },
  { key: 'glow', label: 'Brillo en el monto' },
  { key: 'frame', label: 'Marco' },
];

export const INTENSITIES: { key: Intensity; label: string }[] = [
  { key: 'low', label: 'Pocos' },
  { key: 'mid', label: 'Normal' },
  { key: 'high', label: 'Muchos' },
];

const MULT: Record<Intensity, number> = { low: 0.5, mid: 1, high: 1.8 };

/**
 * Donde va el texto: los adornos grandes no lo tapan. La columna central desde
 * el logo hasta el pie, y de borde a borde a la altura del título y el monto.
 */
function inTextBand(x: number, y: number) {
  if (y > 680 && y < 1420) return true;
  return y > 230 && y < 1720 && x > 170 && x < W - 170;
}

/** Posición al azar fuera de la franja del monto (si `avoid`). */
function spot(rng: Rng, avoid: boolean): [number, number] {
  for (let i = 0; i < 12; i++) {
    const x = between(rng, 0, W);
    const y = between(rng, 0, H);
    if (!avoid || !inTextBand(x, y)) return [x, y];
  }
  return [between(rng, 0, W), between(rng, 0, H * 0.3)];
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  // Estrella de cuatro puntas con lados cóncavos: el "destello" clásico.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const tip = [Math.cos(a) * r, Math.sin(a) * r];
    const next = [Math.cos(a + Math.PI / 2) * r, Math.sin(a + Math.PI / 2) * r];
    if (i === 0) ctx.moveTo(tip[0], tip[1]);
    ctx.quadraticCurveTo(0, 0, next[0], next[1]);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSparkles(ctx: CanvasRenderingContext2D, rng: Rng, m: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(255, 220, 140, 0.95)';
  const n = Math.round(30 * m);
  for (let i = 0; i < n; i++) {
    const r = rng() < 0.25 ? between(rng, 30, 56) : between(rng, 10, 26);
    const [x, y] = spot(rng, r > 24);
    ctx.shadowBlur = r * 1.4;
    ctx.fillStyle = rng() < 0.6 ? '#FFFFFF' : GOLD.light;
    star(ctx, x, y, r, rng() < 0.7 ? 0 : Math.PI / 4);
  }
  // Polvo dorado: puntitos chicos.
  ctx.shadowBlur = 8;
  for (let i = 0; i < Math.round(70 * m); i++) {
    const [x, y] = spot(rng, false);
    ctx.globalAlpha = between(rng, 0.3, 0.9);
    ctx.fillStyle = GOLD[400];
    ctx.beginPath();
    ctx.arc(x, y, between(rng, 1.5, 4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawConfetti(ctx: CanvasRenderingContext2D, rng: Rng, m: number) {
  const palette = [GOLD[500], GOLD.light, '#FFFFFF', '#F56565', '#48BB78', '#4299E1', '#B794F4'];
  ctx.save();
  const n = Math.round(70 * m);
  for (let i = 0; i < n; i++) {
    const [x, y] = spot(rng, rng() < 0.85);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(between(rng, 0, Math.PI));
    ctx.globalAlpha = between(rng, 0.75, 1);
    ctx.fillStyle = pick(rng, palette);
    if (rng() < 0.7) {
      const w = between(rng, 10, 18);
      ctx.fillRect(-w / 2, -w, w, w * 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, between(rng, 6, 11), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function coin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, tilt);
  // Canto: un disco más oscuro corrido hacia abajo da la sensación de espesor.
  ctx.fillStyle = GOLD[700];
  ctx.beginPath();
  ctx.arc(0, r * 0.12, r, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, GOLD.light);
  g.addColorStop(0.5, GOLD[500]);
  g.addColorStop(1, GOLD[600]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = 'rgba(140, 90, 0, 0.7)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(140, 90, 0, 0.85)';
  ctx.font = font(r * 1.1, 900);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 0, r * 0.05);
  ctx.restore();
}

function drawCoins(ctx: CanvasRenderingContext2D, rng: Rng, m: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  const n = Math.round(9 * m);
  for (let i = 0; i < n; i++) {
    const [x, y] = spot(rng, true);
    coin(ctx, x, y, between(rng, 34, 78), between(rng, 0.45, 1), between(rng, -0.6, 0.6));
  }
  ctx.restore();
}

function drawBokeh(ctx: CanvasRenderingContext2D, rng: Rng, m: number) {
  const n = Math.round(22 * m);
  for (let i = 0; i < n; i++) {
    const x = between(rng, 0, W);
    const y = between(rng, 0, H);
    const r = between(rng, 30, 130);
    const warm = rng() < 0.7;
    const a = between(rng, 0.08, 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, warm ? `rgba(255, 210, 130, ${a})` : `rgba(255, 255, 255, ${a})`);
    g.addColorStop(0.7, warm ? `rgba(246, 173, 85, ${a * 0.6})` : `rgba(255, 255, 255, ${a * 0.5})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFrame(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, GOLD.light);
  g.addColorStop(0.5, GOLD[600]);
  g.addColorStop(1, GOLD[400]);
  ctx.save();
  ctx.strokeStyle = g;
  ctx.shadowColor = 'rgba(246, 173, 85, 0.6)';
  ctx.shadowBlur = 20;
  ctx.lineWidth = 8;
  roundRect(ctx, 40, 40, W - 80, H - 80, 48);
  ctx.stroke();
  ctx.lineWidth = 3;
  roundRect(ctx, 62, 62, W - 124, H - 124, 34);
  ctx.stroke();
  // Rombos en las esquinas.
  ctx.fillStyle = g;
  for (const [x, y] of [[62, 62], [W - 62, 62], [62, H - 62], [W - 62, H - 62]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-14, -14, 28, 28);
    ctx.restore();
  }
  ctx.restore();
}

/** Detrás del contenido. */
export function drawBackEffects(ctx: CanvasRenderingContext2D, rng: Rng, effects: EffectKind[], intensity: Intensity) {
  const m = MULT[intensity];
  if (effects.includes('bokeh')) drawBokeh(ctx, rng, m);
  if (effects.includes('coins')) drawCoins(ctx, rng, m);
}

/** Encima del contenido. */
export function drawFrontEffects(ctx: CanvasRenderingContext2D, rng: Rng, effects: EffectKind[], intensity: Intensity) {
  const m = MULT[intensity];
  if (effects.includes('confetti')) drawConfetti(ctx, rng, m);
  if (effects.includes('sparkles')) drawSparkles(ctx, rng, m);
  if (effects.includes('frame')) drawFrame(ctx);
}
