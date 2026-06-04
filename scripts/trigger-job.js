#!/usr/bin/env node
/**
 * Trigger any job type for testing.
 *
 * Usage:
 *   node scripts/trigger-job.js load <username> <amount>
 *   node scripts/trigger-job.js withdraw <username> <amount>
 *   node scripts/trigger-job.js create <username>
 *   node scripts/trigger-job.js password <username> <newPassword>
 *
 * Examples:
 *   node scripts/trigger-job.js load fulanito 500
 *   node scripts/trigger-job.js withdraw fulanito 200
 *   node scripts/trigger-job.js create claudio
 *   node scripts/trigger-job.js password fulanito nueva123
 */

const path = require('path');
process.chdir(path.join(__dirname, '..', 'apps', 'backend-api'));

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PANEL_ID = '6a6a6b21-c731-47cb-98a1-21777edb965e';

const [,, type, targetUsername, extra] = process.argv;

async function main() {
  if (!type || !targetUsername) {
    console.log('Uso:');
    console.log('  node scripts/trigger-job.js load <username> <amount>');
    console.log('  node scripts/trigger-job.js withdraw <username> <amount>');
    console.log('  node scripts/trigger-job.js create <username>');
    console.log('  node scripts/trigger-job.js password <username> <newPassword>');
    process.exit(1);
  }

  // Get a user to attach the request to
  const user = await prisma.user.findFirst({ where: { role: 'CLIENT' }, orderBy: { createdAt: 'desc' } });
  if (!user) { console.error('No CLIENT user found in DB'); process.exit(1); }

  let jobData;

  switch (type) {
    case 'load': {
      const amount = parseFloat(extra) || 500;
      const request = await prisma.request.create({
        data: { userId: user.id, targetUsername, amount, status: 'APPROVED', manuallyApproved: true },
      });
      jobData = {
        requestId: request.id,
        status: 'QUEUED',
        panelId: PANEL_ID,
        targetUsername,
        amount,
        type: 'LOAD_CREDITS',
      };
      console.log(`LOAD_CREDITS: ${amount} fichas para "${targetUsername}"`);
      break;
    }

    case 'withdraw': {
      const amount = parseFloat(extra) || 200;
      const request = await prisma.request.create({
        data: { userId: user.id, targetUsername, amount, status: 'APPROVED', manuallyApproved: true },
      });
      jobData = {
        requestId: request.id,
        status: 'QUEUED',
        panelId: PANEL_ID,
        targetUsername,
        amount,
        type: 'WITHDRAW_CHIPS',
      };
      console.log(`WITHDRAW_CHIPS: ${amount} fichas de "${targetUsername}"`);
      break;
    }

    case 'create': {
      const request = await prisma.request.create({
        data: { userId: user.id, targetUsername, amount: 0, status: 'APPROVED', manuallyApproved: true },
      });
      jobData = {
        requestId: request.id,
        status: 'QUEUED',
        panelId: PANEL_ID,
        targetUsername,
        amount: 0,
        type: 'CREATE_USER',
      };
      console.log(`CREATE_USER: crear usuario "${targetUsername}" en el panel`);
      break;
    }

    case 'password': {
      const newPassword = extra || 'nueva123';
      const request = await prisma.request.create({
        data: { userId: user.id, targetUsername, amount: 0, status: 'APPROVED', manuallyApproved: true },
      });
      jobData = {
        requestId: request.id,
        status: 'QUEUED',
        panelId: PANEL_ID,
        targetUsername,
        amount: 0,
        type: 'CHANGE_PASSWORD',
        newPassword,
      };
      console.log(`CHANGE_PASSWORD: cambiar pass de "${targetUsername}" a "${newPassword}"`);
      break;
    }

    default:
      console.error(`Tipo desconocido: "${type}". Usa: load, withdraw, create, password`);
      process.exit(1);
  }

  const job = await prisma.job.create({ data: jobData });
  console.log(`Job creado: ${job.id} | ${job.type} | QUEUED`);
  console.log('El dispatcher lo va a agarrar en segundos...');

  // Poll job status
  console.log('\nEsperando resultado...');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const updated = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, error: true, result: true } });
    if (updated.status === 'COMPLETED') {
      console.log(`\n✅ JOB COMPLETADO`);
      if (updated.result) console.log('Resultado:', updated.result);
      break;
    }
    if (updated.status === 'FAILED') {
      console.log(`\n❌ JOB FALLIDO`);
      console.log('Error:', updated.error);
      break;
    }
    process.stdout.write('.');
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
