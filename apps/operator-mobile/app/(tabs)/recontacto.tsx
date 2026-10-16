import React, { useMemo, useState, useEffect } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { PageHeader, EmptyState } from '@/components/ui';
import { colors, space, radius, text } from '@/constants/theme';
import { USUARIOS_RECONTACTO, UsuarioRecontacto } from '@/constants/usuariosRecontacto';

/**
 * Ronda de recontacto por la mudanza de servidor del 2026-08-29.
 *
 * Los usuarios que ya tenian la app instalada quedaron apuntando a un servidor
 * que dejo de existir, y no hay forma de avisarles desde adentro: hay que
 * escribirle a cada uno el link nuevo. Esta pantalla es la lista de esa ronda.
 *
 * Los tildes viven en el navegador de cada operadora (localStorage), no en el
 * backend: es una tarea de una sola vez, no vale una tabla ni un endpoint. La
 * contra es que dos operadoras no ven lo del otro, asi que conviene que la
 * ronda la haga una sola persona.
 */

const STORAGE_KEY = 'tiorico:recontacto:contactados';

/** Lee los ya contactados. En web es localStorage; fuera de web no persiste. */
function leerContactados(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function guardarContactados(set: Set<string>) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Modo incognito o storage lleno: se pierde el tildado, no la lista.
  }
}

/** Telefono legible: 5492622256091 -> +54 9 2622 256091 */
function formatPhone(phone: string): string {
  if (!phone) return 'sin telefono';
  const m = phone.match(/^54(9?)(\d{2,4})(\d{6,8})$/);
  if (!m) return phone;
  return `+54 ${m[1] ? '9 ' : ''}${m[2]} ${m[3]}`;
}

function claveDe(u: UsuarioRecontacto): string {
  return u.username || u.phone;
}

export default function RecontactoScreen() {
  const [contactados, setContactados] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [ocultarHechos, setOcultarHechos] = useState(false);

  // El estado inicial se lee en un efecto, no en useState: en el render del
  // servidor (export web) no existe localStorage y romperia la hidratacion.
  useEffect(() => {
    setContactados(leerContactados());
  }, []);

  const toggle = (u: UsuarioRecontacto) => {
    const key = claveDe(u);
    setContactados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      guardarContactados(next);
      return next;
    });
  };

  const lista = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return USUARIOS_RECONTACTO.filter((u) => {
      if (ocultarHechos && contactados.has(claveDe(u))) return false;
      if (!q) return true;
      if (u.username.toLowerCase().includes(q)) return true;
      if (u.panelUsername.toLowerCase().includes(q)) return true;
      if (digits.length >= 3 && u.phone.includes(digits)) return true;
      return false;
    });
  }, [query, ocultarHechos, contactados]);

  const hechos = USUARIOS_RECONTACTO.filter((u) => contactados.has(claveDe(u))).length;
  const total = USUARIOS_RECONTACTO.length;

  const abrirWhatsapp = (u: UsuarioRecontacto) => {
    if (!u.phone) return;
    const msg = encodeURIComponent(
      'Hola! Cambiamos de servidor y la app vieja dejo de andar. ' +
        'Descargate la nueva desde https://tiorico-fichas.onrender.com ' +
        'o entra directo desde https://tiorico-juegos.onrender.com',
    );
    Linking.openURL(`https://wa.me/${u.phone}?text=${msg}`);
  };

  return (
    <View style={s.container}>
      <PageHeader
        title="Recontacto"
        subtitle={`${hechos} de ${total} contactados · los que hicieron al menos una carga`}
      />

      <View style={s.toolbar}>
        <View style={s.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={s.searchInput}
            placeholder="Buscar por usuario o telefono"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => setOcultarHechos((v) => !v)}
          style={[s.filtro, ocultarHechos && s.filtroActivo]}
        >
          <Ionicons
            name={ocultarHechos ? 'eye-off-outline' : 'eye-outline'}
            size={15}
            color={ocultarHechos ? colors.textOnPrimary : colors.textSecondary}
          />
          <Text style={[s.filtroText, ocultarHechos && s.filtroTextActivo]}>
            Ocultar hechos
          </Text>
        </Pressable>
      </View>

      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${total ? (hechos / total) * 100 : 0}%` }]} />
      </View>

      {lista.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title={ocultarHechos && hechos === total ? 'Listo, los contactaste a todos' : 'Sin resultados'}
          subtitle={query ? 'Probá con otro nombre o telefono.' : undefined}
        />
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(u) => claveDe(u)}
          contentContainerStyle={{ padding: space.md, gap: space.sm }}
          renderItem={({ item }) => {
            const hecho = contactados.has(claveDe(item));
            return (
              <Pressable onPress={() => toggle(item)} style={[s.fila, hecho && s.filaHecha]}>
                <View style={[s.check, hecho && s.checkOn]}>
                  {hecho && <Ionicons name="checkmark" size={15} color={colors.textOnPrimary} />}
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={[s.usuario, hecho && s.tachado]} numberOfLines={1}>
                    {item.username || '(sin usuario)'}
                  </Text>
                  <Text style={[s.telefono, hecho && s.tachado]} numberOfLines={1}>
                    {formatPhone(item.phone)}
                    {item.panelUsername && item.panelUsername !== item.username
                      ? ` · panel: ${item.panelUsername}`
                      : ''}
                  </Text>
                </View>

                <Text style={s.cargas}>
                  {item.cargas} {item.cargas === 1 ? 'carga' : 'cargas'}
                </Text>

                {!!item.phone && (
                  <Pressable
                    onPress={(e) => {
                      // Sin esto el tap abre WhatsApp y ademas tacha la fila.
                      e.stopPropagation?.();
                      abrirWhatsapp(item);
                    }}
                    style={s.waBtn}
                  >
                    <Ionicons name="logo-whatsapp" size={17} color={colors.onlineGreen} />
                  </Pressable>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    height: 38,
  },
  searchInput: { flex: 1, ...text.body, color: colors.textPrimary, outlineStyle: 'none' } as any,
  filtro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.sm,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  filtroActivo: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtroText: { color: colors.textSecondary, ...text.body },
  filtroTextActivo: { color: colors.textOnPrimary, fontWeight: '600' },
  progressTrack: {
    height: 3,
    backgroundColor: colors.border,
    marginHorizontal: space.md,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.onlineGreen },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  filaHecha: { opacity: 0.55 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.onlineGreen, borderColor: colors.onlineGreen },
  usuario: { color: colors.textPrimary, ...text.bodyStrong },
  telefono: { color: colors.textSecondary, ...text.caption, marginTop: 1 },
  tachado: { textDecorationLine: 'line-through' },
  cargas: { color: colors.textMuted, ...text.caption },
  waBtn: { padding: 6 },
});
