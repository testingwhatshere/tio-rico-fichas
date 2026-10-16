import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useLayout } from '@/hooks/useLayout';
import { usePaidPrizes, PaidPrize } from '@/hooks/usePaidPrizes';
import { downloadInBrowser } from '@/hooks/useExport';
import { Button, EmptyState, FilterPills, PageHeader } from '@/components/ui';
import { toast } from '@/components/Toast';
import { formatMoney } from '@/utils/amount';
import {
  BACKGROUNDS,
  EFFECTS,
  INTENSITIES,
  SOLID_SWATCHES,
  TEMPLATES,
  BackgroundKind,
  EffectKind,
  Intensity,
  StatusContent,
  StatusStyle,
  TemplateKind,
  renderStatusBlob,
  renderStatusPreview,
} from '@/utils/statusImage';
import { colors, space, radius, text, alpha } from '@/constants/theme';

/**
 * Estados de WhatsApp.
 *
 * Arma imágenes 9:16 con premios pagados para publicar como estado. Nunca
 * muestran a quién se le pagó: el hook recorta cada premio a monto y fecha
 * antes de que llegue acá.
 *
 * Sólo web: el lienzo es el canvas del browser, y la operación va toda por la
 * web de operadores.
 */

const STYLE_KEY = 'estados_style';
const DEFAULT_FOOTER = 'Escribinos y empezá a jugar 🎰';
const MAX_COLLAGE = 6;
const LIST_LIMIT = 40;

const DEFAULT_STYLE: StatusStyle = {
  background: 'gold',
  solidColor: SOLID_SWATCHES[0],
  effects: ['sparkles', 'glow'],
  intensity: 'mid',
  seed: 1,
};

function newSeed() {
  return Math.floor(Math.random() * 1e9);
}

function loadStyle(): StatusStyle {
  try {
    const raw = window.localStorage.getItem(STYLE_KEY);
    if (!raw) return { ...DEFAULT_STYLE, seed: newSeed() };
    const saved = JSON.parse(raw);
    // La imagen propia no se guarda: al volver, ese fondo quedaría vacío.
    const background = saved.background === 'photo' ? 'gold' : saved.background;
    return { ...DEFAULT_STYLE, ...saved, background };
  } catch {
    return { ...DEFAULT_STYLE, seed: newSeed() };
  }
}

function saveStyle(style: StatusStyle) {
  try {
    window.localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    // Sin storage se pierde sólo la preferencia.
  }
}

