import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface RunbookEntry {
  filename: string
  title: string
  content: string
}

const RUNBOOK_FILES = [
  { filename: '01-bot-no-carga.md', title: 'Bot no carga fichas', icon: '🤖' },
  { filename: '02-selectores-cambiaron.md', title: 'Selectores cambiaron', icon: '🎯' },
  { filename: '03-mp-no-verifica.md', title: 'MP no verifica pagos', icon: '💳' },
  { filename: '04-nuevo-cliente.md', title: 'Onboarding nuevo cliente', icon: '🆕' },
  { filename: '05-emergencias.md', title: 'Emergencias', icon: '🚨' },
]

export function Runbook() {
  const [entries, setEntries] = useState<RunbookEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRunbooks()
  }, [])

  const loadRunbooks = async () => {
    setLoading(true)
    const loaded: RunbookEntry[] = []
    for (const file of RUNBOOK_FILES) {
      try {
        const content = await window.api.loadRunbook(file.filename)
        if (content) loaded.push({ filename: file.filename, title: file.title, content })
      } catch {}
    }
    setEntries(loaded)
    if (loaded.length > 0) setSelected(loaded[0].filename)
    setLoading(false)
  }

  const selectedEntry = entries.find(e => e.filename === selected)

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-56 bg-surface-1 border-r border-border flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-gray-200">Runbook</h2>
          <p className="text-[10px] text-gray-600 mt-0.5">Procedimientos operativos</p>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {RUNBOOK_FILES.map((file, i) => {
            const hasContent = entries.some(e => e.filename === file.filename)
            return (
              <button
                key={file.filename}
                onClick={() => setSelected(file.filename)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors ${
                  selected === file.filename
                    ? 'bg-accent/10 text-accent border-r-2 border-accent'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-surface-2'
                }`}
              >
                <span className="text-sm">{file.icon}</span>
                <span className="text-xs font-medium truncate">{file.title}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">Cargando...</div>
        ) : selectedEntry ? (
          <div className="max-w-3xl mx-auto px-8 py-6">
            <MarkdownRenderer content={selectedEntry.content} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            Selecciona un procedimiento
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Simple markdown renderer — handles headers, lists, code, bold, checkboxes.
 * No external dependencies.
 */
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n')

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trimEnd()

        // Headers
        if (trimmed.startsWith('# ')) {
          return <h1 key={i} className="text-lg font-bold text-gray-100 mt-6 mb-2">{trimmed.slice(2)}</h1>
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={i} className="text-sm font-bold text-gray-200 mt-5 mb-1.5 pb-1 border-b border-border">{trimmed.slice(3)}</h2>
        }
        if (trimmed.startsWith('### ')) {
          return <h3 key={i} className="text-xs font-bold text-gray-300 mt-4 mb-1">{trimmed.slice(4)}</h3>
        }

        // Checkbox list
        if (trimmed.startsWith('- [ ] ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2 py-0.5">
              <div className="w-3.5 h-3.5 mt-0.5 border border-border rounded shrink-0" />
              <span className="text-xs text-gray-400 leading-relaxed">{renderInline(trimmed.slice(6))}</span>
            </div>
          )
        }
        if (trimmed.startsWith('- [x] ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2 py-0.5">
              <div className="w-3.5 h-3.5 mt-0.5 bg-accent/20 border border-accent/40 rounded shrink-0 flex items-center justify-center">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-accent"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <span className="text-xs text-gray-500 leading-relaxed line-through">{renderInline(trimmed.slice(6))}</span>
            </div>
          )
        }

        // Bullet list
        if (trimmed.startsWith('- ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2 py-0.5">
              <div className="w-1 h-1 mt-1.5 bg-gray-600 rounded-full shrink-0" />
              <span className="text-xs text-gray-400 leading-relaxed">{renderInline(trimmed.slice(2))}</span>
            </div>
          )
        }

        // Numbered list
        const numMatch = trimmed.match(/^(\d+)\.\s(.+)/)
        if (numMatch) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2 py-0.5">
              <span className="text-[10px] text-accent font-bold mt-0.5 w-4 shrink-0">{numMatch[1]}.</span>
              <span className="text-xs text-gray-400 leading-relaxed">{renderInline(numMatch[2])}</span>
            </div>
          )
        }

        // Empty line
        if (trimmed === '') {
          return <div key={i} className="h-2" />
        }

        // Regular paragraph
        return <p key={i} className="text-xs text-gray-400 leading-relaxed">{renderInline(trimmed)}</p>
      })}
    </div>
  )
}

/** Inline markdown: bold, code, backticks */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    // Inline code
    const codeMatch = remaining.match(/`(.+?)`/)

    const boldIdx = boldMatch?.index ?? Infinity
    const codeIdx = codeMatch?.index ?? Infinity

    if (boldIdx === Infinity && codeIdx === Infinity) {
      parts.push(remaining)
      break
    }

    if (boldIdx < codeIdx && boldMatch) {
      parts.push(remaining.slice(0, boldIdx))
      parts.push(<strong key={key++} className="text-gray-200 font-semibold">{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldIdx + boldMatch[0].length)
    } else if (codeMatch) {
      parts.push(remaining.slice(0, codeIdx))
      parts.push(<code key={key++} className="px-1 py-0.5 bg-surface-3 rounded text-[10px] font-mono text-accent">{codeMatch[1]}</code>)
      remaining = remaining.slice(codeIdx + codeMatch[0].length)
    }
  }

  return parts
}
