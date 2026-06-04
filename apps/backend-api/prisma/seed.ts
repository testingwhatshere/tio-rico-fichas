import { PrismaClient, UserRole, RequestStatus, JobStatus, ChatStatus, MessageType, TransactionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_SETTINGS } from '../src/settings/dto';

const prisma = new PrismaClient();

// ==========================================
// CONFIGURATION
// ==========================================
const SEED_MODE = process.env.SEED_MODE || 'demo';
const IS_PRODUCTION = SEED_MODE === 'production';

const config = {
  adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@platform.com',
  adminPassword: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  operatorEmail: process.env.SEED_OPERATOR_EMAIL || 'operator@platform.com',
  operatorPassword: process.env.SEED_OPERATOR_PASSWORD || 'operator123',
  panelName: process.env.SEED_PANEL_NAME || 'Panel Principal',
};

// ==========================================
// ESSENTIAL DATA (always runs)
// ==========================================

async function seedEssentials() {
  console.log(`\n🌱 Seeding essentials (mode: ${SEED_MODE})...\n`);

  // --- System User ---
  console.log('Creating system user...');
  await prisma.user.upsert({
    where: { username: 'system' },
    update: {},
    create: {
      username: 'system',
      role: UserRole.ADMIN,
      isActive: false,
    },
  });
  console.log('✅ System user ready');

  // --- Admin User ---
  console.log('Creating admin user...');
  const adminPassword = await bcrypt.hash(config.adminPassword, 10);
  await prisma.user.upsert({
    where: { email: config.adminEmail },
    update: {},
    create: {
      email: config.adminEmail,
      password: adminPassword,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });
  console.log(`✅ Admin ready: ${config.adminEmail}`);

  // --- Operator (User + Operator record, separate upserts for idempotency) ---
  console.log('Creating operator...');
  const operatorPassword = await bcrypt.hash(config.operatorPassword, 10);
  const operatorUser = await prisma.user.upsert({
    where: { email: config.operatorEmail },
    update: {},
    create: {
      email: config.operatorEmail,
      password: operatorPassword,
      role: UserRole.SENIOR_OPERATOR,
      isActive: true,
    },
  });

  const existingOperator = await prisma.operator.findUnique({
    where: { userId: operatorUser.id },
  });
  if (!existingOperator) {
    await prisma.operator.create({
      data: {
        userId: operatorUser.id,
        displayName: 'Operador',
        isAvailable: true,
      },
    });
  }
  console.log(`✅ Operator ready: ${config.operatorEmail}`);

  // --- Panel ---
  console.log('Creating panel...');
  await prisma.panel.upsert({
    where: { name: config.panelName },
    update: {},
    create: { name: config.panelName },
  });
  console.log(`✅ Panel ready: ${config.panelName}`);

  // --- All System Settings ---
  console.log('Creating system settings...');
  let settingsCreated = 0;
  for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
    const result = await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: defaultValue },
    });
    if (result.key === key) settingsCreated++;
  }
  console.log(`✅ ${settingsCreated} settings ready`);

  // --- Example Wallet (inactive placeholder) ---
  console.log('Creating example wallet...');
  await prisma.paymentConfig.upsert({
    where: { id: 'seed-example-wallet' },
    update: {},
    create: {
      id: 'seed-example-wallet',
      type: 'MERCADOPAGO',
      label: '[EJEMPLO] Configurar billetera real',
      holderName: 'CONFIGURAR ANTES DE USAR',
      details: {
        alias: 'CONFIGURAR',
        cvu: '0000000000000000000000',
      },
      isActive: false,
      isSelected: false,
    },
  });
  console.log('✅ Example wallet ready (inactive — configure before use)');
}

// ==========================================
// DEMO DATA (only in demo mode)
// ==========================================

