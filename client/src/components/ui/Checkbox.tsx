/**
 * Checkbox — styled checkbox with label.
 */

import type { InputHTMLAttributes } from 'react'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

export function Checkbox({ label, className = '', ...rest }: CheckboxProps) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer ${className}`}>
      <input
        type="checkbox"
        className="w-4 h-4 rounded accent-[var(--accent)] cursor-pointer"
        {...rest}
      />
      <span className="text-[13px] text-[var(--text-1)]">{label}</span>
    </label>
  )
}
