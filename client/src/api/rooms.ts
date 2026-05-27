/**
 * Rooms API hooks.
 *
 * Rooms have a Hebrew name and a capacity (STANDARD | LARGE).
 * LARGE rooms are required for SHARED lessons.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Room } from '@zmanim/shared'
import apiClient from './client'

export const ROOMS_KEY = ['rooms'] as const

export function useRooms() {
  return useQuery<Room[]>({
    queryKey: ROOMS_KEY,
    queryFn: async () => {
      const res = await apiClient.get<Room[]>('/api/rooms')
      return res.data
    },
  })
}

export function useCreateRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<Room, 'id'>) =>
      apiClient.post<Room>('/api/rooms', data).then(r => r.data),
    onSuccess: room =>
      qc.setQueryData<Room[]>(ROOMS_KEY, prev => [...(prev ?? []), room]),
  })
}

export function useUpdateRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Room, 'id'>> }) =>
      apiClient.put<Room>(`/api/rooms/${id}`, data).then(r => r.data),
    onSuccess: updated =>
      qc.setQueryData<Room[]>(ROOMS_KEY, prev =>
        (prev ?? []).map(r => (r.id === updated.id ? updated : r)),
      ),
  })
}

export function useDeleteRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/rooms/${id}`),
    onSuccess: (_data, id) =>
      qc.setQueryData<Room[]>(ROOMS_KEY, prev =>
        (prev ?? []).filter(r => r.id !== id),
      ),
  })
}
