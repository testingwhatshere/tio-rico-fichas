import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const u = await p.user.findFirst({ where: { username: { equals: 'testdiagnostic_1780609419', mode: 'insensitive' } } });
  console.log('User en DB:', u);
  await p.$disconnect();
}
main();
