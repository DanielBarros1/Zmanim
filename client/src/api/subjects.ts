/**
 * Subjects API hooks.
 *
 * Subjects are reusable across lessons. Each has a name (Hebrew), an isArts
 * flag (for the arts-balance restriction), a display color, and an optional
 * specialized room.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Subject } from '@zmanim/shared'
import apiClient from './client'

export const SUBJECTS_KEY = ['subjects'] as const

export function useSubjects() {
  return useQuery<Subject[]>({
    queryKey: SUBJECTS_KEY,
    queryFn: async () => {
      const res = await apiClient.get<Subject[]>('/api/subjects')
      return res.data
    },
  })
}

export function useCreateSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<Subject, 'id'>) =>
      apiClient.post<Subject>('/api/subjects', data).then(r => r.data),
    onSuccess: subject =>
      qc.setQueryData<Subject[]>(SUBJECTS_KEY, prev => [...(prev ?? []), subject]),
  })
}

export function useUpdateSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Subject, 'id'>> }) =>
      apiClient.put<Subject>(`/api/subjects/${id}`, data).then(r => r.data),
    onSuccess: updated =>
      qc.setQueryData<Subject[]>(SUBJECTS_KEY, prev =>
        (prev ?? []).map(s => (s.id === updated.id ? updated : s)),
      ),
  })
}

export function useDeleteSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/subjects/${id}`),
    onSuccess: (_data, id) =>
      qc.setQueryData<Subject[]>(SUBJECTS_KEY, prev =>
        (prev ?? []).filter(s => s.id !== id),
      ),
  })
}
