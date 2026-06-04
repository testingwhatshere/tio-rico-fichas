import type { ThemeConfig } from '@/lib/types'

interface PhoneMockupProps {
  theme: ThemeConfig
  appName: string
}

export function PhoneMockup({ theme, appName }: PhoneMockupProps) {
  const initial = (appName || 'A')[0].toUpperCase()

  return (
    <div className="space-y-2">
      <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">App del usuario</span>
      <div className="mx-auto w-[200px]">
        <div
          className="rounded-[22px] border-2 border-gray-700/50 overflow-hidden shadow-2xl shadow-black/40"
          style={{ backgroundColor: theme.backgroundColor }}
        >
          {/* Status bar */}
          <div className="h-5 flex items-center justify-between px-4" style={{ backgroundColor: theme.headerColor }}>
            <span style={{ color: theme.textColor, fontSize: 7, opacity: 0.5 }}>9:41</span>
            <div className="flex gap-1">
              <div className="w-2.5 h-1.5 rounded-sm" style={{ backgroundColor: theme.textColor, opacity: 0.3 }} />
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.textColor, opacity: 0.3 }} />
            </div>
          </div>

          {/* Header */}
          <div
            className="px-3 py-2 flex items-center gap-2"
            style={{ backgroundColor: theme.headerColor, borderBottom: `1px solid ${theme.primaryColor}33` }}
          >
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: theme.primaryColor, fontSize: 7 }}
            >
              {initial}
            </div>
            <span style={{ color: theme.textColor, fontSize: 10, fontWeight: 600 }}>
              {appName || 'Mi App'}
            </span>
          </div>

          {/* Chat messages */}
          <div className="px-2 py-2.5 space-y-1.5" style={{ minHeight: 155 }}>
            {/* System message */}
            <div className="flex justify-center">
              <div
                className="px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${theme.primaryColor}15`, border: `1px solid ${theme.primaryColor}30` }}
              >
                <span style={{ color: theme.accentColor, fontSize: 7 }}>Bienvenido!</span>
              </div>
            </div>

            {/* User message */}
            <div className="flex justify-end">
              <div
                className="max-w-[72%] px-2 py-1 rounded-xl rounded-tr-sm"
                style={{ backgroundColor: theme.primaryColor }}
              >
                <span style={{ color: '#fff', fontSize: 8 }}>Quiero cargar 5000</span>
              </div>
            </div>

            {/* Bot message */}
            <div className="flex justify-start">
              <div
                className="max-w-[72%] px-2 py-1 rounded-xl rounded-tl-sm"
                style={{ backgroundColor: `${theme.textColor}12` }}
              >
                <span style={{ color: theme.textColor, fontSize: 8 }}>Perfecto! Enviame el comprobante</span>
              </div>
            </div>

            {/* Success card */}
            <div
              className="rounded-md p-1.5 mx-0.5"
              style={{ backgroundColor: `${theme.successColor}12`, border: `1px solid ${theme.successColor}25` }}
            >
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full flex items-center justify-center" style={{ backgroundColor: theme.successColor }}>
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <span style={{ color: theme.successColor, fontSize: 7, fontWeight: 600 }}>Pago verificado</span>
              </div>
            </div>

            {/* Error example */}
            <div
              className="rounded-md p-1.5 mx-0.5"
              style={{ backgroundColor: `${theme.errorColor}10`, border: `1px solid ${theme.errorColor}20` }}
            >
              <span style={{ color: theme.errorColor, fontSize: 7 }}>Error de ejemplo</span>
            </div>
          </div>

          {/* Input bar */}
          <div
            className="px-2 py-1.5 flex items-center gap-1.5"
            style={{ backgroundColor: theme.headerColor, borderTop: `1px solid ${theme.primaryColor}20` }}
          >
            <div
              className="flex-1 rounded-full px-2 py-0.5"
              style={{ backgroundColor: `${theme.textColor}08`, border: `1px solid ${theme.textColor}15` }}
            >
              <span style={{ color: theme.textColor, fontSize: 7, opacity: 0.4 }}>Escribir mensaje...</span>
            </div>
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center"
              style={{ backgroundColor: theme.accentColor }}
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={theme.backgroundColor} strokeWidth="3">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </div>
          </div>

          {/* Home indicator */}
          <div className="h-2.5 flex justify-center items-center" style={{ backgroundColor: theme.backgroundColor }}>
            <div className="w-12 h-0.5 rounded-full" style={{ backgroundColor: theme.textColor, opacity: 0.15 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
