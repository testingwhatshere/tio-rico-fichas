import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from './Toast'

interface AssetSlot {
  name: string
  label: string
  required: boolean
  description: string
}

const ASSET_SLOTS: AssetSlot[] = [
  { name: 'icon.png', label: 'Icono App', required: true, description: '1024x1024 — Icono principal de la app' },
  { name: 'adaptive-icon.png', label: 'Icono Adaptativo', required: true, description: '1024x1024 — Icono para Android con fondo adaptativo' },
  { name: 'splash.png', label: 'Splash Screen', required: true, description: '1284x2778 — Pantalla de carga' },
  { name: 'logo.svg', label: 'Logo (SVG)', required: false, description: 'Logo vectorial para landing y panel de operador' },
  { name: 'favicon.png', label: 'Favicon', required: false, description: '32x32 o 64x64 — Icono para web' },
  { name: 'notification-icon.png', label: 'Icono Notificacion', required: false, description: '96x96 — Icono para push notifications' },
]

interface AssetManagerProps {
  clientId: string
  assets: string[]
  onAssetsChange: () => void
}

export function AssetManager({ clientId, assets, onAssetsChange }: AssetManagerProps) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})

  const requiredCount = ASSET_SLOTS.filter(s => s.required).length
  const requiredFilled = ASSET_SLOTS.filter(s => s.required && assets.includes(s.name)).length

  const handlePickFile = async (slotName: string) => {
    const filePath = await window.api.pickFile([
      { name: 'Imagenes', extensions: ['png', 'svg', 'jpg', 'jpeg'] },
    ])
    if (!filePath) return

    try {
      await window.api.copyAsset(clientId, filePath, slotName)
      toast(`${slotName} actualizado`, 'success')
      onAssetsChange()
    } catch (e: any) {
      toast(e.message || 'Error copiando archivo', 'error')
    }
  }

  const handleDrop = async (e: React.DragEvent, slotName: string) => {
    e.preventDefault()
    setDragOver(null)

    const file = e.dataTransfer.files[0]
    if (!file) return

    // For Electron, we get the path from the file
    const filePath = (file as any).path
    if (!filePath) {
      toast('No se pudo obtener la ruta del archivo', 'error')
      return
    }

    try {
      await window.api.copyAsset(clientId, filePath, slotName)
      toast(`${slotName} actualizado`, 'success')
      onAssetsChange()
    } catch (e: any) {
      toast(e.message || 'Error copiando archivo', 'error')
    }
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center gap-3 p-3 bg-surface-1 border border-border rounded-lg">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-300">Assets requeridos</span>
            <span className="text-xs text-gray-500">{requiredFilled}/{requiredCount}</span>
          </div>
          <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                requiredFilled === requiredCount ? 'bg-green-500' : 'bg-yellow-500'
              }`}
              style={{ width: `${(requiredFilled / requiredCount) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Asset grid */}
      <div className="grid grid-cols-2 gap-3">
        {ASSET_SLOTS.map((slot) => {
          const isUploaded = assets.includes(slot.name)
          const isDragTarget = dragOver === slot.name

          return (
            <div
              key={slot.name}
              onDragOver={(e) => { e.preventDefault(); setDragOver(slot.name) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, slot.name)}
              onClick={() => handlePickFile(slot.name)}
              className={`relative cursor-pointer rounded-lg border-2 border-dashed transition-all duration-200 overflow-hidden group ${
                isDragTarget
                  ? 'border-accent bg-accent/10 scale-[1.02]'
                  : isUploaded
                    ? 'border-green-800/40 bg-surface-1 hover:border-green-700/50'
                    : slot.required
                      ? 'border-red-900/30 bg-surface-1 hover:border-red-800/40'
                      : 'border-border/50 bg-surface-1 hover:border-border'
              }`}
            >
              {/* Preview area */}
              <div className="h-28 flex items-center justify-center bg-surface-0/50 relative">
                {isUploaded ? (
                  <>
                    {/* Checkered background for transparency */}
                    <div className="absolute inset-0 opacity-20" style={{
                      backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
                    }} />
                    <div className="text-2xl relative z-10">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-500">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                    {/* Replace overlay */}
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-xs text-white font-medium">Reemplazar</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-600 mx-auto mb-1">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span className="text-[10px] text-gray-600">
                      {isDragTarget ? 'Soltar aca' : 'Click o arrastrar'}
                    </span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-2.5">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-medium text-gray-300">{slot.label}</span>
                  {slot.required && !isUploaded && (
                    <span className="text-[8px] px-1 py-0.5 bg-red-900/30 text-red-400 rounded font-bold">REQ</span>
                  )}
                  {isUploaded && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-500">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <p className="text-[10px] text-gray-600 leading-relaxed">{slot.description}</p>
                <p className="text-[9px] text-gray-700 font-mono mt-0.5">{slot.name}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
