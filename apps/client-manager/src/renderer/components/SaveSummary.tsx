import type { ClientConfig, PanelProfile } from '../lib/types'
import { validateClientConfig } from '../lib/validation'

interface SaveSummaryProps {
  open: boolean
  config: ClientConfig
  profile: PanelProfile | null
  assets: string[]
  onConfirm: () => void
  onCancel: () => void
  saving: boolean
}

export function SaveSummary({ open, config, profile, assets, onConfirm, onCancel, saving }: SaveSummaryProps) {
  if (!open) return null

  const validation = validateClientConfig(config)
  const profileKeys = profile ? Object.keys(profile).filter(k => !k.startsWith('_')).length : 0

  const files = [
    { name: 'config.json', status: 'write' as const, detail: `${Object.keys(config).length} campos` },
  ]
  if (profile && profileKeys > 0) {
    files.push({ name: 'panel-profile.json', status: 'write' as const, detail: `${profileKeys} selectores` })
  }
  if (assets.length > 0) {
    files.push({ name: `assets/ (${assets.length})`, status: 'keep' as const, detail: assets.join(', ') })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-2 border border-border rounded-xl p-5 max-w-md w-full mx-4 shadow-2xl animate-in">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Guardar cliente</h3>
        <p className="text-xs text-gray-500 mb-4">
          Se escribiran los siguientes archivos en <span className="font-mono text-gray-400">clients/{config.id}/</span>
        </p>

        {/* Files list */}
        <div className="space-y-1.5 mb-4">
          {files.map(f => (
            <div key={f.name} className="flex items-center gap-2 px-3 py-2 bg-surface-1 rounded border border-border">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.status === 'write' ? 'bg-blue-400' : 'bg-gray-600'}`} />
              <span className="text-xs font-mono text-gray-300 flex-1">{f.name}</span>
              <span className="text-[10px] text-gray-600">{f.detail}</span>
            </div>
          ))}
        </div>

        {/* Validation status */}
        {validation.errors.length > 0 && (
          <div className="mb-4 p-3 bg-red-950/30 border border-red-900/30 rounded-lg">
            <p className="text-xs font-medium text-red-400 mb-1">
              {validation.errors.length} error{validation.errors.length > 1 ? 'es' : ''}
            </p>
            {validation.errors.slice(0, 3).map((e, i) => (
              <p key={i} className="text-[10px] text-red-500">{e.message}</p>
            ))}
          </div>
        )}

        {validation.warnings.length > 0 && validation.errors.length === 0 && (
          <div className="mb-4 p-3 bg-yellow-950/30 border border-yellow-900/30 rounded-lg">
            <p className="text-xs font-medium text-yellow-400 mb-1">
              {validation.warnings.length} advertencia{validation.warnings.length > 1 ? 's' : ''}
            </p>
            {validation.warnings.slice(0, 3).map((w, i) => (
              <p key={i} className="text-[10px] text-yellow-500">{w.message}</p>
            ))}
          </div>
        )}

        {validation.errors.length === 0 && validation.warnings.length === 0 && (
          <div className="mb-4 p-3 bg-green-950/30 border border-green-900/30 rounded-lg">
            <p className="text-xs font-medium text-green-400">Todo en orden</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-surface-3 rounded border border-border transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={saving || validation.errors.length > 0}
            className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors"
          >
            {saving ? 'Guardando...' : 'Confirmar y guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
