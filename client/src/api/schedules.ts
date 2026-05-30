/**
 * Schedules API hooks.
 *
 * A Schedule is the top-level container. States: DRAFT | PUBLISHED.
 * Only one schedule can be PUBLISHED at a time — publishing atomically
 * demotes the current published schedule to DRAFT.
 *
 * ScheduleEntries (lesson placements) live at /api/schedules/:id/entries.
 * The auto-scheduler lives at /api/schedules/auto.
 *
 * NOTE: usePlaceEntry / useMoveEntry / useRemoveEntry all write the latest
 * EvaluationResult into the evaluationKey cache as part of their onSuccess,
 * so ScheduleEditorPage can use useEvaluation() as a single reactive source
 * of truth rather than maintaining separate local evaluation state.
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
export const evaluationKey = (scheduleId: string) =>
  ['schedules', scheduleId, 'evaluate'] as const

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
    // Server uses PATCH for partial updates
    mutationFn: ({ id, data }: { id: string; data: { name?: string; isStarred?: boolean } }) =>
      apiClient.patch<Schedule>(`/api/schedules/${id}`, data).then(r => r.data),
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

/**
 * Fetch the authoritative EvaluationResult for a schedule without making
 * any changes. All three mutation hooks (place / move / remove) also write
 * their returned evaluation into this same cache key, so any component
 * using useEvaluation() automatically stays current after each placement.
 */
export function useEvaluation(scheduleId: string) {
  return useQuery<EvaluationResult>({
    queryKey: evaluationKey(scheduleId),
    queryFn: async () => {
      const res = await apiClient.get<EvaluationResult>(
        `/api/schedules/${scheduleId}/evaluate`,
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
      // Keep evaluation cache current
      qc.setQueryData(evaluationKey(scheduleId), result.evaluation)
    },
  })
}

export function useMoveEntry(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    // Server uses PATCH for entry moves
    mutationFn: ({ entryId, data }: { entryId: string; data: MoveEntryRequest }) =>
      apiClient
        .patch<PlaceEntryResponse>(
          `/api/schedules/${scheduleId}/entries/${entryId}`,
          data,
        )
        .then(r => r.data),
    onSuccess: result => {
      qc.setQueryData<ScheduleEntry[]>(entriesKey(scheduleId), prev =>
        (prev ?? []).map(e => (e.id === result.entry.id ? result.entry : e)),
      )
      // Keep evaluation cache current
      qc.setQueryData(evaluationKey(scheduleId), result.evaluation)
    },
  })
}

/** PATCH /api/schedules/:id/entries/:entryId/room — change room assignment */
export function useChangeEntryRoom(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, roomId, roomId2 }: { entryId: string; roomId?: string | null; roomId2?: string | null }) =>
      apiClient
        .patch<ScheduleEntry>(
          `/api/schedules/${scheduleId}/entries/${entryId}/room`,
          { roomId, roomId2 },
        )
        .then(r => r.data),
    onSuccess: entry => {
      qc.setQueryData<ScheduleEntry[]>(entriesKey(scheduleId), prev =>
        (prev ?? []).map(e => (e.id === entry.id ? entry : e)),
      )
    },
  })
}

export interface RemoveEntryResponse {
  evaluation: EvaluationResult
}

export function useRemoveEntry(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (entryId: string) =>
      apiClient
        .delete<RemoveEntryResponse>(`/api/schedules/${scheduleId}/entries/${entryId}`)
        .then(r => r.data),
    onSuccess: (data, entryId) => {
      qc.setQueryData<ScheduleEntry[]>(entriesKey(scheduleId), prev =>
        (prev ?? []).filter(e => e.id !== entryId),
      )
      // Keep evaluation cache current
      qc.setQueryData(evaluationKey(scheduleId), data.evaluation)
    },
  })
}

// ── Overrides ───────────────────────────────────────────────────

/**
 * Add an override for a specific entry + restriction combination.
 * Invalidates the evaluation cache so ViolationPanel re-renders.
 *
 * Only user-configured restrictions (restrictionId != null) can be stored
 * in the DB — hard invariants (CLASS_SUBJECT_TWICE_PER_DAY, etc.) are
 * blocked at the Prisma enum level.
 *
 * Adds the override to one entry; the evaluator marks the violation
 * overridden if ANY affected entry has a matching override.
 */
