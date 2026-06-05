import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Aplicando ALTER TABLE manualmente...');
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPreloaded" BOOLEAN NOT NULL DEFAULT false`,
    );
    console.log('✓ isPreloaded agregado');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preloadedAt" TIMESTAMP(3)`,
    );
    console.log('✓ preloadedAt agregado');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preloadedBy" TEXT`,
    );
    console.log('✓ preloadedBy agregado');

    const verify: any = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name LIKE '%reload%'`,
    );
    console.log('Verificación:', verify);
  } catch (err: any) {
    console.error('ERROR:', err.message);
  }
  await prisma.$disconnect();
}
main();
