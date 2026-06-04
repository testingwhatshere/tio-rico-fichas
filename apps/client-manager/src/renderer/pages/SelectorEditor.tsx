import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useClientStore } from '../store/client-store'
import { SelectorSlot } from '../components/SelectorSlot'
import { DEFAULT_SELECTORS, SELECTOR_CATEGORIES, REQUIRED_SELECTORS, SELECTOR_LABELS } from '../lib/constants'
import { buildPickerHtml } from '../lib/selector-picker-script'
import { toast } from '../components/Toast'
import type { PanelProfile } from '../lib/types'

interface ElementInfo {
  tag: string
  id: string | null
  classes: string[]
  text: string
  type: string | null
  name: string | null
  ariaLabel: string | null
  placeholder: string | null
  href: string | null
}

interface SelectorCandidate {
  selector: string
  strategy: string
  matchCount: number
}

export function SelectorEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { editorProfile, updateProfile, loadClientForEditing, saveCurrentClient, saving, isDirty } = useClientStore()

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isPickingMode, setIsPickingMode] = useState(true)

  // Selection state
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null)
  const [candidates, setCandidates] = useState<SelectorCandidate[]>([])
  const [assignTarget, setAssignTarget] = useState<string | null>(null)
  const [showCandidatePanel, setShowCandidatePanel] = useState(false)

  // Test results
  const [testResults, setTestResults] = useState<Record<string, { matchCount: number }>>({})

  // Active selector slot (for visual feedback)
  const [activeSlot, setActiveSlot] = useState<string | null>(null)

  // Collapsed categories
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  // Build the merged profile (defaults + overrides)
  const profile: Record<string, string> = { ...DEFAULT_SELECTORS }
  if (editorProfile) {
    for (const [k, v] of Object.entries(editorProfile)) {
      if (!k.startsWith('_') && v) profile[k] = v
    }
  }

  useEffect(() => {
    if (id) loadClientForEditing(id)
  }, [id])

  // Listen for messages from iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || !e.data.type) return

      if (e.data.type === 'ELEMENT_SELECTED') {
        setSelectedElement(e.data.elementInfo)
        setCandidates(e.data.candidates)
        setShowCandidatePanel(true)
      }

      if (e.data.type === 'TEST_RESULT') {
        setTestResults(prev => ({
          ...prev,
          [e.data.selector]: { matchCount: e.data.matchCount }
        }))
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleLoadMhtml = async () => {
    const filePath = await window.api.pickFile([
      { name: 'Web Pages', extensions: ['mhtml', 'mht', 'html', 'htm'] },
    ])
    if (!filePath) return

    const html = await window.api.loadMhtml(filePath)
    setHtmlContent(html)
    setFileName(filePath.split('/').pop() || filePath.split('\\').pop() || 'file')
    setTestResults({})
  }

  const handleAssignSelector = useCallback((selectorKey: string, value: string) => {
    const newProfile: PanelProfile = {
      _name: editorProfile?._name || id || '',
      _description: editorProfile?._description || '',
      ...(editorProfile || {}),
      [selectorKey]: value,
    }
    updateProfile(newProfile)
    setShowCandidatePanel(false)
    setActiveSlot(selectorKey)
    // Clear after a moment
    setTimeout(() => setActiveSlot(null), 1500)
  }, [editorProfile, id, updateProfile])

  const handleUpdateSlot = useCallback((key: string, value: string) => {
    const trimmed = value.trim()
    const newProfile: PanelProfile = {
      _name: editorProfile?._name || id || '',
      _description: editorProfile?._description || '',
      ...(editorProfile || {}),
    }
    if (trimmed) {
      newProfile[key] = trimmed
    } else {
      delete newProfile[key]
    }
    updateProfile(newProfile)
  }, [editorProfile, id, updateProfile])

  const handleTestSelector = useCallback((selector: string) => {
    if (!iframeRef.current?.contentWindow) return
    iframeRef.current.contentWindow.postMessage({ type: 'CLEAR_HIGHLIGHTS' }, '*')
    iframeRef.current.contentWindow.postMessage({ type: 'TEST_SELECTOR', selector }, '*')
  }, [])

  const handleSave = async () => {
    // Check required selectors before saving
    const missingRequired = requiredKeys.filter(k => {
      const val = editorProfile?.[k] || DEFAULT_SELECTORS[k]
      return !val || val.trim() === ''
    })
    if (missingRequired.length > 0) {
      toast(`Faltan ${missingRequired.length} selectores requeridos`, 'error')
      return
    }
    const result = await saveCurrentClient()
    if (result.success) {
      toast('Selectores guardados', 'success')
    } else if (result.error) {
      toast(result.error, 'error')
    }
  }

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Count filled selectors
  const allKeys = Object.keys(DEFAULT_SELECTORS)
  const filledKeys = allKeys.filter(k => editorProfile?.[k] && editorProfile[k] !== DEFAULT_SELECTORS[k])
  const requiredKeys = allKeys.filter(k => REQUIRED_SELECTORS.has(k))
  const filledRequired = requiredKeys.filter(k => editorProfile?.[k] || DEFAULT_SELECTORS[k])

  // Prepare iframe srcdoc with picker injection
  const iframeSrcdoc = htmlContent ? buildPickerHtml(htmlContent) : null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between shrink-0 bg-surface-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/client/${id}`)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            &larr; Volver al editor
          </button>
          <div className="h-4 w-px bg-border" />
          <h2 className="text-sm font-semibold text-gray-200">Selectores CSS</h2>
          {isDirty && (
            <span className="text-[9px] px-1.5 py-0.5 bg-yellow-900/40 text-yellow-400 rounded font-medium">
              Sin guardar
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Progress badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-2 rounded border border-border">
            <div className={`w-1.5 h-1.5 rounded-full ${filledRequired.length === requiredKeys.length ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-[10px] text-gray-400">
              {filledRequired.length}/{requiredKeys.length} req
            </span>
            <span className="text-[10px] text-gray-600">|</span>
            <span className="text-[10px] text-gray-500">
              {filledKeys.length} custom
            </span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Main content — two panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — MHTML preview */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          {/* Toolbar */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-surface-1 shrink-0">
            <button
              onClick={handleLoadMhtml}
              className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded transition-colors"
            >
              {htmlContent ? 'Cambiar archivo' : 'Cargar MHTML / HTML'}
            </button>
            {fileName && (
              <span className="text-[10px] text-gray-500 font-mono truncate">{fileName}</span>
            )}
            <div className="flex-1" />
            {htmlContent && (
              <button
                onClick={() => setIsPickingMode(!isPickingMode)}
                className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                  isPickingMode
                    ? 'bg-purple-900/30 border-purple-700 text-purple-300'
                    : 'bg-surface-3 border-border text-gray-400'
                }`}
              >
                {isPickingMode ? 'Seleccionando...' : 'Seleccionar pausado'}
              </button>
            )}
          </div>

          {/* Iframe or placeholder */}
          {iframeSrcdoc ? (
            <iframe
              ref={iframeRef}
              srcDoc={iframeSrcdoc}
              sandbox="allow-scripts allow-same-origin"
              className="flex-1 bg-white"
              style={{ border: 'none' }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-surface-1 text-gray-500 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-600">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-400">Sin archivo cargado</p>
                <p className="text-xs text-gray-600 mt-1">Cargá un MHTML o HTML del panel del casino</p>
                <p className="text-xs text-gray-700 mt-0.5">para seleccionar elementos visualmente</p>
              </div>
              <button
                onClick={handleLoadMhtml}
                className="mt-2 px-4 py-2 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
              >
                Cargar archivo
              </button>
            </div>
          )}
        </div>

        {/* Right panel — Selector slots + candidate picker */}
        <div className="w-[380px] flex flex-col bg-surface-0 shrink-0">
          {/* Candidate picker (shows when element selected) */}
          {showCandidatePanel && selectedElement && candidates.length > 0 && (
            <div className="border-b border-accent/30 bg-accent/5 p-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                  <span className="text-xs font-semibold text-gray-200">Elemento seleccionado</span>
                </div>
                <button
                  onClick={() => setShowCandidatePanel(false)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Cerrar
                </button>
              </div>

              {/* Element info */}
              <div className="bg-surface-2 rounded px-2 py-1.5 mb-2 border border-border">
                <p className="text-[10px] font-mono text-gray-400 truncate">
                  &lt;{selectedElement.tag}
                  {selectedElement.id && <span className="text-blue-400"> id="{selectedElement.id}"</span>}
                  {selectedElement.type && <span className="text-green-400"> type="{selectedElement.type}"</span>}
                  {selectedElement.name && <span className="text-yellow-400"> name="{selectedElement.name}"</span>}
                  &gt;
                </p>
                {selectedElement.text && (
                  <p className="text-[10px] text-gray-600 truncate mt-0.5">"{selectedElement.text}"</p>
                )}
              </div>

              {/* Candidate selectors */}
              <div className="space-y-1 mb-2 max-h-36 overflow-y-auto">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (assignTarget) {
                        handleAssignSelector(assignTarget, c.selector)
                      }
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                      assignTarget
                        ? 'border-border hover:border-accent hover:bg-accent/5 cursor-pointer'
                        : 'border-border/50 cursor-default opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-gray-300 truncate flex-1 mr-2">
                        {c.selector}
                      </span>
                      <span className={`text-[9px] shrink-0 px-1 py-0.5 rounded ${
                        c.matchCount === 1
                          ? 'bg-green-900/30 text-green-400'
                          : c.matchCount === 0
                            ? 'bg-red-900/30 text-red-400'
                            : 'bg-yellow-900/30 text-yellow-400'
                      }`}>
                        {c.matchCount} match{c.matchCount !== 1 ? 'es' : ''}
                      </span>
                    </div>
                    <span className="text-[9px] text-gray-600">{c.strategy}</span>
                  </button>
                ))}
              </div>

              {/* Assign to dropdown */}
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Asignar a:</label>
                <select
                  value={assignTarget || ''}
                  onChange={(e) => setAssignTarget(e.target.value || null)}
                  className="w-full bg-surface-3 border border-border rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
                >
                  <option value="">Seleccionar slot...</option>
                  {Object.entries(SELECTOR_CATEGORIES).map(([cat, keys]) => (
                    <optgroup key={cat} label={cat}>
                      {keys.map(key => (
                        <option key={key} value={key}>
                          {REQUIRED_SELECTORS.has(key) ? '* ' : ''}{SELECTOR_LABELS[key] || key}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Selector slot list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Profile meta */}
            <div className="space-y-2 pb-3 border-b border-border">
              <input
                value={editorProfile?._name || ''}
                onChange={(e) => updateProfile({ ...editorProfile, _name: e.target.value, _description: editorProfile?._description || '' } as PanelProfile)}
                placeholder="Nombre del perfil (ej: Casino X)"
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
              <input
                value={editorProfile?._description || ''}
                onChange={(e) => updateProfile({ ...editorProfile, _name: editorProfile?._name || '', _description: e.target.value } as PanelProfile)}
                placeholder="Descripcion breve..."
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
              />
            </div>

            {/* Categories */}
            {Object.entries(SELECTOR_CATEGORIES).map(([category, keys]) => {
              const isCollapsed = collapsedCategories.has(category)
              const filledInCat = keys.filter(k => editorProfile?.[k])
              const requiredInCat = keys.filter(k => REQUIRED_SELECTORS.has(k))
              const filledReqInCat = requiredInCat.filter(k => editorProfile?.[k] || DEFAULT_SELECTORS[k])

              return (
                <div key={category}>
                  <button
                    onClick={() => toggleCategory(category)}
                    className="flex items-center gap-2 w-full text-left py-1.5 group"
                  >
                    <svg
                      width="10" height="10" viewBox="0 0 10 10"
                      className={`text-gray-600 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                    >
                      <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span className="text-[11px] font-semibold text-gray-400 group-hover:text-gray-300 uppercase tracking-wider">
                      {category}
                    </span>
                    <span className="text-[9px] text-gray-600">
                      {filledInCat.length}/{keys.length}
                    </span>
                    {requiredInCat.length > 0 && filledReqInCat.length < requiredInCat.length && (
                      <span className="text-[9px] text-red-500">
                        ({requiredInCat.length - filledReqInCat.length} req faltante{requiredInCat.length - filledReqInCat.length > 1 ? 's' : ''})
                      </span>
                    )}
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-1.5 ml-3 mt-1">
                      {keys.map(key => (
                        <SelectorSlot
                          key={key}
                          selectorKey={key}
                          value={editorProfile?.[key] || ''}
                          defaultValue={DEFAULT_SELECTORS[key] || ''}
                          onUpdate={(v) => handleUpdateSlot(key, v)}
                          onTest={handleTestSelector}
                          testResult={testResults[editorProfile?.[key] || ''] || null}
                          isActive={activeSlot === key}
                          onActivate={() => setAssignTarget(key)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
