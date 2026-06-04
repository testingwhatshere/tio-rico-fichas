import type { MonitoringData } from './types'

/**
 * Fetches monitoring data from a client's backend API.
 * Uses the dedicated MONITORING_API_KEY for authentication.
 */
export async function fetchMonitoringData(
  apiUrl: string,
  monitoringApiKey: string
): Promise<MonitoringData> {
  if (apiUrl.startsWith('http://') && !apiUrl.includes('localhost') && !apiUrl.includes('127.0.0.1')) {
    throw new Error('Monitoring API requires HTTPS for remote servers')
  }
  const url = `${apiUrl.replace(/\/$/, '')}/api/dashboard/monitoring`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Monitoring-API-Key': monitoringApiKey,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Monitoring API Key invalida o no configurada')
      }
      throw new Error(`Error ${response.status}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Timeout: el servidor no respondio en 10s')
    }
    if (error.message?.includes('fetch')) {
      throw new Error('No se pudo conectar al servidor')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Quick health check — just pings /health/live
 */
export async function checkClientHealth(apiUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/health/live`, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

// --- Remote operations ---

/** Helper for authenticated API calls to a client's backend */
async function clientFetch(apiUrl: string, key: string, path: string, options: RequestInit = {}): Promise<any> {
  const url = `${apiUrl.replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-Monitoring-API-Key': key,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('API Key invalida o sin permisos')
      }
      throw new Error(`Error ${response.status}: ${response.statusText}`)
    }
    // Validate response is JSON before parsing
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(`Respuesta inesperada del servidor (${contentType || 'sin content-type'})`)
    }
    return await response.json()
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('Timeout (15s)')
    if (error.message?.includes('fetch') || error.message?.includes('Failed')) {
      throw new Error('No se pudo conectar al servidor')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/** Fetch activity logs */
export async function fetchLogs(
  apiUrl: string, key: string,
  params: { limit?: number; offset?: number; search?: string } = {}
): Promise<{ logs: any[]; total: number }> {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  if (params.search) qs.set('search', params.search)
  return clientFetch(apiUrl, key, `/api/dashboard/logs?${qs}`)
}

/** Toggle kill switch */
export async function setKillSwitch(
  apiUrl: string, key: string,
  active: boolean, reason = ''
): Promise<{ success: boolean }> {
  return clientFetch(apiUrl, key, '/api/dashboard/killswitch', {
    method: 'POST',
    body: JSON.stringify({ active, reason }),
  })
}

/** Trigger backup */
export async function triggerBackup(apiUrl: string, key: string): Promise<{ url: string; size: number }> {
  return clientFetch(apiUrl, key, '/api/dashboard/backup', { method: 'POST' })
}

/** List backups */
export async function listBackups(apiUrl: string, key: string): Promise<any[]> {
  return clientFetch(apiUrl, key, '/api/dashboard/backups')
}

/** Push app update */
export async function pushAppUpdate(
  apiUrl: string, key: string,
  data: { app: string; version: string; downloadUrl: string; changelog: string }
): Promise<{ success: boolean }> {
  return clientFetch(apiUrl, key, '/api/dashboard/app-update', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

/** Rotate API key */
export async function rotateApiKey(
  apiUrl: string, key: string,
  keyType: string
): Promise<{ newKey: string }> {
  return clientFetch(apiUrl, key, '/api/dashboard/rotate-key', {
    method: 'POST',
    body: JSON.stringify({ keyType }),
  })
}

// --- Formatting helpers ---

export function formatCurrency(amount: number, currency = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-AR').format(n)
}

export function formatUptime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  return `${hours}h`
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`
  return `hace ${Math.floor(hours / 24)}d`
}
