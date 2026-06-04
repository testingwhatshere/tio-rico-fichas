import { useLocation, useNavigate } from 'react-router-dom'
import { Logo } from './Logo'

const NAV_ITEMS = [
  {
    id: 'clients',
    label: 'Clientes',
    path: '/',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    path: '/monitoring',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: 'commissions',
    label: 'Comisiones',
    path: '/commissions',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: 'finance',
    label: 'Finanzas',
    path: '/finance',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    ),
  },
  {
    id: 'runbook',
    label: 'Runbook',
    path: '/runbook',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    id: 'vpn',
    label: 'VPN',
    path: '/vpn',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
]

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  const currentPath = location.pathname

  function isActive(path: string): boolean {
    if (path === '/') return currentPath === '/'
    return currentPath.startsWith(path)
  }

  // Don't show sidebar on editor/detail pages (they have their own back nav)
  const hideOnPaths = ['/client/', '/monitoring/']
  const shouldHide = hideOnPaths.some(p => currentPath.startsWith(p) && currentPath !== p.slice(0, -1))
  if (shouldHide) return null

  return (
    <div className="w-14 bg-surface-0 border-r border-border flex flex-col items-center py-3 gap-1 shrink-0">
      {/* Logo at top */}
      <div className="mb-3 pb-2 border-b border-border/50">
        <Logo size={22} />
      </div>

      {NAV_ITEMS.map(item => {
        const active = isActive(item.path)
        return (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all ${
              active
                ? 'bg-accent/15 text-accent'
                : 'text-gray-600 hover:text-gray-400 hover:bg-surface-2'
            }`}
            title={item.label}
          >
            {item.icon}
            <span className="text-[8px] font-medium leading-none">{item.label.slice(0, 5)}</span>
          </button>
        )
      })}

      {/* Settings at bottom */}
      <div className="mt-auto pt-2 border-t border-border/50">
        <button
          onClick={() => navigate('/settings')}
          className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all ${
            isActive('/settings')
              ? 'bg-accent/15 text-accent'
              : 'text-gray-600 hover:text-gray-400 hover:bg-surface-2'
          }`}
          title="Configuracion"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <span className="text-[8px] font-medium leading-none">Config</span>
        </button>
      </div>
    </div>
  )
}
