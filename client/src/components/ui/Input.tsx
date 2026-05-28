/**
 * Input — styled text input compatible with CSS design tokens.
 *
 * Supports label, error message, and Hebrew RTL content
 * (pass isHebrew for right-aligned text).
 */

import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  isHebrew?: boolean
}

export function Input({ label, error, isHebrew, className = '', ...rest }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-[12px] font-medium text-[var(--text-2)]">{label}</label>
      )}
      <input
        // dir="rtl" is required (not just text-align) so the browser anchors the
        // cursor on the right and flows text right-to-left as the user types Hebrew.
        dir={isHebrew ? 'rtl' : undefined}
        className={[
          'w-full rounded-md border border-[var(--border)] bg-[var(--surface)]',
          'px-3 py-2 text-[13px] text-[var(--text-1)] placeholder-[var(--text-3)]',
          'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
          'transition-colors disabled:opacity-50',
          isHebrew ? 'text-right' : '',
          error ? 'border-red-500' : '',
          className,
        ].join(' ')}
        {...rest}
      />
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}
