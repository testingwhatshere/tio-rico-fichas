import { useEffect, useState } from 'react'

interface ToastData {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let toastId = 0
let addToastFn: ((toast: Omit<ToastData, 'id'>) => void) | null = null

export function toast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  addToastFn?.({ message, type })
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([])

  useEffect(() => {
    addToastFn = (data) => {
      const id = ++toastId
      setToasts((prev) => [...prev, { ...data, id }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3000)
    }
    return () => { addToastFn = null }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-lg text-xs font-medium shadow-lg border animate-in slide-in-from-right backdrop-blur-sm ${
            t.type === 'success'
              ? 'bg-green-950/90 text-green-300 border-green-800/60'
              : t.type === 'error'
                ? 'bg-red-950/90 text-red-300 border-red-800/60'
                : 'bg-surface-2/90 text-gray-300 border-border'
          }`}
        >
          <div className="flex items-center gap-2">
            {t.type === 'success' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
            {t.type === 'error' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
            {t.message}
          </div>
        </div>
      ))}
    </div>
  )
}
