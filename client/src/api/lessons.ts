/**
 * Lessons API hooks.
 *
 * Three lesson types each have different required fields:
 *   REGULAR    — one classId, teacherId, subjectId, hoursPerWeek
 *   SHARED     — two classIds (same grade), teacherId, subjectId, hoursPerWeek
 *   MATH_GROUP — gradeId + mathLevel (auto-links both classes), teacherId, hoursPerWeek
 *
 * The server validates the type-specific invariants and returns a normalized Lesson.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Lesson, LessonType, MathLevel } from '@zmanim/shared'
import apiClient from './client'

export const LESSONS_KEY = ['lessons'] as const

// Input shapes per lesson type
export interface CreateRegularLesson {
  type: LessonType.REGULAR
  subjectId: string
  teacherId: string
  classIds: [string]
  hoursPerWeek: number
}

export interface CreateSharedLesson {
  type: LessonType.SHARED
  subjectId: string
  teacherId: string
  classIds: [string, string]
  hoursPerWeek: number
}

export interface CreateMathGroupLesson {
  type: LessonType.MATH_GROUP
  subjectId: string
  teacherId: string
  gradeId: string
  mathLevel: MathLevel
  hoursPerWeek: number
}

export type CreateLessonInput =
  | CreateRegularLesson
  | CreateSharedLesson
  | CreateMathGroupLesson

export function useLessons() {
  return useQuery<Lesson[]>({
    queryKey: LESSONS_KEY,
    queryFn: async () => {
      const res = await apiClient.get<Lesson[]>('/api/lessons')
      return res.data
    },
  })
}

export function useCreateLesson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLessonInput) =>
      apiClient.post<Lesson>('/api/lessons', data).then(r => r.data),
    onSuccess: lesson =>
      qc.setQueryData<Lesson[]>(LESSONS_KEY, prev => [...(prev ?? []), lesson]),
  })
}

export function useUpdateLesson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateLessonInput> }) =>
      apiClient.patch<Lesson>(`/api/lessons/${id}`, data).then(r => r.data),
    onSuccess: updated =>
      qc.setQueryData<Lesson[]>(LESSONS_KEY, prev =>
        (prev ?? []).map(l => (l.id === updated.id ? updated : l)),
      ),
  })
}

export function useDeleteLesson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/lessons/${id}`),
    onSuccess: (_data, id) =>
      qc.setQueryData<Lesson[]>(LESSONS_KEY, prev =>
        (prev ?? []).filter(l => l.id !== id),
      ),
  })
}