export function useAddOverride(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      entryId,
      restrictionType,
      restrictionId,
      note,
    }: {
      entryId: string
      restrictionType: string
      restrictionId: string | null
      note?: string
    }) =>
      apiClient
        .post(`/api/schedules/${scheduleId}/entries/${entryId}/override`, {
          restrictionType,
          restrictionId,
          note,
        })
        .then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evaluationKey(scheduleId) })
      qc.invalidateQueries({ queryKey: entriesKey(scheduleId) })
    },
  })
}

/**
 * Remove all matching overrides for an entry + restriction combination.
 * Calling this for all affectedEntryIds ensures a clean removal regardless
 * of which entry(ies) the override was originally added to.
 */
export function useRemoveOverride(scheduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      entryId,
      restrictionType,
      restrictionId,
    }: {
      entryId: string
      restrictionType: string
      restrictionId: string | null
    }) =>
      apiClient
        .delete<{ evaluation: EvaluationResult }>(
          `/api/schedules/${scheduleId}/entries/${entryId}/override`,
          { data: { restrictionType, restrictionId } },
        )
        .then(r => r.data),
    onSuccess: result => {
      // Use the server-returned evaluation so the panel updates instantly
      qc.setQueryData(evaluationKey(scheduleId), result.evaluation)
      qc.invalidateQueries({ queryKey: entriesKey(scheduleId) })
    },
  })
}

// ── Suggest fix ─────────────────────────────────────────────────

export interface FixSuggestion {
  entryId: string
  entryLabel: string
  fromDay: string
  fromSlot: number
  toDay: string
  toSlot: number
  description: string
  improvement: number
}

/**
 * POST /api/schedules/:id/suggest-fix
 * Given a violation, returns up to 3 move operations that would improve/resolve it.
 * This is a one-shot mutation (not a query) because the computation is on-demand.
 */
export function useSuggestFix(scheduleId: string) {
  return useMutation({
    mutationFn: (body: {
      violationType: string
      affectedEntryIds: string[]
      restrictionId?: string | null
    }) =>
      apiClient
        .post<FixSuggestion[]>(`/api/schedules/${scheduleId}/suggest-fix`, body)
        .then(r => r.data),
  })
}

// ── Auto-Scheduler ──────────────────────────────────────────────

/** Matches the server's POST /api/schedules/auto body schema exactly */
export interface StartAutoSchedulerInput {
  /** Name for the generated draft schedule (required by server) */
  name: string
  /** Optional: seed the search from an existing schedule's seeded entries */
  seedScheduleId?: string
  config?: {
    /** Number of random restarts (default 50 on server) */
    nRestarts?: number
    /** Local-search iterations per restart (default 1000 on server) */
    nIterations?: number
  }
}

export interface CandidateResult {
  scheduleId: string
  name: string
  score: number
  violations: {
    total: number
    nonNegotiable: number
    important: number
    preferred: number
    flexible: number
  }
}

/** Matches the server's JobStatus shape (status is uppercase) */
export interface AutoSchedulerJob {
  jobId: string
  status: 'RUNNING' | 'DONE' | 'ERROR'
  progress: number         // 0–100
  statusMessage?: string   // human-readable phase label shown in the modal
  candidates?: CandidateResult[]  // set when status === 'DONE'
  scheduleId?: string      // convenience: candidates[0].scheduleId
  error?: string           // set when status === 'ERROR'
}

export function useStartAutoScheduler() {
  return useMutation({
    mutationFn: (input: StartAutoSchedulerInput) =>
      apiClient
        .post<{ jobId: string }>('/api/schedules/auto', input)
        .then(r => r.data),
  })
}

/** Poll route: /api/schedules/auto/jobs/:jobId (note the /jobs/ segment) */
export async function fetchJobStatus(jobId: string): Promise<AutoSchedulerJob> {
  const res = await apiClient.get<AutoSchedulerJob>(
    `/api/schedules/auto/jobs/${jobId}`,
  )
  return res.data
}
