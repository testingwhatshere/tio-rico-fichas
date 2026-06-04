import { useCallback } from 'react';
import { Alert, Share, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

type ExportFormat = 'csv' | 'json';

function toCsv(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map((item) =>
    headers.map((h) => {
      const val = item[h];
      if (val == null) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      // Escape quotes and wrap in quotes if contains comma/newline
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

export function useExport() {
  const exportData = useCallback(
    async (data: any[], format: ExportFormat, title: string) => {
      if (data.length === 0) {
        Alert.alert('Sin datos', 'No hay datos para exportar');
        return;
      }

      const content = format === 'csv' ? toCsv(data) : JSON.stringify(data, null, 2);

      Alert.alert(
        `Exportar ${title}`,
        `${data.length} registros en formato ${format.toUpperCase()}`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Copiar',
            onPress: async () => {
              await Clipboard.setStringAsync(content);
              Alert.alert('Copiado', 'Datos copiados al portapapeles');
            },
          },
          {
            text: 'Compartir',
            onPress: async () => {
              try {
                await Share.share({
                  message: content,
                  title: `${title}.${format}`,
                });
              } catch {
                // User cancelled share
              }
            },
          },
        ],
      );
    },
    [],
  );

  return { exportData };
}
