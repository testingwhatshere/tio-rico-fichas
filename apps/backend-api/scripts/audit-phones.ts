import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const preloadedSample = await p.user.findMany({
    where: { isPreloaded: true },
    select: { username: true, phone: true },
    take: 5,
  });
  console.log('PRELOADED users (5 muestras):');
  preloadedSample.forEach((u) => console.log(`  ${u.username}: phone="${u.phone}"`));
  console.log('');
  const nonPreloaded = await p.user.findMany({
    where: { isPreloaded: false, role: 'CLIENT', phone: { not: null } },
    select: { username: true, phone: true },
    take: 5,
  });
  console.log('CLIENT no-preloaded users (5 muestras):');
  nonPreloaded.forEach((u) => console.log(`  ${u.username}: phone="${u.phone}"`));
  console.log('');
  // Check si hay phones con +
  const withPlus = await p.$queryRawUnsafe(
    `SELECT COUNT(*) as c FROM "User" WHERE phone LIKE '+%'`,
  );
  const withoutPlus = await p.$queryRawUnsafe(
    `SELECT COUNT(*) as c FROM "User" WHERE phone IS NOT NULL AND phone NOT LIKE '+%'`,
  );
  console.log('Phones con "+":', withPlus);
  console.log('Phones sin "+":', withoutPlus);
  await p.$disconnect();
}
main();
