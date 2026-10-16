import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Linking } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useOperatorStore } from '@/stores/operator.store';
import { usePrizeActions } from '@/hooks/usePrizeActions';
import { Button, ConfirmDialog, Badge } from '@/components/ui';
import { CopyableText, CopyButton } from '@/components/Copyable';
import PayoutProofDialog, { PayoutProof } from '@/components/PayoutProofDialog';
import { parseAmount, formatMoney } from '@/utils/amount';
import { timeAgo } from '@/utils/time';
import { prizeStatusMeta } from '@/utils/prizes';
import { colors, space, radius, text, alpha } from '@/constants/theme';

/** Qué falta hacer, en criollo. El status solo no le dice al operador qué sigue. */
const NEXT_STEP: Record<string, string> = {
  VERIFIED: 'Hay que retirarle las fichas del panel. Lo hace el bot.',
  VERIFIED_UNCHECKED:
    'Nadie leyó el saldo todavía: miralo en el panel antes de retirar. El bot retira lo que le pidas, tenga o no las fichas.',
  VERIFICATION_FAILED: 'No se pudo confirmar el saldo en el panel. Podés procesarlo igual si lo verificaste a mano.',
  PROCESSING: 'El bot está retirando las fichas. Esperá a que termine.',
  CHIPS_WITHDRAWN: 'Las fichas ya se retiraron. Falta transferirle la plata y adjuntar el comprobante.',
  FAILED: 'El retiro de fichas falló. Se puede reintentar.',
};

/** Igual que FailureDetailView: componente para poder embeberlo al lado del
 *  tablero de premios o mostrarlo a pantalla completa desde su ruta. */
