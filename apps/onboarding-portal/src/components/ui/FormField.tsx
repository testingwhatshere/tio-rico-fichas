import { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface BaseProps {
  label: string
  error?: string
  hint?: string
  autoTag?: boolean
}

interface InputProps extends BaseProps, InputHTMLAttributes<HTMLInputElement> {
  multiline?: false
}

interface TextareaProps extends BaseProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
  multiline: true
}

type FormFieldProps = InputProps | TextareaProps

export function FormField({ label, error, hint, autoTag, multiline, ...props }: FormFieldProps) {
  const baseClasses = `w-full bg-surface-2 border rounded-lg px-3.5 py-2.5 text-sm text-gray-200 placeholder-gray-500 outline-none transition-all focus:border-accent/60 focus:ring-1 focus:ring-accent/20 ${
    error ? 'border-red-500/60' : 'border-border'
  }`

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-400">{label}</label>
        {autoTag && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent/80 font-medium">
            AUTO
          </span>
        )}
      </div>
      {multiline ? (
        <textarea className={`${baseClasses} resize-none`} rows={4} {...(props as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input className={baseClasses} {...(props as InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}
