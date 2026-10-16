/**
 * Buscar a una persona desde cualquier pantalla.
 *
 * La pregunta que interrumpe el turno es siempre la misma —"¿qué pasa con
 * fulano?"— y hasta ahora había que elegir primero en qué pantalla buscarlo:
 * Seguimiento, Historial, Usuarios o Chats, cada una con su propio buscador y
 * su propio recorte de la realidad. Acá se escribe el nombre (o el teléfono) y
 * se entra a su ficha, que tiene todo.
 *
 * Busca clientes, no cargas: la carga se encuentra a través de la persona.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { emitWithTimeout, getSocket } from '@/services/socket';
import { colors, space, radius, text } from '@/constants/theme';

type Client = {
  id: string;
  username: string | null;
  savedTargetUsername: string | null;
  phone: string | null;
  panel: { name: string } | null;
};

/** Lo suficiente para no disparar una consulta por tecla. */
const DEBOUNCE_MS = 300;
/** Menos de esto trae medio padrón y no acerca a nadie. */
const MIN_CHARS = 2;

export default function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Client[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try {
        if (!getSocket()?.connected) return;
        const res: any = await emitWithTimeout('get_clients', { query: q, limit: 8 }, 15000);
        if (res?.success && Array.isArray(res.data)) {
          setResults(res.data);
          setOpen(true);
        }
      } catch {
        // Un buscador que no encontró no es un error que interrumpa el turno.
      } finally {
        setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const go = (client: Client) => {
    setQuery('');
    setResults([]);
    setOpen(false);
    router.push(`/user/${client.id}` as any);
  };

  return (
    <View style={s.wrap}>
      <View style={s.box}>
        <Ionicons name="search" size={15} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setOpen(true)}
          placeholder="Buscar cliente"
          placeholderTextColor={colors.placeholder}
          style={s.input}
        />
        {busy && <ActivityIndicator size="small" color={colors.textMuted} />}
        {!busy && !!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close" size={15} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {open && results.length > 0 && (
        <View style={s.results}>
          {results.map((c) => {
            const name = c.savedTargetUsername ?? c.username ?? '—';
            return (
              <Pressable key={c.id} style={s.result} onPress={() => go(c)}>
                <Text style={s.resultName} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={s.resultMeta} numberOfLines={1}>
                  {[c.phone, c.panel?.name].filter(Boolean).join(' · ') || 'sin panel'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {open && !busy && query.trim().length >= MIN_CHARS && results.length === 0 && (
        <View style={s.results}>
          <Text style={s.none}>Nadie con ese nombre ni ese teléfono</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: space.sm, paddingBottom: space.sm, zIndex: 10 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: 34,
  },
  input: { flex: 1, ...text.body, color: colors.textPrimary, outlineStyle: 'none' } as any,
  results: {
    marginTop: space.xs,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  result: { paddingHorizontal: space.md, paddingVertical: space.sm },
  resultName: { ...text.body, color: colors.textPrimary },
  resultMeta: { ...text.caption, color: colors.textMuted },
  none: { ...text.caption, color: colors.textMuted, padding: space.md },
});
