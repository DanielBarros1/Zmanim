/**
 * Topbar — 56px fixed bar at the top of the main content area.
 *
 * Contains:
 *   - Page title (breadcrumb context)
 *   - Optional action slot (e.g. "New Schedule" button)
 *   - Dark mode toggle (moon/sun icon)
 */

import type { ReactNode } from 'react'
import { useUIStore } from '../../store/uiStore'

interface TopbarProps {
  title: string
  actions?: ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  const { isDark, toggleDark } = useUIStore()

  return (
    <header
      className="flex items-center px-6 shrink-0"
      style={{
        height: 56,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <h1 className="text-[15px] font-semibold text-[var(--text-1)] flex-1">{title}</h1>

      {actions && <div className="flex items-center gap-2 mr-4">{actions}</div>}

      {/* Dark mode toggle */}
      <button
        onClick={toggleDark}
        className="p-2 rounded-md text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-2)] transition-colors"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Light mode' : 'Dark mode'}
      >
        {isDark ? (
          // Sun icon
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          // Moon icon
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </header>
  )
}
