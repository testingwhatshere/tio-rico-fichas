/**
 * El comprobante, con red de seguridad.
 *
 * Un `<Image>` pelado falla en silencio: si el archivo no se puede mostrar
 * (Cloudinary devuelve 401 para un PDF crudo, el asset se borró, el CDN está
 * caído) queda un recuadro vacío y el operador no tiene forma de saber si la
 * carga no tiene comprobante o si el comprobante no cargó. Son dos cosas muy
 * distintas: una se resuelve pidiéndole el comprobante al usuario y la otra no.
 *
 * Acá el fallo se ve y tiene salida: se abre el archivo en una pestaña aparte,
 * donde el navegador sabe mostrar formatos que el `<img>` no.
 */
import React, { useState } from 'react';
import { View, Text, Image, Pressable, Linking, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, space, radius, text, alpha } from '@/constants/theme';
import { proofThumbUrl } from '@/utils/proofUrl';

type Props = {
  uri: string;
  /** Mismo contrato que `<Image>`: se aplica al visor y al cartel de error. */
  style?: any;
  resizeMode?: 'cover' | 'contain';
  /** Miniaturas: el cartel completo no entra, va sólo el ícono. */
  compact?: boolean;
};

export default function ProofImage({
  uri,
  style,
  resizeMode = 'contain',
  compact = false,
}: Props) {
  const [failed, setFailed] = useState(false);
  // En las listas se pide una versión de 128 px (~7 KB en vez de ~300 KB). Si esa
  // versión no se puede generar, se cae al archivo original antes de dar el
  // comprobante por perdido: que falle el recorte no significa que no haya
  // comprobante.
  const [useOriginal, setUseOriginal] = useState(false);
  const src = compact && !useOriginal ? proofThumbUrl(uri) || uri : uri;

  // Resetea el estado si cambia el comprobante mostrado: sin esto, una vez que
  // falla uno, el siguiente hereda el cartel de error.
  React.useEffect(() => {
    setFailed(false);
    setUseOriginal(false);
  }, [uri]);

  if (!failed) {
    return (
      <Image
        source={{ uri: src }}
        style={style}
        resizeMode={resizeMode}
        onError={() => {
          if (src !== uri) setUseOriginal(true);
          else setFailed(true);
        }}
      />
    );
  }

  if (compact) {
    return (
      <View style={[style, s.compact]}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
      </View>
    );
  }

  // El cartel NO hereda el tamaño de la imagen: adentro de un visor a pantalla
  // completa se estiraba de borde a borde y tapaba el fondo, que es justamente
  // donde se toca para cerrar. Queda del tamaño de una tarjeta, con aire
  // alrededor.
  return (
    <View style={s.box}>
      <Ionicons name="alert-circle-outline" size={32} color={colors.warning} />
      <Text style={s.title}>No se pudo mostrar el comprobante</Text>
      <Pressable onPress={() => Linking.openURL(uri)} style={s.link}>
        <Ionicons name="open-outline" size={16} color={colors.primary} />
        <Text style={s.linkText}>Abrir en una pestaña nueva</Text>
      </Pressable>
      <Text style={s.hint}>Tocá afuera para cerrar</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    maxWidth: 340,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: alpha(colors.warning, 0.4),
    padding: space.lg,
  },
  compact: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundSecondary,
  },
  title: { ...text.body, color: colors.textSecondary, textAlign: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  linkText: { ...text.body, color: colors.primary, fontWeight: '600' },
  hint: { ...text.caption, color: colors.textMuted },
});
