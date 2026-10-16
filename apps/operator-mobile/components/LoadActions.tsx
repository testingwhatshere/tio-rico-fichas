/**
 * Las decisiones sobre una carga, en cualquier pantalla.
 *
 * Mismo bloque de botones en Seguimiento, en el Historial y en la ficha del
 * cliente. La Bandeja tiene su propia composición (`FailureDetailView`, que
 * pone el comprobante al lado y ordena los botones por lo que conviene hacer),
 * pero las acciones y los diálogos son los mismos de acá.
 *
 * Regla de la pantalla: si una carga se puede tocar, se toca desde donde se la
 * está mirando. El operador no debería tener que acordarse de en qué pestaña
 * vivía el botón.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Image, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button, ConfirmDialog } from '@/components/ui';
import AmountDialog from '@/components/AmountDialog';
import { toast } from '@/components/Toast';
import { useLoadActions } from '@/hooks/useLoadActions';
import { formatMoney } from '@/utils/amount';
import { proofTwinAlert } from '@/utils/proofTwins';
import { overpaidOfferTag } from '@/utils/overpaidOffer';
import { cancelConsequence } from '@/utils/tracking';
import {
  ActionableLoad,
  canApprove,
  canAskNewProof,
  canCancel,
  canLoadCredits,
  canMarkLoaded,
  canRetry,
} from '@/utils/loadActions';
import { colors, space, radius, text, alpha } from '@/constants/theme';
import ProofImage from '@/components/ProofImage';

type Dialog = null | 'approve' | 'load' | 'cancel' | 'retry' | 'loaded' | 'proof' | 'reject';

export default function LoadActions({
  load,
  onDone,
  compact,
}: {
  load: ActionableLoad;
  /** Se llama después de cualquier acción exitosa, para refrescar la lista. */
  onDone?: () => void;
  /** Sin el botón de comprobante (la pantalla ya lo muestra). */
  compact?: boolean;
}) {
  const actions = useLoadActions();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');

  const close = () => {
    setDialog(null);
    setReason('');
  };

  const settle = (err: string | null, ok: string) => {
    if (err) {
      toast.error(err);
      return;
    }
    toast.success(ok);
    close();
    onDone?.();
  };

  const aprobar = async (amount: number, override: boolean, note?: string) =>
    settle(
      await actions.approve(load.id, { amount, override, note }),
      'Aprobado — el bot va a cargar las fichas',
    );

  const cargar = async (amount: number, note?: string) => {
    if (!load.userId) return toast.error('Esta carga no tiene un cliente asociado');
    settle(
      await actions.loadCredits(load.userId, amount, note),
      `Se le cargan ${formatMoney(amount)} a ${load.targetUsername}`,
    );
  };

  const twinAlert = proofTwinAlert(load.proofTwins);
  const overpaid = overpaidOfferTag(load.overpaidOffer);

  return (
    <>
      {overpaid && (
        <View style={[s.twin, { borderColor: alpha(overpaid.color, 0.5) }]}>
          <Ionicons name="cash-outline" size={16} color={overpaid.color} />
          <View style={{ flex: 1 }}>
            <Text style={[s.twinLabel, { color: overpaid.color }]}>{overpaid.label}</Text>
          </View>
        </View>
      )}
      {twinAlert && (
        <View
          style={[
            s.twin,
            twinAlert.severe && { borderColor: alpha(colors.error, 0.5) },
          ]}
        >
          <Ionicons
            name="copy-outline"
            size={16}
            color={twinAlert.severe ? colors.error : colors.warning}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                s.twinLabel,
                { color: twinAlert.severe ? colors.error : colors.warning },
              ]}
            >
              {twinAlert.label}
            </Text>
            <Text style={s.twinDetail}>{twinAlert.detail}</Text>
          </View>
        </View>
      )}

      <View style={[s.row, compact && s.rowCompact]}>
        {!compact && !!load.proofUrl && (
          <Button
            label="Ver comprobante"
            tone="neutral"
            icon="document-text-outline"
            onPress={() => setDialog('proof')}
          />
        )}

        {canApprove(load) ? (
          <Button
            label="Aprobar y cargar"
            tone="success"
            icon="checkmark-circle"
            onPress={() => setDialog('approve')}
          />
        ) : (
          canLoadCredits(load) && (
            <Button
              label="Cargar fichas"
              tone="success"
              icon="cash-outline"
              onPress={() => setDialog('load')}
            />
          )
        )}

        {canRetry(load) && (
          <Button label="Reintentar" tone="primary" icon="refresh" onPress={() => setDialog('retry')} />
        )}
        {canAskNewProof(load) && (
          <Button
            label="Pedir comprobante nuevo"
            tone="neutral"
            icon="camera-outline"
            onPress={() => setDialog('reject')}
          />
        )}
        {canMarkLoaded(load) && (
          <Button
            label="Ya las cargué a mano"
            tone="neutral"
            icon="hand-left-outline"
            onPress={() => setDialog('loaded')}
          />
        )}
        {canCancel(load as any) && (
          <Button
            label="Cerrar carga"
            tone="danger"
            icon="close-circle-outline"
            onPress={() => setDialog('cancel')}
          />
        )}
      </View>

      {/* Aprobar esta carga: el monto sale del comprobante, pero lo decide el
          operador. */}
      <AmountDialog
        visible={dialog === 'approve'}
        title="Aprobar y cargar"
        username={load.targetUsername}
        requested={load.amount}
        extracted={load.extractedAmount ?? null}
        loading={actions.busy}
        onConfirm={(c) => aprobar(c.amount, c.override, c.note)}
        onCancel={close}
      />

      {/* Carga suelta: no hay pedido esperando, la decide el operador entero. */}
      <AmountDialog
        visible={dialog === 'load'}
        title={`Cargar fichas a ${load.targetUsername}`}
        username={load.targetUsername}
        requested={load.amount || null}
        extracted={load.extractedAmount ?? null}
        loading={actions.busy}
        onConfirm={(c) => cargar(c.amount, c.note)}
        onCancel={close}
        noteLabel="Por qué (queda registrado)"
      />

      <ConfirmDialog
        visible={dialog === 'cancel'}
        title="¿Cerrar esta carga?"
        message={`${load.targetUsername} · ${formatMoney(load.amount)} — ${cancelConsequence(load as any)}`}
        confirmLabel="Cerrar carga"
        tone="danger"
        loading={actions.busy}
        onConfirm={async () =>
          settle(await actions.cancel(load.id, reason.trim() || undefined), 'Carga cerrada')
        }
        onCancel={close}
      >
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Motivo (opcional)"
          placeholderTextColor={colors.placeholder}
          style={s.input}
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={dialog === 'retry'}
        title="Reintentar"
        message={
          load.jobId
            ? 'Se manda el bot de nuevo. Si las fichas ya se cargaron, esto las carga otra vez — verificá antes.'
            : 'Se vuelve a buscar al usuario en los paneles.'
        }
        confirmLabel="Reintentar"
        tone="primary"
        loading={actions.busy}
        onConfirm={async () =>
          settle(await actions.retry({ requestId: load.id, jobId: load.jobId }), 'Reintentando')
        }
        onCancel={close}
      />

      <ConfirmDialog
        visible={dialog === 'loaded'}
        title="Ya las cargué a mano"
        message="Se cierra como completada y NO se manda el bot, para no cargar dos veces. El usuario recibe el aviso de fichas cargadas."
        confirmLabel="Confirmar"
        tone="primary"
        loading={actions.busy}
        onConfirm={async () =>
          settle(await actions.markLoaded(load.id), 'Cerrado como cargado a mano')
        }
        onCancel={close}
      />

      <ConfirmDialog
        visible={dialog === 'reject'}
        title="Pedir comprobante nuevo"
        message="No se rechaza la carga: se le avisa que mande otro comprobante. El pago que ya hizo sigue vigente."
        confirmLabel="Pedir de nuevo"
        tone="primary"
        loading={actions.busy}
        onConfirm={async () => {
          if (!reason.trim()) return toast.error('Escribí qué tiene que corregir');
          settle(await actions.reject(load.id, reason.trim()), 'Se le pidió un comprobante nuevo');
        }}
        onCancel={close}
      >
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Qué tiene que corregir"
          placeholderTextColor={colors.placeholder}
          style={s.input}
        />
      </ConfirmDialog>

      <Modal visible={dialog === 'proof'} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={s.zoomOverlay} onPress={close}>
          {/* Un visor a pantalla completa sin botón de cerrar deja al operador
              adivinando que se cierra tocando el fondo. */}
          <Pressable onPress={close} style={s.zoomClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>
          {load.proofUrl ? (
            <ProofImage uri={load.proofUrl} style={s.zoomImage} resizeMode="contain" />
          ) : (
            <View style={s.noProof}>
              <Ionicons name="document-outline" size={40} color={colors.textMuted} />
              <Text style={s.noProofText}>Esta carga no tiene comprobante</Text>
            </View>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
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
  twin: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.md,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: alpha(colors.warning, 0.5),
    backgroundColor: colors.backgroundSecondary,
  },
  twinLabel: { ...text.label },
  twinDetail: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  rowCompact: { marginTop: space.sm },
  input: {
    ...text.body,
    color: colors.textPrimary,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  zoomOverlay: {
    flex: 1,
    backgroundColor: alpha(colors.black, 0.92),
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  zoomImage: { width: '100%', height: '100%' },
  noProof: { alignItems: 'center', gap: space.sm },
  noProofText: { ...text.body, color: colors.textMuted },
});
