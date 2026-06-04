import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClientStore } from '../store/client-store'
import { formatCurrency } from '../lib/monitoring-api'
import { getCurrentPeriod, getPendingTotal, getPaidTotal } from '../lib/commission-calc'
import type { CommissionData } from '../lib/types'

export function CommissionsSummary() {
  const navigate = useNavigate()
  const { clients, fetchClients } = useClientStore()
  const [commissionsMap, setCommissionsMap] = useState<Record<string, CommissionData>>({})
  const [selectedPeriod, setSelectedPeriod] = useState(getCurrentPeriod())
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchClients() }, [])

  useEffect(() => {
    loadAllCommissions()
  }, [clients])

  const loadAllCommissions = async () => {
    setLoading(true)
    const map: Record<string, CommissionData> = {}
    for (const client of clients) {
      try {
        const data = await window.api.loadCommissions(client.id)
        if (data) map[client.id] = data
      } catch (e) {
        console.warn(`[Commissions] Failed to load for ${client.id}:`, e)
      }
    }
    setCommissionsMap(map)
    setLoading(false)
  }

  // Calculate totals
  const allPeriods = new Set<string>()
  Object.values(commissionsMap).forEach(cd => cd.history.forEach(h => allPeriods.add(h.period)))
  const sortedPeriods = [...allPeriods].sort().reverse()
  if (!sortedPeriods.includes(selectedPeriod)) sortedPeriods.unshift(selectedPeriod)

  let totalPending = 0
  let totalPaid = 0
  let totalVolumeMonth = 0
  const rows: { clientId: string; name: string; period: ReturnType<typeof getPeriodData> }[] = []

  function getPeriodData(cd: CommissionData, period: string) {
    return cd.history.find(h => h.period === period) || null
  }

  clients.forEach(client => {
    const cd = commissionsMap[client.id]
    if (!cd) return
    totalPending += getPendingTotal(cd.history)
    totalPaid += getPaidTotal(cd.history)
    const periodData = getPeriodData(cd, selectedPeriod)
    if (periodData) totalVolumeMonth += periodData.volumeLoaded
    rows.push({ clientId: client.id, name: client.businessName, period: periodData })
  })

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/monitoring')} className="text-xs text-gray-500 hover:text-gray-300">&larr;</button>
          <h1 className="text-lg font-semibold text-gray-100">Comisiones</h1>
        </div>
        <select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          className="bg-surface-2 border border-border rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
        >
          {sortedPeriods.map(p => (
            <option key={p} value={p}>{formatPeriodLabel(p)}</option>
          ))}
        </select>
      </div>

      {/* Summary strip */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-8 bg-surface-1 shrink-0">
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Pendiente de cobro</div>
          <div className="text-lg font-bold text-yellow-400">{formatCurrency(totalPending)}</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Cobrado total</div>
          <div className="text-lg font-bold text-green-400">{formatCurrency(totalPaid)}</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Volumen {formatPeriodLabel(selectedPeriod)}</div>
          <div className="text-lg font-bold text-gray-200">{formatCurrency(totalVolumeMonth)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-500">Cargando...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 text-left font-medium">Cliente</th>
                <th className="px-4 py-3 text-right font-medium">Volumen</th>
                <th className="px-4 py-3 text-right font-medium">Cargas</th>
                <th className="px-4 py-3 text-right font-medium">Comision %</th>
                <th className="px-4 py-3 text-right font-medium">Fee fijo</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-center font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.clientId} className="border-b border-border/50 hover:bg-surface-1/50 transition-colors">
                  <td className="px-6 py-3">
                    <button
                      onClick={() => navigate(`/client/${row.clientId}`)}
                      className="text-xs font-medium text-gray-200 hover:text-accent transition-colors"
                    >
                      {row.name}
                    </button>
                    <p className="text-[10px] text-gray-600 font-mono">{row.clientId}</p>
                  </td>
                  {row.period ? (
                    <>
                      <td className="px-4 py-3 text-right text-xs text-gray-300">{formatCurrency(row.period.volumeLoaded)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">{row.period.requestCount}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-300">{formatCurrency(row.period.commissionFromVolume)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-300">{formatCurrency(row.period.fixedFee)}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-gray-200">{formatCurrency(row.period.totalCommission)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          row.period.paid
                            ? 'bg-green-900/30 text-green-400'
                            : 'bg-yellow-900/30 text-yellow-400'
                        }`}>
                          {row.period.paid ? 'Cobrado' : 'Pendiente'}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={6} className="px-4 py-3 text-center text-[10px] text-gray-600">Sin datos para este periodo</td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-xs text-gray-500">No hay comisiones configuradas</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-')
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${months[parseInt(month) - 1]} ${year}`
}
