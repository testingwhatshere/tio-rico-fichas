# Extension Icons

## Quick Setup

**You need to create 3 PNG files:**
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

## Using the SVG Template

1. **Open `duck-icon.svg`** in:
   - [Inkscape](https://inkscape.org/) (free desktop app)
   - [Boxy SVG](https://boxy-svg.com/) (online editor)
   - [Figma](https://figma.com) (import SVG)

2. **Customize if desired:**
   - Change colors
   - Adjust hat style
   - Modify duck details

3. **Export as PNG:**
   - 512x512 first (high quality)
   - Then resize to needed sizes

## Online Conversion (Easiest)

1. Upload `duck-icon.svg` to [CloudConvert](https://cloudconvert.com/svg-to-png)
2. Set output size: 512x512
3. Download PNG
4. Use [iloveimg.com/resize-image](https://www.iloveimg.com/resize-image) to create:
   - icon16.png (16x16)
   - icon48.png (48x48)
   - icon128.png (128x128)

## Using AI Image Generator (Best Quality)

**Prompt for DALL-E/Midjourney:**
```
A cute yellow cartoon duck wearing a black detective top hat,
simple flat icon design, centered, tech logo style,
gradient blue-purple circular background, professional
```

Then resize the generated image to needed sizes.

## Using ImageMagick (Command Line)

```bash
# Convert SVG to PNG at different sizes
convert duck-icon.svg -resize 128x128 icon128.png
convert duck-icon.svg -resize 48x48 icon48.png
convert duck-icon.svg -resize 16x16 icon16.png
```

## Placeholder Icons

If you just want to test the extension now, use any duck emoji:

```bash
# macOS: Take screenshot of emoji in Preview/TextEdit
# Save as icon.png, then resize
```

---

**Status:** ⚠️ Icons not yet created - extension will show broken image icons until PNGs are added
