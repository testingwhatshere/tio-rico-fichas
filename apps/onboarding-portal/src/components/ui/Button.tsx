import { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const base = 'px-6 py-2.5 rounded-lg font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm'

  const variants = {
    primary: 'bg-accent hover:bg-accent-hover text-surface-0 shadow-lg shadow-accent/20',
    secondary: 'bg-surface-3 hover:bg-surface-4 text-gray-200 border border-border',
    ghost: 'hover:bg-surface-2 text-gray-400 hover:text-gray-200',
  }

  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}
