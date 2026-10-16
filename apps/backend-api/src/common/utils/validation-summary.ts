import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lo unico de `Request.validationDetails` que leen las listas del operador.
 *
 * `validationDetails` es el JSON completo del OCR (texto leido, campos, scores)
 * y pesa mas que todo el resto de la fila. Traerlo entero en cada lista
 * (Seguimiento, cola de fallos) era la segunda fuente de egress de Supabase:
 * se mandaba por la red para usar tres claves. Aca Postgres arma un objeto
 * chico con solo esas claves y viaja eso.
 */
export type ValidationSummary = {
  extractedAmount?: unknown;
  fraudFlags?: unknown;
  recipientVerifiedBy?: unknown;
  /** Transfirio de mas y se le pregunto al jugador: { status, requestedAmount, offeredAmount }. */
  overpaidOffer?: unknown;
};

export async function fetchValidationSummaries(
  prisma: PrismaService,
  requestIds: string[],
): Promise<Map<string, ValidationSummary | null>> {
  const ids = [...new Set(requestIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    Array<{ id: string; vd: ValidationSummary | null }>
  >`
    SELECT id,
      CASE WHEN "validationDetails" IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
        'extractedAmount', "validationDetails"->'extractedAmount',
        'fraudFlags', "validationDetails"->'fraudFlags',
        'recipientVerifiedBy', "validationDetails"->'recipientVerifiedBy',
        'overpaidOffer', "validationDetails"->'overpaidOffer'
      )) END AS vd
    FROM "Request"
    WHERE id = ANY(${ids}::text[])`;

  return new Map(rows.map((r) => [r.id, r.vd]));
}

/**
 * Lo que el operador usa de `RequestStatusHistory.metadata`: la nota visible,
 * el score del validador y la marca de asiento contable. El resto del JSON es
 * contexto interno que no se dibuja.
 */
export async function fetchSlimStatusHistory(
  prisma: PrismaService,
  requestIds: string[],
): Promise<
  Map<
    string,
    Array<{
      id: string;
      status: string;
      changedBy: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
    }>
  >
> {
  const ids = [...new Set(requestIds.filter(Boolean))];
  const byRequest = new Map<string, any[]>();
  if (ids.length === 0) return byRequest;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      requestId: string;
      status: string;
      changedBy: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
    }>
  >`
    SELECT id, "requestId", status::text AS status, "changedBy", "createdAt",
      CASE WHEN metadata IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
        'walletAccumulated', metadata->'walletAccumulated',
        'validationScore', metadata->'validationScore',
        'error', metadata->'error',
        'reason', metadata->'reason',
        'validationError', metadata->'validationError',
        'note', metadata->'note',
        'overpaidOffer', metadata->'overpaidOffer'
      )) END AS metadata
    FROM "RequestStatusHistory"
    WHERE "requestId" = ANY(${ids}::text[])
    ORDER BY "createdAt" ASC`;

  for (const r of rows) {
    const { requestId, ...entry } = r;
    const list = byRequest.get(requestId);
    if (list) list.push(entry);
    else byRequest.set(requestId, [entry]);
  }
  return byRequest;
}
