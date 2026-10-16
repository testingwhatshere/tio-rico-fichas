/**
 * Comprobantes repetidos: para una tanda de cargas, qué otras cargas comparten
 * el comprobante.
 *
 * Vive fuera de los services porque lo necesitan dos consumidores distintos —el
 * seguimiento/historial (`RequestsService`) y la bandeja de fallas
 * (`DashboardService`)— y la regla de qué es "el mismo comprobante" tiene que
 * ser una sola.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Otra carga que comparte el comprobante. El operador necesita saberlo para no
 * acreditar dos veces el mismo pago: la duda real que llega es "me mando otro
 * comprobante, no se si es el mismo que antes".
 */
export type ProofTwin = {
  id: string;
  status: string;
  amount: string;
  createdAt: Date;
  /** false = el mismo comprobante aparece en la carga de OTRA persona. */
  sameUser: boolean;
};

type TwinInput = {
  id: string;
  userId: string;
  proofHash?: string | null;
  extractedTransactionId?: string | null;
};

/**
 * Marca las cargas cuyo comprobante ya se uso en otra carga.
 *
 * La clave es `proofHash || extractedTransactionId`, el mismo criterio que ya
 * usaba la pestaña de cargas aprobadas del panel viejo. Se resuelve con UNA
 * sola query para todo el lote (`proofHash` esta indexado), no una por fila.
 *
 * No filtra por usuario a proposito: que el mismo comprobante aparezca en la
 * carga de otra persona es mas grave que repetirlo uno mismo, y el operador
 * tiene que verlo igual.
 */
export async function attachProofTwins<T extends TwinInput>(
  prisma: PrismaService,
  rows: T[],
): Promise<(T & { proofTwins: ProofTwin[] })[]> {
  const hashes = [
    ...new Set(rows.map((r) => r.proofHash).filter(Boolean) as string[]),
  ];
  const txIds = [
    ...new Set(
      rows.map((r) => r.extractedTransactionId).filter(Boolean) as string[],
    ),
  ];

  if (hashes.length === 0 && txIds.length === 0) {
    return rows.map((r) => ({ ...r, proofTwins: [] }));
  }

  const or: Prisma.RequestWhereInput[] = [];
  if (hashes.length) or.push({ proofHash: { in: hashes } });
  if (txIds.length) or.push({ extractedTransactionId: { in: txIds } });

  const candidates = await prisma.request.findMany({
    where: { OR: or },
    select: {
      id: true,
      userId: true,
      status: true,
      amount: true,
      createdAt: true,
      proofHash: true,
      extractedTransactionId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const byKey = new Map<string, typeof candidates>();
  for (const c of candidates) {
    for (const key of [c.proofHash, c.extractedTransactionId]) {
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(c);
      byKey.set(key, list);
    }
  }

  return rows.map((r) => {
    const seen = new Set<string>();
    const twins: ProofTwin[] = [];
    for (const key of [r.proofHash, r.extractedTransactionId]) {
      if (!key) continue;
      for (const c of byKey.get(key) ?? []) {
        if (c.id === r.id || seen.has(c.id)) continue;
        seen.add(c.id);
        twins.push({
          id: c.id,
          status: c.status,
          amount: c.amount.toString(),
          createdAt: c.createdAt,
          sameUser: c.userId === r.userId,
        });
      }
    }
    // Las mas recientes primero, y un tope: el operador decide con una o dos.
    twins.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { ...r, proofTwins: twins.slice(0, 3) };
  });
}
