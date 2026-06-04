#!/usr/bin/env node

/**
 * Generate a 256x256 PNG icon for the Operator Panel.
 * Uses only built-in Node.js modules (zlib for deflate, no external deps).
 *
 * The icon is a dark blue rounded rectangle with "OP" text rendered
 * via a simple bitmap font.
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const WIDTH = 256;
const HEIGHT = 256;

// Colors (RGBA)
const BG_COLOR = { r: 30, g: 41, b: 59 };       // slate-800
const CIRCLE_COLOR = { r: 59, g: 130, b: 246 };  // blue-500
const TEXT_COLOR = { r: 255, g: 255, b: 255 };    // white
const BORDER_COLOR = { r: 37, g: 99, b: 235 };    // blue-600

// --- Pixel drawing helpers ---

// Raw pixel buffer: RGBA, 4 bytes per pixel
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 0);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const idx = (y * WIDTH + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

function blendPixel(x, y, r, g, b, alpha) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const idx = (y * WIDTH + x) * 4;
  const a = alpha / 255;
  const invA = 1 - a;
  pixels[idx] = Math.round(r * a + pixels[idx] * invA);
  pixels[idx + 1] = Math.round(g * a + pixels[idx + 1] * invA);
  pixels[idx + 2] = Math.round(b * a + pixels[idx + 2] * invA);
  pixels[idx + 3] = Math.min(255, pixels[idx + 3] + alpha);
}

function fillRect(x1, y1, w, h, r, g, b) {
  for (let y = y1; y < y1 + h; y++) {
    for (let x = x1; x < x1 + w; x++) {
      setPixel(x, y, r, g, b);
    }
  }
}

function fillCircle(cx, cy, radius, r, g, b) {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= r2) {
        const dist = Math.sqrt(dist2);
        if (dist > radius - 1.5) {
          const alpha = Math.max(0, Math.min(255, Math.round((radius - dist) * 255 / 1.5)));
          blendPixel(Math.round(x), Math.round(y), r, g, b, alpha);
        } else {
          setPixel(Math.round(x), Math.round(y), r, g, b);
        }
      }
    }
  }
}

function fillRoundedRect(x1, y1, w, h, radius, r, g, b) {
  fillRect(x1 + radius, y1, w - 2 * radius, h, r, g, b);
  fillRect(x1, y1 + radius, w, h - 2 * radius, r, g, b);
  fillCircle(x1 + radius, y1 + radius, radius, r, g, b);
  fillCircle(x1 + w - radius - 1, y1 + radius, radius, r, g, b);
  fillCircle(x1 + radius, y1 + h - radius - 1, radius, r, g, b);
  fillCircle(x1 + w - radius - 1, y1 + h - radius - 1, radius, r, g, b);
}

// --- Simple bitmap font for "OP" ---

const FONT = {
  O: [
    '  ####  ',
    ' ##  ## ',
    '##    ##',
    '##    ##',
    '##    ##',
    '##    ##',
    ' ##  ## ',
    '  ####  ',
  ],
  P: [
    '######  ',
    '##   ## ',
    '##   ## ',
    '######  ',
    '##      ',
    '##      ',
    '##      ',
    '##      ',
  ],
};

function drawLetter(letter, startX, startY, scale, r, g, b) {
  const grid = FONT[letter];
  if (!grid) return;
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === '#') {
        fillRect(
          startX + col * scale,
          startY + row * scale,
          scale,
          scale,
          r, g, b
        );
      }
    }
  }
}

// --- Draw the icon ---

// 1. Background: dark rounded rectangle
fillRoundedRect(0, 0, WIDTH, HEIGHT, 40, BG_COLOR.r, BG_COLOR.g, BG_COLOR.b);

// 2. Inner circle (blue)
fillCircle(128, 118, 80, CIRCLE_COLOR.r, CIRCLE_COLOR.g, CIRCLE_COLOR.b);

// 3. Border ring (slightly darker blue)
for (let angle = 0; angle < Math.PI * 2; angle += 0.001) {
  for (let rOff = 78; rOff <= 82; rOff++) {
    const x = Math.round(128 + rOff * Math.cos(angle));
    const y = Math.round(118 + rOff * Math.sin(angle));
    setPixel(x, y, BORDER_COLOR.r, BORDER_COLOR.g, BORDER_COLOR.b);
  }
}

// 4. "OP" text centered in the circle
const letterScale = 6;
const letterW_O = 8 * letterScale; // 48
const letterW_P = 8 * letterScale; // 48
const gap = 6;
const totalTextW = letterW_O + gap + letterW_P;
const textStartX = Math.round(128 - totalTextW / 2);
const textStartY = Math.round(118 - (8 * letterScale) / 2);

drawLetter('O', textStartX, textStartY, letterScale, TEXT_COLOR.r, TEXT_COLOR.g, TEXT_COLOR.b);
drawLetter('P', textStartX + letterW_O + gap, textStartY, letterScale, TEXT_COLOR.r, TEXT_COLOR.g, TEXT_COLOR.b);

// 5. Small label "OPERATOR" at bottom
const SMALL_FONT = {
  O: ['###', '# #', '# #', '# #', '###'],
  P: ['## ', '# #', '## ', '#  ', '#  '],
  E: ['###', '#  ', '## ', '#  ', '###'],
  R: ['## ', '# #', '## ', '# #', '#  '],
  A: [' # ', '# #', '###', '# #', '# #'],
  T: ['###', ' # ', ' # ', ' # ', ' # '],
};

function drawSmallLetter(letter, startX, startY, scale, r, g, b) {
  const grid = SMALL_FONT[letter];
  if (!grid) return;
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === '#') {
        fillRect(startX + col * scale, startY + row * scale, scale, scale, r, g, b);
      }
    }
  }
}

const smallScale = 3;
const smallLetterW = 3 * smallScale + 2;
const word = 'OPERATOR';
const wordW = word.length * smallLetterW;
const wordStartX = Math.round(128 - wordW / 2);
const wordStartY = 215;

for (let i = 0; i < word.length; i++) {
  drawSmallLetter(word[i], wordStartX + i * smallLetterW, wordStartY, smallScale, 180, 200, 220);
}

// --- PNG encoding ---

const rawData = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
for (let y = 0; y < HEIGHT; y++) {
  const rowOffset = y * (1 + WIDTH * 4);
  rawData[rowOffset] = 0; // filter: None
  pixels.copy(rawData, rowOffset + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, typeBytes, data, crcVal]);
}

// PNG signature
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type: RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace

// IDAT (compressed pixel data)
const compressed = zlib.deflateSync(rawData, { level: 9 });

// IEND
const iend = Buffer.alloc(0);

// Assemble PNG
const png = Buffer.concat([
  signature,
  createChunk('IHDR', ihdr),
  createChunk('IDAT', compressed),
  createChunk('IEND', iend),
]);

// Write to file
const outputPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(outputPath, png);

console.log('Icon generated: ' + outputPath);
console.log('Size: ' + png.length + ' bytes (' + WIDTH + 'x' + HEIGHT + ' RGBA PNG)');
