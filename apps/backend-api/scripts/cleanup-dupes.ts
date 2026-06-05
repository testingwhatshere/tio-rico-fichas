import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Find all rows where there are case-insensitive duplicate usernames
  const dupes: any = await p.$queryRawUnsafe(`
    SELECT LOWER(username) as norm, COUNT(*) as c
    FROM "User"
    WHERE username IS NOT NULL
    GROUP BY LOWER(username)
    HAVING COUNT(*) > 1
  `);
  console.log(`Casos de username duplicado (case-insensitive): ${dupes.length}`);

  let removed = 0;
  for (const d of dupes) {
    const users = await p.user.findMany({
      where: { username: { equals: d.norm, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
    });
    // Keep the preloaded one; delete non-preloaded ones (these are test/fake rows)
    const preloaded = users.find(u => u.isPreloaded);
    const nonPreloaded = users.filter(u => !u.isPreloaded);
    if (preloaded && nonPreloaded.length > 0) {
      for (const u of nonPreloaded) {
        try {
          await p.user.delete({ where: { id: u.id } });
          removed++;
        } catch (err: any) {
          console.log(`No pude borrar ${u.id} (${u.username}): ${err.message?.slice(0, 80)}`);
        }
      }
    }
  }
  console.log(`Borrados ${removed} duplicados non-preloaded.`);
  // Check ana2t state
  const ana = await p.user.findMany({ where: { username: { equals: 'ana2t', mode: 'insensitive' } } });
  console.log(`\nana2t ahora: ${ana.length} fila(s)`);
  ana.forEach(u => console.log(`  ${u.id} | preloaded=${u.isPreloaded} | phone=${u.phone}`));
  await p.$disconnect();
}
main();
