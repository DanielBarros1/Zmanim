/**
 * Select — styled <select> wrapper matching the design token system.
 *
 * Displays a chevron icon and respects dark mode automatically.
 */

import type { SelectHTMLAttributes } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export function Select({ label, error, className = '', children, ...rest }: SelectProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-[12px] font-medium text-[var(--text-2)]">{label}</label>
      )}
      <div className="relative">
        <select
          className={[
            'w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--surface)]',
            'px-3 py-2 pr-8 text-[13px] text-[var(--text-1)]',
            'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
            'transition-colors disabled:opacity-50 cursor-pointer',
            error ? 'border-red-500' : '',
            className,
          ].join(' ')}
          {...rest}
        >
          {children}
        </select>
        {/* Chevron */}
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 4.5L6 8l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}
