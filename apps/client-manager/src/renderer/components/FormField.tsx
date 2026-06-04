import { useState } from 'react'

interface FormFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'url' | 'textarea'
  placeholder?: string
  error?: string
  required?: boolean
  rows?: number
}

export function FormField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  required,
  rows = 4,
}: FormFieldProps) {
  const [showPassword, setShowPassword] = useState(false)
  const inputType = type === 'password' ? (showPassword ? 'text' : 'password') : type

  const baseClasses =
    'w-full bg-surface-2 border border-border rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent transition-colors'
  const errorClasses = error ? 'border-red-500' : ''

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-400 flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>

      <div className="relative">
        {type === 'textarea' ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            className={`${baseClasses} ${errorClasses} resize-y`}
          />
        ) : (
          <input
            type={inputType}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${baseClasses} ${errorClasses} ${type === 'password' ? 'pr-10' : ''}`}
          />
        )}

        {type === 'password' && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
          >
            {showPassword ? 'Ocultar' : 'Ver'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
