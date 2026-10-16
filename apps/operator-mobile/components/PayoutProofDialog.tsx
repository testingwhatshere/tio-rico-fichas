import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import { Button } from '@/components/ui';
import { toast } from '@/components/Toast';
import { uploadPayoutProof } from '@/services/api';
import { formatMoney } from '@/utils/amount';
import { claimAmount, prizeUsername } from '@/utils/prizes';
import { colors, space, radius, text } from '@/constants/theme';

export type PayoutProof = { url: string; type: 'image' | 'pdf'; name?: string };

type Attachment = {
  id: string;
  name: string;
  type: 'image' | 'pdf';
  /** Preview local. Se descarta al cerrar. */
  preview?: string;
  status: 'uploading' | 'ready' | 'error';
  url?: string;
  error?: string;
  /** Para reintentar sin volver a elegir el archivo. */
  source: { uri: string; mime: string };
};

/** Igual que el backend: veinte transferencias para un premio ya es rarísimo. */
const MAX_PROOFS = 20;

/**
 * Adjuntar los comprobantes de un premio.
 *
 * Un premio grande no se paga de una: se manda desde varias cuentas para no
 * pasar el límite de cada billetera, y entonces hay tres o cuatro comprobantes
 * para el mismo premio. El diálogo viejo aceptaba uno solo, así que el operador
 * tenía que elegir cuál guardar y los otros se perdían — justo la evidencia que
 * hace falta cuando el usuario dice que no le llegó todo.
 *
 * Los archivos se suben apenas se eligen: al confirmar ya están arriba y el
 * premio se cierra al toque. Si uno falla se puede reintentar sin perder los
 * otros.
 */
