import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const c = await p.user.count({ where: { isPreloaded: true } });
  console.log('Total preloaded users en DB:', c);
  await p.$disconnect();
}
main();
