import { PrismaClient, UserRole } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Borrar todos los users creados por test (phone con 9999... wrong)
  const fakes = await p.user.findMany({
    where: { OR: [{ phone: '5499999999999' }, { phone: { startsWith: '9999' } }, { phone: '9999999' }] },
  });
  console.log(`Users fake encontrados: ${fakes.length}`);
  for (const u of fakes) {
    console.log(`  Borrando: ${u.username} (${u.phone})`);
    await p.user.delete({ where: { id: u.id } });
  }
  // Borrar tests testdiagnostic_*, testdup*, testfake*, e2e_dup_*
  const testPatterns = await p.user.findMany({
    where: { OR: [
      { username: { startsWith: 'testdiagnostic_' } },
      { username: { startsWith: 'testdup' } },
      { username: { startsWith: 'testfake' } },
      { username: { startsWith: 'e2e_dup_' } },
    ]},
  });
  console.log(`\nUsers con patrón test: ${testPatterns.length}`);
  for (const u of testPatterns) {
    console.log(`  Borrando: ${u.username}`);
    await p.user.delete({ where: { id: u.id } });
  }
  console.log('\n--- Re-import ana2t correctly ---');
  const ana = await p.user.findFirst({ where: { username: 'ana2t' } });
  if (!ana) {
    await p.user.create({
      data: {
        username: 'ana2t',
        phone: '5493454111164',
        role: UserRole.CLIENT,
        savedTargetUsername: 'ana2t',
        isPreloaded: true,
        preloadedAt: new Date(),
        preloadedBy: 'csv-import',
      },
    });
    console.log('  ✓ ana2t creado preloaded');
  } else {
    await p.user.update({
      where: { id: ana.id },
      data: { phone: '5493454111164', isPreloaded: true, preloadedAt: new Date(), preloadedBy: 'csv-import' },
    });
    console.log('  ✓ ana2t actualizado preloaded');
  }
  const count = await p.user.count({ where: { isPreloaded: true } });
  console.log(`\nTotal preloaded en Neon: ${count}`);
  await p.$disconnect();
}
main();
