// Local E2E bootstrap. Creates a CLIENT user, an OPERATOR user, and an active wallet.
// Run with: dotenv -e .env.local -- bun run scripts/e2e-bootstrap.ts
// (or override DATABASE_URL inline.)

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log(`Bootstrapping E2E data into ${process.env.DATABASE_URL?.split('@')[1]}`);

  const passwordHash = await bcrypt.hash('test1234', 10);

  const operator = await prisma.user.upsert({
    where: { email: 'op@e2e.local' },
    update: {},
    create: {
      email: 'op@e2e.local',
      password: passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log(`OPERATOR: ${operator.email} (${operator.id})`);

  const client = await prisma.user.upsert({
    where: { username: 'e2e_user' },
    update: {},
    create: {
      username: 'e2e_user',
      phone: '+5491100000001',
      password: passwordHash,
      role: 'CLIENT',
      isActive: true,
      savedTargetUsername: 'nahuebot',
    },
  });
  console.log(`CLIENT: ${client.username} (${client.id})`);

  // Active wallet for payment instructions
  const wallet = await prisma.paymentConfig.upsert({
    where: { id: 'e2e-wallet-1' },
    update: { isActive: true, isSelected: true },
    create: {
      id: 'e2e-wallet-1',
      type: 'MERCADOPAGO',
      label: 'MP E2E',
      holderName: 'E2E Test',
      details: { alias: 'e2e.test.mp', cvu: '0000003100000000000001' },
      isActive: true,
      isSelected: true,
      amountLimit: 1_000_000,
      accumulatedAmount: 0,
    },
  });
  console.log(`WALLET: ${wallet.label} (${wallet.id})`);

  // Panel for the mock bot
  const panel = await prisma.panel.upsert({
    where: { id: 'e2e-panel-1' },
    update: {},
    create: { id: 'e2e-panel-1', name: 'E2E Panel', isActive: true },
  });
  console.log(`PANEL: ${panel.name} (${panel.id})`);

  // Settings: support phone
  await prisma.setting.upsert({
    where: { key: 'supportPhoneNumber' },
    update: { value: '+541159996996' },
    create: { key: 'supportPhoneNumber', value: '+541159996996' },
  });

  console.log('\nE2E bootstrap done.');
  console.log('  Login operator:  op@e2e.local / test1234');
  console.log('  Login client:    e2e_user / test1234 (phone: +5491100000001)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
