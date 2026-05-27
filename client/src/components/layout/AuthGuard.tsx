/**
 * AuthGuard — wraps protected routes.
 *
 * While the /api/me query is loading, shows a full-screen spinner.
 * If the user is not authenticated (null returned by useCurrentUser),
 * navigates to /login.
 * Otherwise, renders children.
 */

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useCurrentUser } from '../../api/auth'
import { CenteredSpinner } from '../ui/Spinner'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useCurrentUser()

  if (isLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <CenteredSpinner />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
