import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const all: any = await p.$queryRawUnsafe(
    `SELECT id, username, phone, "isPreloaded" FROM "User" WHERE LOWER(username) = 'ana2t' ORDER BY "createdAt"`
  );
  console.log(`Users con username 'ana2t' (case-insensitive): ${all.length}`);
  all.forEach((u: any) => console.log(`  ${u.id} | username="${u.username}" | phone="${u.phone}" | preloaded=${u.isPreloaded}`));
  const target = await p.user.findUnique({ where: { id: 'f2cf7186-b0b0-42ec-bdde-89a19241f170' } });
  console.log('\nf2cf7186 existe?:', target);
  await p.$disconnect();
}
main();
