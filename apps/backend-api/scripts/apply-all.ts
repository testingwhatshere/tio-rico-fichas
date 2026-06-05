/**
 * Single script: applies schema + imports BOTH CSVs to Neon.
 * Reads from .env (Neon URL).
 */
import { PrismaClient, UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const prisma = new PrismaClient();

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else { q = !q; }
      continue;
    }
    if (c === ',' && !q) { cells.push(cur); cur = ''; } else { cur += c; }
  }
  cells.push(cur);
  return cells;
}

function normUser(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function canonAr(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('549')) return d;
  if (d.startsWith('54') && d.length >= 11 && d.length <= 13) return '549' + d.slice(2);
  if (d.startsWith('9') && d.length >= 10 && d.length <= 12) return '54' + d;
  if (d.length >= 10 && d.length <= 11 && !d.startsWith('0')) return '549' + d;
  return d;
}

async function main() {
  const conn: any = await prisma.$queryRawUnsafe(`SELECT current_database() as db`);
  console.log('Conectado a DB:', conn[0].db);
  if (conn[0].db !== 'neondb') {
    console.error('ERROR: no estoy en Neon. Abortando.');
    process.exit(1);
  }

  console.log('\n1. Aplicando schema (ALTER TABLE)...');
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPreloaded" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preloadedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preloadedBy" TEXT`);
  console.log('   ✓ Columnas listas');

  const files = [
    path.join(os.homedir(), 'Downloads', 'contacts.csv'),
    path.join(os.homedir(), 'Downloads', 'contacts (1).csv'),
    path.join(os.homedir(), 'Downloads', 'contacts (2).csv'),
  ];

  let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

  for (const file of files) {
    if (!fs.existsSync(file)) { console.log(`\n[skip] ${file} no existe`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const header = (lines[0] || '').toLowerCase();
    if (!header.includes('first name') || !header.includes('phone')) {
      console.log(`[skip] ${file}: header no es Google Contacts`);
      continue;
    }
    const headerCells = splitCsv(lines[0]).map(c => c.toLowerCase());
    const phoneCol = headerCells.findIndex(c => /phone\s*1\s*-\s*value/.test(c));
    console.log(`\n📂 ${path.basename(file)}: ${lines.length - 1} filas, phone col idx ${phoneCol}`);

    let created = 0, updated = 0, errors = 0;
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;
      const cells = splitCsv(raw);
      const username = normUser(cells[0] || '');
      const phone = canonAr(cells[phoneCol] || '');
      if (!username || username.length < 3 || !phone || phone.length < 7) { errors++; continue; }
      try {
        const phoneOwner = await prisma.user.findUnique({ where: { phone } });
        if (phoneOwner && phoneOwner.username?.toLowerCase() !== username) { errors++; continue; }
        const existing = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } });
        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { phone, isPreloaded: true, preloadedAt: new Date(), preloadedBy: 'csv-import' },
          });
          updated++;
        } else {
          await prisma.user.create({
            data: {
              username, phone, role: UserRole.CLIENT,
              savedTargetUsername: username,
              isPreloaded: true, preloadedAt: new Date(), preloadedBy: 'csv-import',
            },
          });
          created++;
        }
      } catch { errors++; }
    }
    console.log(`   ✓ nuevos=${created}, actualizados=${updated}, errores=${errors}`);
    totalCreated += created; totalUpdated += updated; totalErrors += errors;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TOTAL nuevos: ${totalCreated}`);
  console.log(`TOTAL actualizados: ${totalUpdated}`);
  console.log(`TOTAL errores: ${totalErrors}`);

  const preloadedCount = await prisma.user.count({ where: { isPreloaded: true } });
  console.log(`Preloaded en Neon ahora: ${preloadedCount}`);
  await prisma.$disconnect();
}
main();
