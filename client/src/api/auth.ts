/**
 * Auth API hooks.
 *
 * /api/me returns the current session user (or 401 if not logged in).
 * Login is done by navigating to /auth/google — no fetch needed.
 * Logout calls /auth/logout and then redirects to /login.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AuthUser } from '@zmanim/shared'
import apiClient from './client'

export function useCurrentUser() {
  return useQuery<AuthUser | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<AuthUser>('/auth/me')
        return res.data
      } catch {
        return null
      }
    },
    staleTime: 5 * 60 * 1000, // 5 min — session rarely changes
    retry: false,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient.post('/auth/logout'),
    onSuccess: () => {
      qc.clear()
      window.location.href = '/login'
    },
  })
}
