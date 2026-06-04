import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchLogs, timeAgo } from '../lib/monitoring-api'
import { toast } from '../components/Toast'
import type { ClientConfig } from '../lib/types'

interface LogEntry {
  id: string
  action: string
  entityType?: string
  entityId?: string
  details?: string
  level?: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export function LogViewer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [config, setConfig] = useState<ClientConfig | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (id) window.api.loadClient(id).then(d => setConfig(d.config as ClientConfig))
  }, [id])

  const loadLogs = async (searchQuery?: string) => {
    if (!config?.apiUrl || !config?.monitoringApiKey) return
    setLoading(true)
    try {
      const result = await fetchLogs(config.apiUrl, config.monitoringApiKey, {
        limit: 100,
        search: searchQuery || search || undefined,
      })
      setLogs(result.logs || [])
      setLastUpdated(Date.now())
    } catch (e: any) {
      toast(e.message, 'error')
    }
    setLoading(false)
  }

  useEffect(() => {
    if (config?.apiUrl) loadLogs()
  }, [config])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadLogs(search)
  }

  const getLevelColor = (action: string) => {
    const a = action.toLowerCase()
    if (a.includes('fail') || a.includes('error') || a.includes('reject')) return 'text-red-400'
    if (a.includes('warn') || a.includes('suspicious')) return 'text-yellow-400'
    if (a.includes('complet') || a.includes('approv') || a.includes('success')) return 'text-green-400'
    return 'text-gray-400'
  }

  const getLevelDot = (action: string) => {
    const a = action.toLowerCase()
    if (a.includes('fail') || a.includes('error') || a.includes('reject')) return 'bg-red-500'
    if (a.includes('warn') || a.includes('suspicious')) return 'bg-yellow-500'
    if (a.includes('complet') || a.includes('approv') || a.includes('success')) return 'bg-green-500'
    return 'bg-gray-600'
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between shrink-0 bg-surface-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/monitoring/${id}`)} className="text-xs text-gray-500 hover:text-gray-300">&larr; Monitoring</button>
          <div className="h-4 w-px bg-border" />
          <h2 className="text-sm font-semibold text-gray-200">Logs</h2>
          <span className="text-[10px] text-gray-600 font-mono">{id}</span>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <span className="text-[10px] text-gray-600">{timeAgo(lastUpdated)}</span>}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 text-[10px] rounded border transition-colors ${
              autoScroll ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-surface-3 border-border text-gray-500'
            }`}
          >
            Auto-scroll
          </button>
          <button
            onClick={() => loadLogs()}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded"
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="px-4 py-2 border-b border-border bg-surface-1 flex gap-2 shrink-0">
        <div className="relative flex-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en logs..."
            className="w-full bg-surface-2 border border-border rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
          />
        </div>
        <button type="submit" className="px-3 py-1.5 text-xs bg-surface-3 hover:bg-surface-4 text-gray-300 rounded border border-border">
          Buscar
        </button>
      </form>

      {/* Logs */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono text-[11px]">
        {logs.length === 0 && !loading && (
          <div className="flex items-center justify-center h-40 text-gray-600 text-xs">
            {config?.apiUrl ? 'Sin logs. Clickea Refresh.' : 'Configurar API URL y Monitoring Key primero.'}
          </div>
        )}
        {loading && logs.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <table className="w-full">
          <tbody>
            {logs.map((log, i) => (
              <tr key={log.id || i} className="border-b border-border/20 hover:bg-surface-1/50 group">
                <td className="pl-3 py-1.5 w-5">
                  <div className={`w-1.5 h-1.5 rounded-full ${getLevelDot(log.action)}`} />
                </td>
                <td className="py-1.5 text-gray-600 w-[140px] whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' })}
                </td>
                <td className={`py-1.5 px-2 font-medium whitespace-nowrap ${getLevelColor(log.action)}`}>
                  {log.action}
                </td>
                <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">
                  {log.entityType && <span>{log.entityType}</span>}
                  {log.entityId && <span className="text-gray-700 ml-1">#{log.entityId.substring(0, 8)}</span>}
                </td>
                <td className="py-1.5 pr-3 text-gray-600 truncate max-w-[300px]">
                  {log.details || (log.metadata ? JSON.stringify(log.metadata).substring(0, 80) : '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="px-4 py-1.5 border-t border-border bg-surface-0 flex items-center justify-between shrink-0">
        <span className="text-[10px] text-gray-600">{logs.length} entries</span>
        {loading && <span className="text-[10px] text-accent">Cargando...</span>}
      </div>
    </div>
  )
}
