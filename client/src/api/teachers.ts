/**
 * Teachers API hooks.
 *
 * Teachers have a Hebrew name and a list of subject IDs they can teach.
 * The subjectIds array is used by the restriction forms to filter teacher-
 * level restrictions.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Teacher } from '@zmanim/shared'
import apiClient from './client'

export const TEACHERS_KEY = ['teachers'] as const

export function useTeachers() {
  return useQuery<Teacher[]>({
    queryKey: TEACHERS_KEY,
    queryFn: async () => {
      const res = await apiClient.get<Teacher[]>('/api/teachers')
      return res.data
    },
  })
}

export function useCreateTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; subjectIds: string[] }) =>
      apiClient.post<Teacher>('/api/teachers', data).then(r => r.data),
    onSuccess: teacher =>
      qc.setQueryData<Teacher[]>(TEACHERS_KEY, prev => [...(prev ?? []), teacher]),
  })
}

export function useUpdateTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: { name?: string; subjectIds?: string[] }
    }) => apiClient.patch<Teacher>(`/api/teachers/${id}`, data).then(r => r.data),
    onSuccess: updated =>
      qc.setQueryData<Teacher[]>(TEACHERS_KEY, prev =>
        (prev ?? []).map(t => (t.id === updated.id ? updated : t)),
      ),
  })
}

export function useDeleteTeacher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/teachers/${id}`),
    onSuccess: (_data, id) =>
      qc.setQueryData<Teacher[]>(TEACHERS_KEY, prev =>
        (prev ?? []).filter(t => t.id !== id),
      ),
  })
}

/**
 * Backfills teacher→subject connections from all existing lessons.
 * Safe to call multiple times (connect is idempotent).
 * On success, invalidates the teachers cache so subject pills refresh.
 */
export function useBackfillTeacherSubjects() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient.post('/api/teachers/backfill-subjects').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEACHERS_KEY }),
  })
}
