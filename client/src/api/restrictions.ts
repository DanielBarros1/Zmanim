/**
 * Restrictions API hooks.
 *
 * Restrictions encode scheduling constraints. Each has a type (from RestrictionType),
 * a tier (NON_NEGOTIABLE → FLEXIBLE), and optional foreign keys (teacherId, classId, etc.)
 * plus a type-specific params object.
 *
 * The dynamic restriction form in RestrictionsPage builds the params based on the
 * selected type — see the form component for field rendering logic.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Restriction, RestrictionType, RestrictionTier } from '@zmanim/shared'
import apiClient from './client'

export const RESTRICTIONS_KEY = ['restrictions'] as const

export interface CreateRestrictionInput {
  type: RestrictionType
  tier: RestrictionTier
  teacherId?: string
  classId?: string
  gradeId?: string
  lessonId?: string
  subjectId?: string
  params: Record<string, unknown>
  note?: string
}

export function useRestrictions() {
  return useQuery<Restriction[]>({
    queryKey: RESTRICTIONS_KEY,
    queryFn: async () => {
      const res = await apiClient.get<Restriction[]>('/api/restrictions')
      return res.data
    },
  })
}

export function useCreateRestriction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRestrictionInput) =>
      apiClient.post<Restriction>('/api/restrictions', data).then(r => r.data),
    onSuccess: r =>
      qc.setQueryData<Restriction[]>(RESTRICTIONS_KEY, prev => [...(prev ?? []), r]),
  })
}

export function useUpdateRestriction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Partial<CreateRestrictionInput> & { isActive?: boolean }
    }) =>
      apiClient.put<Restriction>(`/api/restrictions/${id}`, data).then(r => r.data),
    onSuccess: updated =>
      qc.setQueryData<Restriction[]>(RESTRICTIONS_KEY, prev =>
        (prev ?? []).map(r => (r.id === updated.id ? updated : r)),
      ),
  })
}

export function useDeleteRestriction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/restrictions/${id}`),
    onSuccess: (_data, id) =>
      qc.setQueryData<Restriction[]>(RESTRICTIONS_KEY, prev =>
        (prev ?? []).filter(r => r.id !== id),
      ),
  })
}
