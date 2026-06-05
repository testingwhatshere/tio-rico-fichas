import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const columns: any = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'User' AND column_name IN ('isPreloaded', 'preloadedAt', 'preloadedBy')`,
  );
  console.log('Columnas isPreloaded/preloadedAt/preloadedBy en tabla User:');
  console.log(columns);
  console.log('');
  const all: any = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'User' ORDER BY ordinal_position`,
  );
  console.log('TODAS las columnas de User:', all.map((c: any) => c.column_name).join(', '));
  await prisma.$disconnect();
}
main();