function shortDay(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Abre el selector de archivos del browser y devuelve la imagen ya cargada. */
function pickImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

export default function EstadosScreen() {
  if (Platform.OS !== 'web') {
    return (
      <View style={s.screen}>
        <PageHeader title="Estados" subtitle="Imágenes de premios para WhatsApp" />
        <EmptyState icon="desktop-outline" title="Disponible en la web" subtitle="Abrí la web de operadores para generar estados." />
      </View>
    );
  }
  return <EstadosWeb />;
}

function EstadosWeb() {
  const { isDesktop, width } = useLayout();
  const { prizes, loaded, refreshing, refresh, connected, capped } = usePaidPrizes();

  const [template, setTemplate] = useState<TemplateKind>('single');
  const [singleId, setSingleId] = useState<string | null>(null);
  const [collageIds, setCollageIds] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<'today' | 'week'>('today');
  const [footer, setFooter] = useState(DEFAULT_FOOTER);
  const [style, setStyle] = useState<StatusStyle>(loadStyle);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => saveStyle(style), [style]);

  const recent = useMemo(() => prizes.slice(0, LIST_LIMIT), [prizes]);
  const single = recent.find((p) => p.id === singleId) ?? recent[0] ?? null;
  // Por defecto, los más recientes. Una vez que el operador toca la lista, manda su elección.
  const collage = useMemo(() => {
    if (collageIds === null) return recent.slice(0, MAX_COLLAGE);
    return recent.filter((p) => collageIds.includes(p.id));
  }, [recent, collageIds]);

  const summary = useMemo(() => {
    const now = new Date();
    const since =
      period === 'today'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        : now.getTime() - 7 * 86400000;
    const inPeriod = prizes.filter((p) => new Date(p.paidAt).getTime() >= since);
    // Si vino el tope de 100 y el más viejo todavía cae dentro del período, faltan premios.
    const oldest = prizes[prizes.length - 1];
    const partial = capped && !!oldest && new Date(oldest.paidAt).getTime() >= since;
    return {
      count: inPeriod.length,
      total: inPeriod.reduce((acc, p) => acc + p.amount, 0),
      partial,
    };
  }, [prizes, period, capped]);

  const content: StatusContent | null = useMemo(() => {
    if (template === 'single') return single ? { template, amount: single.amount, paidAt: single.paidAt } : null;
    if (template === 'collage') {
      return collage.length ? { template, items: collage.map((p) => ({ amount: p.amount, paidAt: p.paidAt })) } : null;
    }
    return summary.count ? { template, period, ...summary } : null;
  }, [template, single, collage, summary, period]);

  // Preview con debounce: mover la intensidad o tipear el pie no redibuja 1080×1920 por tecla.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!content) {
      setPreview(null);
      return;
    }
    timer.current = setTimeout(() => {
      try {
        setPreview(renderStatusPreview({ content, style, footer, photo }));
      } catch {
        setPreview(null);
      }
    }, 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, style, footer, photo]);

  const patchStyle = (patch: Partial<StatusStyle>) => setStyle((st) => ({ ...st, ...patch }));

  const toggleEffect = (key: EffectKind) =>
    patchStyle({
      effects: style.effects.includes(key) ? style.effects.filter((e) => e !== key) : [...style.effects, key],
    });

  const toggleCollage = (id: string) => {
    const current = collage.map((p) => p.id);
    if (current.includes(id)) setCollageIds(current.filter((x) => x !== id));
    else if (current.length >= MAX_COLLAGE) toast.error(`Hasta ${MAX_COLLAGE} premios por estado`);
    else setCollageIds([...current, id]);
  };

  const chooseBackground = async (key: BackgroundKind) => {
    if (key === 'photo') {
      const img = await pickImage();
      if (!img) return;
      setPhoto(img);
    }
    patchStyle({ background: key });
  };

  const surprise = () => {
    const bgs = BACKGROUNDS.filter((b) => b.key !== 'photo' || photo).map((b) => b.key);
    const effects = EFFECTS.map((e) => e.key).filter(() => Math.random() < 0.5);
    setStyle({
      background: bgs[Math.floor(Math.random() * bgs.length)],
      solidColor: SOLID_SWATCHES[Math.floor(Math.random() * SOLID_SWATCHES.length)],
      effects: effects.length ? effects : ['sparkles'],
      intensity: INTENSITIES[Math.floor(Math.random() * INTENSITIES.length)].key,
      seed: newSeed(),
    });
  };

  const makeBlob = async () => {
    if (!content) return null;
    return renderStatusBlob({ content, style, footer, photo });
  };

  const download = async () => {
    setBusy(true);
    try {
      const blob = await makeBlob();
      if (!blob) return;
      downloadInBrowser(blob, `estado-premio-${stamp()}.png`, 'image/png');
      toast.success('Estado descargado');
    } catch {
      toast.error('No se pudo generar la imagen');
    } finally {
      setBusy(false);
    }
  };

  // En el celular, "Compartir" manda la imagen directo a WhatsApp sin pasar por la galería.
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as any).canShare === 'function';
  const share = async () => {
    setBusy(true);
    try {
      const blob = await makeBlob();
      if (!blob) return;
      const file = new File([blob], `estado-premio-${stamp()}.png`, { type: 'image/png' });
      if (!(navigator as any).canShare({ files: [file] })) {
        downloadInBrowser(blob, file.name, 'image/png');
        toast.success('Este navegador no comparte imágenes: la descargué');
        return;
      }
      await (navigator as any).share({ files: [file] });
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast.error('No se pudo compartir');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || prizes.length === 0) {
    return (
      <View style={s.screen}>
        <PageHeader title="Estados" subtitle="Imágenes de premios para WhatsApp" />
        <EmptyState
          icon="image-outline"
          loading={!loaded}
          connected={connected}
          title="Todavía no hay premios pagados"
          subtitle="Cuando se pague un premio vas a poder armar el estado acá."
        />
      </View>
    );
  }

  const previewWidth = isDesktop ? 380 : Math.min(width - space.xl * 2, 340);

  const previewBlock = (
    <View style={[s.previewCol, isDesktop && { width: previewWidth }]}>
      <View style={[s.previewFrame, { width: previewWidth, height: (previewWidth * 16) / 9 }]}>
        {preview ? (
          <Image source={{ uri: preview }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={s.previewEmpty}>
            <Ionicons name="image-outline" size={32} color={colors.textMuted} />
            <Text style={s.hint}>
              {template === 'summary' ? 'No hay premios pagados en el período' : 'Elegí al menos un premio'}
            </Text>
          </View>
        )}
      </View>
      <View style={[s.actions, { width: previewWidth }]}>
        <Button label="Descargar PNG" icon="download-outline" tone="primary" onPress={download} loading={busy} disabled={!content} style={{ flex: 1 }} />
        {canShare && !isDesktop && (
          <Button label="Compartir" icon="share-social-outline" onPress={share} disabled={!content || busy} style={{ flex: 1 }} />
        )}
      </View>
      <View style={[s.actions, { width: previewWidth }]}>
        <Button label="Otra variante" icon="dice-outline" onPress={() => patchStyle({ seed: newSeed() })} style={{ flex: 1 }} />
        <Button label="Sorprendeme" icon="sparkles-outline" onPress={surprise} style={{ flex: 1 }} />
      </View>
    </View>
  );

  const prizeChip = (p: PaidPrize, active: boolean, onPress: () => void) => (
    <Pressable key={p.id} onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipAmount, active && s.chipTextActive]}>{formatMoney(p.amount)}</Text>
      <Text style={[s.chipDate, active && s.chipTextActive]}>{shortDay(p.paidAt)}</Text>
    </Pressable>
  );

  const controls = (
    <View style={s.controls}>
      <Section title="Plantilla">
        <View style={s.pills}>
          <FilterPills options={TEMPLATES} value={template} onChange={setTemplate} />
        </View>
      </Section>

      {template === 'single' && (
        <Section title="Premio" hint="Sólo se muestra el monto y el día. Nunca el usuario.">
          <View style={s.chips}>{recent.map((p) => prizeChip(p, p.id === single?.id, () => setSingleId(p.id)))}</View>
        </Section>
      )}

      {template === 'collage' && (
        <Section title={`Premios (${collage.length}/${MAX_COLLAGE})`} hint="Tocá para sumar o sacar. Queda mejor con 3 a 6.">
          <View style={s.chips}>
            {recent.map((p) => prizeChip(p, collage.some((c) => c.id === p.id), () => toggleCollage(p.id)))}
          </View>
        </Section>
      )}

      {template === 'summary' && (
        <Section
          title="Período"
          hint={`${summary.partial ? 'Más de 100' : summary.count} premios · ${formatMoney(summary.total)}${summary.partial ? ' o más' : ''}`}
        >
          <View style={s.pills}>
          <FilterPills
            options={[
              { key: 'today', label: 'Hoy' },
              { key: 'week', label: 'Últimos 7 días' },
            ]}
            value={period}
            onChange={setPeriod}
          />
          </View>
        </Section>
      )}

      <Section title="Fondo">
        <View style={s.chips}>
          {BACKGROUNDS.map((b) => (
            <Pressable
              key={b.key}
              onPress={() => chooseBackground(b.key)}
              style={[s.toggle, style.background === b.key && s.toggleActive]}
            >
              {b.key === 'photo' && (
                <Ionicons name="cloud-upload-outline" size={14} color={style.background === b.key ? colors.textOnPrimary : colors.textSecondary} />
              )}
              <Text style={[s.toggleText, style.background === b.key && s.chipTextActive]}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
        {style.background === 'solid' && (
          <View style={s.swatches}>
            {SOLID_SWATCHES.map((c) => (
              <Pressable
                key={c}
                onPress={() => patchStyle({ solidColor: c })}
                style={[s.swatch, { backgroundColor: c }, style.solidColor === c && s.swatchActive]}
              />
            ))}
          </View>
        )}
        {style.background === 'photo' && (
          <Text style={s.hint}>La imagen queda en tu navegador, no se sube a ningún lado. Tocá de nuevo para cambiarla.</Text>
        )}
      </Section>

      <Section title="Efectos">
        <View style={s.chips}>
          {EFFECTS.map((e) => {
            const on = style.effects.includes(e.key);
            return (
              <Pressable key={e.key} onPress={() => toggleEffect(e.key)} style={[s.toggle, on && s.toggleActive]}>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={on ? colors.textOnPrimary : colors.textMuted} />
                <Text style={[s.toggleText, on && s.chipTextActive]}>{e.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[s.pills, { marginTop: space.sm }]}>
          <FilterPills<Intensity> options={INTENSITIES} value={style.intensity} onChange={(k) => patchStyle({ intensity: k })} />
        </View>
      </Section>

      <Section title="Texto de abajo" hint="Dejalo vacío si no querés texto.">
        <TextInput
          value={footer}
          onChangeText={setFooter}
          placeholder={DEFAULT_FOOTER}
          placeholderTextColor={colors.placeholder}
          maxLength={120}
          style={s.input}
        />
      </Section>
    </View>
  );

  return (
    <View style={s.screen}>
      <PageHeader
        title="Estados"
        subtitle="Imágenes de premios pagados para WhatsApp, sin datos del cliente"
        right={<Button label="Actualizar" icon="refresh" onPress={refresh} loading={refreshing} />}
      />
      <ScrollView contentContainerStyle={[s.body, isDesktop && s.bodyDesktop]}>
        {isDesktop ? (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>{controls}</View>
            {previewBlock}
          </>
        ) : (
          <>
            {previewBlock}
            {controls}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
      {!!hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { padding: space.xl, paddingTop: 0, gap: space.xl },
  bodyDesktop: { flexDirection: 'row', alignItems: 'flex-start' },

  controls: { gap: space.xl },
  section: { gap: space.sm },
  // FilterPills trae padding lateral pensado para el borde de la pantalla; acá se compensa.
  pills: { marginHorizontal: -space.xl },
  sectionTitle: { ...text.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { ...text.caption, color: colors.textMuted },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 96,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipAmount: { ...text.bodyStrong, color: colors.textPrimary },
  chipDate: { ...text.caption, color: colors.textMuted },
  chipTextActive: { color: colors.textOnPrimary },

  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
  },
  toggleActive: { backgroundColor: colors.primary },
  toggleText: { ...text.label, color: colors.textSecondary },

  swatches: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  swatch: { width: 32, height: 32, borderRadius: radius.full, borderWidth: 2, borderColor: colors.border },
  swatchActive: { borderColor: colors.primary, borderWidth: 3 },

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

  previewCol: { alignItems: 'center', gap: space.md },
  previewFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: alpha(colors.primary, 0.3),
  },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  actions: { flexDirection: 'row', gap: space.sm },
});
