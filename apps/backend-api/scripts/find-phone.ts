import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const u = await p.user.findMany({ where: { phone: { contains: '99999999' } }, select: { id: true, username: true, phone: true } });
  console.log('Users con phone contiene "99999999" en mi DB:', u);
  await p.$disconnect();
}
main();
