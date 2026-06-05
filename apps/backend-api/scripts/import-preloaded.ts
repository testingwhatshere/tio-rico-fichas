/**
 * One-off importer for the operator's `contacts.csv` (Google Contacts export).
 * Reads `~/Downloads/contacts.csv`, normalizes each row, and upserts the
 * corresponding User row with isPreloaded=true.
 *
 *   - First Name (col 0): username (strip "⭐ ", emojis, accents → lowercase)
 *   - Phone 1 - Value (last col): phone (strip non-digits, so "+5491134..." → "5491134...")
 *
 * Case-insensitive lookup is used so previously-created users with mixed case
 * get upgraded to preloaded instead of duplicated.
 *
 * Run with:
 *   bun --cwd apps/backend-api run scripts/import-preloaded.ts
 */

import { PrismaClient, UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CSV_PATH =
  process.argv[2] ||
  path.join(os.homedir(), 'Downloads', 'contacts (1).csv');

const prisma = new PrismaClient();

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * Conservative Argentine phone normalizer.
 * Returns canonical "549<area><number>" when input is clearly AR.
 * Leaves foreign numbers (+56 Chile, +34 Spain, etc.) as digit-only.
 */
function canonicalArPhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54') && digits.length >= 11 && digits.length <= 13) {
    return '549' + digits.slice(2);
  }
  if (digits.startsWith('9') && digits.length >= 10 && digits.length <= 12) {
    return '54' + digits;
  }
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('0')) {
    return '549' + digits;
  }
  return digits;
}

function normalizeUsername(s: string): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: ${CSV_PATH} no existe`);
    process.exit(1);
  }
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/);

  // Detect Google Contacts format
  const header = (lines[0] || '').toLowerCase();
  const isGoogle = header.includes('first name') && header.includes('phone');
  if (!isGoogle) {
    console.error('ERROR: el CSV no parece ser Google Contacts (falta "First Name" o "Phone")');
    process.exit(1);
  }

  const headerCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const phoneColIdx = headerCells.findIndex((c) => /phone\s*1\s*-\s*value/.test(c));
  if (phoneColIdx === -1) {
    console.error('ERROR: no se encontró columna "Phone 1 - Value"');
    process.exit(1);
  }

  console.log(`📂 ${CSV_PATH}`);
  console.log(`📊 Filas totales: ${lines.length - 1}`);
  console.log('');

  let created = 0;
  let updated = 0;
  const errors: Array<{ row: number; raw: string; reason: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cells = splitCsvLine(raw);
    const rawUsername = (cells[0] || '').trim();
    const rawPhone = (cells[phoneColIdx] || '').trim();
    const username = normalizeUsername(rawUsername);
    const phone = canonicalArPhone(rawPhone);

    if (!username || username.length < 3) {
      errors.push({ row: i + 1, raw: rawUsername, reason: `Username vacío tras limpiar` });
      continue;
    }
    if (!phone || phone.length < 7) {
      errors.push({ row: i + 1, raw: rawUsername, reason: `Teléfono inválido: "${rawPhone}"` });
      continue;
    }

    try {
      // Check phone owner
      const phoneOwner = await prisma.user.findUnique({ where: { phone } });
      if (phoneOwner) {
        const phoneOwnerUsernameLower = (phoneOwner.username || '').toLowerCase();
        if (phoneOwnerUsernameLower !== username) {
          errors.push({
            row: i + 1,
            raw: rawUsername,
            reason: `Teléfono ${phone} ya usado por "${phoneOwner.username}"`,
          });
          continue;
        }
      }

      // Case-insensitive username lookup
      const existing = await prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' } },
      });

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            phone,
            isPreloaded: true,
            preloadedAt: new Date(),
            preloadedBy: 'csv-import-script',
          },
        });
        updated++;
        console.log(`  🔄 ${username} (actualizado)`);
      } else {
        await prisma.user.create({
          data: {
            username,
            phone,
            role: UserRole.CLIENT,
            savedTargetUsername: username,
            isPreloaded: true,
            preloadedAt: new Date(),
            preloadedBy: 'csv-import-script',
          },
        });
        created++;
        console.log(`  ✨ ${username} (nuevo)`);
      }
    } catch (err: any) {
      errors.push({ row: i + 1, raw: rawUsername, reason: err.message });
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Nuevos:        ${created}`);
  console.log(`🔄 Actualizados:  ${updated}`);
  console.log(`⚠️  Errores:       ${errors.length}`);
  if (errors.length > 0) {
    console.log('');
    console.log('Errores:');
    errors.forEach((e) => console.log(`  fila ${e.row} ("${e.raw}"): ${e.reason}`));
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FATAL:', err);
  prisma.$disconnect();
  process.exit(1);
});
