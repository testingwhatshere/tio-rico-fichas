import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Image, ScrollView, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useRouter } from 'expo-router';
import { useOperatorStore } from '@/stores/operator.store';
import { useLayout } from '@/hooks/useLayout';
import { emitWithTimeout } from '@/services/socket';
import { toast } from '@/components/Toast';
import { Button, ConfirmDialog, Badge } from '@/components/ui';
import AmountDialog from '@/components/AmountDialog';
import { CopyableText, CopyButton } from '@/components/Copyable';
import { parseAmount, formatMoney } from '@/utils/amount';
import { humanizeError } from '@/utils/errors';
import { timeAgo } from '@/utils/time';
import { KIND_META, WorkKind } from '@/utils/workItems';
import { colors, space, radius, text, alpha } from '@/constants/theme';
import ProofImage from '@/components/ProofImage';
import { proofTwinAlert } from '@/utils/proofTwins';
import { overpaidOfferTag } from '@/utils/overpaidOffer';

/** Etiquetas humanas de los flags del validador. El operador no puede accionar
 *  sobre `RECIPIENT_ACCOUNT_MISMATCH`; sí sobre lo que eso significa. */
const FLAG_LABELS: Record<string, string> = {
  RECIPIENT_MISMATCH: 'No se pudo verificar el nombre del destinatario',
  RECIPIENT_ACCOUNT_MISMATCH: 'No se pudo verificar la cuenta destino',
  RECIPIENT_UNVERIFIABLE: 'El comprobante no muestra el destinatario',
  DUPLICATE_TRANSACTION_ID: 'Número de operación ya usado',
  CROSS_USER_DUPLICATE: 'Comprobante ya usado por otro usuario',
  CROSS_USER_SENDER: 'Pagó otra persona (común: un familiar)',
  HIGH_FAILURE_RATE: 'Este usuario viene fallando seguido',
  VERY_HIGH_FAILURE_RATE: 'Este usuario falla muchísimo',
  MULTIPLE_SENDERS: 'Le pagaron desde varias cuentas distintas',
  LIKELY_EDITED: 'El comprobante parece editado',
  INVALID_FORMAT: 'Formato de comprobante inválido',
  STATUS_NOT_APPROVED: 'La transferencia no figura aprobada',
  AMOUNT_MISMATCH: 'El comprobante es por menos de lo pedido',
  AMOUNT_OVERPAID: 'Transfirió más de lo que pidió',
  AMOUNT_TEXT_UNCONFIRMED: 'Ese monto no aparece en el texto — puede estar mal leído',
  AMOUNT_OVER_LIMIT: 'El monto supera el tope por carga',
  AMOUNT_UNREADABLE: 'No se pudo leer el monto',
  AMOUNT_AMBIGUOUS: 'El monto no se lee con certeza — mirá el comprobante',
  OLD_DATE: 'El comprobante es viejo',
  FUTURE_DATE: 'La fecha está en el futuro',
};

/** Flags que por sí solos invalidan el comprobante (`criticalFlags` del backend). */
const BLOCKING = new Set([
  'DUPLICATE_TRANSACTION_ID', 'CROSS_USER_DUPLICATE', 'LIKELY_EDITED',
  'STATUS_NOT_APPROVED', 'VERY_HIGH_FAILURE_RATE', 'AMOUNT_MISMATCH',
  'AMOUNT_UNREADABLE', 'AMOUNT_OVERPAID', 'AMOUNT_AMBIGUOUS',
]);

/**
 * Vista de decisión de un fallo.
 *
 * Vive como componente y no como pantalla para poder mostrarse de dos maneras:
 * a pantalla completa (ruta `/failure/[id]`, que es lo que usa el celular) o
 * embebida al lado de la bandeja en desktop, donde la lista queda a la vista y
 * el operador puede resolver uno atrás del otro sin ir y volver.
 */
