import { useCallback } from 'react';
import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { toast } from '@/components/Toast';

type ExportFormat = 'csv' | 'json';

/** Convierte a CSV escapando comillas, comas y saltos de línea. */
function toCsv(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map((item) =>
    headers
      .map((h) => {
        const val = item[h];
        if (val == null) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

/** Descarga real en el browser: genera un blob y dispara un <a download>. */
export function downloadInBrowser(content: string | Blob, filename: string, mime: string) {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Sin esto el blob queda retenido en memoria mientras viva la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Exportar datos.
 *
 * En web descarga un archivo de verdad: antes abría un `Alert` con la opción
 * "Compartir", que llama a `Share.share` — una API que en el browser no existe,
 * así que el botón no hacía nada. La otra opción, "Copiar", volcaba miles de
 * líneas de CSV al portapapeles.
 */
export function useExport() {
  const exportData = useCallback(
    async (data: any[], format: ExportFormat, title: string) => {
      if (!data || data.length === 0) {
        toast.error('No hay datos para exportar');
        return;
      }

      const content = format === 'csv' ? toCsv(data) : JSON.stringify(data, null, 2);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `${title.toLowerCase().replace(/\s+/g, '-')}-${stamp}.${format}`;

      if (Platform.OS === 'web') {
        try {
          downloadInBrowser(content, filename, format === 'csv' ? 'text/csv' : 'application/json');
          toast.success(`${data.length} registros descargados`);
        } catch {
          await Clipboard.setStringAsync(content);
          toast.success('No se pudo descargar — copiado al portapapeles');
        }
        return;
      }

      try {
        await Share.share({ message: content, title: filename });
      } catch {
        await Clipboard.setStringAsync(content);
        toast.success('Copiado al portapapeles');
      }
    },
    [],
  );

  return { exportData };
}
