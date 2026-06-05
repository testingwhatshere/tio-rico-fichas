import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const u = await p.user.findFirst({
    where: { username: { equals: 'ana2t', mode: 'insensitive' } },
    select: { id: true, username: true, phone: true, isPreloaded: true, isActive: true },
  });
  console.log('ana2t:', u);
  await p.$disconnect();
}
main();
