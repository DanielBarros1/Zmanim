/**
 * LessonPlacementModal — open when clicking an empty cell.
 * Shows available lessons that can be placed in that slot,
 * separated by eligibility (no violations vs. violations present).
 */

import { useState, useEffect } from 'react'
import type { Lesson, ScheduleEntry, Subject, EvaluationResult, Violation } from '@zmanim/shared'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import apiClient from '../../api/client'

interface LessonPlacementModalProps {
  open: boolean
  onClose: () => void
  day: string
  slot: number
  classId: string
  scheduleId: string
  lessons: Lesson[]
  subjects: Subject[]
  entries: ScheduleEntry[]
  onPlace: (lessonId: string, overrides?: string[]) => void
  loading?: boolean
}

export function LessonPlacementModal({
  open,
  onClose,
  day,
  slot,
  classId,
  scheduleId,
  lessons,
  subjects,
  entries,
  onPlace,
  loading,
}: LessonPlacementModalProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)
  const [violationsByLesson, setViolationsByLesson] = useState<Map<string, Violation[]>>(new Map())

  // Evaluate all available lessons when modal opens
  useEffect(() => {
    if (!open) return

    const evaluateLessons = async () => {
      const violations = new Map<string, Violation[]>()

      // Filter lessons that can go in this class
      const availableLessons = lessons.filter(l =>
        l.classIds.includes(classId) &&
        entries.filter(e => e.lessonId === l.id).length < l.hoursPerWeek
      )

      for (const lesson of availableLessons) {
        try {
          const res = await apiClient.post<EvaluationResult>(
            `/api/schedules/${scheduleId}/evaluate-placement`,
            { lessonId: lesson.id, day, slot, classId }
          )
          violations.set(lesson.id, res.data.violations)
        } catch (err) {
          console.error(`Failed to evaluate lesson ${lesson.id}:`, err)
        }
      }

      setViolationsByLesson(violations)
    }

    evaluateLessons()
  }, [open, scheduleId, day, slot, classId, lessons, entries])

  if (!open) return null

  // Build subject map for quick lookups
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))

  // Filter lessons that can go in this class
  const availableLessons = lessons.filter(l =>
    l.classIds.includes(classId) &&
    // Only show lessons that need more placements (haven't reached hoursPerWeek yet)
    entries.filter(e => e.lessonId === l.id).length < l.hoursPerWeek
  )

  // For now, all available lessons are shown as eligible
  // (In a future version, we could run the evaluator for each placement to predict violations)
  const eligibleLessons: Lesson[] = availableLessons

  const handlePlace = () => {
    if (!selectedLessonId) return
    onPlace(selectedLessonId)
    setSelectedLessonId(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Place lesson — Slot ${slot}`}
      width="max-w-md"
    >
      <div className="space-y-4">
        <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          {availableLessons.length === 0 ? (
            <p>No lessons available for placement in this class.</p>
          ) : (
            <>
              {/* Available lessons */}
              {eligibleLessons.length > 0 && (
                <div className="space-y-2">
                  <p className="font-semibold" style={{ color: 'var(--text-2)' }}>
                    Available lessons:
                  </p>
                  <div className="space-y-1.5">
                    {eligibleLessons.map(lesson => {
                      const subject = subjectMap[lesson.subjectId]
                      const violations = violationsByLesson.get(lesson.id) || []
                      const hasViolations = violations.length > 0
                      return (
                        <div key={lesson.id} className="space-y-1">
                          <button
                            onClick={() => setSelectedLessonId(lesson.id)}
                            className="w-full text-left px-3 py-2 rounded border-2 transition-all hebrew"
                            style={{
                              borderColor: selectedLessonId === lesson.id ? 'var(--accent)' : hasViolations ? '#FCA5A5' : 'var(--border)',
                              background: selectedLessonId === lesson.id ? 'var(--accent-bg)' : hasViolations ? '#FEF2F2' : 'transparent',
                              color: 'var(--text-1)',
                            }}
                          >
                            {subject?.name ?? '—'} ({lesson.hoursPerWeek}h) {hasViolations && ' ⚠'}
                          </button>
                          {hasViolations && (
                            <div className="px-3 py-1 text-[10px] space-y-0.5" style={{ color: '#DC2626' }}>
                              {violations.map((v, i) => (
                                <p key={i}>• {v.message}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handlePlace}
            disabled={!selectedLessonId || loading}
            loading={loading}
          >
            Place Lesson
          </Button>
        </div>
      </div>
    </Modal>
  )
}