export default function PrizeDetailView({
  id,
  onClose,
  embedded,
  fallbackClaim,
}: {
  id: string;
  onClose: () => void;
  embedded?: boolean;
  /**
   * Premio ya cerrado que no está en el store.
   *
   * El store sólo guarda los accionables (`findPending`), así que abrir un
   * premio del historial mostraba "ya no está en la bandeja" — justo la
   * consulta que el operador más hace: "¿a este ya le pagué?".
   */
  fallbackClaim?: any;
}) {
  const prizeClaims = useOperatorStore((s) => s.prizeClaims);
  const claim = useMemo(
    () => prizeClaims.find((c: any) => c.id === id) || (fallbackClaim?.id === id ? fallbackClaim : null),
    [prizeClaims, id, fallbackClaim],
  );

  const actions = usePrizeActions();
  const [dialog, setDialog] = useState<
    null | 'process' | 'retry' | 'reject' | 'pay' | 'verify' | 'withdrawn'
  >(null);
  const [reason, setReason] = useState('');

  if (!claim && prizeClaims.length === 0) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={s.muted}>Cargando…</Text>
      </View>
    );
  }
  if (!claim) {
    return (
      <View style={s.center}>
        <Ionicons name="trophy-outline" size={40} color={colors.textMuted} />
        <Text style={s.muted}>Este premio ya no está en la lista</Text>
        <Button label="Volver" tone="neutral" onPress={() => onClose()} />
      </View>
    );
  }

  const amount = parseAmount(claim.amount);
  const username = claim.targetUsername || claim.user?.username || '—';
  const status = claim.status as string;
  const meta = prizeStatusMeta(status);
  const terminal = status === 'COMPLETED' || status === 'REJECTED';
  const busy = actions.isBusy(claim.id);

  const close = () => {
    setDialog(null);
    setReason('');
  };

  const process = async () => {
    await actions.process(claim);
    close();
  };

  const reject = async () => {
    const ok = await actions.reject(claim, reason);
    close();
    if (ok) onClose();
  };

  const markVerified = async () => {
    await actions.markVerified(claim);
    close();
  };

  const markWithdrawn = async () => {
    await actions.markChipsWithdrawn(claim);
    close();
  };

  const pay = async (proofs: PayoutProof[]) => {
    const ok = await actions.payWithProofs(claim, proofs);
    setDialog(null);
    if (ok) onClose();
  };

  return (
    <View style={s.screen}>
      {!embedded && (
        <View style={s.topBar}>
          <Pressable onPress={onClose} style={s.back}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={s.backText}>Premios</Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* El usuario es lo primero que se pega en el buscador del panel. */}
            <CopyableText value={username} label="Usuario" style={s.username} iconSize={15} />
            <Text style={s.age}>hace {timeAgo(claim.createdAt)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: space.xs }}>
            <Badge label={meta.label} color={meta.color} />
            <View style={s.amountRow}>
              <Text style={s.amount}>{formatMoney(amount)}</Text>
              {/* Sin símbolo ni puntos: va directo al campo del banco. */}
              <CopyButton value={amount} label="Monto" />
            </View>
          </View>
        </View>

        {/* Un VERIFIED sin saldo leído no es lo mismo que uno verificado. */}
        {!!NEXT_STEP[
          status === 'VERIFIED' && claim.verifiedBalance == null
            ? 'VERIFIED_UNCHECKED'
            : status
        ] && (
          <View style={[s.step, { borderLeftColor: meta.color }]}>
            <Text style={s.stepText}>
              {NEXT_STEP[
                status === 'VERIFIED' && claim.verifiedBalance == null
                  ? 'VERIFIED_UNCHECKED'
                  : status
              ]}
            </Text>
          </View>
        )}

        {!!claim.rejectionReason && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>Motivo del rechazo: {claim.rejectionReason}</Text>
          </View>
        )}

        {/* Los datos para transferir. Es lo único que el operador necesita copiar. */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Dónde pagarle</Text>
          <Row label="Método" value={claim.paymentMethod || '—'} />
          {payoutFields(claim.paymentDetails).map((f) => (
            <Row key={f.label} label={f.label} value={f.value} mono={f.mono} />
          ))}
          {claim.verifiedBalance != null && (
            <Row label="Saldo verificado en el panel" value={formatMoney(parseAmount(claim.verifiedBalance))} />
          )}
        </View>

        {/* Comprobantes de la transferencia: la prueba de que este premio se pagó.
            Pueden ser varios — un premio grande se paga desde varias cuentas. */}
        {payoutProofs(claim).map((proof, i, all) => (
          <Pressable key={proof.url} onPress={() => Linking.openURL(proof.url)} style={s.proof}>
            <Ionicons
              name={proof.type === 'pdf' ? 'document-text-outline' : 'receipt-outline'}
              size={16}
              color={colors.success}
            />
            <Text style={s.proofText} numberOfLines={1}>
              {all.length > 1
                ? `Comprobante ${i + 1} de ${all.length}${proof.name ? ` — ${proof.name}` : ''}`
                : 'Ver el comprobante que se le mandó'}
            </Text>
            <Ionicons name="open-outline" size={14} color={colors.textMuted} />
          </Pressable>
        ))}

        {!terminal && (
          <View style={s.actions}>
            {status === 'VERIFIED' && (
              <Button label="Retirar fichas" tone="primary" icon="download-outline" onPress={() => setDialog('process')} />
            )}
            {status === 'VERIFICATION_FAILED' && (
              <Button label="Procesar igual" tone="primary" icon="download-outline" onPress={() => setDialog('process')} />
            )}
            {status === 'FAILED' && (
              <Button label="Reintentar retiro" tone="primary" icon="refresh" onPress={() => setDialog('retry')} />
            )}
            {status === 'CHIPS_WITHDRAWN' && (
              <Button label="Ya le transferí — adjuntar comprobante" tone="success" icon="checkmark-circle" onPress={() => setDialog('pay')} />
            )}
            {/* Verificación colgada o fallida: el operador que ya miró el panel
                deja el premio listo, sin retirar nada todavía. */}
            {['PENDING_VERIFICATION', 'VERIFYING_CHIPS', 'VERIFICATION_FAILED'].includes(
              status,
            ) && (
              <Button
                label="Ya vi que tiene las fichas"
                tone="primary"
                icon="checkmark-done-outline"
                onPress={() => setDialog('verify')}
              />
            )}
            {/* El bot no pudo y lo resolvió una persona en el panel. */}
            {['VERIFIED', 'VERIFICATION_FAILED', 'PENDING_VERIFICATION', 'VERIFYING_CHIPS', 'FAILED', 'PROCESSING'].includes(
              status,
            ) && (
              <Button
                label="Ya le retiré las fichas a mano"
                tone="neutral"
                icon="hand-left-outline"
                onPress={() => setDialog('withdrawn')}
              />
            )}
            {status === 'PROCESSING' && (
              <View style={s.processing}>
                <ActivityIndicator size="small" color={colors.info} />
                <Text style={s.processingText}>El bot está retirando las fichas…</Text>
              </View>
            )}
            <Button label="Rechazar" tone="neutral" icon="close-circle-outline" onPress={() => setDialog('reject')} />
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={dialog === 'process' || dialog === 'retry'}
        title={dialog === 'retry' ? 'Reintentar retiro' : 'Retirar fichas'}
        message={`El bot le retira las fichas a ${username} del panel. Después vas a tener que transferirle ${formatMoney(amount)}.`}
        confirmLabel={dialog === 'retry' ? 'Reintentar' : 'Retirar'} tone="primary" loading={busy}
        onConfirm={process} onCancel={close}
      />

      <ConfirmDialog
        visible={dialog === 'verify'}
        title="Confirmar las fichas"
        message={`Confirmás que ${username} tiene las fichas en el panel. El premio queda listo para retirar; no se retira nada todavía.`}
        confirmLabel="Confirmar"
        tone="primary"
        loading={busy}
        onConfirm={markVerified}
        onCancel={close}
      />

      <ConfirmDialog
        visible={dialog === 'withdrawn'}
        title="Fichas retiradas a mano"
        message={`Confirmás que ya le retiraste las ${formatMoney(amount)} en fichas a ${username} desde el panel. El bot no va a retirar nada: el premio pasa directo a "falta pagarle".`}
        confirmLabel="Sí, ya las retiré"
        tone="primary"
        loading={busy}
        onConfirm={markWithdrawn}
        onCancel={close}
      />

      <PayoutProofDialog
        visible={dialog === 'pay'}
        claim={claim}
        busy={busy}
        onCancel={close}
        onConfirm={pay}
      />

      <ConfirmDialog
        visible={dialog === 'reject'} title="Rechazar premio"
        message={`Se rechaza el pedido de ${formatMoney(amount)} de ${username}.`}
        confirmLabel="Rechazar" tone="danger" loading={busy}
        onConfirm={reject} onCancel={close}
      >
        <TextInput style={s.input} placeholder="Motivo (se lo ve el usuario)"
          placeholderTextColor={colors.placeholder} value={reason} onChangeText={setReason} />
      </ConfirmDialog>

      {busy && <View style={s.busy}><ActivityIndicator color={colors.primary} /></View>}
    </View>
  );
}

/** Todo dato de la ficha se puede copiar: el titular y el DNI también se pegan
 *  en el formulario del banco, no sólo el CBU. */
function Row({
  label, value, mono,
}: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <CopyableText value={value} label={label} mono={mono} style={s.rowValue} />
    </View>
  );
}

