/**
 * ErrorBoundary — catches unhandled render errors and shows a friendly UI.
 *
 * Wrap individual route subtrees (not the whole app) so a crash on one page
 * doesn't kill the entire session.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <ScheduleEditorPage />
 *   </ErrorBoundary>
 *
 * When an error is caught:
 *   - Logs to console (could send to Sentry in production)
 *   - Shows message + "Try again" (reset boundary) and "Go home" buttons
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  /** Optional custom fallback — if omitted, the default error UI is shown */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error)
    console.error('[ErrorBoundary] Component stack:', info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <ErrorFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      )
    }
    return this.props.children
  }
}

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error | null
  onReset: () => void
}) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-5 p-8"
      style={{ background: 'var(--bg)' }}
    >
      <p className="text-5xl select-none">💥</p>

      <div className="text-center max-w-md space-y-2">
        <h2 className="text-[18px] font-semibold text-[var(--text-1)]">
          Something went wrong
        </h2>
        {error?.message && (
          <p
            className="text-[12px] font-mono px-3 py-2 rounded-md break-words"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              border: '1px solid var(--border)',
            }}
          >
            {error.message}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="px-4 py-2 rounded-md text-[13px] font-medium border transition-colors hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          Try again
        </button>
        <button
          onClick={() => { window.location.href = '/' }}
          className="px-4 py-2 rounded-md text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent)' }}
        >
          Go home
        </button>
      </div>
    </div>
  )
}
