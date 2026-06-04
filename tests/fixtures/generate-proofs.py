#!/usr/bin/env python3
"""Generate fake payment proofs for E2E testing.

Creates several variants:
  - readable_clean: a clear MercadoPago-style receipt at the expected amount
  - readable_with_noise: same but with mild blur + JPEG compression artifacts
  - illegible_blur: heavy blur, OCR should struggle
  - wrong_amount: clean but amount differs (validator should flag amount mismatch)
  - non_proof: a random screenshot (e.g. game error) — validator should reject

Usage:
    python3 generate-proofs.py <output_dir> [--amount 5000]
"""
from __future__ import annotations

import argparse
import os
import random
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

WIDTH, HEIGHT = 720, 1280  # phone screenshot dimensions
BG = (245, 247, 250)
INK = (30, 32, 36)
ACCENT = (0, 158, 233)  # MP cyan


def _font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _format_amount(amount_ars: int) -> str:
    return f"$ {amount_ars:,.0f}".replace(",", ".")


def _random_op_id() -> str:
    return str(random.randint(70_000_000_000, 99_999_999_999))


def _draw_receipt(amount: int, *, op_id: str | None = None, when: datetime | None = None) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    op_id = op_id or _random_op_id()
    when = when or datetime.now() - timedelta(minutes=random.randint(1, 90))

    # Header bar
    d.rectangle([0, 0, WIDTH, 120], fill=ACCENT)
    d.text((30, 38), "Mercado Pago", font=_font(44), fill=(255, 255, 255))

    # Check icon (circle + tick)
    d.ellipse([WIDTH // 2 - 70, 170, WIDTH // 2 + 70, 310], outline=(0, 180, 80), width=6)
    d.line([(WIDTH // 2 - 32, 240), (WIDTH // 2 - 6, 268), (WIDTH // 2 + 40, 218)],
           fill=(0, 180, 80), width=10)

    d.text((WIDTH // 2 - 132, 340), "Pago realizado", font=_font(36), fill=INK)
    d.text((WIDTH // 2 - 70, 400), _format_amount(amount), font=_font(56), fill=INK)

    # Details block
    y = 510
    rows = [
        ("Para", "E2E Test"),
        ("Alias", "e2e.test.mp"),
        ("Fecha", when.strftime("%d/%m/%Y %H:%M")),
        ("N° de operación", op_id),
        ("Metodo", "Dinero en cuenta"),
    ]
    for label, value in rows:
        d.text((60, y), label, font=_font(26), fill=(110, 115, 125))
        d.text((60, y + 32), value, font=_font(30), fill=INK)
        y += 100

    # Footer
    d.text((60, HEIGHT - 90), "Recibido correctamente",
           font=_font(24), fill=(110, 115, 125))
    return img


def _save_jpeg(img: Image.Image, path: Path, quality: int = 92) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True)


def make_variants(out_dir: Path, amount: int) -> list[Path]:
    paths: list[Path] = []

    # 1. Clean readable
    clean = _draw_receipt(amount)
    p = out_dir / "01_readable_clean.jpg"
    _save_jpeg(clean, p, quality=95)
    paths.append(p)

    # 2. Slight blur + lower quality (still readable)
    noisy = clean.copy().filter(ImageFilter.GaussianBlur(radius=0.8))
    p = out_dir / "02_readable_with_noise.jpg"
    _save_jpeg(noisy, p, quality=55)
    paths.append(p)

    # 3. Heavy blur — should fail OCR
    blurry = clean.copy().filter(ImageFilter.GaussianBlur(radius=8))
    p = out_dir / "03_illegible_blur.jpg"
    _save_jpeg(blurry, p, quality=70)
    paths.append(p)

    # 4. Wrong amount — clean but amount mismatch
    wrong = _draw_receipt(amount + 5000)
    p = out_dir / "04_wrong_amount.jpg"
    _save_jpeg(wrong, p, quality=95)
    paths.append(p)

    # 5. Non-proof — solid color with "Game error" text
    err = Image.new("RGB", (WIDTH, HEIGHT), (20, 20, 24))
    d = ImageDraw.Draw(err)
    d.text((80, HEIGHT // 2 - 40), "Error de conexión",
           font=_font(48), fill=(255, 80, 80))
    d.text((80, HEIGHT // 2 + 20), "El juego no está disponible",
           font=_font(28), fill=(220, 220, 220))
    p = out_dir / "05_non_proof.jpg"
    _save_jpeg(err, p, quality=90)
    paths.append(p)

    return paths


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("out_dir")
    parser.add_argument("--amount", type=int, default=5000)
    args = parser.parse_args()

    out = Path(args.out_dir).resolve()
    paths = make_variants(out, args.amount)
    print(f"Generated {len(paths)} proofs in {out}:")
    for p in paths:
        size_kb = p.stat().st_size // 1024
        print(f"  {p.name}  ({size_kb} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