export default function PayoutProofDialog({
  visible,
  claim,
  busy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  claim: any | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (proofs: PayoutProof[]) => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [picking, setPicking] = useState(false);

  // Cada premio arranca con la lista limpia: arrastrar los comprobantes del
  // anterior sería mandarle a un usuario la transferencia de otro.
  useEffect(() => {
    if (!visible) setItems([]);
  }, [visible, claim?.id]);

  if (!claim) return null;

  const amount = claimAmount(claim);
  const username = prizeUsername(claim);
  const ready = items.filter((i) => i.status === 'ready');
  const uploading = items.some((i) => i.status === 'uploading');
  const failed = items.filter((i) => i.status === 'error');
  const total = ready.length;

  const add = (attachments: Attachment[]) => {
    setItems((prev) => {
      const room = MAX_PROOFS - prev.length;
      if (room <= 0) {
        toast.error(`Máximo ${MAX_PROOFS} comprobantes por premio`);
        return prev;
      }
      const next = attachments.slice(0, room);
      if (attachments.length > room) {
        toast.error(`Sólo entran ${MAX_PROOFS} comprobantes: se agregaron ${room}`);
      }
      next.forEach((a) => upload(a));
      return [...prev, ...next];
    });
  };

  const upload = async (a: Attachment) => {
    const res = await uploadPayoutProof(a.source.uri, a.name, a.source.mime);
    setItems((prev) =>
      prev.map((i) =>
        i.id === a.id
          ? res.url
            ? { ...i, status: 'ready', url: res.url, type: res.type || i.type }
            : { ...i, status: 'error', error: res.error || 'No se pudo subir' }
          : i,
      ),
    );
  };

  const retry = (a: Attachment) => {
    setItems((prev) =>
      prev.map((i) => (i.id === a.id ? { ...i, status: 'uploading', error: undefined } : i)),
    );
    upload(a);
  };

  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  /** Galería del celular. En web no existe: ahí todo entra por "Archivos". */
  const pickFromGallery = async () => {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error('Hace falta permiso para acceder a la galería');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PROOFS,
        quality: 0.85,
      });
      if (r.canceled) return;
      add(
        (r.assets || []).map((a, idx) => {
          const ext = (a.fileName?.split('.').pop() || 'jpg').toLowerCase();
          return {
            id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
            name: a.fileName || `comprobante-${Date.now()}-${idx + 1}.${ext}`,
            type: 'image' as const,
            preview: a.uri,
            status: 'uploading' as const,
            source: {
              uri: a.uri,
              mime: a.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg'),
            },
          };
        }),
      );
    } finally {
      setPicking(false);
    }
  };

  /** Imágenes y PDFs, varios de una. Es el único camino en web. */
  const pickFiles = async () => {
    setPicking(true);
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (r.canceled) return;
      add(
        (r.assets || []).map((a, idx) => {
          const mime = a.mimeType || guessMime(a.name);
          const isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(a.name || '');
          return {
            id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
            name: a.name || `comprobante-${Date.now()}-${idx + 1}`,
            type: (isPdf ? 'pdf' : 'image') as 'pdf' | 'image',
            preview: isPdf ? undefined : a.uri,
            status: 'uploading' as const,
            source: { uri: a.uri, mime },
          };
        }),
      );
    } finally {
      setPicking(false);
    }
  };

  const confirm = () => {
    if (!ready.length) return toast.error('Adjuntá al menos un comprobante');
    if (uploading) return toast.error('Esperá a que terminen de subir');
    onConfirm(ready.map((i) => ({ url: i.url!, type: i.type, name: i.name })));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.overlay} onPress={busy ? undefined : onCancel}>
        <Pressable style={s.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={s.title}>Comprobantes de la transferencia</Text>
          <Text style={s.message}>
            Confirmás que le transferiste {formatMoney(amount)} a {username}. Si lo pagaste
            desde varias cuentas, adjuntá todos los comprobantes: se le mandan por chat.
          </Text>

          <View style={s.pickers}>
            {Platform.OS !== 'web' && (
              <Pressable onPress={pickFromGallery} disabled={picking || busy} style={s.picker}>
                <Ionicons name="images-outline" size={16} color={colors.textPrimary} />
                <Text style={s.pickerText}>Galería</Text>
              </Pressable>
            )}
            <Pressable onPress={pickFiles} disabled={picking || busy} style={s.picker}>
              <Ionicons name="attach-outline" size={16} color={colors.textPrimary} />
              <Text style={s.pickerText}>
                {Platform.OS === 'web' ? 'Elegir archivos (imagen o PDF)' : 'Archivos'}
              </Text>
            </Pressable>
          </View>

          {items.length > 0 && (
            <ScrollView style={s.list} contentContainerStyle={{ gap: space.sm }}>
              {items.map((i) => (
                <View key={i.id} style={s.item}>
                  {i.preview ? (
                    <Image source={{ uri: i.preview }} style={s.thumb} />
                  ) : (
                    <View style={[s.thumb, s.thumbIcon]}>
                      <Ionicons
                        name={i.type === 'pdf' ? 'document-text-outline' : 'image-outline'}
                        size={18}
                        color={colors.textSecondary}
                      />
                    </View>
                  )}

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.itemName} numberOfLines={1}>{i.name}</Text>
                    <Text
                      style={[
                        s.itemStatus,
                        i.status === 'error' && { color: colors.error },
                        i.status === 'ready' && { color: colors.success },
                      ]}
                      numberOfLines={1}
                    >
                      {i.status === 'uploading'
                        ? 'Subiendo…'
                        : i.status === 'ready'
                          ? 'Listo'
                          : i.error || 'No se pudo subir'}
                    </Text>
                  </View>

                  {i.status === 'uploading' && <ActivityIndicator size="small" color={colors.primary} />}
                  {i.status === 'error' && (
                    <Pressable onPress={() => retry(i)} style={s.iconBtn}>
                      <Ionicons name="refresh" size={16} color={colors.warning} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => remove(i.id)} style={s.iconBtn} disabled={busy}>
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <Text style={s.summary}>
            {total === 0
              ? 'Todavía no adjuntaste ningún comprobante.'
              : `${total} comprobante${total === 1 ? '' : 's'} listo${total === 1 ? '' : 's'}${
                  failed.length ? ` · ${failed.length} con error` : ''
                }`}
          </Text>

          <View style={s.actions}>
            <Button label="Cancelar" tone="neutral" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              label="Marcar como pagado"
              tone="success"
              onPress={confirm}
              loading={busy}
              disabled={!total || uploading}
              style={{ flex: 1 }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function guessMime(name?: string): string {
  const ext = (name?.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  title: { ...text.title, color: colors.textPrimary },
  message: { ...text.body, color: colors.textSecondary, lineHeight: 20 },

  pickers: { flexDirection: 'row', gap: space.sm },
  picker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.cardBackground,
  },
  pickerText: { ...text.label, color: colors.textPrimary },

  list: { maxHeight: 220 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.cardBackground,
  },
  thumb: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surfaceElevated },
  thumbIcon: { alignItems: 'center', justifyContent: 'center' },
  itemName: { ...text.body, color: colors.textPrimary },
  itemStatus: { ...text.caption, color: colors.textMuted },
  iconBtn: { padding: space.xs },

  summary: { ...text.caption, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: space.sm },
});
