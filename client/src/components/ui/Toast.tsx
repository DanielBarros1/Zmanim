/**
 * Toast — a dismissible notification that slides in from the bottom-right.
 *
 * Usage: render <ToastStack toasts={...} onDismiss={...} /> at the root of
 * your layout.  Add/remove items from the array to show/hide toasts.
 *
 * Each toast auto-dismisses after `duration` ms (default 8 s).
 */

import { useEffect, useRef } from 'react'

export interface ToastData {
  id: string
  type: 'success' | 'error' | 'info'
  title: string
  message?: string
  /** Optional call-to-action link rendered as a button. */
  action?: { label: string; onClick: () => void }
  /** Auto-dismiss after this many ms. Default 8000. */
  duration?: number
}

const TYPE_STYLE: Record<ToastData['type'], { icon: string; bar: string; bg: string; border: string }> = {
  success: { icon: '✅', bar: '#22c55e', bg: 'var(--surface)',    border: '#22c55e' },
  error:   { icon: '❌', bar: '#ef4444', bg: 'var(--surface)',    border: '#ef4444' },
  info:    { icon: 'ℹ️', bar: '#3b82f6', bg: 'var(--surface)',    border: '#3b82f6' },
}

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const s = TYPE_STYLE[toast.type]
  const duration = toast.duration ?? 8000
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), duration)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [toast.id, duration, onDismiss])

  return (
    <div
      className="relative flex items-start gap-3 rounded-lg shadow-lg pointer-events-auto overflow-hidden"
      style={{
        background:   s.bg,
        border:       `1px solid var(--border)`,
        borderLeft:   `4px solid ${s.bar}`,
        minWidth:     300,
        maxWidth:     400,
        padding:      '12px 14px',
      }}
      role="alert"
    >
      <span className="text-[18px] shrink-0 leading-none mt-0.5">{s.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{toast.title}</p>
        {toast.message && (
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {toast.message}
          </p>
        )}
        {toast.action && (
          <button
            onClick={() => { toast.action!.onClick(); onDismiss(toast.id) }}
            className="mt-2 text-[11px] font-semibold underline"
            style={{ color: 'var(--accent-text)' }}
          >
            {toast.action.label} →
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-[14px] leading-none hover:opacity-60 transition-opacity"
        style={{ color: 'var(--text-3)' }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map(t => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
