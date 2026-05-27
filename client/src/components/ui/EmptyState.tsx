/**
 * EmptyState — shown when a list has no items.
 *
 * Renders in the recess area (dashed border, muted colors per design spec).
 */

import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 px-6 rounded-xl text-center"
      style={{
        background: 'var(--empty-bg)',
        border: '1.5px dashed var(--empty-border)',
      }}
    >
      {icon && (
        <span className="text-3xl" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="text-[14px] font-medium text-[var(--text-2)]">{title}</p>
      {description && (
        <p className="text-[12px] text-[var(--text-3)] max-w-xs">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
