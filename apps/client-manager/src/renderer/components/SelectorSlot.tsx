import { useState, useRef, useEffect } from 'react'
import { SELECTOR_LABELS, REQUIRED_SELECTORS } from '../lib/constants'

interface SelectorSlotProps {
  selectorKey: string
  value: string
  defaultValue: string
  onUpdate: (value: string) => void
  onTest: (selector: string) => void
  testResult?: { matchCount: number } | null
  isActive: boolean
  onActivate: () => void
}

export function SelectorSlot({
  selectorKey,
  value,
  defaultValue,
  onUpdate,
  onTest,
  testResult,
  isActive,
  onActivate,
}: SelectorSlotProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const isRequired = REQUIRED_SELECTORS.has(selectorKey)
  const label = SELECTOR_LABELS[selectorKey] || selectorKey
  const hasValue = !!value
  const isDefault = value === defaultValue || (!value && !!defaultValue)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(value)
  }, [value])

  const handleSaveEdit = () => {
    onUpdate(editValue.trim())
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveEdit()
    if (e.key === 'Escape') {
      setEditValue(value)
      setIsEditing(false)
    }
  }

  return (
    <div
      className={`group rounded-lg border transition-all duration-150 ${
        isActive
          ? 'border-accent bg-accent/5 shadow-sm shadow-accent/10'
          : hasValue
            ? 'border-border bg-surface-1 hover:border-border-light'
            : isRequired
              ? 'border-red-900/40 bg-red-950/10 hover:border-red-800/50'
              : 'border-border/50 bg-surface-0 hover:border-border'
      }`}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={onActivate}
      >
        {/* Status dot */}
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            hasValue ? 'bg-green-500' : isRequired ? 'bg-red-400 animate-pulse' : 'bg-gray-600'
          }`}
        />

        {/* Label */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-300 truncate">{label}</span>
            {isRequired && !hasValue && (
              <span className="text-[9px] px-1 py-0.5 bg-red-900/30 text-red-400 rounded font-medium shrink-0">
                Requerido
              </span>
            )}
            {isDefault && hasValue && (
              <span className="text-[9px] px-1 py-0.5 bg-gray-800 text-gray-500 rounded shrink-0">
                Default
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-gray-600 truncate mt-0.5">
            {selectorKey}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {hasValue && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTest(value)
              }}
              className="px-1.5 py-0.5 text-[10px] bg-surface-3 hover:bg-surface-4 text-gray-400 rounded border border-border transition-colors"
              title="Testear selector"
            >
              Test
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setEditValue(value || defaultValue)
              setIsEditing(true)
            }}
            className="px-1.5 py-0.5 text-[10px] bg-surface-3 hover:bg-surface-4 text-gray-400 rounded border border-border transition-colors"
          >
            Editar
          </button>
        </div>
      </div>

      {/* Value preview */}
      {hasValue && !isEditing && (
        <div className="px-3 pb-2">
          <p className="text-[10px] font-mono text-gray-500 truncate leading-relaxed">
            {value}
          </p>
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div className={`mx-3 mb-2 px-2 py-1 rounded text-[10px] font-medium ${
          testResult.matchCount === 1
            ? 'bg-green-900/20 text-green-400'
            : testResult.matchCount === 0
              ? 'bg-red-900/20 text-red-400'
              : testResult.matchCount === -1
                ? 'bg-red-900/20 text-red-400'
                : 'bg-yellow-900/20 text-yellow-400'
        }`}>
          {testResult.matchCount === -1
            ? 'Selector invalido'
            : testResult.matchCount === 0
              ? 'Sin coincidencias'
              : testResult.matchCount === 1
                ? '1 coincidencia (perfecto)'
                : `${testResult.matchCount} coincidencias (deberia ser 1)`
          }
        </div>
      )}

      {/* Inline editor */}
      {isEditing && (
        <div className="px-3 pb-3 space-y-2">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            placeholder={defaultValue || 'Pegar selector CSS...'}
            className="w-full bg-surface-3 border border-border rounded px-2 py-1.5 text-[11px] font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSaveEdit()
                }}
                className="px-2 py-1 text-[10px] bg-accent hover:bg-accent-hover text-white rounded transition-colors"
              >
                Guardar
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  setEditValue(value)
                  setIsEditing(false)
                }}
                className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                Cancelar
              </button>
            </div>
            {value && (
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  onUpdate('')
                  setIsEditing(false)
                }}
                className="px-2 py-1 text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                Borrar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
