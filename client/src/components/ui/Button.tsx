/**
 * Button — primary, secondary, ghost, and danger variants.
 *
 * Uses CSS custom properties for color so it respects dark mode automatically.
 * Size: sm | md (default).
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
  loading?: boolean
}

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50',
  secondary:
    'bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--border)] hover:bg-[var(--border)] disabled:opacity-50',
  ghost:
    'bg-transparent text-[var(--text-2)] hover:bg-[var(--surface-2)] disabled:opacity-50',
  danger:
    'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
}

const sizeStyles: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-4 py-2 text-[13px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        'inline-flex items-center gap-2 rounded-md font-medium transition-colors cursor-pointer',
        variantStyles[variant],
        sizeStyles[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && (
        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
}
