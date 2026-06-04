#!/usr/bin/env node
// Upload the chat-app APK to Cloudinary as a raw asset so the landing page
// can link directly to the CDN. Run on each new APK build.
//
// Usage:
//   CLOUDINARY_URL=cloudinary://... node scripts/upload-apk-cloudinary.mjs [apkPath]
//
// Defaults to apps/landing-page/public/tio-rico-fichas.apk.
import path from 'node:path';
import fs from 'node:fs';
import { v2 as cloudinary } from 'cloudinary';

const apkPath = path.resolve(process.argv[2] || 'apps/landing-page/public/tio-rico-fichas.apk');
if (!fs.existsSync(apkPath)) {
  console.error(`APK not found at ${apkPath}`);
  process.exit(1);
}

if (!process.env.CLOUDINARY_URL) {
  console.error('CLOUDINARY_URL env var is required');
  process.exit(1);
}
cloudinary.config(); // reads CLOUDINARY_URL automatically

const sizeMb = (fs.statSync(apkPath).size / 1024 / 1024).toFixed(1);
console.log(`Uploading ${path.basename(apkPath)} (${sizeMb} MB) to Cloudinary as raw...`);

// `upload_large` does a chunked upload — the simple `upload` endpoint is capped at
// 10 MB for raw assets even on paid plans. With 20 MB chunks the free tier handles
// APK-sized binaries comfortably (up to 100 MB per file, 25 GB storage).
const result = await new Promise((resolve, reject) => {
  cloudinary.uploader.upload_large(
    apkPath,
    {
      resource_type: 'raw',
      public_id: 'apps/tio-rico-fichas',
      overwrite: true,
      use_filename: false,
      unique_filename: false,
      type: 'upload',
      // Cloudinary's chunked upload requires each non-final chunk to be at least
      // 5 MB and the free plan caps each request at 10 MB. 6 MB chunks sit safely
      // in that window.
      chunk_size: 6 * 1024 * 1024,
    },
    (err, res) => (err ? reject(err) : resolve(res)),
  );
});

console.log('\n✅ Uploaded.');
console.log(`URL:          ${result.secure_url}`);
console.log(`Size:         ${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`Version tag:  v${result.version}`);
console.log('\nPin this URL in:');
console.log('  apps/landing-page/public/script.js  →  APK_URL');
