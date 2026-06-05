import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // 1. Inspect fake user created during audit
  const fake = await p.user.findFirst({ where: { username: 'testfake999random' } });
  console.log('Fake user creado:', fake);
  console.log('');
  // 2. Inspect ana2t to compare
  const ana = await p.user.findFirst({ where: { username: { equals: 'ana2t', mode: 'insensitive' } } });
  console.log('ana2t en DB:', ana);
  console.log('');
  // 3. Search any user with phone "5493454111164"
  const byPhone = await p.user.findMany({ where: { phone: '5493454111164' } });
  console.log(`Users con phone "5493454111164": ${byPhone.length}`);
  byPhone.forEach(u => console.log(`  ${u.username}: ${u.phone}`));
  // 4. Clean up the fake user
  if (fake) {
    await p.user.delete({ where: { id: fake.id } });
    console.log('Fake user borrado.');
  }
  await p.$disconnect();
}
main();
