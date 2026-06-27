/**
 * One-shot migration: move PDF assets uploaded with resource_type='raw'
 * (URL contains `/raw/upload/`) to `/image/upload/` so Cloudinary's
 * "Restricted media types" setting stops returning 401 on delivery.
 *
 * What it does per asset:
 *   1. Parse the publicId from the URL.
 *   2. Call Cloudinary `uploader.rename` with `from_resource_type: 'raw'` →
 *      `to_resource_type: 'image'`. This is the documented way to change
 *      an asset's resource type.
 *   3. Update the matching DB row's URL: replace `/raw/upload/` with
 *      `/image/upload/` (publicId stays the same).
 *
 * Tables touched:
 *   - Request.proofUrl
 *   - PrizeClaim.payoutProofUrl
 *
 * Flags:
 *   --dry-run    Log what would change. No DB writes, no Cloudinary calls.
 *   --limit=N    Process at most N rows per table (safety + batching).
 *   --delay=N    ms between Cloudinary calls (default 500ms, rate-limit safe).
 *
 * Run with:
 *   cd apps/backend-api && bun run scripts/migrate-pdf-raw-to-image.ts --dry-run
 *   cd apps/backend-api && bun run scripts/migrate-pdf-raw-to-image.ts
 *   cd apps/backend-api && bun run scripts/migrate-pdf-raw-to-image.ts --limit=100
 */
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const a = args.find((x) => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : Number.POSITIVE_INFINITY;
})();
const DELAY_MS = (() => {
  const a = args.find((x) => x.startsWith('--delay='));
  return a ? parseInt(a.split('=')[1], 10) : 500;
})();

const prisma = new PrismaClient();
cloudinary.config({ secure: true });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extract publicId from a Cloudinary URL like
 *   https://res.cloudinary.com/<cloud>/raw/upload/v1234567/proofs/<uuid>.pdf
 * → "proofs/<uuid>"
 */
function extractPublicId(url: string): string | null {
  const m = url.match(/\/raw\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
  return m ? m[1] : null;
}

function newUrlFor(oldUrl: string): string {
  return oldUrl.replace('/raw/upload/', '/image/upload/');
}

type Counters = {
  scanned: number;
  migrated: number;
  failed: number;
  skipped: number;
};

async function migrateRequests(c: Counters) {
  const rows = await prisma.request.findMany({
    where: { proofUrl: { contains: '/raw/upload/' } },
    select: { id: true, proofUrl: true },
    take: Number.isFinite(LIMIT) ? LIMIT : undefined,
  });
  console.log(`[migrate] Request rows to scan: ${rows.length}`);

  for (const row of rows) {
    c.scanned++;
    const oldUrl = row.proofUrl!;
    const publicId = extractPublicId(oldUrl);
    if (!publicId) {
      console.warn(`[skip] Request ${row.id}: could not extract publicId from ${oldUrl}`);
      c.skipped++;
      continue;
    }
    const newUrl = newUrlFor(oldUrl);

    if (DRY_RUN) {
      console.log(`[dry] Request ${row.id}: ${oldUrl} → ${newUrl} (publicId=${publicId})`);
      c.migrated++;
      continue;
    }

    try {
      // Cloudinary SDK doesn't type from/to_resource_type but the REST API does
      // accept them — cast to bypass the narrow TS overload.
      await (cloudinary.uploader.rename as any)(publicId, publicId, {
        resource_type: 'raw',
        from_resource_type: 'raw',
        to_resource_type: 'image',
        overwrite: true,
        invalidate: false,
      });
      await prisma.request.update({
        where: { id: row.id },
        data: { proofUrl: newUrl },
      });
      console.log(`[ok] Request ${row.id}: migrated ${publicId}`);
      c.migrated++;
    } catch (err: any) {
      console.error(`[fail] Request ${row.id}: ${err?.message || err}`);
      c.failed++;
    }
    await sleep(DELAY_MS);
  }
}

async function migratePrizeClaims(c: Counters) {
  const rows = await prisma.prizeClaim.findMany({
    where: { payoutProofUrl: { contains: '/raw/upload/' } },
    select: { id: true, payoutProofUrl: true },
    take: Number.isFinite(LIMIT) ? LIMIT : undefined,
  });
  console.log(`[migrate] PrizeClaim rows to scan: ${rows.length}`);

  for (const row of rows) {
    c.scanned++;
    const oldUrl = row.payoutProofUrl!;
    const publicId = extractPublicId(oldUrl);
    if (!publicId) {
      console.warn(`[skip] PrizeClaim ${row.id}: could not extract publicId from ${oldUrl}`);
      c.skipped++;
      continue;
    }
    const newUrl = newUrlFor(oldUrl);

    if (DRY_RUN) {
      console.log(`[dry] PrizeClaim ${row.id}: ${oldUrl} → ${newUrl} (publicId=${publicId})`);
      c.migrated++;
      continue;
    }

    try {
      await (cloudinary.uploader.rename as any)(publicId, publicId, {
        resource_type: 'raw',
        from_resource_type: 'raw',
        to_resource_type: 'image',
        overwrite: true,
        invalidate: false,
      });
      await prisma.prizeClaim.update({
        where: { id: row.id },
        data: { payoutProofUrl: newUrl },
      });
      console.log(`[ok] PrizeClaim ${row.id}: migrated ${publicId}`);
      c.migrated++;
    } catch (err: any) {
      console.error(`[fail] PrizeClaim ${row.id}: ${err?.message || err}`);
      c.failed++;
    }
    await sleep(DELAY_MS);
  }
}

async function main() {
  const cloudUrl = process.env.CLOUDINARY_URL || '';
  if (!cloudUrl) {
    console.error('CLOUDINARY_URL env var is required');
    process.exit(1);
  }
  console.log(
    `[migrate] mode=${DRY_RUN ? 'DRY-RUN' : 'LIVE'} limit=${LIMIT} delay=${DELAY_MS}ms`,
  );

  const counters: Counters = { scanned: 0, migrated: 0, failed: 0, skipped: 0 };
  await migrateRequests(counters);
  await migratePrizeClaims(counters);

  console.log('\n[migrate] Summary:');
  console.log(`  scanned:  ${counters.scanned}`);
  console.log(`  migrated: ${counters.migrated}`);
  console.log(`  failed:   ${counters.failed}`);
  console.log(`  skipped:  ${counters.skipped}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
