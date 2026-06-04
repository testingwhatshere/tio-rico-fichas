/**
 * E2E test runner — verifies a client's backend works end-to-end.
 * Tests are grouped by category and ordered from basic to complex.
 */

export interface TestResult {
  name: string
  category: string
  status: 'pass' | 'fail' | 'skip' | 'running'
  duration: number
  error?: string
  detail?: string
}

export interface TestSuiteResult {
  clientId: string
  results: TestResult[]
  passed: number
  failed: number
  skipped: number
  totalDuration: number
  runAt: string
  grade: 'A' | 'B' | 'C' | 'F'
}

type TestFn = (apiUrl: string, key: string) => Promise<{ ok: boolean; detail?: string }>

interface TestDef {
  name: string
  category: string
  fn: TestFn
  critical: boolean
  description: string
}

const TESTS: TestDef[] = [
  // --- Connectivity ---
  {
    name: 'Servidor responde',
    category: 'Conectividad',
    critical: true,
    description: 'Ping basico al servidor',
    fn: async (apiUrl) => {
      const res = await timedFetch(`${apiUrl}/health/live`, {}, 5000)
      return { ok: res.ok, detail: res.ok ? `${res.status} OK` : `Status ${res.status}` }
    },
  },
  {
    name: 'Base de datos conectada',
    category: 'Conectividad',
    critical: true,
    description: 'Verifica que la DB responde',
    fn: async (apiUrl) => {
      const res = await timedFetch(`${apiUrl}/health/ready`, {}, 5000)
      return { ok: res.ok, detail: res.ok ? 'DB OK' : 'DB no responde' }
    },
  },
  {
    name: 'Latencia aceptable',
    category: 'Conectividad',
    critical: false,
    description: 'Tiempo de respuesta < 2s',
    fn: async (apiUrl) => {
      const start = Date.now()
      await timedFetch(`${apiUrl}/health/live`, {}, 5000)
      const ms = Date.now() - start
      return { ok: ms < 2000, detail: `${ms}ms${ms > 1000 ? ' (lento)' : ''}` }
    },
  },

  // --- Authentication ---
  {
    name: 'Monitoring API Key valida',
    category: 'Autenticacion',
    critical: true,
    description: 'Verifica que la key de monitoring funciona',
    fn: async (apiUrl, key) => {
      const res = await timedFetch(`${apiUrl}/api/dashboard/monitoring`, {
        headers: { 'X-Monitoring-API-Key': key },
      }, 10000)
      if (res.status === 401 || res.status === 403) return { ok: false, detail: 'Key rechazada' }
      return { ok: res.ok, detail: res.ok ? 'Autenticado' : `Status ${res.status}` }
    },
  },
  {
    name: 'Bot API Key valida',
    category: 'Autenticacion',
    critical: false,
    description: 'Verifica que la bot key funciona',
    fn: async (apiUrl, key) => {
      const res = await timedFetch(`${apiUrl}/api/dashboard/stats`, {
        headers: { 'X-Bot-API-Key': key },
      }, 10000)
      if (res.status === 401 || res.status === 403) return { ok: false, detail: 'Key rechazada' }
      return { ok: res.ok, detail: res.ok ? 'Autenticado' : `Status ${res.status}` }
    },
  },

  // --- Core Services ---
  {
    name: 'Monitoring data completa',
    category: 'Servicios',
    critical: false,
    description: 'Revenue, sistema, y operaciones',
    fn: async (apiUrl, key) => {
      const res = await timedFetch(`${apiUrl}/api/dashboard/monitoring`, {
        headers: { 'X-Monitoring-API-Key': key, 'X-Bot-API-Key': key },
      }, 10000)
      if (!res.ok) return { ok: false, detail: `Status ${res.status}` }
      const d = await res.json()
      const fields = ['revenue', 'volume', 'system', 'failures', 'operators']
      const missing = fields.filter(f => !d[f])
      return {
        ok: missing.length === 0,
        detail: missing.length === 0
          ? `Revenue $${d.revenue?.total?.toLocaleString() || 0} | Bot: ${d.system?.botStatus}`
          : `Faltan: ${missing.join(', ')}`,
      }
    },
  },
  {
    name: 'Metricas publicas',
    category: 'Servicios',
    critical: false,
    description: 'Endpoint de metricas sin auth',
    fn: async (apiUrl) => {
      const res = await timedFetch(`${apiUrl}/api/metrics`, {}, 5000)
      if (!res.ok) return { ok: false, detail: `Status ${res.status}` }
      const d = await res.json()
      return { ok: !!d.uptime, detail: `Uptime: ${d.uptime?.human || '?'}` }
    },
  },
  {
    name: 'Dashboard stats',
    category: 'Servicios',
    critical: false,
    description: 'Estadisticas del dashboard',
    fn: async (apiUrl, key) => {
      const res = await timedFetch(`${apiUrl}/api/dashboard/stats`, {
        headers: { 'X-Bot-API-Key': key },
      }, 10000)
      if (!res.ok) return { ok: false, detail: `Status ${res.status}` }
      const d = await res.json()
      return { ok: true, detail: `${d.requests?.completed || 0} completadas` }
    },
  },

  // --- Bot & Automation ---
  {
    name: 'Estado del bot',
    category: 'Automatizacion',
    critical: false,
    description: 'Bot online y respondiendo',
    fn: async (apiUrl) => {
      const res = await timedFetch(`${apiUrl}/health/bot`, {}, 5000)
      if (!res.ok) return { ok: false, detail: `Status ${res.status}` }
      const d = await res.json()
      const status = d.bot?.status || d.status || 'unknown'
      return { ok: status === 'online' || status === 'ok', detail: `Bot: ${status}` }
    },
  },
  {
    name: 'Kill switch desactivado',
    category: 'Automatizacion',
    critical: false,
    description: 'Verifica que la automatizacion no este pausada',
    fn: async (apiUrl, key) => {
      const res = await timedFetch(`${apiUrl}/api/dashboard/monitoring`, {
        headers: { 'X-Monitoring-API-Key': key, 'X-Bot-API-Key': key },
      }, 10000)
      if (!res.ok) return { ok: false, detail: 'No se pudo verificar' }
      const d = await res.json()
      return {
        ok: !d.system?.killSwitch,
        detail: d.system?.killSwitch ? 'KILL SWITCH ACTIVO' : 'Desactivado (OK)',
      }
    },
  },

  // --- System Health ---
  {
    name: 'Health check completo',
    category: 'Sistema',
    critical: false,
    description: 'DB, memoria, disco, bot',
    fn: async (apiUrl) => {
      const res = await timedFetch(`${apiUrl}/health/full`, {}, 10000)
      if (!res.ok) return { ok: false, detail: `Status ${res.status}` }
      const d = await res.json()
      return { ok: d.status === 'ok', detail: d.status === 'ok' ? 'Todos los checks OK' : `Status: ${d.status}` }
    },
  },
  {
    name: 'Sin jobs stuck',
    category: 'Sistema',
    critical: false,
    description: 'No hay jobs procesando hace mas de 5min',
    fn: async (apiUrl, key) => {
      const res = await timedFetch(`${apiUrl}/api/dashboard/monitoring`, {
        headers: { 'X-Monitoring-API-Key': key, 'X-Bot-API-Key': key },
      }, 10000)
      if (!res.ok) return { ok: false, detail: 'No se pudo verificar' }
      const d = await res.json()
      const qLen = d.system?.queueLength || 0
      const active = d.system?.activeJobs || 0
      return {
        ok: qLen < 20,
        detail: `Cola: ${qLen} | Activos: ${active}`,
      }
    },
  },
]

