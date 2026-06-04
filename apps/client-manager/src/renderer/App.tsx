import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { ClientList } from './pages/ClientList'
import { ClientEditor } from './pages/ClientEditor'
import { SelectorEditor } from './pages/SelectorEditor'
import { MonitoringDashboard } from './pages/MonitoringDashboard'
import { MonitoringDetail } from './pages/MonitoringDetail'
import { CommissionsSummary } from './pages/CommissionsSummary'
import { LogViewer } from './pages/LogViewer'
import { VpnManager } from './pages/VpnManager'
import { FinanceDashboard } from './pages/FinanceDashboard'
import { Runbook } from './pages/Runbook'
import { Settings } from './pages/Settings'
import { Sidebar } from './components/Sidebar'
import { Logo } from './components/Logo'
import { ToastContainer } from './components/Toast'
import { useClientStore } from './store/client-store'

export function App() {
  const { saveCurrentClient, isDirty } = useClientStore()

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty) saveCurrentClient()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDirty, saveCurrentClient])

  return (
    <HashRouter>
      <div className="h-screen flex flex-col">
        {/* Titlebar */}
        <div className="titlebar-drag h-9 bg-surface-0 flex items-center px-4 border-b border-border shrink-0 gap-2">
          <Logo size={18} />
          <span className="text-[11px] font-semibold tracking-wide" style={{ color: '#c9983a' }}>Aurum</span>
        </div>

        {/* Content with sidebar */}
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <div className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<ClientList />} />
              <Route path="/client/:id" element={<ClientEditor />} />
              <Route path="/client/:id/selectors" element={<SelectorEditor />} />
              <Route path="/monitoring" element={<MonitoringDashboard />} />
              <Route path="/monitoring/:id" element={<MonitoringDetail />} />
              <Route path="/commissions" element={<CommissionsSummary />} />
            <Route path="/logs/:id" element={<LogViewer />} />
            <Route path="/vpn" element={<VpnManager />} />
            <Route path="/finance" element={<FinanceDashboard />} />
            <Route path="/runbook" element={<Runbook />} />
            <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </div>

        <ToastContainer />
      </div>
    </HashRouter>
  )
}
