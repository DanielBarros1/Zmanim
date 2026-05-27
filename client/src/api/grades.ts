/**
 * Grades & Classes API hooks.
 *
 * Grades (7–12) and their classes (A/B) are seeded and read-only in Milestone 1.
 * Both are fetched together since classes always appear in the context of their grade.
 */

import { useQuery } from '@tanstack/react-query'
import type { Grade, Class } from '@zmanim/shared'
import apiClient from './client'

export const GRADES_KEY = ['grades'] as const
export const CLASSES_KEY = ['classes'] as const

export function useGrades() {
  return useQuery<Grade[]>({
    queryKey: GRADES_KEY,
    queryFn: async () => {
      const res = await apiClient.get<Grade[]>('/api/grades')
      return res.data
    },
    staleTime: Infinity, // grades never change during a session
  })
}

export function useClasses() {
  return useQuery<Class[]>({
    queryKey: CLASSES_KEY,
    queryFn: async () => {
      const res = await apiClient.get<Class[]>('/api/classes')
      return res.data
    },
    staleTime: Infinity,
  })
}
