import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getApi } from '@/services/api';
import { toast } from '@/components/Toast';
import colors from '@/constants/colors';

interface Published {
  version: string | null;
  builtAt: string | null;
  panels: { slug: string; panelId: string; name: string }[];
}

/**
 * Botón para bajar la última versión de la extensión del bot, una por panel
 * (cada zip ya viene con su panel fijo). Sólo en la web: la extensión se
 * instala en el Chrome de la PC del bot, no en el celular.
 *
 * El zip lo entrega el backend con la clave de operador (lleva la clave del
 * bot, no puede estar en un link público).
 */
export default function ExtensionDownload({ installedVersions }: { installedVersions: Record<string, string> }) {
  const [published, setPublished] = useState<Published | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    getApi()
      .get<Published>('/operator/extension')
      .then((r) => setPublished(r.data))
      .catch(() => setPublished(null));
  }, []);

  if (Platform.OS !== 'web' || !published?.version) return null;

  const download = async (slug: string) => {
    setDownloading(slug);
    try {
      const r = await getApi().get(`/operator/extension/${slug}/download`, { responseType: 'blob', timeout: 60000 });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tio-rico-bot-${slug}-${published.version}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo descargar');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="download-outline" size={18} color={colors.primary} />
        <Text style={styles.title}>Última versión de la extensión: {published.version}</Text>
      </View>
      <Text style={styles.hint}>
        Cada archivo ya trae su panel. En la PC del bot: sacar la extensión vieja en chrome://extensions,
        descomprimir el zip y "Cargar descomprimida".
      </Text>
      <View style={styles.buttons}>
        {published.panels.map((p) => {
          const installed = installedVersions[p.panelId]?.replace(/-extension$/, '');
          const outdated = installed && installed !== published.version;
          return (
            <Pressable
              key={p.slug}
              style={[styles.button, downloading === p.slug && styles.buttonBusy]}
              disabled={downloading === p.slug}
              onPress={() => download(p.slug)}
            >
              <Text style={styles.buttonText}>{downloading === p.slug ? 'Descargando…' : `Descargar ${p.name}`}</Text>
              {installed ? (
                <Text style={[styles.installed, outdated && styles.outdated]}>
                  {outdated ? `instalada ${installed} — actualizar` : `instalada ${installed} ✓`}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: colors.primary + '20',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  installed: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  outdated: { color: colors.warning, fontWeight: '700' },
});