export default function FailureDetailView({
  id,
  onClose,
  embedded,
}: {
  id: string;
  onClose: () => void;
  /** Embebido junto a la lista: sin barra de volver y sin ancho máximo propio. */
  embedded?: boolean;
}) {
  const { isDesktop } = useLayout();
  const router = useRouter();

  const failures = useOperatorStore((s) => s.failures);
  const resolveFailure = useOperatorStore((s) => s.resolveFailure);
  const failure = useMemo(() => failures.find((f: any) => f.id === id), [failures, id]);

  const [dialog, setDialog] = useState<null | 'approve' | 'overpaid' | 'reject' | 'loaded' | 'retry'>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);

  // Entrando por link directo el store todavía está vacío: decir "ya no está"
  // en ese momento es mentira y manda al operador de vuelta sin motivo.
  if (!failure && failures.length === 0) {
    return (
      <View style={s.notFound}>
        <ActivityIndicator color={colors.primary} />
        <Text style={s.notFoundText}>Cargando…</Text>
      </View>
    );
  }

  if (!failure) {
    return (
      <View style={s.notFound}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.textMuted} />
        <Text style={s.notFoundText}>Este caso ya no está en la bandeja</Text>
        <Button label="Volver" tone="neutral" onPress={() => onClose()} />
      </View>
    );
  }

  const amount = parseAmount(failure.amount ?? failure.request?.amount);
  // El backend manda el monto leido plano, pero los payloads viejos (y los
  // eventos en vivo que quedaron sin actualizar) sólo lo traen anidado. Sin
  // este fallback `extracted` era null SIEMPRE: no aparecia el boton de
  // "transferio de mas" y el monto a mano quedaba topeado en lo pedido.
  const extractedRaw =
    failure.extractedAmount ??
    failure.validationDetails?.extractedAmount ??
    failure.request?.validationDetails?.extractedAmount ??
    null;
  const extracted = extractedRaw != null ? parseAmount(extractedRaw) : null;
  const username = failure.targetUsername || failure.request?.targetUsername || '—';
  const proofUrl = failure.proofUrl || failure.request?.proofUrl;
  const screenshot = failure.screenshot;
  const score = failure.validationScore ?? failure.request?.validationScore;
  const rawError = failure.validationError || failure.error;
  const flags: string[] = failure.fraudFlags || failure.validationFlags || failure.flags || [];
  const recipientVerifiedBy = failure.recipientVerifiedBy || failure.validationDetails?.recipientVerifiedBy;
  const requestId = failure.requestId || failure.request?.id || failure.id;
  const userId = failure.userId || failure.request?.userId || failure.user?.id;

  // Mismo criterio que la bandeja: un fallo de discovery no tiene job.
  const kind: WorkKind =
    failure.type === 'validation_failed' || score != null || failure.validationError
      ? 'validation'
      : failure.jobId || (failure.requestId && failure.id !== failure.requestId)
        ? 'bot'
        : 'discovery';
  const meta = KIND_META[kind];

  const mismatch = extracted !== null && Math.abs(extracted - amount) > 0.01;
  // En un fallo de bot el comprobante ya se validó: lo que importa es el screenshot.
  const image = kind === 'bot' ? screenshot || proofUrl : proofUrl;

  const done = (label: string, resolution: string) => {
    resolveFailure(failure.id, resolution);
    toast.success(label);
    onClose();
  };

  const run = async (event: string, payload: any, okLabel: string, resolution: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res: any = await emitWithTimeout(event, payload, 15000);
      if (res?.error) throw new Error(res.error);
      done(okLabel, resolution);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo completar la acción');
    } finally {
      setBusy(false);
      setDialog(null);
      setNote(''); setReason('');
    }
  };

  /** Lo que la evidencia respalda. Ya no es un tope: es lo que se le muestra al
   *  operador cuando decide cargar por encima. */
  const respaldado = extracted !== null && extracted > amount ? extracted : amount;

  const approve = (choice: { amount?: number; override?: boolean; note?: string }) => {
    const payload: any = {
      failureId: requestId,
      note: choice.note ?? (note.trim() || undefined),
    };
    if (choice.amount !== undefined) {
      if (!Number.isFinite(choice.amount) || choice.amount <= 0) {
        return toast.error('Monto inválido');
      }
      payload.approvedAmount = choice.amount;
      // El operador está mirando el comprobante: si decide un monto que la
      // validación no respalda, se carga igual y queda asentado.
      payload.amountOverride = choice.override ?? false;
    }
    run('approve_failure', payload, 'Aprobado — el bot va a cargar las fichas', 'APPROVED');
  };

  /** Transfirio de mas: se acepta con un toque, cargando lo que transfirio. */
  const transfirioDeMas = extracted !== null && extracted - amount > 1;

  const reject = () => {
    if (!reason.trim()) return toast.error('Escribí qué tiene que corregir');
    run('reject_failure', { failureId: failure.id, requestId, action: 'reject', reason: reason.trim() },
        'Se le pidió un comprobante nuevo', 'REJECTED');
  };

  const markLoaded = () =>
    run('mark_failure_loaded', { failureId: requestId },
        'Cerrado como cargado a mano', 'LOADED');

  const retry = () =>
    run(kind === 'bot' ? 'retry_job' : 'retry_failed_request',
        kind === 'bot' ? { jobId: failure.jobId || failure.id } : { requestId },
        'Reintentando', 'RETRIED');

  const twin = proofTwinAlert(failure.proofTwins || failure.request?.proofTwins);
  const overpaid = overpaidOfferTag(
    failure.validationDetails?.overpaidOffer || failure.request?.validationDetails?.overpaidOffer,
  );

  // ── Panel de decisión ──────────────────────────────────────────────────────
  const detail = (
    <ScrollView style={s.side} contentContainerStyle={s.sideContent}>
      <View style={s.sideHeader}>
        <View style={{ flex: 1 }}>
          {/* Lo primero que el operador pega en el buscador del panel. */}
          <CopyableText value={username} label="Usuario" style={s.username} iconSize={15} />
          <View style={s.copyRow}>
            <Text style={s.age}>hace {timeAgo(failure.createdAt)}</Text>
            {!!userId && (
              // Para cuando el caso no se entiende solo: la ficha tiene sus
              // cargas anteriores, sus premios y su chat.
              <Pressable onPress={() => router.push(`/user/${userId}` as any)}>
                <Text style={s.link}>ver ficha</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: space.xs }}>
          <Badge label={meta.label} color={meta.color} />
          {kind === 'bot' && (
            <View style={s.copyRow}>
              <Text style={s.amountValue}>{formatMoney(amount)}</Text>
              <CopyButton value={amount} label="Monto" />
            </View>
          )}
        </View>
      </View>

      {/* Lo primero: qué pasó. Antes esto quedaba cortado abajo de todo. */}
      <View style={[s.reasonBox, { borderLeftColor: meta.color }]}>
        <CopyableText
          value={rawError || humanizeError(rawError)}
          display={humanizeError(rawError)}
          label="Motivo"
          style={s.reasonText}
          numberOfLines={0}
        />
      </View>

      {!!twin && (
        <View style={[s.twinBox, twin.severe && { borderColor: alpha(colors.error, 0.5) }]}>
          <Ionicons
            name="copy-outline"
            size={16}
            color={twin.severe ? colors.error : colors.warning}
          />
          <View style={{ flex: 1 }}>
            <Text style={[s.twinLabel, { color: twin.severe ? colors.error : colors.warning }]}>
              {twin.label}
            </Text>
            <Text style={s.twinDetail}>{twin.detail}</Text>
          </View>
        </View>
      )}

      {!!overpaid && (
        <View style={[s.twinBox, { borderColor: alpha(overpaid.color, 0.5) }]}>
          <Ionicons name="cash-outline" size={16} color={overpaid.color} />
          <View style={{ flex: 1 }}>
            <Text style={[s.twinLabel, { color: overpaid.color }]}>{overpaid.label}</Text>
          </View>
        </View>
      )}

      {/* La comparación que define la decisión, presentada como comparación. */}
      {kind !== 'bot' && (
        <View style={s.amounts}>
          <View style={s.amountCol}>
            <Text style={s.amountLabel}>Pidió</Text>
            <View style={s.copyRow}>
              <Text style={s.amountValue}>{formatMoney(amount)}</Text>
              <CopyButton value={amount} label="Monto pedido" size={12} />
            </View>
          </View>
          <Ionicons
            name={mismatch ? 'close' : extracted !== null ? 'checkmark' : 'remove'}
            size={18}
            color={mismatch ? colors.error : extracted !== null ? colors.success : colors.textMuted}
          />
          <View style={s.amountCol}>
            <Text style={s.amountLabel}>Comprobante</Text>
            <View style={s.copyRow}>
              <Text style={[s.amountValue, mismatch && { color: colors.error }]}>
                {extracted !== null ? formatMoney(extracted) : 'no se pudo leer'}
              </Text>
              {extracted !== null && (
                <CopyButton value={extracted} label="Monto del comprobante" size={12} />
              )}
            </View>
          </View>
        </View>
      )}

      {!!recipientVerifiedBy && (
        <View style={s.verified}>
          <Ionicons name="shield-checkmark" size={15} color={colors.success} />
          <CopyableText
            value={recipientVerifiedBy}
            display={`Nos pagó a: ${recipientVerifiedBy}`}
            label="Cuenta de destino"
            style={s.verifiedText}
          />
        </View>
      )}

      {flags.length > 0 && (
        <View style={s.flags}>
          {flags.map((f) => (
            <View key={f} style={[s.flag, BLOCKING.has(f) && s.flagBlocking]}>
              <Ionicons
                name={BLOCKING.has(f) ? 'alert-circle' : 'information-circle-outline'}
                size={14}
                color={BLOCKING.has(f) ? colors.error : colors.warning}
              />
              <Text style={[s.flagText, BLOCKING.has(f) && { color: colors.error }]}>
                {FLAG_LABELS[f] || f}
              </Text>
            </View>
          ))}
        </View>
      )}

      {score != null && (
        <Text style={s.score}>Confianza de la IA: {Math.round(score * 100)}%</Text>
      )}

      {/* El id no se mira nunca... hasta que hay que rastrear el caso. */}
      <View style={s.idRow}>
        <Text style={s.score}>Solicitud</Text>
        <CopyableText value={requestId} label="ID de la solicitud" mono style={s.idValue} />
      </View>

      <View style={s.actions}>
        {/* Transfirió de más: el caso tiene una sola decisión razonable —
            acreditarle lo que pagó— así que va primero y con el monto adentro
            del botón. El operador igual mira el comprobante antes de tocarlo. */}
        {transfirioDeMas && kind !== 'bot' && (
          <>
            <Button
              label={`Aceptar y cargar ${formatMoney(extracted!)}`}
              tone="success"
              icon="cash-outline"
              onPress={() => setDialog('overpaid')}
            />
            <Text style={s.overpaidNote}>
              Pidió {formatMoney(amount)} y transfirió {formatMoney(extracted!)}.
            </Text>
          </>
        )}

        {/* `approve` crea el Job. El backend lo rechaza para fallos de bot (ahí el
            bot ya tocó el panel), así que no se ofrece. */}
        {kind !== 'bot' && (
          <Button
            label={transfirioDeMas ? `Cargar otro monto` : 'Aprobar y cargar'}
            tone={transfirioDeMas ? 'neutral' : 'success'}
            icon="checkmark-circle"
            onPress={() => setDialog('approve')}
          />
        )}
        {kind === 'validation' && (
          <Button label="Pedir comprobante nuevo" tone="neutral" icon="camera-outline"
                  onPress={() => setDialog('reject')} />
        )}
        {kind !== 'validation' && (
          <Button label="Reintentar" tone="primary" icon="refresh"
                  onPress={() => setDialog('retry')} />
        )}
        {/* Nunca crea Job: es para cuando las fichas YA se cargaron a mano. */}
        <Button label="Ya las cargué a mano" tone="neutral" icon="hand-left-outline"
                onPress={() => setDialog('loaded')} />
      </View>
    </ScrollView>
  );

  // ── Comprobante ────────────────────────────────────────────────────────────
  const proof = !image ? null : (
    <View style={s.proofPane}>
      {true ? (
        <Pressable onPress={() => setZoom(true)} style={s.proofPress}>
          <ProofImage uri={image} style={s.proof} resizeMode="contain" />
          <View style={s.zoomHint}>
            <Ionicons name="expand" size={14} color={colors.textPrimary} />
            <Text style={s.zoomHintText}>Ampliar</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={s.screen}>
      {!embedded && (
        <View style={s.topBar}>
          <Pressable onPress={onClose} style={s.back}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={s.backText}>Bandeja</Text>
          </Pressable>
        </View>
      )}

      <View style={[
        s.body,
        !isDesktop && { flexDirection: 'column' },
        // Sin comprobante el panel queda solo: se centra en el eje horizontal,
        // que en un contenedor `row` es el eje principal.
        // Comprobante y decisión tienen ancho máximo, así que el par se centra
        // en vez de dejar todo el sobrante de un lado.
        isDesktop && !embedded && { justifyContent: 'center' },
      ]}>
        {proof}
        <View style={image && isDesktop ? s.sideFixed : s.sideAlone}>{detail}</View>
      </View>

      <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
        <Pressable style={s.zoomOverlay} onPress={() => setZoom(false)}>
          <Pressable onPress={() => setZoom(false)} style={s.zoomClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>
          <ProofImage uri={image} style={s.zoomImage} resizeMode="contain" />
        </Pressable>
      </Modal>

      <ConfirmDialog
        visible={dialog === 'overpaid'}
        title={`Cargar ${formatMoney(extracted ?? 0)}`}
        message={`${username} pidió ${formatMoney(amount)} y el comprobante es por ${formatMoney(extracted ?? 0)}. Se le cargan ${formatMoney(extracted ?? 0)}.`}
        confirmLabel="Aceptar y cargar"
        tone="success"
        loading={busy}
        onConfirm={() => approve({ amount: extracted ?? undefined })}
        onCancel={() => setDialog(null)}
      />

      <AmountDialog
        visible={dialog === 'approve'}
        title="Aprobar y cargar"
        username={username}
        requested={amount}
        extracted={extracted}
        confirmLabel="Cargar"
        loading={busy}
        onConfirm={(choice) =>
          approve({ amount: choice.amount, override: choice.override, note: choice.note })
        }
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        visible={dialog === 'reject'} title="Pedir comprobante nuevo"
        message="No se rechaza la carga: se le avisa que mande otro comprobante. El pago que ya hizo sigue vigente."
        confirmLabel="Pedir de nuevo" tone="primary" loading={busy}
        onConfirm={reject} onCancel={() => setDialog(null)}
      >
        <TextInput style={s.input} placeholder="Qué tiene que corregir"
          placeholderTextColor={colors.placeholder} value={reason} onChangeText={setReason} />
      </ConfirmDialog>

      <ConfirmDialog
        visible={dialog === 'loaded'} title="Ya las cargué a mano"
        message="Se cierra como completada y NO se manda el bot, para no cargar dos veces. El usuario recibe el aviso de fichas cargadas."
        confirmLabel="Confirmar" tone="primary" loading={busy}
        onConfirm={markLoaded} onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        visible={dialog === 'retry'} title="Reintentar"
        message={kind === 'bot'
          ? 'Se manda el bot de nuevo. Si las fichas ya se cargaron, esto las carga otra vez — verificá antes.'
          : 'Se vuelve a buscar al usuario en los paneles.'}
        confirmLabel="Reintentar" tone="primary" loading={busy}
        onConfirm={retry} onCancel={() => setDialog(null)}
      />

      {busy && (
        <View style={s.busy}><ActivityIndicator color={colors.primary} /></View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  zoomClose: {
    position: 'absolute',
    top: space.lg,
    right: space.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  twinBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: alpha(colors.warning, 0.5),
    backgroundColor: colors.backgroundSecondary,
  },
  twinLabel: { ...text.label },
  twinDetail: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  overpaidNote: { ...text.caption, color: colors.textSecondary, textAlign: 'center' },
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  backText: { ...text.body, color: colors.textPrimary },

  body: { flex: 1, flexDirection: 'row' },

  proofPane: {
    // Los comprobantes son fotos de celular (verticales). Dejar que la columna
    // se estire a 1000px sólo agrega vacío alrededor de una imagen angosta.
    flex: 1, maxWidth: 620, backgroundColor: colors.backgroundSecondary,
    alignItems: 'center', justifyContent: 'center', padding: space.lg,
    borderRightWidth: 1, borderRightColor: colors.border,
    minHeight: 280,
  },
  proofPress: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  proof: { width: '100%', height: '100%', borderRadius: radius.md },
  zoomHint: {
    position: 'absolute', bottom: space.md, right: space.md,
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingVertical: space.xs,
    borderRadius: radius.sm, backgroundColor: alpha(colors.black, 0.6),
  },
  zoomHintText: { ...text.caption, color: colors.textPrimary },
  noProof: { alignItems: 'center', gap: space.sm },
  noProofText: { ...text.body, color: colors.textMuted },

  side: { flex: 1 },
  sideFixed: { flex: 1, maxWidth: 520 },
  /** Sin comprobante que mostrar, el panel de decisión ocupa el ancho, con un
   *  máximo para que el texto no se estire a 1400px. */
  sideAlone: { flex: 1, maxWidth: 640, width: '100%', alignSelf: 'stretch' },
  sideContent: { padding: space.xl, gap: space.lg },
  sideHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  username: { ...text.display, color: colors.textPrimary },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  idValue: { ...text.mono, color: colors.textMuted, flexShrink: 1 },
  age: { ...text.caption, color: colors.textMuted, marginTop: 2 },
  link: { ...text.caption, color: colors.primary, marginTop: 2 },

  reasonBox: {
    borderLeftWidth: 3, paddingLeft: space.md, paddingVertical: space.sm,
    backgroundColor: colors.cardBackground, borderRadius: radius.sm,
  },
  reasonText: { ...text.body, color: colors.textPrimary, lineHeight: 20 },

  amounts: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: space.md, padding: space.lg,
    backgroundColor: colors.cardBackground, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  amountCol: { flex: 1, gap: 2 },
  amountLabel: { ...text.caption, color: colors.textSecondary },
  amountValue: { ...text.title, color: colors.textPrimary },

  verified: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
    backgroundColor: alpha(colors.success, 0.12),
  },
  verifiedText: { ...text.body, color: colors.success, flex: 1 },

  flags: { gap: space.sm },
  flag: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
    backgroundColor: alpha(colors.warning, 0.1),
  },
  flagBlocking: { backgroundColor: alpha(colors.error, 0.12) },
  flagText: { ...text.body, color: colors.warning, flex: 1 },

  score: { ...text.caption, color: colors.textMuted },

  actions: { gap: space.sm, marginTop: space.sm },

  input: {
    ...text.body, color: colors.textPrimary,
    backgroundColor: colors.input, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md,
  },

  zoomOverlay: {
    flex: 1, backgroundColor: alpha(colors.black, 0.92),
    alignItems: 'center', justifyContent: 'center', padding: space.xl,
  },
  zoomImage: { width: '100%', height: '100%' },

  busy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.background, 0.5),
  },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, backgroundColor: colors.background },
  notFoundText: { ...text.body, color: colors.textSecondary },
});
