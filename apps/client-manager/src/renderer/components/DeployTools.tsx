import { useState, useMemo } from 'react'
import { generateAllFiles, validateBeforeGeneration, type GeneratedFiles } from '../lib/deploy-generator'
import { toast } from './Toast'
import type { ClientConfig } from '../lib/types'

interface DeployToolsProps {
  config: ClientConfig
}

type FileKey = keyof GeneratedFiles

const FILE_LIST: { key: FileKey; label: string; icon: string; description: string }[] = [
  { key: 'backend.env', label: 'Backend .env', icon: '🔧', description: 'Variables de entorno del backend NestJS' },
  { key: 'chat-app.env', label: 'Chat App .env', icon: '📱', description: 'Variables para el build de la app movil' },
  { key: 'extension-config.json', label: 'Extension Config', icon: '🧩', description: 'Config JSON para la Chrome Extension' },
  { key: 'render.yaml', label: 'Render Blueprint', icon: '☁️', description: 'Deployment blueprint para Render' },
  { key: 'docker-compose.yml', label: 'Docker Compose', icon: '🐳', description: 'Compose para deploy local con Docker' },
  { key: 'provision.sh', label: 'Provision Script', icon: '🖥️', description: 'Script de setup para VPS Ubuntu' },
]

export function DeployTools({ config }: DeployToolsProps) {
  const [expandedFile, setExpandedFile] = useState<FileKey | null>(null)
  const [editedContent, setEditedContent] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [existingFiles, setExistingFiles] = useState<Set<string>>(new Set())

  // Validate config for generation
  const validation = useMemo(() => validateBeforeGeneration(config), [config])
  const canGenerate = validation.valid

  // Generate files only if validation passes (otherwise show individual generators would crash)
  const generatedFiles = useMemo(() => {
    if (!canGenerate) return null
    try {
      return generateAllFiles(config)
    } catch {
      return null
    }
  }, [config, canGenerate])

  const getContent = (key: FileKey): string => {
    return editedContent[key] ?? generatedFiles?.[key] ?? '# No se puede generar — faltan campos requeridos'
  }

  const isEdited = (key: FileKey): boolean => {
    return key in editedContent && editedContent[key] !== generatedFiles?.[key]
  }

  const handleToggleFile = (key: FileKey) => {
    setExpandedFile(expandedFile === key ? null : key)
  }

  const handleResetFile = (key: FileKey) => {
    setEditedContent(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    toast('Restaurado al contenido generado', 'info')
  }

  const handleCopy = (key: FileKey) => {
    navigator.clipboard.writeText(getContent(key))
    toast(`${key} copiado al clipboard`, 'success')
  }

  const handleSaveOne = async (key: FileKey) => {
    try {
      await window.api.saveDeployFiles(config.id, { [key]: getContent(key) } as any)
      toast(`${key} guardado en deploy/`, 'success')
      setExistingFiles(prev => new Set([...prev, key]))
    } catch (e: any) {
      toast(e.message || 'Error', 'error')
    }
  }

  const handleGenerateAll = async () => {
    setGenerating(true)
    try {
      // Use edited content where available, generated for the rest
      const filesToSave: Record<string, string> = {}
      for (const f of FILE_LIST) {
        filesToSave[f.key] = getContent(f.key)
      }
      await window.api.saveDeployFiles(config.id, filesToSave)
      setExistingFiles(new Set(FILE_LIST.map(f => f.key)))
      toast(`${FILE_LIST.length} archivos guardados en clients/${config.id}/deploy/`, 'success')
    } catch (e: any) {
      toast(e.message || 'Error generando archivos', 'error')
    }
    setGenerating(false)
  }

  return (
    <div className="space-y-4">
      {/* Blocking errors — cannot generate */}
      {validation.errors.length > 0 && (
        <div className="p-4 bg-red-950/30 border border-red-900/40 rounded-lg">
          <p className="text-xs font-bold text-red-400 mb-2">Campos requeridos faltantes</p>
          <ul className="space-y-1">
            {validation.errors.map((err) => (
              <li key={err} className="text-[11px] text-red-400/80 flex items-center gap-2">
                <span className="text-red-500">&#10005;</span> {err}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-gray-500 mt-2">
            Completa estos campos antes de generar archivos de deploy.
          </p>
        </div>
      )}

      {/* Warnings — generation proceeds but things may be incomplete */}
      {validation.warnings.length > 0 && canGenerate && (
        <div className="p-3 bg-yellow-950/20 border border-yellow-900/30 rounded-lg">
          <p className="text-xs font-medium text-yellow-400 mb-1">Campos opcionales vacios</p>
          <p className="text-[10px] text-yellow-500/70">
            {validation.warnings.join(', ')}
          </p>
          <p className="text-[10px] text-gray-600 mt-1">
            Los archivos se generaran pero estos valores quedaran vacios.
          </p>
        </div>
      )}

      {/* Generate all */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${
        canGenerate ? 'bg-accent/5 border-accent/20' : 'bg-surface-1 border-border opacity-60'
      }`}>
        <div>
          <p className="text-sm font-medium text-gray-200">Archivos de deploy</p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {FILE_LIST.length} archivos → clients/{config.id}/deploy/
          </p>
        </div>
        <button
          onClick={handleGenerateAll}
          disabled={generating || !canGenerate}
          className="px-4 py-2 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          title={!canGenerate ? 'Completa los campos requeridos primero' : undefined}
        >
          {generating ? 'Guardando...' : 'Guardar todos'}
        </button>
      </div>

      {/* File list */}
      <div className="space-y-2">
        {FILE_LIST.map(({ key, label, icon, description }) => {
          const isExpanded = expandedFile === key
          const wasEdited = isEdited(key)
          const exists = existingFiles.has(key)

          return (
            <div key={key} className={`bg-surface-1 border rounded-lg overflow-hidden transition-colors ${
              isExpanded ? 'border-accent/30' : 'border-border'
            }`}>
              {/* File header */}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-sm shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-gray-300">{label}</p>
                    {wasEdited && (
                      <span className="text-[8px] px-1 py-0.5 bg-yellow-900/30 text-yellow-400 rounded font-medium">Editado</span>
                    )}
                    {exists && !wasEdited && (
                      <span className="text-[8px] px-1 py-0.5 bg-green-900/30 text-green-400 rounded font-medium">Guardado</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600">{description}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleCopy(key)}
                    disabled={!canGenerate}
                    className="px-2 py-1 text-[10px] bg-surface-3 hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 rounded border border-border transition-colors"
                    title="Copiar al clipboard"
                  >
                    Copiar
                  </button>
                  <button
                    onClick={() => handleToggleFile(key)}
                    disabled={!canGenerate}
                    className={`px-2 py-1 text-[10px] rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      isExpanded
                        ? 'bg-accent/10 border-accent/30 text-accent'
                        : 'bg-surface-3 border-border text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    {isExpanded ? 'Cerrar' : 'Ver / Editar'}
                  </button>
                  <button
                    onClick={() => handleSaveOne(key)}
                    disabled={!canGenerate}
                    className="px-2 py-1 text-[10px] bg-surface-3 hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 rounded border border-border transition-colors"
                  >
                    Guardar
                  </button>
                </div>
              </div>

              {/* Expanded: editable content */}
              {isExpanded && (
                <div className="border-t border-border">
                  <div className="flex items-center justify-between px-4 py-1.5 bg-surface-0/50">
                    <span className="text-[9px] text-gray-600 font-mono">
                      clients/{config.id}/deploy/{key}
                    </span>
                    <div className="flex items-center gap-1">
                      {wasEdited && (
                        <button
                          onClick={() => handleResetFile(key)}
                          className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors"
                        >
                          Restaurar original
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={getContent(key)}
                    onChange={(e) => setEditedContent(prev => ({ ...prev, [key]: e.target.value }))}
                    spellCheck={false}
                    className="w-full bg-surface-0 px-4 py-3 text-[10px] font-mono text-gray-400 leading-relaxed resize-y focus:outline-none focus:text-gray-300 min-h-[200px] max-h-[500px]"
                    style={{ tabSize: 2 }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
