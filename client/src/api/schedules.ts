/**
 * Schedules API hooks.
 *
 * A Schedule is the top-level container. States: DRAFT | PUBLISHED.
 * Only one schedule can be PUBLISHED at a time — publishing atomically
 * demotes the current published schedule to DRAFT.
 *
 * ScheduleEntries (lesson placements) live at /api/schedules/:id/entries.
 * The auto-scheduler lives at /api/schedules/auto.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Schedule,
  ScheduleSummary,
  ScheduleEntry,
  PlaceEntryRequest,
  MoveEntryRequest,
} from '@zmanim/shared'
import type { EvaluationResult } from '@zmanim/shared'
import apiClient from './client'

export const SCHEDULES_KEY = ['schedules'] as const
export const scheduleKey = (id: string) => ['schedule', id] as const
export const entriesKey = (scheduleId: string) =>
  ['schedules', scheduleId, 'entries'] as const

// ── Schedule CRUD ───────────────────────────────────────────────

export function useSchedules() {
  return useQuery<ScheduleSummary[]>({
    queryKey: SCHEDULES_KEY,
    queryFn: async () => {
      const res = await apiClient.get<ScheduleSummary[]>('/api/schedules')
      return res.data
    },
  })
}

export function useSchedule(id: string) {
  return useQuery<Schedule>({
    queryKey: scheduleKey(id),
    queryFn: async () => {
      const res = await apiClient.get<Schedule>(`/api/schedules/${id}`)
      return res.data
    },
    enabled: !!id,
  })
}

export function useCreateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string }) =>
      apiClient.post<Schedule>('/api/schedules', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  })
}

export function useUpdateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; isStarred?: boolean } }) =>
      apiClient.put<Schedule>(`/api/schedules/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  })
}

export function useDeleteSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  })
}

export function usePublishSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Schedule>(`/api/schedules/${id}/publish`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  })
}

export function useCloneSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Schedule>(`/api/schedules/${id}/clone`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  })
}

// ── Entries (placements) ────────────────────────────────────────

export interface PlaceEntryResponse {
  entry: ScheduleEntry
  evaluation: EvaluationResult
}

export function useEntries(scheduleId: string) {
  return useQuery<ScheduleEntry[]>({
    queryKey: entriesKey(scheduleId),
    queryFn: async () => {
      const res = await apiClient.get<ScheduleEntry[]>(
        `/api/schedules/${scheduleId}/entries`,
      )
      return res.data
    },
    enabled: !!scheduleId,
  })
}

export function usePlaceEntry(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PlaceEntryRequest) =>
      apiClient
        .post<PlaceEntryResponse>(`/api/schedules/${scheduleId}/entries`, data)
        .then(r => r.data),
    onSuccess: result => {
      qc.setQueryData<ScheduleEntry[]>(entriesKey(scheduleId), prev => [
        ...(prev ?? []),
        result.entry,
      ])
    },
  })
}

export function useMoveEntry(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: MoveEntryRequest }) =>
      apiClient
        .put<PlaceEntryResponse>(
          `/api/schedules/${scheduleId}/entries/${entryId}`,
          data,
        )
        .then(r => r.data),
    onSuccess: result => {
      qc.setQueryData<ScheduleEntry[]>(entriesKey(scheduleId), prev =>
        (prev ?? []).map(e => (e.id === result.entry.id ? result.entry : e)),
      )
    },
  })
}

export function useRemoveEntry(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (entryId: string) =>
      apiClient.delete(`/api/schedules/${scheduleId}/entries/${entryId}`),
    onSuccess: (_data, entryId) => {
      qc.setQueryData<ScheduleEntry[]>(entriesKey(scheduleId), prev =>
        (prev ?? []).filter(e => e.id !== entryId),
      )
    },
  })
}

// ── Auto-Scheduler ──────────────────────────────────────────────

export interface AutoSchedulerConfig {
  maxRestarts?: number
  timeLimitMs?: number
}

export interface AutoSchedulerJob {
  jobId: string
  status: 'running' | 'done' | 'error'
  progress: number
  scheduleId?: string
  error?: string
}

export function useStartAutoScheduler() {
  return useMutation({
    mutationFn: (config: AutoSchedulerConfig) =>
      apiClient.post<AutoSchedulerJob>('/api/schedules/auto', config).then(r => r.data),
  })
}

export async function fetchJobStatus(jobId: string): Promise<AutoSchedulerJob> {
  const res = await apiClient.get<AutoSchedulerJob>(`/api/schedules/auto/${jobId}`)
  return res.data
}
