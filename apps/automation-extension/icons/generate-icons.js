#!/usr/bin/env node
/**
 * Icon Generator Script
 * Generates PNG icons from the SVG template
 *
 * Usage: node generate-icons.js
 * Requirements: npm install sharp
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SIZES = [16, 48, 128];

async function generateIcons() {
  console.log('🦆 Generating duck with hat icons...\n');

  const svgPath = join(__dirname, 'duck-icon.svg');
  const svgContent = readFileSync(svgPath, 'utf-8');

  for (const size of SIZES) {
    const outputPath = join(__dirname, `icon${size}.png`);

    try {
      await sharp(Buffer.from(svgContent))
        .resize(size, size)
        .png()
        .toFile(outputPath);

      console.log(`✅ Generated icon${size}.png (${size}x${size})`);
    } catch (error) {
      console.error(`❌ Failed to generate icon${size}.png:`, error.message);
    }
  }

  console.log('\n🎉 Icon generation complete!');
  console.log('Icons are ready in the icons/ folder.');
}

generateIcons().catch(console.error);
