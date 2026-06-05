import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const last = await p.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, username: true, createdAt: true } });
  console.log('5 users más recientes en mi conexión:');
  last.forEach(u => console.log(`  ${u.createdAt.toISOString()} | ${u.username} | id=${u.id}`));
  console.log('');
  const target = await p.user.findUnique({ where: { id: '5ba2cf70-10a8-4c2a-8fae-accb107dd22e' } });
  console.log('Target user id:', target);
  console.log('');
  // Verify connection target
  const conn: any = await p.$queryRawUnsafe(`SELECT current_database() as db, inet_server_addr()::text as addr`);
  console.log('Conexión:', conn);
  await p.$disconnect();
}
main();
