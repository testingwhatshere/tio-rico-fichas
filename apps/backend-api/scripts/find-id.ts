import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const u = await p.user.findUnique({ where: { id: 'f2cf7186-b0b0-42ec-bdde-89a19241f170' } });
  console.log('User con id f2cf7186:', u);
  await p.$disconnect();
}
main();
