/**
 * Re-normalize ALL User.phone values to canonical Argentine format:
 * "549<area><number>". Skips rows that are already canonical or have no phone.
 *
 * Safe to run multiple times (idempotent).
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function canonicalArPhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) return '549' + digits.slice(2);
  if (digits.startsWith('9')) return '54' + digits;
  return '549' + digits;
}

async function main() {
  const all = await prisma.user.findMany({
    where: { phone: { not: null } },
    select: { id: true, username: true, phone: true },
  });
  console.log(`Total users con phone: ${all.length}`);

  let changed = 0;
  let alreadyCanonical = 0;
  let collisions = 0;

  for (const u of all) {
    const canonical = canonicalArPhone(u.phone!);
    if (canonical === u.phone) {
      alreadyCanonical++;
      continue;
    }
    // Avoid colliding with another user that already has the canonical form.
    const collision = await prisma.user.findFirst({
      where: { phone: canonical, NOT: { id: u.id } },
    });
    if (collision) {
      collisions++;
      console.log(`  ⚠️  ${u.username}: "${u.phone}" → "${canonical}" colisión con "${collision.username}"`);
      continue;
    }
    try {
      await prisma.user.update({ where: { id: u.id }, data: { phone: canonical } });
      changed++;
      // Log only the first 20 to keep output sane
      if (changed <= 20) console.log(`  ✓ ${u.username}: "${u.phone}" → "${canonical}"`);
    } catch (err: any) {
      console.log(`  ✗ ${u.username}: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Ya canónicos: ${alreadyCanonical}`);
  console.log(`Cambiados:    ${changed}`);
  console.log(`Colisiones:   ${collisions}`);
  await prisma.$disconnect();
}
main();