/**
 * Los comprobantes del pago.
 *
 * Los premios pagados antes del 2026-08-28 sólo tienen `payoutProofUrl`; desde
 * entonces la lista completa vive en `payoutProofs`. Se leen los dos para que
 * el historial viejo siga mostrando su comprobante.
 */
function payoutProofs(claim: any): { url: string; type: string; name?: string }[] {
  const list = Array.isArray(claim?.payoutProofs) ? claim.payoutProofs : [];
  const valid = list.filter((p: any) => p && typeof p.url === 'string' && p.url);
  if (valid.length) return valid;
  return claim?.payoutProofUrl
    ? [{ url: claim.payoutProofUrl, type: claim.payoutProofType || 'image' }]
    : [];
}

/** `paymentDetails` es Json y viene con forma distinta según el método. Las
 *  claves son las que grabó la app (camelCase), así que se traducen. */
const PAYOUT_LABELS: Record<string, string> = {
  cbu: 'CBU',
  cvu: 'CVU',
  alias: 'Alias',
  accountHolder: 'Titular',
  holderName: 'Titular',
  dni: 'DNI',
  bank: 'Banco',
  bankName: 'Banco',
  email: 'Email',
  phone: 'Teléfono',
};

type PayoutField = { label: string; value: string; mono: boolean };

function payoutFields(details: any): PayoutField[] {
  if (!details) return [];
  if (typeof details === 'string') {
    return [{ label: 'Datos', value: details, mono: true }];
  }
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ({
      label: PAYOUT_LABELS[k] || k,
      value: String(v),
      // Monoespaciado para los números largos, que se leen de a bloques.
      mono: /^(cbu|cvu|dni)$/i.test(k),
    }));
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, backgroundColor: colors.background },
  muted: { ...text.body, color: colors.textSecondary },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  backText: { ...text.body, color: colors.textPrimary },

  content: { padding: space.xl, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  username: { ...text.display, color: colors.textPrimary },
  age: { ...text.caption, color: colors.textMuted, marginTop: 2 },
  amount: { ...text.title, color: colors.textPrimary },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },

  step: {
    borderLeftWidth: 3, paddingLeft: space.md, paddingVertical: space.sm,
    backgroundColor: colors.cardBackground, borderRadius: radius.sm,
  },
  stepText: { ...text.body, color: colors.textPrimary, lineHeight: 20 },

  errorBox: { padding: space.md, borderRadius: radius.md, backgroundColor: alpha(colors.error, 0.12) },
  errorText: { ...text.body, color: colors.error },

  card: {
    backgroundColor: colors.cardBackground, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.borderSubtle, padding: space.lg, gap: space.md,
  },
  cardTitle: { ...text.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { gap: 2 },
  rowValueLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowLabel: { ...text.caption, color: colors.textMuted },
  rowValue: { ...text.body, color: colors.textPrimary },

  proof: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
    backgroundColor: alpha(colors.success, 0.1),
  },
  proofText: { ...text.body, color: colors.success, flex: 1 },

  actions: { gap: space.sm },
  processing: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md, backgroundColor: alpha(colors.info, 0.12),
  },
  processingText: { ...text.body, color: colors.info },

  input: {
    ...text.body, color: colors.textPrimary, backgroundColor: colors.input,
    borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.md,
  },
  pdfLink: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'center' },
  pdfLinkText: { ...text.caption, color: colors.textSecondary, textDecorationLine: 'underline' },

  busy: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.background, 0.5),
  },
});
