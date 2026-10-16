import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useOperatorStore } from '@/stores/operator.store';
import { emitWithTimeout } from '@/services/socket';
import { toast } from '@/components/Toast';
import colors from '@/constants/colors';

/**
 * Cartel fijo, arriba de todas las pantallas, mientras la extensión de algún
 * panel esté frenada (circuit breaker). Mientras dura, ese panel NO carga nada:
 * cada pedido falla al instante y hay que cargarlo a mano.
 *
 * Existe porque el 2026-10-15 los operadores cargaron a mano todo el día sin
 * enterarse: el aviso era un Alert.alert, que en la web no muestra nada.
 * No se puede cerrar: desaparece sólo cuando la extensión vuelve a andar.
 */
export default function BreakerBanner() {
  const extensions = useOperatorStore((s) => s.extensions);
  const panels = useOperatorStore((s) => (s.settings as any)?.panels) as any[] | undefined;
  const [resetting, setResetting] = useState<string | null>(null);

  const stopped = extensions.filter((e: any) => e.circuitBreakerActive);
  if (stopped.length === 0) return null;

  const panelName = (id: string) => panels?.find((p: any) => p.id === id)?.name || id?.slice(0, 8);

  const reactivate = async (extensionId: string) => {
    setResetting(extensionId);
    try {
      await emitWithTimeout('reset_circuit_breaker', { extensionId }, 15000);
      toast.success(`${panelName(extensionId)} reactivado`);
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo reactivar');
    } finally {
      setResetting(null);
    }
  };

  return (
    <View>
      {stopped.map((e: any) => {
        const reason = Array.isArray(e.breakerReasons) && e.breakerReasons.length
          ? e.breakerReasons[e.breakerReasons.length - 1]
          : null;
        return (
          <View key={e.extensionId} style={styles.bar}>
            <View style={styles.texts}>
              <Text style={styles.title}>
                {panelName(e.extensionId)} PAUSADO — no está cargando nada
              </Text>
              {reason ? <Text style={styles.reason} numberOfLines={2}>Último error: {reason}</Text> : null}
              <Text style={styles.hint}>
                Revisar la pestaña del panel en la PC del bot (que no pida login) y después tocar Reactivar.
              </Text>
            </View>
            <Pressable
              style={[styles.button, resetting === e.extensionId && styles.buttonBusy]}
              disabled={resetting === e.extensionId}
              onPress={() => reactivate(e.extensionId)}
            >
              <Text style={styles.buttonText}>{resetting === e.extensionId ? '...' : 'Reactivar'}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  texts: { flex: 1 },
  title: { color: '#fff', fontSize: 14, fontWeight: '800' },
  reason: { color: '#fff', fontSize: 12, marginTop: 2, opacity: 0.95 },
  hint: { color: '#fff', fontSize: 12, marginTop: 2, opacity: 0.85 },
  button: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: colors.error, fontWeight: '800', fontSize: 13 },
});
