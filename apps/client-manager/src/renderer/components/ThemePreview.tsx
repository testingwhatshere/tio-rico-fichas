import type { ThemeConfig } from '../lib/types'

interface ThemePreviewProps {
  theme: ThemeConfig
  appName: string
}

export function ThemePreview({ theme, appName }: ThemePreviewProps) {
  return (
    <div className="space-y-3">
      <span className="text-xs font-medium text-gray-400">Preview de la app</span>

      {/* Phone mockup */}
      <div className="mx-auto w-[220px]">
        <div
          className="rounded-[24px] border-2 border-gray-700 overflow-hidden shadow-2xl"
          style={{ backgroundColor: theme.backgroundColor }}
        >
          {/* Status bar */}
          <div className="h-5 flex items-center justify-between px-4" style={{ backgroundColor: theme.headerColor }}>
            <span style={{ color: theme.textColor, fontSize: 8, opacity: 0.5 }}>9:41</span>
            <div className="flex gap-1">
              <div className="w-2.5 h-1.5 rounded-sm" style={{ backgroundColor: theme.textColor, opacity: 0.3 }} />
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.textColor, opacity: 0.3 }} />
            </div>
          </div>

          {/* Header */}
          <div
            className="px-3 py-2.5 flex items-center gap-2"
            style={{ backgroundColor: theme.headerColor, borderBottom: `1px solid ${theme.primaryColor}33` }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: theme.primaryColor, fontSize: 8 }}
            >
              {(appName || 'A')[0].toUpperCase()}
            </div>
            <span style={{ color: theme.textColor, fontSize: 11, fontWeight: 600 }}>
              {appName || 'Mi App'}
            </span>
          </div>

          {/* Chat messages */}
          <div className="px-2.5 py-3 space-y-2" style={{ minHeight: 180 }}>
            {/* System message */}
            <div className="flex justify-center">
              <div
                className="px-2 py-1 rounded-full"
                style={{ backgroundColor: `${theme.primaryColor}15`, border: `1px solid ${theme.primaryColor}30` }}
              >
                <span style={{ color: theme.accentColor, fontSize: 8 }}>Bienvenido!</span>
              </div>
            </div>

            {/* User message */}
            <div className="flex justify-end">
              <div
                className="max-w-[70%] px-2.5 py-1.5 rounded-xl rounded-tr-sm"
                style={{ backgroundColor: theme.primaryColor }}
              >
                <span style={{ color: '#fff', fontSize: 9 }}>Quiero cargar 5000</span>
              </div>
            </div>

            {/* Bot message */}
            <div className="flex justify-start">
              <div
                className="max-w-[70%] px-2.5 py-1.5 rounded-xl rounded-tl-sm"
                style={{ backgroundColor: `${theme.textColor}12` }}
              >
                <span style={{ color: theme.textColor, fontSize: 9 }}>Perfecto! Enviame el comprobante</span>
              </div>
            </div>

            {/* Status card */}
            <div
              className="rounded-lg p-2 mx-1"
              style={{ backgroundColor: `${theme.successColor}12`, border: `1px solid ${theme.successColor}25` }}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full flex items-center justify-center" style={{ backgroundColor: theme.successColor }}>
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <span style={{ color: theme.successColor, fontSize: 8, fontWeight: 600 }}>Pago verificado</span>
              </div>
            </div>

            {/* Error example */}
            <div
              className="rounded-lg p-2 mx-1"
              style={{ backgroundColor: `${theme.errorColor}10`, border: `1px solid ${theme.errorColor}20` }}
            >
              <span style={{ color: theme.errorColor, fontSize: 8 }}>Error de ejemplo</span>
            </div>
          </div>

          {/* Input bar */}
          <div
            className="px-2.5 py-2 flex items-center gap-2"
            style={{ backgroundColor: theme.headerColor, borderTop: `1px solid ${theme.primaryColor}20` }}
          >
            <div
              className="flex-1 rounded-full px-2.5 py-1"
              style={{ backgroundColor: `${theme.textColor}08`, border: `1px solid ${theme.textColor}15` }}
            >
              <span style={{ color: theme.textColor, fontSize: 8, opacity: 0.4 }}>Escribir mensaje...</span>
            </div>
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: theme.accentColor }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.backgroundColor} strokeWidth="3">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </div>
          </div>

          {/* Home indicator */}
          <div className="h-3 flex justify-center items-center" style={{ backgroundColor: theme.backgroundColor }}>
            <div className="w-16 h-1 rounded-full" style={{ backgroundColor: theme.textColor, opacity: 0.15 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
