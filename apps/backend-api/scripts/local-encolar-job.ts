// Encola un job de prueba en la base LOCAL para probar la extensión contra el panel
// real con la cuenta de prueba. Se niega a correr contra cualquier base que no sea
// localhost.
//
// Uso (desde apps/backend-api):
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5435/tio_rico_fichas \
//     bun run scripts/local-encolar-job.ts carga fulanito 100
//   ... descarga fulanito 100
//   ... ver            (últimos jobs y su resultado)

import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1):/.test(url)) {
  console.error(`NO: DATABASE_URL no es local (${url.split('@')[1] || 'vacía'}). Este script es sólo para la base de prueba.`);
  process.exit(1);
}

const prisma = new PrismaClient();
const PANEL_ID = process.env.PANEL_ID || 'e2e-panel-1';

async function main() {
  const [accion, usuario, monto] = process.argv.slice(2);
  if (accion === 'ver' || !accion) {
    const jobs = await prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    for (const j of jobs) {
      console.log(`${j.createdAt.toISOString().slice(11, 19)}  ${j.type.padEnd(14)} ${String(j.targetUsername).padEnd(12)} $${j.amount}  ${j.status.padEnd(10)} ${j.error || (j.result ? JSON.stringify(j.result).slice(0, 120) : '')}`);
    }
    return;
  }
  const type = accion === 'descarga' ? 'WITHDRAW_CHIPS' : accion === 'carga' ? 'LOAD_CREDITS' : null;
  if (!type || !usuario || !Number(monto)) {
    console.error('Uso: carga|descarga <usuario> <monto>  |  ver');
    process.exit(1);
  }
  const job = await prisma.job.create({
    data: { type, targetUsername: usuario, amount: Number(monto), panelId: PANEL_ID, status: 'QUEUED' },
  });
  console.log(`Encolado ${type} ${usuario} $${monto} (job ${job.id}). El backend lo despacha en menos de 1 min.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
