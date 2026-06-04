import type { CommissionData, CommissionPeriod } from './types'

export interface ClientCosts {
  renderMonthly: number
  cloudinaryMonthly: number
  vpnShare: number
  otherCosts: number
  notes: string
}

export const EMPTY_COSTS: ClientCosts = {
  renderMonthly: 0,
  cloudinaryMonthly: 0,
  vpnShare: 0,
  otherCosts: 0,
  notes: '',
}

export interface ClientFinanceRow {
  clientId: string
  businessName: string
  revenue: number
  commissionPending: number
  commissionPaid: number
  costs: number
  margin: number
}

export function calculateClientFinance(
  clientId: string,
  businessName: string,
  commissions: CommissionData | null,
  costs: ClientCosts | null,
  period?: string
): ClientFinanceRow {
  let commissionPending = 0
  let commissionPaid = 0
  let revenue = 0

  if (commissions) {
    const entries = period
      ? commissions.history.filter(h => h.period === period)
      : commissions.history

    for (const h of entries) {
      revenue += h.volumeLoaded
      if (h.paid) {
        commissionPaid += h.totalCommission
      } else {
        commissionPending += h.totalCommission
      }
    }
  }

  const totalCosts = costs
    ? costs.renderMonthly + costs.cloudinaryMonthly + costs.vpnShare + costs.otherCosts
    : 0

  // Margin = what we actually collected minus what it costs us
  const margin = commissionPaid - totalCosts

  return {
    clientId,
    businessName,
    revenue,
    commissionPending,
    commissionPaid,
    costs: totalCosts,
    margin,
  }
}

export function getCurrentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-')
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${months[parseInt(month) - 1]} ${year}`
}
