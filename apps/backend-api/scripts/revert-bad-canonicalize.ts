/**
 * Undo the 9 erroneous changes from canonicalize-phones.ts where it added
 * "549" to non-Argentine numbers (Spain, Chile, Uruguay, Paraguay, etc.).
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// username → original phone (pre-erroneous-canonicalization)
const REVERTS: Array<[string, string]> = [
  ['raul26d', '543564335930'],
  ['principalm', '541164167058'],
  ['azul94abr', '34621034094'],
  ['23luciano23', '59895408559'],
  ['armando88jun', '56931396788'],
  ['funes55t', '555496992865'],
  ['rolando77t', '595987404377'],
  ['ariel79', '595984821432'],
  ['isidro8', '554588403078'],
];

async function main() {
  for (const [username, originalPhone] of REVERTS) {
    const u = await prisma.user.findFirst({ where: { username } });
    if (!u) {
      console.log(`  ⚠️  ${username}: no encontrado`);
      continue;
    }
    // Sanity: avoid colliding with someone else.
    const collision = await prisma.user.findFirst({
      where: { phone: originalPhone, NOT: { id: u.id } },
    });
    if (collision) {
      console.log(`  ⚠️  ${username}: "${originalPhone}" colisiona con "${collision.username}"`);
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { phone: originalPhone },
    });
    console.log(`  ✓ ${username}: "${u.phone}" → "${originalPhone}"`);
  }
  await prisma.$disconnect();
}
main();
