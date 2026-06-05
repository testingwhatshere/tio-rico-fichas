import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Tomar un user random de los importados
  const u = await p.user.findFirst({
    where: { isPreloaded: true },
    select: { id: true, username: true, phone: true },
  });
  console.log('User en mi DB:', u);
  // Ahora hacer login al backend deployed y comparar id
  const res = await fetch('https://tiorico-api.onrender.com/api/auth/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u?.username, phone: u?.phone }),
  });
  const body = await res.json();
  console.log('Backend response status:', res.status);
  console.log('Backend response user:', body.user);
  console.log('IDs coinciden:', body.user?.id === u?.id);
  await p.$disconnect();
}
main();
