import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  console.log('Búsqueda case-insensitive con findFirst:');
  const r1 = await p.user.findFirst({ where: { username: { equals: 'ana2t', mode: 'insensitive' } } });
  console.log('  ana2t →', r1 ? `OK (id=${r1.id})` : 'NULL');
  const r2 = await p.user.findFirst({ where: { username: { equals: 'ANA2T', mode: 'insensitive' } } });
  console.log('  ANA2T →', r2 ? `OK (id=${r2.id})` : 'NULL');
  const r3 = await p.user.findFirst({ where: { username: { equals: 'Ana2t', mode: 'insensitive' } } });
  console.log('  Ana2t →', r3 ? `OK (id=${r3.id})` : 'NULL');
  const r4 = await p.user.findUnique({ where: { username: 'ana2t' } });
  console.log('  ana2t (findUnique exact) →', r4 ? `OK (id=${r4.id})` : 'NULL');
  await p.$disconnect();
}
main();
