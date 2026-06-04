/**
 * Trigger a test job for the bot extension (production-safe).
 *
 * Creates an APPROVED request + QUEUED job in the DB.
 * The backend's periodic dispatch retry (every 60s) will pick it up
 * and push it to the bot via WebSocket automatically.
 *
 * Usage:
 *   cd apps/backend-api && node ../../scripts/trigger-test-job.mjs
 *   cd apps/backend-api && node ../../scripts/trigger-test-job.mjs --username pepe --amount 5000
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Parse args
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const targetUsername = getArg('username', 'fulanito');
const amount = Number(getArg('amount', '1000'));

async function main() {
  console.log(`\n=== Trigger Test Job ===`);
  console.log(`Usuario:  ${targetUsername}`);
  console.log(`Monto:    $${amount.toLocaleString('es-AR')}\n`);

  // 1. Find user
  let user = await prisma.user.findFirst({
    where: { savedTargetUsername: targetUsername },
  });
  if (!user) {
    user = await prisma.user.findFirst({ where: { role: 'CLIENT' } });
  }
  if (!user) {
    console.error('No hay usuarios CLIENT en la DB.');
    process.exit(1);
  }
  console.log(`Usuario DB: ${user.username || user.email} (panelId: ${user.panelId || 'ninguno'})`);

  // 2. Find chat
  const chat = await prisma.chat.findFirst({ where: { userId: user.id } });

  // 3. Create APPROVED request
  const request = await prisma.request.create({
    data: {
      userId: user.id,
      targetUsername,
      amount,
      status: 'APPROVED',
      approvedById: null,
      manuallyApproved: true,
      approvedAt: new Date(),
      ...(chat ? { chat: { connect: { id: chat.id } } } : {}),
    },
  });
  console.log(`Request creada: ${request.id} (APPROVED)`);

  // 4. Create QUEUED job
  const job = await prisma.job.create({
    data: {
      requestId: request.id,
      status: 'QUEUED',
      panelId: user.panelId || null,
      targetUsername,
      amount,
    },
  });
  console.log(`Job creado:     ${job.id} (QUEUED)`);

  await prisma.$disconnect();

  console.log(`\n=== Listo! ===`);
  console.log(`El backend va a despachar el job al bot en el proximo ciclo (~60s max).`);
  console.log(`Mira los logs del backend para confirmar el dispatch.`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  prisma.$disconnect();
  process.exit(1);
});
