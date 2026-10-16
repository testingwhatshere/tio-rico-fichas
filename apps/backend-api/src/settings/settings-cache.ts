/**
 * Estado del cache de Setting, en un modulo sin dependencias.
 *
 * Vive aparte de SettingsService a proposito: los servicios que escriben
 * Setting directo (dashboard, bot, telegram) tienen que poder invalidarlo, y
 * si importan SettingsService se arma un ciclo de imports que deja la clase
 * `undefined` al momento de resolver la inyeccion de Nest (la API no arranca).
 */
export const settingsCache: {
  value: { at: number; rows: Map<string, any> } | null;
  loading: Promise<Map<string, any>> | null;
} = { value: null, loading: null };

export function invalidateSettingsCache(): void {
  settingsCache.value = null;
}