async function seedDemoData() {
  console.log('\n🎭 Seeding demo data...\n');

  // --- Extra Panels ---
  console.log('Creating demo panels...');
  const panelA = await prisma.panel.upsert({
    where: { name: 'Panel A' },
    update: {},
    create: { name: 'Panel A' },
  });
  const panelB = await prisma.panel.upsert({
    where: { name: 'Panel B' },
    update: {},
    create: { name: 'Panel B' },
  });
  const panelC = await prisma.panel.upsert({
    where: { name: 'Panel C' },
    update: {},
    create: { name: 'Panel C' },
  });
  console.log(`✅ Demo panels: ${panelA.name}, ${panelB.name}, ${panelC.name}`);

  // --- Extra Operators ---
  console.log('Creating demo operators...');
  const operatorPassword = await bcrypt.hash('operator123', 10);

  const seniorUser = await prisma.user.upsert({
    where: { email: 'senior@tiorico.com' },
    update: {},
    create: {
      email: 'senior@tiorico.com',
      password: operatorPassword,
      role: UserRole.SENIOR_OPERATOR,
      isActive: true,
    },
  });
  const existingSeniorOp = await prisma.operator.findUnique({ where: { userId: seniorUser.id } });
  if (!existingSeniorOp) {
    await prisma.operator.create({
      data: { userId: seniorUser.id, displayName: 'Senior Operator', isAvailable: true },
    });
  }

  const op1User = await prisma.user.upsert({
    where: { email: 'operator1@tiorico.com' },
    update: {},
    create: {
      email: 'operator1@tiorico.com',
      password: operatorPassword,
      role: UserRole.OPERATOR,
      isActive: true,
    },
  });
  const existingOp1 = await prisma.operator.findUnique({ where: { userId: op1User.id } });
  if (!existingOp1) {
    await prisma.operator.create({
      data: { userId: op1User.id, displayName: 'Operator 1', isAvailable: true },
    });
  }
  console.log('✅ Demo operators created');

  // --- Client Users ---
  console.log('Creating demo clients...');
  const clientPassword = await bcrypt.hash('client123', 10);
  const clients: any[] = [];
  const clientUsernames = ['juan123', 'maria456', 'carlos789', 'lucia012', 'pedro345'];

  for (const username of clientUsernames) {
    const client = await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        password: clientPassword,
        role: UserRole.CLIENT,
        isActive: true,
        balance: Math.floor(Math.random() * 5000) + 1000,
      },
    });
    clients.push(client);
  }
  console.log(`✅ ${clients.length} demo clients created`);

  // --- Active Payment Wallets ---
  console.log('Creating demo wallets...');
  await prisma.paymentConfig.upsert({
    where: { id: 'demo-wallet-mp' },
    update: {},
    create: {
      id: 'demo-wallet-mp',
      type: 'MERCADOPAGO',
      label: 'MercadoPago Principal',
      holderName: 'Tio Rico Fichas',
      details: { alias: 'tiorico.fichas', cvu: '0000003100012345678901' },
      isActive: true,
      isSelected: true,
    },
  });
  await prisma.paymentConfig.upsert({
    where: { id: 'demo-wallet-cbu' },
    update: {},
    create: {
      id: 'demo-wallet-cbu',
      type: 'CBU',
      label: 'Banco Galicia',
      holderName: 'Juan Carlos Rodriguez',
      details: { cbu: '0070999830000012345678', alias: 'tiorico.banco' },
      isActive: true,
      isSelected: false,
    },
  });
  await prisma.paymentConfig.upsert({
    where: { id: 'demo-wallet-cvu' },
    update: {},
    create: {
      id: 'demo-wallet-cvu',
      type: 'CVU',
      label: 'Brubank',
      holderName: 'Maria Laura Gomez',
      details: { cvu: '0000168300000001234567', alias: 'tiorico.brubank' },
      isActive: true,
      isSelected: false,
    },
  });
  console.log('✅ Demo wallets created');

  // --- Sample Requests ---
  console.log('Creating demo requests...');

  const completedRequest = await prisma.request.create({
    data: {
      userId: clients[0].id,
      targetUsername: 'juan_gaming_123',
      amount: 5000,
      status: RequestStatus.COMPLETED,
      proofUrl: 'https://example.com/proofs/proof1.jpg',
      proofHash: 'hash123abc',
      validationScore: 0.95,
      manuallyApproved: false,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.job.create({
    data: {
      requestId: completedRequest.id,
      status: JobStatus.COMPLETED,
      result: JSON.stringify({ success: true, message: 'Credits loaded successfully' }),
      completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.transaction.create({
    data: {
      userId: clients[0].id,
      requestId: completedRequest.id,
      type: TransactionType.DEPOSIT,
      amount: 5000,
      balanceBefore: 1000,
      balanceAfter: 6000,
      description: 'Credit load from request',
    },
  });

  await prisma.request.create({
    data: {
      userId: clients[1].id,
      targetUsername: 'maria_play_456',
      amount: 3000,
      status: RequestStatus.VALIDATION_FAILED,
      proofUrl: 'https://example.com/proofs/proof2.jpg',
      proofHash: 'hash456def',
      validationScore: 0.45,
      validationError: 'Amount mismatch: Expected 3000, found 2800',
      manuallyApproved: false,
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
  });

  const processingRequest = await prisma.request.create({
    data: {
      userId: clients[2].id,
      targetUsername: 'carlos_pro_789',
      amount: 10000,
      status: RequestStatus.PROCESSING,
      proofUrl: 'https://example.com/proofs/proof3.jpg',
      proofHash: 'hash789ghi',
      validationScore: 0.88,
      manuallyApproved: false,
      approvedById: seniorUser.id,
      approvedAt: new Date(Date.now() - 5 * 60 * 1000),
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    },
  });

  await prisma.job.create({
    data: {
      requestId: processingRequest.id,
      status: JobStatus.PROCESSING,
    },
  });

  const failedRequest = await prisma.request.create({
    data: {
      userId: clients[3].id,
      targetUsername: 'lucia_gamer_012',
      amount: 2500,
      status: RequestStatus.FAILED,
      proofUrl: 'https://example.com/proofs/proof4.jpg',
      proofHash: 'hash012jkl',
      validationScore: 0.92,
      manuallyApproved: false,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  });

  await prisma.job.create({
    data: {
      requestId: failedRequest.id,
      status: JobStatus.FAILED,
      error: 'Session expired. Login required.',
      screenshot: '/screenshots/error-session-expired.png',
      completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  });

  await prisma.request.create({
    data: {
      userId: clients[4].id,
      targetUsername: 'pedro_player_345',
      amount: 1500,
      status: RequestStatus.PENDING_PROOF,
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    },
  });

  console.log('✅ Demo requests created');

  // --- Sample Chats & Messages ---
  console.log('Creating demo chats...');

  const systemUser = await prisma.user.findUnique({ where: { username: 'system' } });

  const chat1 = await prisma.chat.create({
    data: {
      userId: clients[0].id,
      status: ChatStatus.OPEN,
    },
  });

  await prisma.message.createMany({
    data: [
      {
        chatId: chat1.id,
        senderId: clients[0].id,
        content: 'Hola! Quiero cargar fichas',
        type: MessageType.USER,
        createdAt: new Date(Date.now() - 15 * 60 * 1000),
      },
      {
        chatId: chat1.id,
        senderId: systemUser!.id,
        content: '¡Hola! Para cargar fichas, indicame: 1) Tu usuario de juego 2) Monto a cargar',
        type: MessageType.SYSTEM,
        createdAt: new Date(Date.now() - 14 * 60 * 1000),
      },
      {
        chatId: chat1.id,
        senderId: clients[0].id,
        content: 'Usuario: juan_gaming_123, Monto: $5000',
        type: MessageType.USER,
        createdAt: new Date(Date.now() - 13 * 60 * 1000),
      },
      {
        chatId: chat1.id,
        senderId: systemUser!.id,
        content: 'Perfecto! Por favor enviá el comprobante de pago de $5000',
        type: MessageType.SYSTEM,
        createdAt: new Date(Date.now() - 12 * 60 * 1000),
      },
    ],
  });

  const chat2 = await prisma.chat.create({
    data: {
      userId: clients[1].id,
      operatorId: op1User.id,
      status: ChatStatus.ASSIGNED,
    },
  });

  await prisma.message.createMany({
    data: [
      {
        chatId: chat2.id,
        senderId: clients[1].id,
        content: 'Por qué fue rechazado mi pago?',
        type: MessageType.USER,
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      },
      {
        chatId: chat2.id,
        senderId: op1User.id,
        content: 'Hola! El monto del comprobante no coincide con lo solicitado. Podés enviar un nuevo comprobante?',
        type: MessageType.OPERATOR,
        createdAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    ],
  });

  console.log('✅ Demo chats created');

  // --- Audit Logs ---
  console.log('Creating demo audit logs...');
  await prisma.auditLog.createMany({
    data: [
      {
        operatorId: seniorUser.id,
        action: 'APPROVED',
        entityType: 'REQUEST',
        entityId: completedRequest.id,
        metadata: { note: 'Payment validated successfully' },
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        operatorId: seniorUser.id,
        action: 'TRIGGERED_BOT',
        entityType: 'JOB',
        entityId: completedRequest.id,
        metadata: { targetUsername: 'juan_gaming_123', amount: 5000 },
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ],
  });
  console.log('✅ Demo audit logs created');
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  await seedEssentials();

  if (!IS_PRODUCTION) {
    await seedDemoData();
  }

  // --- Summary ---
  const userCount = await prisma.user.count();
  const panelCount = await prisma.panel.count();
  const settingCount = await prisma.setting.count();
  const requestCount = await prisma.request.count();
  const chatCount = await prisma.chat.count();

  console.log('\n✅ Database seeded successfully!\n');
  console.log(`📊 Summary (mode: ${SEED_MODE}):`);
  console.log(`   Users: ${userCount}`);
  console.log(`   Panels: ${panelCount}`);
  console.log(`   Settings: ${settingCount}`);

  if (!IS_PRODUCTION) {
    console.log(`   Requests: ${requestCount}`);
    console.log(`   Chats: ${chatCount}`);
  }

  console.log('\n🔑 Credentials:');
  console.log(`   Admin: ${config.adminEmail} / ${IS_PRODUCTION ? '(configured via env)' : config.adminPassword}`);
  console.log(`   Operator: ${config.operatorEmail} / ${IS_PRODUCTION ? '(configured via env)' : config.operatorPassword}`);

  if (!IS_PRODUCTION) {
    console.log('   Demo Senior: senior@tiorico.com / operator123');
    console.log('   Demo Operator: operator1@tiorico.com / operator123');
    console.log('   Demo Clients: juan123, maria456, carlos789, lucia012, pedro345 / client123');
  }

  if (IS_PRODUCTION) {
    console.log('\n⚠️  Próximos pasos:');
    console.log('   1. Cambiar la contraseña del admin');
    console.log('   2. Configurar billeteras reales (la de ejemplo está desactivada)');
    console.log('   3. Configurar SUPPORT_PHONE_NUMBER en settings');
    console.log('   4. Configurar Telegram (opcional)');
  }

  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
