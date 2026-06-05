import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const candidate = 'f2cf7186-b0b0-42ec-bdde-89a19241f170';
  const u = await p.user.findUnique({ where: { id: candidate } });
  if (u) {
    console.log(`User ${candidate} EXISTE:`, u);
  } else {
    console.log(`User ${candidate} NO EXISTE en DB local`);
  }
  // ¿Existe el e2e_user? si sí, confirma misma DB
  const e2e = await p.user.findFirst({ where: { username: 'e2e_user' } });
  console.log('e2e_user existe:', e2e ? 'SÍ' : 'NO');
  await p.$disconnect();
}
main();
