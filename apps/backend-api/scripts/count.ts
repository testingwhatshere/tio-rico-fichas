import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const c = await p.user.count();
  const recent = await p.user.findMany({ orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, username: true, phone: true, createdAt: true } });
  console.log('Total users:', c);
  console.log('Most recent:', recent);
  await p.$disconnect();
}
main();
