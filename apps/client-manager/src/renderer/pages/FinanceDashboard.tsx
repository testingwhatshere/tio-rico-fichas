import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClientStore } from '../store/client-store'
import { formatCurrency } from '../lib/monitoring-api'
import { calculateClientFinance, getCurrentPeriod, formatPeriodLabel, EMPTY_COSTS } from '../lib/finance'
import { toast } from '../components/Toast'
import type { CommissionData } from '../lib/types'
import type { ClientCosts, ClientFinanceRow } from '../lib/finance'

export function FinanceDashboard() {
  const navigate = useNavigate()
  const { clients, fetchClients } = useClientStore()
  const [rows, setRows] = useState<ClientFinanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState<string | ''>('')
  const [editingCosts, setEditingCosts] = useState<string | null>(null)
  const [editCosts, setEditCosts] = useState<ClientCosts>(EMPTY_COSTS)

  useEffect(() => { fetchClients() }, [])

  useEffect(() => {
    if (clients.length > 0) loadFinanceData()
  }, [clients, selectedPeriod])

  const loadFinanceData = async () => {
    setLoading(true)
    const newRows: ClientFinanceRow[] = []

    for (const client of clients) {
      try {
        const [commissions, costs] = await Promise.all([
          window.api.loadCommissions(client.id),
          window.api.loadCosts(client.id),
        ])
        newRows.push(
          calculateClientFinance(
            client.id,
            client.businessName,
            commissions as CommissionData | null,
            costs as ClientCosts | null,
            selectedPeriod || undefined,
          )
        )
      } catch (e) {
        console.warn(`[Finance] Failed to load data for ${client.id}:`, e)
        newRows.push({
          clientId: client.id,
          businessName: client.businessName,
          revenue: 0,
          commissionPending: 0,
          commissionPaid: 0,
          costs: 0,
          margin: 0,
        })
      }
    }

    setRows(newRows)
    setLoading(false)
  }

  const handleSaveCosts = async () => {
    if (!editingCosts) return
    await window.api.saveCosts(editingCosts, editCosts)
    setEditingCosts(null)
    toast('Costos guardados', 'success')
    loadFinanceData()
  }

  const handleEditCosts = async (clientId: string) => {
    const costs = await window.api.loadCosts(clientId)
    setEditCosts(costs as ClientCosts || { ...EMPTY_COSTS })
    setEditingCosts(clientId)
  }

  // Totals
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      commissionPending: acc.commissionPending + r.commissionPending,
      commissionPaid: acc.commissionPaid + r.commissionPaid,
      costs: acc.costs + r.costs,
      margin: acc.margin + r.margin,
    }),
    { revenue: 0, commissionPending: 0, commissionPaid: 0, costs: 0, margin: 0 }
  )

  // Available periods from all commission histories
  const allPeriods = new Set<string>()
  // We'd need to load all commissions for period list — for now use current + recent
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    allPeriods.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-gray-100">Finanzas</h1>
        <select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          className="bg-surface-2 border border-border rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
        >
          <option value="">Todo el historial</option>
          {[...allPeriods].map(p => (
            <option key={p} value={p}>{formatPeriodLabel(p)}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      <div className="px-6 py-4 border-b border-border bg-surface-1 shrink-0">
        <div className="grid grid-cols-5 gap-4">
          <KpiCard label="Revenue total" value={formatCurrency(totals.revenue)} color="text-gray-200" />
          <KpiCard label="Comisiones pendientes" value={formatCurrency(totals.commissionPending)} color="text-yellow-400" />
          <KpiCard label="Comisiones cobradas" value={formatCurrency(totals.commissionPaid)} color="text-green-400" />
          <KpiCard label="Costos totales" value={formatCurrency(totals.costs)} color="text-red-400" />
          <KpiCard
            label="Margen neto"
            value={formatCurrency(totals.margin)}
            color={totals.margin >= 0 ? 'text-green-400' : 'text-red-400'}
            highlight
          />
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
                <th className="px-4 py-3 text-right font-medium">Revenue</th>
                <th className="px-4 py-3 text-right font-medium">Com. Pendiente</th>
                <th className="px-4 py-3 text-right font-medium">Com. Cobrada</th>
                <th className="px-4 py-3 text-right font-medium">Costos</th>
                <th className="px-4 py-3 text-right font-medium">Margen</th>
                <th className="px-4 py-3 text-center font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.clientId} className="border-b border-border/30 hover:bg-surface-1/50">
                  <td className="px-6 py-3">
                    <button
                      onClick={() => navigate(`/client/${row.clientId}`)}
                      className="text-xs font-medium text-gray-200 hover:text-accent transition-colors"
                    >
                      {row.businessName}
                    </button>
                    <p className="text-[10px] text-gray-600 font-mono">{row.clientId}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-300">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-3 text-right text-xs text-yellow-400">{formatCurrency(row.commissionPending)}</td>
                  <td className="px-4 py-3 text-right text-xs text-green-400">{formatCurrency(row.commissionPaid)}</td>
                  <td className="px-4 py-3 text-right text-xs text-red-400">{formatCurrency(row.costs)}</td>
                  <td className={`px-4 py-3 text-right text-xs font-bold ${row.margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(row.margin)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleEditCosts(row.clientId)}
                      className="text-[10px] text-gray-500 hover:text-accent transition-colors"
                    >
                      Editar costos
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-xs text-gray-500">No hay datos</td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-1/30">
                  <td className="px-6 py-3 text-xs font-bold text-gray-300">TOTAL</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-gray-200">{formatCurrency(totals.revenue)}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-yellow-400">{formatCurrency(totals.commissionPending)}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-green-400">{formatCurrency(totals.commissionPaid)}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-red-400">{formatCurrency(totals.costs)}</td>
                  <td className={`px-4 py-3 text-right text-xs font-bold ${totals.margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(totals.margin)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* Edit costs modal */}
      {editingCosts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-2 border border-border rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl animate-in">
            <h3 className="text-sm font-semibold text-gray-200 mb-1">Costos mensuales</h3>
            <p className="text-[10px] text-gray-500 mb-4">{editingCosts}</p>

            <div className="space-y-3 mb-4">
              <CostField label="Render (mensual)" value={editCosts.renderMonthly} onChange={v => setEditCosts({ ...editCosts, renderMonthly: v })} />
              <CostField label="Cloudinary (mensual)" value={editCosts.cloudinaryMonthly} onChange={v => setEditCosts({ ...editCosts, cloudinaryMonthly: v })} />
              <CostField label="VPN (parte proporcional)" value={editCosts.vpnShare} onChange={v => setEditCosts({ ...editCosts, vpnShare: v })} />
              <CostField label="Otros costos" value={editCosts.otherCosts} onChange={v => setEditCosts({ ...editCosts, otherCosts: v })} />
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Notas</label>
                <input
                  value={editCosts.notes}
                  onChange={e => setEditCosts({ ...editCosts, notes: e.target.value })}
                  placeholder="Ej: plan free de render, cloudinary starter..."
                  className="w-full bg-surface-3 border border-border rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                />
              </div>
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="text-xs text-gray-400">Total mensual:</span>
                <span className="text-sm font-bold text-red-400">
                  {formatCurrency(editCosts.renderMonthly + editCosts.cloudinaryMonthly + editCosts.vpnShare + editCosts.otherCosts)}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingCosts(null)} className="px-3 py-1.5 text-xs text-gray-400 bg-surface-3 rounded border border-border">
                Cancelar
              </button>
              <button onClick={handleSaveCosts} className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, color, highlight }: { label: string; value: string; color: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${highlight ? 'bg-surface-2 border-2 border-accent/30' : 'bg-surface-0'}`}>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  )
}

function CostField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[10px] text-gray-500 block mb-1">{label}</label>
      <input
        type="number"
        value={value || ''}
        onChange={e => onChange(Number(e.target.value) || 0)}
        placeholder="0"
        className="w-full bg-surface-3 border border-border rounded px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
      />
    </div>
  )
}
