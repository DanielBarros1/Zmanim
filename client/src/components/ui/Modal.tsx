/**
 * Modal — centered overlay dialog.
 *
 * Closes on backdrop click or Escape key.
 * Uses a portal so it's always on top of the grid.
 *
 * Usage:
 *   <Modal open={open} onClose={handleClose} title="Edit Teacher">
 *     ...form content...
 *   </Modal>
 */

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Constrain width (default: max-w-lg) */
  width?: string
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: ModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={[
          'relative z-10 w-full rounded-xl shadow-2xl',
          'bg-[var(--surface)] border border-[var(--border)]',
          width,
        ].join(' ')}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
            <h2 className="text-[15px] font-semibold text-[var(--text-1)]">{title}</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors p-1 rounded"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M12 4L4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
