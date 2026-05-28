/**
 * School config API hooks — reads and writes the single SchoolConfig record.
 *
 * The config controls day start time, lesson duration, slots per day,
 * recess definitions, and which days the school runs.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SchoolConfig } from '@zmanim/shared'
import apiClient from './client'

export const CONFIG_KEY = ['config'] as const

export function useConfig() {
  return useQuery<SchoolConfig>({
    queryKey: CONFIG_KEY,
    queryFn: async () => {
      const res = await apiClient.get<SchoolConfig>('/api/config')
      return res.data
    },
  })
}

export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<SchoolConfig>) =>
      apiClient.patch<SchoolConfig>('/api/config', data).then(r => r.data),
    onSuccess: updated => qc.setQueryData(CONFIG_KEY, updated),
  })
}
