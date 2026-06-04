import { useEffect, useState } from 'react'
import { formatCurrency, fetchMonitoringData } from '../lib/monitoring-api'
import { calculateCommission, getCurrentPeriod, getPendingTotal } from '../lib/commission-calc'
import { toast } from './Toast'
import type { CommissionData, CommissionPeriod, FeeType, ClientConfig } from '../lib/types'
import { EMPTY_COMMISSION_DATA } from '../lib/types'

interface CommissionEditorProps {
  clientId: string
  config: ClientConfig
}

export function CommissionEditor({ clientId, config }: CommissionEditorProps) {
  const [data, setData] = useState<CommissionData>(EMPTY_COMMISSION_DATA)
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)

  useEffect(() => {
    loadData()
  }, [clientId])

  const loadData = async () => {
    setLoading(true)
    try {
      const loaded = await window.api.loadCommissions(clientId)
      if (loaded) setData(loaded as CommissionData)
    } catch {}
    setLoading(false)
  }

  const saveData = async (newData: CommissionData) => {
    setData(newData)
    await window.api.saveCommissions(clientId, newData)
  }

  const updateConfig = (partial: Partial<CommissionData['config']>) => {
    const newData = { ...data, config: { ...data.config, ...partial } }
    saveData(newData)
  }

  const handleCalculateCurrentMonth = async () => {
    if (!config.apiUrl || !config.monitoringApiKey) {
      toast('Necesitas API URL y Monitoring API Key para calcular', 'error')
      return
    }

    setCalculating(true)
    try {
      const monitoringData = await fetchMonitoringData(config.apiUrl, config.monitoringApiKey)
      const period = getCurrentPeriod()
      const commission = calculateCommission(data.config, monitoringData, period)

      // Update or add period
      const existingIdx = data.history.findIndex(h => h.period === period)
      const newHistory = [...data.history]
      if (existingIdx >= 0) {
        newHistory[existingIdx] = { ...newHistory[existingIdx], ...commission, paid: newHistory[existingIdx].paid }
      } else {
        newHistory.push(commission)
      }
      newHistory.sort((a, b) => b.period.localeCompare(a.period))

      await saveData({ ...data, history: newHistory })
      toast(`Comision ${period} calculada: ${formatCurrency(commission.totalCommission)}`, 'success')
    } catch (e: any) {
      toast(e.message || 'Error calculando', 'error')
    }
    setCalculating(false)
  }

  const togglePaid = async (period: string) => {
    const newHistory = data.history.map(h => {
      if (h.period === period) {
        return { ...h, paid: !h.paid, paidAt: !h.paid ? new Date().toISOString() : null }
      }
      return h
    })
    await saveData({ ...data, history: newHistory })
    toast(newHistory.find(h => h.period === period)?.paid ? 'Marcado como cobrado' : 'Marcado como pendiente', 'info')
  }

  if (loading) return <div className="text-xs text-gray-500 py-4">Cargando comisiones...</div>

  const pendingTotal = getPendingTotal(data.history)

  return (
    <div className="space-y-5">
      {/* Commission config */}
      <div className="bg-surface-1 border border-border rounded-xl p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Configuracion</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Tipo de fee</label>
            <select
              value={data.config.feeType}
              onChange={(e) => updateConfig({ feeType: e.target.value as FeeType })}
              className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
            >
              <option value="both">Fee fijo + %</option>
              <option value="fixed">Solo fee fijo</option>
              <option value="percentage">Solo %</option>
            </select>
          </div>
          {(data.config.feeType === 'fixed' || data.config.feeType === 'both') && (
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Fee mensual (ARS)</label>
              <input
                type="number"
                value={data.config.fixedMonthlyFee || ''}
                onChange={(e) => updateConfig({ fixedMonthlyFee: Number(e.target.value) })}
                placeholder="50000"
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          )}
          {(data.config.feeType === 'percentage' || data.config.feeType === 'both') && (
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Porcentaje (%)</label>
              <input
                type="number"
                step="0.01"
                value={data.config.percentageRate ? (data.config.percentageRate * 100) : ''}
                onChange={(e) => updateConfig({ percentageRate: Number(e.target.value) / 100 })}
                placeholder="5"
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between p-4 bg-yellow-950/15 border border-yellow-900/25 rounded-xl">
        <div>
          <p className="text-xs font-medium text-yellow-300">Pendiente de cobro</p>
          <p className="text-lg font-bold text-yellow-400">{formatCurrency(pendingTotal)}</p>
        </div>
        <button
          onClick={handleCalculateCurrentMonth}
          disabled={calculating}
          className="px-4 py-2 text-xs bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {calculating ? 'Calculando...' : `Calcular ${getCurrentPeriod()}`}
        </button>
      </div>

      {/* History table */}
      {data.history.length > 0 && (
        <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left font-medium">Periodo</th>
                <th className="px-3 py-2.5 text-right font-medium">Volumen</th>
                <th className="px-3 py-2.5 text-right font-medium">Cargas</th>
                <th className="px-3 py-2.5 text-right font-medium">Com. %</th>
                <th className="px-3 py-2.5 text-right font-medium">Fee</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 text-center font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map(h => (
                <tr key={h.period} className="border-b border-border/30 hover:bg-surface-0/50">
                  <td className="px-4 py-2.5 text-xs font-medium text-gray-300">{formatPeriod(h.period)}</td>
                  <td className="px-3 py-2.5 text-xs text-right text-gray-400">{formatCurrency(h.volumeLoaded)}</td>
                  <td className="px-3 py-2.5 text-xs text-right text-gray-500">{h.requestCount}</td>
                  <td className="px-3 py-2.5 text-xs text-right text-gray-400">{formatCurrency(h.commissionFromVolume)}</td>
                  <td className="px-3 py-2.5 text-xs text-right text-gray-400">{formatCurrency(h.fixedFee)}</td>
                  <td className="px-3 py-2.5 text-xs text-right font-bold text-gray-200">{formatCurrency(h.totalCommission)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => togglePaid(h.period)}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                        h.paid
                          ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                          : 'bg-yellow-900/30 text-yellow-400 hover:bg-yellow-900/50'
                      }`}
                    >
                      {h.paid ? 'Cobrado' : 'Pendiente'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.history.length === 0 && (
        <div className="text-center py-6 text-gray-600">
          <p className="text-xs mb-1">Sin historial de comisiones</p>
          <p className="text-[10px]">Configura los fees arriba y clickea "Calcular" para empezar</p>
        </div>
      )}
    </div>
  )
}

function formatPeriod(p: string): string {
  const [y, m] = p.split('-')
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${months[parseInt(m) - 1]} ${y}`
}
