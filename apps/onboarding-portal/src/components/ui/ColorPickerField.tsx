'use client'

import { useState, useRef, useEffect } from 'react'
import { HexColorPicker } from 'react-colorful'

interface ColorPickerFieldProps {
  label: string
  description?: string
  value: string
  onChange: (color: string) => void
}

export function ColorPickerField({ label, description, value, onChange }: ColorPickerFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${
          isOpen
            ? 'bg-surface-3 border-accent/40 ring-1 ring-accent/20'
            : 'bg-surface-2 border-border hover:border-border-light hover:bg-surface-3'
        } border`}
      >
        <div
          className="w-10 h-10 rounded-lg shadow-inner flex-shrink-0 border border-white/10"
          style={{ backgroundColor: value }}
        />
        <div className="flex-1 text-left min-w-0">
          <div className="text-xs font-medium text-gray-300">{label}</div>
          {description && <div className="text-[10px] text-gray-500 truncate">{description}</div>}
        </div>
        <span className="text-[11px] font-mono text-gray-500 bg-surface-1 px-2 py-1 rounded-md">{value}</span>
      </button>

      {isOpen && (
        <div className="absolute z-30 top-full left-0 right-0 mt-2 p-4 rounded-xl bg-surface-3 border border-border shadow-2xl shadow-black/50 space-y-3">
          <HexColorPicker color={value} onChange={onChange} />
          <div className="flex gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => {
                const v = e.target.value
                if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v)
              }}
              className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-gray-300 outline-none focus:border-accent/50"
              maxLength={7}
            />
            <div className="w-8 h-8 rounded-lg border border-white/10" style={{ backgroundColor: value }} />
          </div>
        </div>
      )}
    </div>
  )
}

interface ColorSwatchGridProps {
  colors: { key: string; label: string; description: string; value: string }[]
  onChange: (key: string, value: string) => void
}

export function ColorSwatchGrid({ colors, onChange }: ColorSwatchGridProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedKey) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedKey(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [selectedKey])

  const selected = colors.find((c) => c.key === selectedKey)

  return (
    <div ref={containerRef} className="space-y-4">
      {/* Swatch grid */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {colors.map((color) => (
          <button
            key={color.key}
            onClick={() => setSelectedKey(selectedKey === color.key ? null : color.key)}
            className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all duration-200 ${
              selectedKey === color.key
                ? 'bg-surface-3 ring-1 ring-accent/30 scale-105'
                : 'hover:bg-surface-2 hover:scale-105'
            }`}
          >
            <div
              className={`w-11 h-11 rounded-xl shadow-lg border transition-all ${
                selectedKey === color.key ? 'border-accent/50 ring-2 ring-accent/20' : 'border-white/10'
              }`}
              style={{ backgroundColor: color.value }}
            />
            <span className="text-[9px] text-gray-500 font-medium text-center leading-tight">{color.label}</span>
          </button>
        ))}
      </div>

      {/* Expanded picker for selected color */}
      {selected && (
        <div className="p-4 rounded-xl bg-surface-2 border border-border space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-300">{selected.label}</span>
              <p className="text-[10px] text-gray-500">{selected.description}</p>
            </div>
            <button
              onClick={() => setSelectedKey(null)}
              className="text-gray-500 hover:text-gray-300 text-sm px-2"
            >
              ✕
            </button>
          </div>
          <HexColorPicker color={selected.value} onChange={(v) => onChange(selected.key, v)} />
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={selected.value}
              onChange={(e) => {
                const v = e.target.value
                if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(selected.key, v)
              }}
              className="flex-1 bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-gray-300 outline-none focus:border-accent/50"
              maxLength={7}
            />
            <div className="w-8 h-8 rounded-lg border border-white/10" style={{ backgroundColor: selected.value }} />
          </div>
        </div>
      )}
    </div>
  )
}
