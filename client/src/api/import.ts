/**
 * XLSX import API — wraps the two /api/import endpoints.
 *
 * Uses raw fetch (not axios) because we need to send multipart/form-data,
 * which axios handles but TanStack Query mutations work just as well with fetch.
 */

import { useMutation } from '@tanstack/react-query'
import type { LessonType, MathLevel } from '@zmanim/shared'

// Use relative URL so it works in both dev (Vite proxy) and production
// (Express serves the API on the same origin as the SPA).
const API = ''

// ─── Response shapes (mirror server types) ───────────────────

export interface PreviewItem {
  name: string
  existing: boolean
}

export interface PreviewLesson {
  subject: string
  teacher: string
  type: LessonType
  classes: string[]
  hoursPerWeek: number
  mathLevel?: MathLevel
  existing: boolean
}

export interface ImportPreview {
  subjects: PreviewItem[]
  teachers: PreviewItem[]
  lessons: PreviewLesson[]
  warnings: string[]
}

export interface ImportResult {
  subjectsCreated: number
  teachersCreated: number
  lessonsCreated: number
  lessonsSkipped: number
  warnings: string[]
}

// ─── Helpers ─────────────────────────────────────────────────

async function postFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

// ─── Mutations ────────────────────────────────────────────────

/** Parse the file and return a preview without touching the DB. */
export function usePreviewImport() {
  return useMutation<ImportPreview, Error, File>({
    mutationFn: (file: File) =>
      postFile<ImportPreview>('/api/import/xlsx/preview', file),
  })
}

/** Execute the import — creates subjects, teachers, and lessons. */
export function useExecuteImport() {
  return useMutation<ImportResult, Error, File>({
    mutationFn: (file: File) =>
      postFile<ImportResult>('/api/import/xlsx/execute', file),
  })
}
