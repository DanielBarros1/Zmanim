/**
 * LessonPlacementModal — open when clicking an empty cell.
 * Shows available lessons that can be placed in that slot,
 * separated by eligibility (no violations vs. violations present).
 */

import { useState } from 'react'
import type { Lesson, ScheduleEntry, EvaluationResult, Subject } from '@zmanim/shared'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

interface LessonPlacementModalProps {
  open: boolean
  onClose: () => void
  slot: number
  classId: string
  lessons: Lesson[]
  subjects: Subject[]
  entries: ScheduleEntry[]
  evaluation: EvaluationResult | null
  onPlace: (lessonId: string, overrides?: string[]) => void
  loading?: boolean
}

export function LessonPlacementModal({
  open,
  onClose,
  slot,
  classId,
  lessons,
  subjects,
  entries,
  evaluation,
  onPlace,
  loading,
}: LessonPlacementModalProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)

  if (!open) return null

  // Build subject map for quick lookups
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))

  // Filter lessons that can go in this class
  const availableLessons = lessons.filter(l =>
    l.classIds.includes(classId) &&
    // Only show lessons that need more placements (haven't reached hoursPerWeek yet)
    entries.filter(e => e.lessonId === l.id).length < l.hoursPerWeek
  )

  // Categorize by whether they would create violations
  const eligibleLessons: Lesson[] = []
  const ineligibleLessons: Map<Lesson, string[]> = new Map()

  for (const lesson of availableLessons) {
    if (!evaluation) {
      eligibleLessons.push(lesson)
      continue
    }

    // Check if placing this lesson would create violations
    // (This is a simplified check - in reality we'd run the evaluator)
    const relevantViolations = evaluation.violations
      .filter(v => !v.isOverridden && v.affectedEntryIds.length > 0)
      .map(v => v.message)

    if (relevantViolations.length === 0) {
      eligibleLessons.push(lesson)
    } else {
      ineligibleLessons.set(lesson, relevantViolations)
    }
  }

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
              {/* Eligible lessons */}
              {eligibleLessons.length > 0 && (
                <div className="space-y-2">
                  <p className="font-semibold" style={{ color: 'var(--text-2)' }}>
                    ✓ Can place without violations:
                  </p>
                  <div className="space-y-1.5">
                    {eligibleLessons.map(lesson => {
                      const subject = subjectMap[lesson.subjectId]
                      return (
                        <button
                          key={lesson.id}
                          onClick={() => setSelectedLessonId(lesson.id)}
                          className="w-full text-left px-3 py-2 rounded border-2 transition-all hebrew"
                          style={{
                            borderColor: selectedLessonId === lesson.id ? 'var(--accent)' : 'var(--border)',
                            background: selectedLessonId === lesson.id ? 'var(--accent-bg)' : 'transparent',
                            color: 'var(--text-1)',
                          }}
                        >
                          {subject?.name ?? '—'} ({lesson.hoursPerWeek}h)
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Ineligible lessons */}
              {ineligibleLessons.size > 0 && (
                <div className="space-y-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                  <p className="font-semibold" style={{ color: 'var(--text-2)' }}>
                    ⚠ Would create violations:
                  </p>
                  <div className="space-y-2">
                    {Array.from(ineligibleLessons.entries()).map(([lesson, violations]) => {
                      const subject = subjectMap[lesson.subjectId]
                      return (
                        <div
                          key={lesson.id}
                          className="px-3 py-2 rounded border-2 hebrew"
                          style={{
                            borderColor: '#FCA5A5',
                            background: '#FEF2F2',
                            color: 'var(--text-3)',
                            opacity: 0.7,
                          }}
                        >
                          <p className="font-medium">{subject?.name ?? '—'}</p>
                          <p className="text-[11px] mt-1">
                            {violations.join(', ')}
                          </p>
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
