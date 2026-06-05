import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const list = await p.user.findMany({
    where: { username: { equals: 'ana2t', mode: 'insensitive' } },
    select: { id: true, username: true, phone: true, isPreloaded: true, createdAt: true },
  });
  console.log(`Encontrados ${list.length} users con username 'ana2t':`);
  list.forEach((u) => console.log(`  ${u.id} | username="${u.username}" | phone="${u.phone}" | preloaded=${u.isPreloaded} | created=${u.createdAt.toISOString()}`));
  await p.$disconnect();
}
main();
