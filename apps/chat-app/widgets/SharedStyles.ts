// Shared color palette and styles for all widgets
export const COLORS = {
  background: '#0B0F15',
  backgroundLight: '#141B24',
  accent: '#F5A623',
  accentDark: '#D4911E',
  textPrimary: '#FFFFFF',
  textSecondary: '#8B95A5',
  textMuted: '#5A6474',
  success: '#10B981',
  error: '#EF4444',
  processing: '#3B82F6',
  border: '#1E2A38',
};

// Status display config
export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_PROOF: { label: 'Esperando comprobante', color: COLORS.accent, icon: '📎' },
  VALIDATING: { label: 'Validando...', color: COLORS.processing, icon: '🔍' },
  PENDING_MP_VERIFICATION: { label: 'Verificando pago...', color: COLORS.processing, icon: '🏦' },
  APPROVED: { label: 'Aprobado', color: COLORS.success, icon: '✅' },
  PROCESSING: { label: 'Cargando fichas...', color: COLORS.processing, icon: '⚡' },
  COMPLETED: { label: 'Completado', color: COLORS.success, icon: '🎉' },
  FAILED: { label: 'Error', color: COLORS.error, icon: '❌' },
  VALIDATION_FAILED: { label: 'Validacion fallida', color: COLORS.error, icon: '⚠️' },
};