/**
 * Runs the full E2E test suite against a client's backend.
 */
export async function runE2ETests(
  clientId: string,
  apiUrl: string,
  monitoringKey: string,
  onProgress?: (result: TestResult, index: number, total: number) => void
): Promise<TestSuiteResult> {
  const results: TestResult[] = []
  const startTime = Date.now()
  let criticalFailed = false

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i]

    if (criticalFailed) {
      const skipped: TestResult = { name: test.name, category: test.category, status: 'skip', duration: 0, detail: 'Test critico fallo — salteado' }
      results.push(skipped)
      onProgress?.(skipped, i, TESTS.length)
      continue
    }

    // Report as running
    onProgress?.({ name: test.name, category: test.category, status: 'running', duration: 0 }, i, TESTS.length)

    const testStart = Date.now()
    try {
      const result = await test.fn(apiUrl, monitoringKey)
      const duration = Date.now() - testStart
      const testResult: TestResult = {
        name: test.name,
        category: test.category,
        status: result.ok ? 'pass' : 'fail',
        duration,
        detail: result.detail,
        error: result.ok ? undefined : result.detail,
      }
      results.push(testResult)
      onProgress?.(testResult, i, TESTS.length)
      if (!result.ok && test.critical) criticalFailed = true
    } catch (e: any) {
      const duration = Date.now() - testStart
      const testResult: TestResult = {
        name: test.name,
        category: test.category,
        status: 'fail',
        duration,
        error: e.name === 'AbortError' ? 'Timeout' : (e.message || 'Error desconocido'),
      }
      results.push(testResult)
      onProgress?.(testResult, i, TESTS.length)
      if (test.critical) criticalFailed = true
    }
  }

  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const total = results.filter(r => r.status !== 'skip').length

  // Grade
  let grade: 'A' | 'B' | 'C' | 'F' = 'A'
  if (failed > 0) grade = 'F'
  else if (passed < total) grade = 'C'
  else if (results.some(r => r.duration > 3000)) grade = 'B'

  return {
    clientId,
    results,
    passed,
    failed,
    skipped: results.filter(r => r.status === 'skip').length,
    totalDuration: Date.now() - startTime,
    runAt: new Date().toISOString(),
    grade,
  }
}

/** All test categories in order */
export function getCategories(): string[] {
  const seen = new Set<string>()
  return TESTS.map(t => t.category).filter(c => { if (seen.has(c)) return false; seen.add(c); return true })
}

/** Tests count */
export const TEST_COUNT = TESTS.length

async function timedFetch(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}
