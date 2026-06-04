import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClientStore } from '../store/client-store'
import { fetchMonitoringData, formatCurrency, formatNumber, timeAgo } from '../lib/monitoring-api'
import { toast } from '../components/Toast'
import type { ClientSummary, ClientMonitoringState } from '../lib/types'

export function MonitoringDashboard() {
  const navigate = useNavigate()
  const { clients, fetchClients } = useClientStore()
  const [monitoringStates, setMonitoringStates] = useState<Record<string, ClientMonitoringState>>({})
  const [refreshingAll, setRefreshingAll] = useState(false)

  useEffect(() => { fetchClients() }, [])

  const refreshClient = async (client: ClientSummary) => {
    // Load full config to get API URL and monitoring key
    setMonitoringStates(prev => ({
      ...prev,
      [client.id]: { ...prev[client.id], loading: true, error: null, data: prev[client.id]?.data || null, lastUpdated: prev[client.id]?.lastUpdated || null }
    }))

    try {
      const clientData = await window.api.loadClient(client.id)
      const config = clientData.config
      if (!config.apiUrl || !config.monitoringApiKey) {
        throw new Error('Falta API URL o Monitoring API Key en la config')
      }

      const data = await fetchMonitoringData(config.apiUrl, config.monitoringApiKey)
      setMonitoringStates(prev => ({
        ...prev,
        [client.id]: { data, loading: false, error: null, lastUpdated: Date.now() }
      }))
    } catch (e: any) {
      setMonitoringStates(prev => ({
        ...prev,
        [client.id]: { ...prev[client.id], loading: false, error: e.message, data: prev[client.id]?.data || null, lastUpdated: prev[client.id]?.lastUpdated || null }
      }))
      throw e // Re-throw so refreshAll can count errors
    }
  }

  const refreshAll = async () => {
    setRefreshingAll(true)
    let errorCount = 0
    // Rate limit: process in batches of 5 to avoid flooding networks
    const BATCH_SIZE = 5
    for (let i = 0; i < clients.length; i += BATCH_SIZE) {
      const batch = clients.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(batch.map(c => refreshClient(c)))
      errorCount += results.filter(r => r.status === 'rejected').length
    }
    setRefreshingAll(false)
    if (errorCount > 0) {
      toast(`${clients.length - errorCount} OK, ${errorCount} con error`, 'error')
    } else {
      toast('Todos los clientes actualizados', 'info')
    }
  }

  // Totals
  const totalRevenueToday = Object.values(monitoringStates)
    .filter(s => s.data)
    .reduce((sum, s) => sum + (s.data?.revenue.today || 0), 0)
  const totalRevenueMonth = Object.values(monitoringStates)
    .filter(s => s.data)
    .reduce((sum, s) => sum + (s.data?.revenue.month || 0), 0)
  const onlineCount = Object.values(monitoringStates)
    .filter(s => s.data && s.data.system.botStatus === 'online').length
  const clientsWithData = Object.values(monitoringStates).filter(s => s.data).length

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-xs text-gray-500 hover:text-gray-300">&larr;</button>
          <h1 className="text-lg font-semibold text-gray-100">Monitoring</h1>
          <span className="text-xs text-gray-600">{clients.length} clientes</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/commissions')}
            className="px-3 py-1.5 text-xs bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border border-yellow-700/40 rounded transition-colors"
          >
            Comisiones
          </button>
          <button
            onClick={refreshAll}
            disabled={refreshingAll}
            className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors"
          >
            {refreshingAll ? 'Actualizando...' : 'Refresh All'}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {clientsWithData > 0 && (
        <div className="px-6 py-3 border-b border-border flex items-center gap-6 bg-surface-1 shrink-0">
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Hoy</div>
            <div className="text-sm font-bold text-green-400">{formatCurrency(totalRevenueToday)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Mes</div>
            <div className="text-sm font-bold text-gray-200">{formatCurrency(totalRevenueMonth)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Bots Online</div>
            <div className="text-sm font-bold text-gray-200">
              <span className={onlineCount > 0 ? 'text-green-400' : 'text-red-400'}>{onlineCount}</span>
              <span className="text-gray-600">/{clientsWithData}</span>
            </div>
          </div>
        </div>
      )}

      {/* Client grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500">
            <p className="text-sm">No hay clientes configurados</p>
            <button onClick={() => navigate('/')} className="mt-2 text-xs text-accent hover:text-accent-hover">
              Ir a gestionar clientes
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {clients.map(client => {
              const state = monitoringStates[client.id]
              const data = state?.data
              const isLoading = state?.loading
              const error = state?.error
              const isStale = state?.lastUpdated && (Date.now() - state.lastUpdated) > 5 * 60 * 1000

              return (
                <div
                  key={client.id}
                  className={`bg-surface-1 border rounded-xl overflow-hidden transition-all group ${
                    error ? 'border-red-900/40' : data ? 'border-border hover:border-border-light' : 'border-border/50'
                  }`}
                >
                  {/* Card header */}
                  <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Status dot */}
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        !data ? 'bg-gray-700'
                          : data.system.botStatus === 'online' ? 'bg-green-500'
                          : data.system.botStatus === 'busy' ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`} />
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium text-gray-200 truncate">{client.businessName}</h3>
                        <p className="text-[10px] text-gray-600 font-mono">{client.id}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => refreshClient(client)}
                      disabled={isLoading}
                      className="px-2 py-1 text-[10px] bg-surface-3 hover:bg-surface-4 text-gray-400 rounded border border-border transition-colors disabled:opacity-50"
                    >
                      {isLoading ? '...' : 'Refresh'}
                    </button>
                  </div>

                  {/* Card body */}
                  <div className="px-4 py-3">
                    {!data && !error && !isLoading && (
                      <p className="text-xs text-gray-600 text-center py-4">
                        Click "Refresh" para cargar datos
                      </p>
                    )}

                    {isLoading && !data && (
                      <div className="flex items-center justify-center py-4">
                        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}

                    {error && (
                      <div className="text-center py-3">
                        <p className="text-xs text-red-400 mb-1">Error</p>
                        <p className="text-[10px] text-red-500/70">{error}</p>
                      </div>
                    )}

                    {data && (
                      <>
                        {/* Revenue row */}
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-[10px] text-gray-500">Hoy</div>
                            <div className="text-sm font-bold text-green-400">{formatCurrency(data.revenue.today)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-gray-500">Mes</div>
                            <div className="text-sm font-semibold text-gray-300">{formatCurrency(data.revenue.month)}</div>
                          </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="bg-surface-0 rounded px-2 py-1.5 text-center">
                            <div className="text-xs font-bold text-gray-200">{formatNumber(data.volume.todayCount)}</div>
                            <div className="text-[9px] text-gray-600">Cargas hoy</div>
                          </div>
                          <div className="bg-surface-0 rounded px-2 py-1.5 text-center">
                            <div className="text-xs font-bold text-gray-200">{data.failures.pendingCount}</div>
                            <div className="text-[9px] text-gray-600">Fallos</div>
                          </div>
                          <div className="bg-surface-0 rounded px-2 py-1.5 text-center">
                            <div className="text-xs font-bold text-gray-200">{data.system.queueLength}</div>
                            <div className="text-[9px] text-gray-600">En cola</div>
                          </div>
                        </div>

                        {/* System status */}
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span className={data.system.killSwitch ? 'text-red-400 font-bold' : ''}>
                            {data.system.killSwitch ? 'KILL SWITCH ON' : 'Bot ' + data.system.botStatus}
                          </span>
                          <span>|</span>
                          <span>{data.operators.online}/{data.operators.total} ops</span>
                          {state?.lastUpdated && (
                            <>
                              <span>|</span>
                              <span className={isStale ? 'text-yellow-500' : ''}>{timeAgo(state.lastUpdated)}</span>
                              {isStale && <span className="text-yellow-500 font-bold" title="Datos desactualizados (>5min)">STALE</span>}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Card footer — click to detail */}
                  {data && (
                    <button
                      onClick={() => navigate(`/monitoring/${client.id}`)}
                      className="w-full px-4 py-2 bg-surface-0/50 border-t border-border/30 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-surface-2 transition-colors text-center"
                    >
                      Ver detalle completo →
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
