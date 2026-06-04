#!/usr/bin/env python3
"""Generate harder variants of payment proofs for stress-testing the validator.

Variants:
  06_rotated_15deg          : MP receipt rotated 15° (OCR usually still copes)
  07_rotated_90deg          : full sideways (most OCR engines fail)
  08_dark_underexposed      : darkened to ~40% brightness
  09_bright_overexposed     : whites blown out, low contrast
  10_low_resolution         : downscaled to 240x426 then upscaled (pixel mush)
  11_photo_of_screen        : moiré + glare overlay simulating phone-of-screen
  12_partial_crop_top       : amount + alias visible, but no op number
  13_partial_crop_bottom    : op number visible but amount cut off
  14_watermark_overlay      : huge "SAMPLE" diagonal text on top
  15_double_exposure        : two receipts overlapped (fraud attempt)
  16_handwritten_amount     : printed receipt with handwritten amount sticker
  17_screenshot_with_chrome : MP receipt with browser chrome / status bar
  18_jpeg_artifacts         : Q=20 ultra-low compression
  19_bank_transfer_style    : Banco Santander style receipt (different layout)
  20_qr_code_only           : Just a QR code, no readable text

Usage: python3 generate-proofs-hard.py <out_dir> [--amount 5000]
"""
from __future__ import annotations

import argparse
import math
import os
import random
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

W, H = 720, 1280

# ---------- helpers ----------

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


