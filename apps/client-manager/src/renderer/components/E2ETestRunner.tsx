import { useState, useRef, useEffect } from 'react'
import { runE2ETests, getCategories, TEST_COUNT, type TestSuiteResult, type TestResult } from '../lib/e2e-runner'
import { toast } from './Toast'

interface E2ETestRunnerProps {
  clientId: string
  apiUrl: string
  monitoringKey: string
}

export function E2ETestRunner({ clientId, apiUrl, monitoringKey }: E2ETestRunnerProps) {
  const [result, setResult] = useState<TestSuiteResult | null>(null)
  const [liveResults, setLiveResults] = useState<TestResult[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleRun = async () => {
    if (!apiUrl) {
      toast('Falta API URL en la config del cliente', 'error')
      return
    }
    if (!monitoringKey) {
      toast('Falta Monitoring API Key en la config del cliente', 'error')
      return
    }

    setRunning(true)
    setResult(null)
    setLiveResults([])
    setProgress(0)

    try {
      const suiteResult = await runE2ETests(clientId, apiUrl, monitoringKey, (testResult, index, total) => {
        setProgress(((index + 1) / total) * 100)
        setLiveResults(prev => {
          const updated = [...prev]
          // Update or add
          const existingIdx = updated.findIndex(r => r.name === testResult.name)
          if (existingIdx >= 0) {
            updated[existingIdx] = testResult
          } else {
            updated.push(testResult)
          }
          return updated
        })
      })
      setResult(suiteResult)

      if (suiteResult.failed === 0) {
        toast(`Grade ${suiteResult.grade} — ${suiteResult.passed} tests OK (${suiteResult.totalDuration}ms)`, 'success')
      } else {
        toast(`${suiteResult.failed} tests fallaron de ${suiteResult.passed + suiteResult.failed}`, 'error')
      }
    } catch (e: any) {
      toast(e.message || 'Error ejecutando tests', 'error')
    }
    setRunning(false)
  }

  // Auto-scroll to latest result
  useEffect(() => {
    if (scrollRef.current && running) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [liveResults, running])

  const displayResults = result?.results || liveResults
  const categories = getCategories()

  const gradeColors = {
    A: 'bg-green-500 text-white',
    B: 'bg-yellow-500 text-black',
    C: 'bg-orange-500 text-white',
    F: 'bg-red-500 text-white',
  }

  return (
    <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-xs font-semibold text-gray-300">Tests E2E</h3>
            <p className="text-[10px] text-gray-600 mt-0.5">{TEST_COUNT} tests en {categories.length} categorias</p>
          </div>
          {result && (
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${gradeColors[result.grade]}`}>
              {result.grade}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <span className="text-[10px] text-gray-600">{result.totalDuration}ms</span>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              running
                ? 'bg-surface-3 text-gray-500 cursor-wait'
                : 'bg-accent hover:bg-accent-hover text-white'
            }`}
          >
            {running ? 'Ejecutando...' : result ? 'Correr de nuevo' : 'Correr tests'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {running && (
        <div className="h-0.5 bg-surface-3">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Results by category */}
      {displayResults.length > 0 && (
        <div ref={scrollRef} className="max-h-80 overflow-y-auto">
          {categories.map(category => {
            const categoryResults = displayResults.filter(r => r.category === category)
            if (categoryResults.length === 0) return null
            const allPassed = categoryResults.every(r => r.status === 'pass')
            const hasFails = categoryResults.some(r => r.status === 'fail')

            return (
              <div key={category}>
                {/* Category header */}
                <div className="px-4 py-1.5 bg-surface-0/50 border-y border-border/20 flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    hasFails ? 'bg-red-500' : allPassed ? 'bg-green-500' : 'bg-gray-600'
                  }`} />
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{category}</span>
                </div>

                {/* Tests in this category */}
                {categoryResults.map((test, i) => (
                  <div
                    key={test.name}
                    className={`px-4 py-2 flex items-center gap-3 border-b border-border/10 ${
                      test.status === 'skip' ? 'opacity-30' : ''
                    } ${test.status === 'running' ? 'bg-accent/5' : ''}`}
                  >
                    {/* Status icon */}
                    <div className="w-4 shrink-0">
                      {test.status === 'pass' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-400">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                      {test.status === 'fail' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-red-400">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                      {test.status === 'skip' && (
                        <span className="text-[10px] text-gray-700">—</span>
                      )}
                      {test.status === 'running' && (
                        <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>

                    {/* Test name */}
                    <span className={`text-xs flex-1 ${
                      test.status === 'fail' ? 'text-red-300' : test.status === 'running' ? 'text-accent' : 'text-gray-400'
                    }`}>
                      {test.name}
                    </span>

                    {/* Detail */}
                    {test.detail && test.status !== 'running' && (
                      <span className={`text-[10px] font-mono truncate max-w-[220px] ${
                        test.status === 'fail' ? 'text-red-500/70' : 'text-gray-600'
                      }`}>
                        {test.detail}
                      </span>
                    )}
                    {test.error && !test.detail && (
                      <span className="text-[10px] font-mono text-red-500/70 truncate max-w-[220px]">
                        {test.error}
                      </span>
                    )}

                    {/* Duration */}
                    {test.duration > 0 && (
                      <span className={`text-[9px] font-mono shrink-0 w-12 text-right ${
                        test.duration > 5000 ? 'text-red-500' : test.duration > 2000 ? 'text-yellow-500' : 'text-gray-700'
                      }`}>
                        {test.duration}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          })}

          {/* Summary footer */}
          {result && (
            <div className="px-4 py-2.5 bg-surface-0/50 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-green-400 font-medium">{result.passed} pasaron</span>
                {result.failed > 0 && <span className="text-red-400 font-medium">{result.failed} fallaron</span>}
                {result.skipped > 0 && <span className="text-gray-600">{result.skipped} salteados</span>}
              </div>
              <span className="text-[10px] text-gray-600">
                {new Date(result.runAt).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {displayResults.length === 0 && !running && (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-gray-500 mb-1">Verificar que todo funciona</p>
          <p className="text-[10px] text-gray-600">Ejecuta {TEST_COUNT} tests de conectividad, auth, servicios, y sistema</p>
        </div>
      )}
    </div>
  )
}
