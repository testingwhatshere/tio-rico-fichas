import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchMonitoringData, setKillSwitch, formatCurrency, formatNumber, formatUptime, timeAgo } from '../lib/monitoring-api'
import { toast } from '../components/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { E2ETestRunner } from '../components/E2ETestRunner'
import type { MonitoringData, ClientConfig } from '../lib/types'

export function MonitoringDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [config, setConfig] = useState<ClientConfig | null>(null)
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [showKillConfirm, setShowKillConfirm] = useState(false)
  const [togglingKill, setTogglingKill] = useState(false)

  useEffect(() => {
    if (id) {
      window.api.loadClient(id).then(d => setConfig(d.config as ClientConfig))
    }
  }, [id])

  const refresh = async () => {
    if (!config?.apiUrl || !config?.monitoringApiKey) {
      toast('Falta API URL o Monitoring API Key', 'error')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchMonitoringData(config.apiUrl, config.monitoringApiKey)
      setData(result)
      setLastUpdated(Date.now())
    } catch (e: any) {
      setError(e.message)
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (config?.apiUrl && config?.monitoringApiKey) refresh()
  }, [config])

  if (!config) return <div className="flex items-center justify-center h-full text-sm text-gray-500">Cargando...</div>

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/monitoring')} className="text-xs text-gray-500 hover:text-gray-300">&larr; Monitoring</button>
          <h2 className="text-sm font-semibold text-gray-200">{config.businessName}</h2>
          {data && (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
              data.system.botStatus === 'online' ? 'bg-green-900/30 text-green-400'
                : data.system.botStatus === 'busy' ? 'bg-yellow-900/30 text-yellow-400'
                : 'bg-red-900/30 text-red-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                data.system.botStatus === 'online' ? 'bg-green-500' : data.system.botStatus === 'busy' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              {data.system.botStatus}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <span className="text-[10px] text-gray-600">{timeAgo(lastUpdated)}</span>}
          <button
            onClick={() => navigate(`/logs/${id}`)}
            className="px-3 py-1.5 text-xs bg-surface-3 hover:bg-surface-4 text-gray-300 rounded border border-border"
          >
            Logs
          </button>
          {data && (
            <button
              onClick={() => setShowKillConfirm(true)}
              disabled={togglingKill}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                data.system.killSwitch
                  ? 'bg-red-900/30 border-red-800 text-red-300 hover:bg-red-900/50'
                  : 'bg-surface-3 border-border text-gray-400 hover:text-red-300 hover:border-red-800'
              }`}
            >
              {data.system.killSwitch ? 'Kill Switch ON' : 'Kill Switch'}
            </button>
          )}
          <button onClick={refresh} disabled={loading} className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors">
            {loading ? 'Cargando...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && !data && (
          <div className="text-center py-12">
            <p className="text-sm text-red-400 mb-2">No se pudo conectar</p>
            <p className="text-xs text-gray-500">{error}</p>
            <button onClick={refresh} className="mt-4 px-4 py-2 text-xs bg-accent hover:bg-accent-hover text-white rounded">Reintentar</button>
          </div>
        )}

        {data && (
          <div className="max-w-4xl space-y-6">
            {/* Revenue cards */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Hoy" value={formatCurrency(data.revenue.today)} accent="green" />
              <StatCard label="Semana" value={formatCurrency(data.revenue.week)} />
              <StatCard label="Mes" value={formatCurrency(data.revenue.month)} />
              <StatCard label="Total historico" value={formatCurrency(data.revenue.total)} accent="yellow" />
            </div>

            {/* Volume cards */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Cargas hoy" value={formatNumber(data.volume.todayCount)} />
              <StatCard label="Cargas semana" value={formatNumber(data.volume.weekCount)} />
              <StatCard label="Cargas mes" value={formatNumber(data.volume.monthCount)} />
              <StatCard label="Cargas total" value={formatNumber(data.volume.totalCount)} />
            </div>

            {/* System + Operations */}
            <div className="grid grid-cols-2 gap-4">
              {/* System health */}
              <div className="bg-surface-1 border border-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Sistema</h3>
                <div className="space-y-2.5">
                  <InfoRow label="Bot" value={data.system.botStatus} color={data.system.botStatus === 'online' ? 'green' : 'red'} />
                  <InfoRow label="Kill Switch" value={data.system.killSwitch ? 'ACTIVO' : 'Desactivado'} color={data.system.killSwitch ? 'red' : 'green'} />
                  <InfoRow label="Uptime" value={formatUptime(data.system.uptime)} />
                  <InfoRow label="DB Latency" value={`${data.system.dbLatency}ms`} color={data.system.dbLatency > 100 ? 'yellow' : undefined} />
                  <InfoRow label="Cola" value={`${data.system.queueLength} jobs`} />
                  <InfoRow label="Jobs activos" value={String(data.system.activeJobs)} />
                </div>
              </div>

              {/* Operations */}
              <div className="bg-surface-1 border border-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Operaciones</h3>
                <div className="space-y-2.5">
                  <InfoRow label="Fallos pendientes" value={String(data.failures.pendingCount)} color={data.failures.pendingCount > 0 ? 'red' : 'green'} />
                  <InfoRow label="Fallos hoy" value={String(data.failures.todayCount)} color={data.failures.todayCount > 5 ? 'red' : data.failures.todayCount > 0 ? 'yellow' : 'green'} />
                  <InfoRow label="Operadores online" value={`${data.operators.online}/${data.operators.total}`} />
                  <InfoRow label="Completadas (24h)" value={String(data.recentRequests.completed)} color="green" />
                  <InfoRow label="Fallidas (24h)" value={String(data.recentRequests.failed)} color={data.recentRequests.failed > 0 ? 'red' : undefined} />
                  <InfoRow label="Pendientes (24h)" value={String(data.recentRequests.pending)} />
                </div>
              </div>
            </div>

            {/* Panel balances */}
            {data.panelBalance.length > 0 && (
              <div className="bg-surface-1 border border-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Balance de Paneles</h3>
                <div className="grid grid-cols-3 gap-3">
                  {data.panelBalance.map((p, i) => (
                    <div key={i} className="bg-surface-0 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-gray-500">{p.panelName}</p>
                      <p className={`text-sm font-bold ${p.amount < 1000 ? 'text-red-400' : 'text-gray-200'}`}>
                        {formatNumber(p.amount)} fichas
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* E2E Tests */}
            {config && (
              <E2ETestRunner
                clientId={id || ''}
                apiUrl={config.apiUrl}
                monitoringKey={config.monitoringApiKey}
              />
            )}
          </div>
        )}
      </div>

      {/* Kill switch confirmation */}
      <ConfirmDialog
        open={showKillConfirm}
        title={data?.system.killSwitch ? 'Desactivar Kill Switch' : 'Activar Kill Switch'}
        message={
          data?.system.killSwitch
            ? 'Se reactivara toda la automatizacion de este cliente.'
            : 'Se detendra TODA la automatizacion de este cliente inmediatamente. Los jobs en curso se completaran pero no se iniciaran nuevos.'
        }
        confirmLabel={data?.system.killSwitch ? 'Desactivar' : 'Activar Kill Switch'}
        danger={!data?.system.killSwitch}
        onConfirm={async () => {
          if (!config?.apiUrl || !config?.monitoringApiKey) return
          setTogglingKill(true)
          setShowKillConfirm(false)
          try {
            const newState = !data?.system.killSwitch
            await setKillSwitch(config.apiUrl, config.monitoringApiKey, newState, newState ? 'Activado desde Aurum' : '')
            toast(newState ? 'Kill switch ACTIVADO' : 'Kill switch desactivado', newState ? 'error' : 'success')
            refresh()
          } catch (e: any) {
            toast(e.message || 'Error', 'error')
          }
          setTogglingKill(false)
        }}
        onCancel={() => setShowKillConfirm(false)}
      />
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'yellow' }) {
  return (
    <div className="bg-surface-1 border border-border rounded-xl px-4 py-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${
        accent === 'green' ? 'text-green-400' : accent === 'yellow' ? 'text-yellow-400' : 'text-gray-200'
      }`}>{value}</p>
    </div>
  )
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' | 'yellow' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-medium ${
        color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : color === 'yellow' ? 'text-yellow-400' : 'text-gray-300'
      }`}>{value}</span>
    </div>
  )
}
