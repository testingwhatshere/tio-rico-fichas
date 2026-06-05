/**
 * Strip "+" (and other non-digit chars) from all User.phone values.
 * Idempotent: rows already digit-only stay unchanged.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const before: any = await prisma.$queryRawUnsafe(
    `SELECT id, username, phone FROM "User" WHERE phone IS NOT NULL AND phone ~ '[^0-9]'`,
  );
  console.log(`Filas con caracteres no-dígito en phone: ${before.length}`);
  before.forEach((u: any) => console.log(`  ${u.username}: "${u.phone}"`));

  if (before.length === 0) {
    console.log('Nada que normalizar.');
    await prisma.$disconnect();
    return;
  }

  // Normalize: strip everything except digits
  for (const row of before) {
    const cleaned = row.phone.replace(/\D/g, '');
    if (cleaned !== row.phone) {
      try {
        await prisma.user.update({
          where: { id: row.id },
          data: { phone: cleaned },
        });
        console.log(`  ✓ ${row.username}: "${row.phone}" → "${cleaned}"`);
      } catch (err: any) {
        // If the cleaned phone collides with another user, log and skip.
        console.log(`  ✗ ${row.username}: ${err.message}`);
      }
    }
  }

  await prisma.$disconnect();
}
main();
