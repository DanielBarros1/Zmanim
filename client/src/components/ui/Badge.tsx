/**
 * Badge — pill-shaped status indicator.
 *
 * Variants:
 *   draft     — amber  (schedule is a draft)
 *   published — green  (schedule is live)
 *   warn      — amber  (violation / warning)
 *   ok        — green  (constraint satisfied)
 *   neutral   — gray   (informational)
 *   accent    — blue   (active/selected)
 */

import type { ReactNode } from 'react'

type Variant = 'draft' | 'published' | 'warn' | 'ok' | 'neutral' | 'accent'

interface BadgeProps {
  variant?: Variant
  children: ReactNode
  className?: string
}

const variantStyles: Record<Variant, string> = {
  draft:     'bg-[var(--warn-badge)]    text-[var(--warn-text)]',
  published: 'bg-[var(--ok-bg)]        text-[var(--ok-text)]   border border-[var(--ok-border)]',
  warn:      'bg-[var(--warn-bg)]       text-[var(--warn-text)] border border-[var(--warn-border)]',
  ok:        'bg-[var(--ok-bg)]         text-[var(--ok-text)]',
  neutral:   'bg-[var(--surface-2)]    text-[var(--text-2)]',
  accent:    'bg-[var(--accent-bg)]    text-[var(--accent-text)]',
}

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold leading-none whitespace-nowrap',
        variantStyles[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}
