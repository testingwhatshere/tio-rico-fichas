import type { ThemeConfig } from '@/lib/types'

interface PanelMockupProps {
  theme: ThemeConfig
  appName: string
}

export function PanelMockup({ theme, appName }: PanelMockupProps) {
  return (
    <div className="space-y-2">
      <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Panel del operador</span>
      <div className="mx-auto w-[240px]">
        <div
          className="rounded-lg border border-gray-700/50 overflow-hidden shadow-2xl shadow-black/40"
          style={{ backgroundColor: theme.backgroundColor }}
        >
          {/* Top bar */}
          <div className="h-6 flex items-center justify-between px-3" style={{ backgroundColor: theme.headerColor }}>
            <span style={{ color: theme.textColor, fontSize: 8, fontWeight: 600 }}>
              {appName || 'Panel'} - Operador
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.successColor }} />
              <span style={{ color: theme.successColor, fontSize: 7 }}>Online</span>
            </div>
          </div>

          <div className="flex" style={{ minHeight: 160 }}>
            {/* Sidebar */}
            <div className="w-12 py-2 flex flex-col items-center gap-2" style={{ backgroundColor: `${theme.primaryColor}18`, borderRight: `1px solid ${theme.primaryColor}25` }}>
              {['📊', '💬', '⚠️', '📋'].map((icon, i) => (
                <div
                  key={i}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] transition-colors"
                  style={{
                    backgroundColor: i === 0 ? `${theme.accentColor}20` : 'transparent',
                    border: i === 0 ? `1px solid ${theme.accentColor}40` : '1px solid transparent',
                  }}
                >
                  {icon}
                </div>
              ))}
            </div>

            {/* Main content */}
            <div className="flex-1 p-2 space-y-2">
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: 'Hoy', value: '12', color: theme.accentColor },
                  { label: 'Pendientes', value: '3', color: theme.primaryColor },
                  { label: 'Fallos', value: '1', color: theme.errorColor },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded p-1 text-center"
                    style={{ backgroundColor: `${stat.color}10`, border: `1px solid ${stat.color}20` }}
                  >
                    <div style={{ color: stat.color, fontSize: 11, fontWeight: 700 }}>{stat.value}</div>
                    <div style={{ color: theme.textColor, fontSize: 6, opacity: 0.6 }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Request rows */}
              <div className="space-y-1">
                {[
                  { user: 'usuario123', amount: '$5,000', status: 'Completado', statusColor: theme.successColor },
                  { user: 'jugador456', amount: '$2,500', status: 'Procesando', statusColor: theme.accentColor },
                  { user: 'player789', amount: '$10,000', status: 'Fallido', statusColor: theme.errorColor },
                ].map((row) => (
                  <div
                    key={row.user}
                    className="flex items-center justify-between rounded px-1.5 py-1"
                    style={{ backgroundColor: `${theme.textColor}06`, border: `1px solid ${theme.textColor}08` }}
                  >
                    <div>
                      <div style={{ color: theme.textColor, fontSize: 7, fontWeight: 500 }}>{row.user}</div>
                      <div style={{ color: theme.textColor, fontSize: 6, opacity: 0.5 }}>{row.amount}</div>
                    </div>
                    <span
                      className="rounded-full px-1.5 py-0.5"
                      style={{ backgroundColor: `${row.statusColor}15`, color: row.statusColor, fontSize: 6, fontWeight: 600 }}
                    >
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Action button */}
              <button
                className="w-full rounded py-1 text-center"
                style={{
                  backgroundColor: theme.accentColor,
                  color: theme.backgroundColor,
                  fontSize: 7,
                  fontWeight: 700,
                }}
              >
                Ver todos los pedidos
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
