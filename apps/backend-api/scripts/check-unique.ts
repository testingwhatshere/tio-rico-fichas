import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Check actual indexes on User table
  const indexes: any = await p.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'User' ORDER BY indexname`,
  );
  console.log('Indexes en User:');
  indexes.forEach((i: any) => console.log(`  ${i.indexname}: ${i.indexdef}`));
  console.log('');
  // Try direct create with duplicate phone
  console.log('Intentando crear user con phone duplicado de ana2t (5493454111164)...');
  try {
    const u = await p.user.create({
      data: {
        username: 'test_dup_check_xyz_' + Date.now(),
        phone: '5493454111164',
        role: 'CLIENT',
      },
    });
    console.log('❌ BUG: se creó user duplicado:', u.id);
    await p.user.delete({ where: { id: u.id } });
  } catch (err: any) {
    console.log('✓ Falló como esperado:', err.code, err.message?.slice(0, 200));
  }
  await p.$disconnect();
}
main();
