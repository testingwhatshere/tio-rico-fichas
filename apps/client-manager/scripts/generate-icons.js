/**
 * Generates app icons for Aurum.
 * Creates a 1024x1024 PNG, then converts to .icns (Mac) and .ico (Win).
 * Uses only Node.js built-ins + macOS sips/iconutil.
 */
const { writeFileSync, mkdirSync, existsSync } = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

const RESOURCES = join(__dirname, '..', 'resources');
const ICONSET = join(RESOURCES, 'icon.iconset');

// SVG source — the Aurum logo
const SVG = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2a2520"/>
      <stop offset="100%" stop-color="#1a1714"/>
    </linearGradient>
    <linearGradient id="letter" x1="384" y1="224" x2="640" y2="800" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#d4a853"/>
      <stop offset="50%" stop-color="#c9983a"/>
      <stop offset="100%" stop-color="#a67c2e"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="200" fill="url(#bg)"/>
  <path d="M512 224L288 800h102.4l51.2-144h140.8L633.6 800H736L512 224z" fill="url(#letter)"/>
  <path d="M396.8 592L512 304l115.2 288H396.8z" fill="#1a1a1a" opacity="0.15"/>
</svg>`;

// Write SVG
mkdirSync(RESOURCES, { recursive: true });
const svgPath = join(RESOURCES, 'icon.svg');
writeFileSync(svgPath, SVG);
console.log('✅ SVG written');

// Convert SVG to PNG using sips (macOS) — we need a workaround since sips doesn't do SVG
// Use a simple approach: write an HTML file and use the system to render it
// Actually, let's use the built-in Electron approach — just provide the SVG and PNG

// For macOS .icns we need multiple PNG sizes in an .iconset folder
// sips can resize PNGs

// First, let's try using a canvas-based approach via a tiny script
// Since we don't have ImageMagick, let's generate a simple PNG header manually
// Actually the simplest approach: install sharp temporarily

try {
  // Check if sharp is available
  require.resolve('sharp');
} catch {
  console.log('Installing sharp for PNG generation...');
  execSync('npm install --no-save sharp', { cwd: join(__dirname, '..'), stdio: 'inherit' });
}

const sharp = require('sharp');

async function main() {
  const svgBuffer = Buffer.from(SVG);

  // Generate 1024x1024 master PNG
  const masterPng = join(RESOURCES, 'icon.png');
  await sharp(svgBuffer).resize(1024, 1024).png().toFile(masterPng);
  console.log('✅ icon.png (1024x1024)');

  // Generate .iconset for macOS
  if (existsSync('/usr/bin/iconutil')) {
    mkdirSync(ICONSET, { recursive: true });

    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    for (const size of sizes) {
      await sharp(svgBuffer).resize(size, size).png().toFile(join(ICONSET, `icon_${size}x${size}.png`));
      // @2x variants
      if (size <= 512) {
        await sharp(svgBuffer).resize(size * 2, size * 2).png().toFile(join(ICONSET, `icon_${size}x${size}@2x.png`));
      }
    }

    // iconutil wants specific names
    const renames = {
      'icon_16x16.png': 'icon_16x16.png',
      'icon_16x16@2x.png': 'icon_16x16@2x.png',
      'icon_32x32.png': 'icon_32x32.png',
      'icon_32x32@2x.png': 'icon_32x32@2x.png',
      'icon_64x64.png': 'icon_32x32@2x.png', // 64 = 32@2x
      'icon_128x128.png': 'icon_128x128.png',
      'icon_128x128@2x.png': 'icon_128x128@2x.png',
      'icon_256x256.png': 'icon_256x256.png',
      'icon_256x256@2x.png': 'icon_256x256@2x.png',
      'icon_512x512.png': 'icon_512x512.png',
      'icon_512x512@2x.png': 'icon_512x512@2x.png',
    };

    execSync(`iconutil -c icns "${ICONSET}" -o "${join(RESOURCES, 'icon.icns')}"`, { stdio: 'inherit' });
    console.log('✅ icon.icns (macOS)');

    // Cleanup iconset
    execSync(`rm -rf "${ICONSET}"`);
  }

  // Generate .ico for Windows (multi-size ICO)
  // sharp can output ico-compatible PNGs, we'll create a simple ico
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    icoSizes.map(s => sharp(svgBuffer).resize(s, s).png().toBuffer())
  );

  const ico = createIco(pngBuffers, icoSizes);
  writeFileSync(join(RESOURCES, 'icon.ico'), ico);
  console.log('✅ icon.ico (Windows)');

  console.log('\n🎉 All icons generated in resources/');
}

/**
 * Creates a minimal .ico file from PNG buffers.
 */
function createIco(pngBuffers, sizes) {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  // ICO header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);        // reserved
  header.writeUInt16LE(1, 2);        // type: ico
  header.writeUInt16LE(numImages, 4); // count

  // Directory entries
  const dir = Buffer.alloc(dirSize);
  const offsets = [];
  for (let i = 0; i < numImages; i++) {
    const s = sizes[i];
    const offset = i * dirEntrySize;
    dir.writeUInt8(s < 256 ? s : 0, offset);       // width
    dir.writeUInt8(s < 256 ? s : 0, offset + 1);   // height
    dir.writeUInt8(0, offset + 2);                  // palette
    dir.writeUInt8(0, offset + 3);                  // reserved
    dir.writeUInt16LE(1, offset + 4);               // color planes
    dir.writeUInt16LE(32, offset + 6);              // bits per pixel
    dir.writeUInt32LE(pngBuffers[i].length, offset + 8);  // size
    dir.writeUInt32LE(dataOffset, offset + 12);     // offset
    dataOffset += pngBuffers[i].length;
  }

  return Buffer.concat([header, dir, ...pngBuffers]);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
