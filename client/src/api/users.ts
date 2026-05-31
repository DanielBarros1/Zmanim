/**
 * User management API hooks.
 *
 * useUsers()       — fetch list of all users (root + invited)
 * useInviteUser()  — add an email to the AllowedEmail table (root only)
 * useRevokeUser()  — remove an invited user by AllowedEmail ID (root only)
 *
 * All mutations invalidate the ['users'] query so the list auto-refreshes.
 * Server returns 403 for non-root users — callers should guard with user.isRoot.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { UserListItem } from '@zmanim/shared'
import apiClient from './client'

export function useUsers() {
  return useQuery<UserListItem[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiClient.get<UserListItem[]>('/api/users')
      return res.data
    },
  })
}

export function useInviteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) =>
      apiClient.post('/api/users/invite', { email }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useRevokeUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (allowedEmailId: string) =>
      apiClient.delete(`/api/users/${allowedEmailId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
