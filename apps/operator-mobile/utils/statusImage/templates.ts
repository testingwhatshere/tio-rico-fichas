import { formatMoney } from '@/utils/amount';
import {
  GOLD,
  SAFE_BOTTOM,
  SAFE_TOP,
  W,
  centerText,
  dayLabel,
  drawAmount,
  drawBrand,
  font,
  roundRect,
  setSpacing,
  wrapLines,
} from './draw';

export type TemplateKind = 'single' | 'collage' | 'summary';

export const TEMPLATES: { key: TemplateKind; label: string }[] = [
  { key: 'single', label: 'Premio individual' },
  { key: 'collage', label: 'Varios premios' },
  { key: 'summary', label: 'Resumen' },
];

/**
 * Lo único que llega al lienzo: montos y fechas. Ningún tipo acá tiene lugar
 * para un usuario, a propósito.
 */
export type StatusContent =
  | { template: 'single'; amount: number; paidAt: string }
  | { template: 'collage'; items: { amount: number; paidAt: string }[] }
  | { template: 'summary'; total: number; count: number; period: 'today' | 'week'; partial: boolean };

function pill(ctx: CanvasRenderingContext2D, label: string, y: number) {
  ctx.save();
  ctx.font = font(40, 800);
  setSpacing(ctx, 4);
  const w = ctx.measureText(label).width + 90;
  roundRect(ctx, (W - w) / 2, y - 40, w, 80, 40);
  ctx.fillStyle = 'rgba(72, 187, 120, 0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 16;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, y + 2);
  ctx.restore();
}

function footer(ctx: CanvasRenderingContext2D, value: string) {
  if (!value.trim()) return;
  ctx.save();
  ctx.font = font(50, 700);
  const lines = wrapLines(ctx, value, W - 200, 3);
  const lineH = 66;
  const startY = SAFE_BOTTOM - 40 - (lines.length - 1) * lineH;
  lines.forEach((line, i) => centerText(ctx, line, startY + i * lineH, { size: 50, weight: 700 }));
  ctx.restore();
}

function drawSingle(ctx: CanvasRenderingContext2D, c: Extract<StatusContent, { template: 'single' }>, glow: boolean) {
  drawBrand(ctx, SAFE_TOP + 10, 190);
  centerText(ctx, '¡OTRO GANADOR!', 820, { size: 96, weight: 900, spacing: 2 });
  centerText(ctx, 'se llevó', 920, { size: 52, weight: 600, color: 'rgba(255,255,255,0.85)' });
  drawAmount(ctx, formatMoney(c.amount), 1070, { maxSize: 230, glow });
  pill(ctx, '✔ PREMIO PAGADO', 1240);
  centerText(ctx, dayLabel(c.paidAt), 1340, { size: 46, weight: 600, color: GOLD[400] });
}

function drawCollage(ctx: CanvasRenderingContext2D, c: Extract<StatusContent, { template: 'collage' }>, glow: boolean) {
  const end = drawBrand(ctx, SAFE_TOP - 10, 140);
  centerText(ctx, 'PREMIOS PAGADOS', end + 70, { size: 84, weight: 900, spacing: 2 });

  const items = c.items.slice(0, 6);
  const rowH = items.length > 4 ? 118 : 140;
  const gap = 18;
  // Con pocos premios la lista se centra en el espacio libre en vez de quedar pegada al título.
  const listH = items.length * rowH + (items.length - 1) * gap;
  const room = SAFE_BOTTOM - 260 - (end + 150);
  const listTop = end + 150 + Math.max(0, (room - listH) / 2);
  const left = 110;
  const width = W - 220;

  items.forEach((it, i) => {
    const y = listTop + i * (rowH + gap);
    ctx.save();
    roundRect(ctx, left, y, width, rowH, 28);
    ctx.fillStyle = 'rgba(10, 10, 12, 0.62)';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(246, 173, 85, 0.55)';
    ctx.stroke();

    const mid = y + rowH / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(rowH * 0.42, 400);
    ctx.fillText('🏆', left + 34, mid + 2);
    ctx.font = font(36, 600);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(dayLabel(it.paidAt), left + 34 + rowH * 0.6, mid + 2);

    const amount = formatMoney(it.amount);
    ctx.textAlign = 'right';
    ctx.font = font(rowH * 0.48, 900);
    if (glow) {
      ctx.shadowColor = 'rgba(246, 173, 85, 0.85)';
      ctx.shadowBlur = 24;
    }
    ctx.fillStyle = GOLD[400];
    ctx.fillText(amount, left + width - 36, mid + 3);
    ctx.restore();
  });
}

function drawSummary(ctx: CanvasRenderingContext2D, c: Extract<StatusContent, { template: 'summary' }>, glow: boolean) {
  drawBrand(ctx, SAFE_TOP + 10, 170);
  centerText(ctx, c.period === 'today' ? 'HOY PAGAMOS' : 'ESTA SEMANA PAGAMOS', 760, {
    size: 76,
    weight: 900,
    spacing: 2,
  });
  const total = formatMoney(c.total);
  if (c.partial) centerText(ctx, 'más de', 880, { size: 52, weight: 600, color: 'rgba(255,255,255,0.85)' });
  drawAmount(ctx, total, 1010, { maxSize: 220, glow });
  const count = c.partial ? 'en más de 100 premios' : c.count === 1 ? 'en 1 premio' : `en ${c.count} premios`;
  centerText(ctx, count, 1160, { size: 58, weight: 700 });
  pill(ctx, '✔ TODOS PAGADOS', 1290);
}

export function drawContent(ctx: CanvasRenderingContext2D, content: StatusContent, glow: boolean, footerText: string) {
  if (content.template === 'single') drawSingle(ctx, content, glow);
  else if (content.template === 'collage') drawCollage(ctx, content, glow);
  else drawSummary(ctx, content, glow);
  footer(ctx, footerText);
}
