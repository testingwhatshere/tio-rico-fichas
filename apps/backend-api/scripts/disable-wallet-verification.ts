/**
 * Forzar PaymentConfig.requiresVerification=false en todas las wallets.
 *
 * Decisión de negocio (2026-06-06): no se usa la extension MP. La carga se decide
 * 100% con el comprobante. Si alguna wallet quedó con requiresVerification=true,
 * los requests cuelgan en PENDING_MP_VERIFICATION indefinidamente porque nadie
 * confirma el matcheo del operationNumber.
 *
 * También re-encola los requests que ya quedaron colgados en ese estado: los pasa
 * a APPROVED (el validator OK ya marcó como válidos) y deja que el flujo normal
 * de approve cree el job. Si algún request realmente debe quedar pendiente de
 * verificación manual, marcarlo como VALIDATION_FAILED a mano antes de correr.
 *
 * Safe to run multiple times (idempotent).
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('DB:', await prisma.$queryRaw`SELECT current_database()`);

  const walletsNeedingFix = await prisma.paymentConfig.findMany({
    where: { requiresVerification: true },
    select: { id: true, label: true, type: true, holderName: true },
  });
  console.log(`Wallets con requiresVerification=true: ${walletsNeedingFix.length}`);
  for (const w of walletsNeedingFix) {
    console.log(`  - ${w.id} | ${w.type} | ${w.label} (${w.holderName})`);
  }

  if (walletsNeedingFix.length > 0) {
    const res = await prisma.paymentConfig.updateMany({
      where: { requiresVerification: true },
      data: { requiresVerification: false },
    });
    console.log(`Wallets actualizadas a requiresVerification=false: ${res.count}`);
  }

  const stuck = await prisma.request.findMany({
    where: { status: 'PENDING_MP_VERIFICATION' },
    select: { id: true, userId: true, targetUsername: true, amount: true, createdAt: true },
  });
  console.log(`\nRequests colgadas en PENDING_MP_VERIFICATION: ${stuck.length}`);
  for (const r of stuck) {
    console.log(`  - ${r.id} | user=${r.userId} | target=${r.targetUsername} | $${r.amount} | ${r.createdAt.toISOString()}`);
  }

  if (stuck.length > 0) {
    const res = await prisma.request.updateMany({
      where: { status: 'PENDING_MP_VERIFICATION' },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    console.log(`Requests pasadas a APPROVED: ${res.count}`);
    console.log('Nota: los jobs se crearán cuando el operador re-apruebe desde el panel o cuando el flujo de approve los re-tome.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