def _draw_mp_receipt(amount: int, *, op_id: str | None = None, when: datetime | None = None) -> Image.Image:
    img = Image.new("RGB", (W, H), (245, 247, 250))
    d = ImageDraw.Draw(img)
    op_id = op_id or _random_op_id()
    when = when or datetime.now() - timedelta(minutes=random.randint(1, 90))

    d.rectangle([0, 0, W, 120], fill=(0, 158, 233))
    d.text((30, 38), "Mercado Pago", font=_font(44), fill="white")
    d.ellipse([W // 2 - 70, 170, W // 2 + 70, 310], outline=(0, 180, 80), width=6)
    d.line([(W // 2 - 32, 240), (W // 2 - 6, 268), (W // 2 + 40, 218)], fill=(0, 180, 80), width=10)
    d.text((W // 2 - 132, 340), "Pago realizado", font=_font(36), fill=(30, 32, 36))
    d.text((W // 2 - 70, 400), _format_amount(amount), font=_font(56), fill=(30, 32, 36))

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
        d.text((60, y + 32), value, font=_font(30), fill=(30, 32, 36))
        y += 100
    return img


def _save(img: Image.Image, path: Path, quality: int = 90) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True)


# ---------- variants ----------

def v_rotated(amount: int, deg: float) -> Image.Image:
    base = _draw_mp_receipt(amount)
    return base.rotate(deg, expand=True, fillcolor=(245, 247, 250))


def v_dark(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount)
    return ImageEnhance.Brightness(base).enhance(0.4)


def v_bright(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount)
    b = ImageEnhance.Brightness(base).enhance(1.6)
    return ImageEnhance.Contrast(b).enhance(0.5)


def v_low_res(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount)
    tiny = base.resize((240, 426), Image.NEAREST)
    return tiny.resize((W, H), Image.NEAREST)


def v_photo_of_screen(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount).filter(ImageFilter.GaussianBlur(0.5))
    px = base.load()
    # moiré pattern overlay
    for y in range(0, H, 3):
        for x in range(W):
            r, g, b = px[x, y]
            px[x, y] = (max(0, r - 15), max(0, g - 15), max(0, b - 15))
    # glare circle
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([W * 0.4, H * 0.1, W * 1.1, H * 0.6], fill=(255, 255, 230, 80))
    combined = Image.alpha_composite(base.convert("RGBA"), overlay)
    return combined.convert("RGB")


def v_partial_crop_top(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount)
    return base.crop((0, 0, W, 600))


def v_partial_crop_bottom(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount)
    return base.crop((0, 600, W, H))


def v_watermark(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount).convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    f = _font(120)
    text = "SAMPLE"
    od.text((W // 2 - 200, H // 2 - 80), text, font=f, fill=(180, 0, 0, 100))
    od.text((W // 2 - 200, H // 2 + 100), text, font=f, fill=(180, 0, 0, 100))
    return Image.alpha_composite(base, overlay).convert("RGB")


def v_double_exposure(amount: int) -> Image.Image:
    a = _draw_mp_receipt(amount)
    b = _draw_mp_receipt(amount + 5000).rotate(8, expand=False, fillcolor=(245, 247, 250))
    a = a.convert("RGBA")
    b.putalpha(140)
    return Image.alpha_composite(a, b).convert("RGB")


def v_handwritten_amount(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount).convert("RGBA")
    # white sticker over the printed amount
    sticker = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sticker)
    sd.rectangle([W // 2 - 130, 390, W // 2 + 200, 470], fill=(255, 255, 220, 240))
    # squiggly handwritten-look text
    sd.text((W // 2 - 110, 405), f"$ {amount + 2000}", font=_font(48), fill=(20, 20, 80, 255))
    sd.line([(W // 2 - 130, 460), (W // 2 + 200, 467)], fill=(20, 20, 80, 200), width=2)
    return Image.alpha_composite(base, sticker).convert("RGB")


def v_screenshot_chrome(amount: int) -> Image.Image:
    base = _draw_mp_receipt(amount)
    chromed = Image.new("RGB", (W, H + 100), (40, 40, 50))
    chromed.paste(base, (0, 100))
    d = ImageDraw.Draw(chromed)
    d.text((20, 30), "9:41 AM", font=_font(28), fill="white")
    d.text((W - 100, 30), "100%", font=_font(28), fill="white")
    d.rectangle([W // 2 - 40, 70, W // 2 + 40, 90], fill=(80, 80, 100))
    return chromed.resize((W, H))


def v_jpeg_artifacts(amount: int) -> Image.Image:
    return _draw_mp_receipt(amount)  # save with quality=20 caller-side


def v_bank_transfer(amount: int) -> Image.Image:
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 140], fill=(196, 30, 58))
    d.text((30, 50), "Santander", font=_font(48), fill="white")
    d.text((40, 200), "Transferencia exitosa", font=_font(36), fill=(40, 40, 40))
    d.text((40, 280), "Monto", font=_font(24), fill=(120, 120, 120))
    d.text((40, 320), _format_amount(amount), font=_font(48), fill=(0, 0, 0))
    d.text((40, 420), "CBU destino", font=_font(24), fill=(120, 120, 120))
    d.text((40, 460), "0000003100000000000001", font=_font(28), fill=(40, 40, 40))
    d.text((40, 540), "Comprobante", font=_font(24), fill=(120, 120, 120))
    d.text((40, 580), _random_op_id(), font=_font(32), fill=(40, 40, 40))
    d.text((40, 680), "Fecha", font=_font(24), fill=(120, 120, 120))
    d.text((40, 720), datetime.now().strftime("%d/%m/%Y %H:%M"), font=_font(28), fill=(40, 40, 40))
    return img


def v_qr_only() -> Image.Image:
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    # Fake QR: 21x21 random black/white grid
    cell = 28
    offset_x = (W - cell * 21) // 2
    offset_y = (H - cell * 21) // 2
    random.seed(42)
    for y in range(21):
        for x in range(21):
            if random.random() > 0.45:
                d.rectangle([
                    offset_x + x * cell, offset_y + y * cell,
                    offset_x + (x + 1) * cell, offset_y + (y + 1) * cell,
                ], fill=(0, 0, 0))
    # finder squares
    for cx, cy in [(0, 0), (14, 0), (0, 14)]:
        d.rectangle([
            offset_x + cx * cell, offset_y + cy * cell,
            offset_x + (cx + 7) * cell, offset_y + (cy + 7) * cell,
        ], outline=(0, 0, 0), width=8)
    return img


# ---------- runner ----------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("out_dir")
    parser.add_argument("--amount", type=int, default=5000)
    args = parser.parse_args()

    out = Path(args.out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    amount = args.amount

    jobs = [
        ("06_rotated_15deg.jpg",          lambda: v_rotated(amount, 15)),
        ("07_rotated_90deg.jpg",          lambda: v_rotated(amount, 90)),
        ("08_dark_underexposed.jpg",      lambda: v_dark(amount)),
        ("09_bright_overexposed.jpg",     lambda: v_bright(amount)),
        ("10_low_resolution.jpg",         lambda: v_low_res(amount)),
        ("11_photo_of_screen.jpg",        lambda: v_photo_of_screen(amount)),
        ("12_partial_crop_top.jpg",       lambda: v_partial_crop_top(amount)),
        ("13_partial_crop_bottom.jpg",    lambda: v_partial_crop_bottom(amount)),
        ("14_watermark_overlay.jpg",      lambda: v_watermark(amount)),
        ("15_double_exposure.jpg",        lambda: v_double_exposure(amount)),
        ("16_handwritten_amount.jpg",     lambda: v_handwritten_amount(amount)),
        ("17_screenshot_with_chrome.jpg", lambda: v_screenshot_chrome(amount)),
        ("18_jpeg_artifacts.jpg",         lambda: v_jpeg_artifacts(amount)),
        ("19_bank_transfer_style.jpg",    lambda: v_bank_transfer(amount)),
        ("20_qr_code_only.jpg",           lambda: v_qr_only()),
    ]

    for name, fn in jobs:
        img = fn()
        q = 20 if "jpeg_artifacts" in name else 92
        _save(img, out / name, quality=q)
        size_kb = (out / name).stat().st_size // 1024
        print(f"  {name}  ({size_kb} KB)")

    print(f"\nGenerated {len(jobs)} hard variants in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
