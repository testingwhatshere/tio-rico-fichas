import type { CommissionConfig, CommissionPeriod, MonitoringData } from './types'

/**
 * Calculates commission for a period based on monitoring data and commission config.
 */
export function calculateCommission(
  config: CommissionConfig,
  monitoringData: MonitoringData,
  period: string // "2026-04"
): CommissionPeriod {
  const volumeLoaded = monitoringData.revenue.month
  const requestCount = monitoringData.volume.monthCount

  let commissionFromVolume = 0
  let fixedFee = 0

  if (config.feeType === 'percentage' || config.feeType === 'both') {
    commissionFromVolume = Math.round(volumeLoaded * config.percentageRate)
  }

  if (config.feeType === 'fixed' || config.feeType === 'both') {
    fixedFee = config.fixedMonthlyFee
  }

  return {
    period,
    volumeLoaded,
    requestCount,
    commissionFromVolume,
    fixedFee,
    totalCommission: commissionFromVolume + fixedFee,
    paid: false,
    paidAt: null,
    notes: '',
  }
}

/**
 * Gets the current period string.
 */
export function getCurrentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Returns total pending commissions across all periods.
 */
export function getPendingTotal(history: CommissionPeriod[]): number {
  return history
    .filter(p => !p.paid)
    .reduce((sum, p) => sum + p.totalCommission, 0)
}

/**
 * Returns total paid commissions.
 */
export function getPaidTotal(history: CommissionPeriod[]): number {
  return history
    .filter(p => p.paid)
    .reduce((sum, p) => sum + p.totalCommission, 0)
}
