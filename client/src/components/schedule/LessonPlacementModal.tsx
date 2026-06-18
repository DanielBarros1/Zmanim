/**
 * LessonPlacementModal — open when clicking an empty cell.
 * Shows available lessons that can be placed in that slot,
 * separated by eligibility (no violations vs. violations present).
 */

import { useState } from 'react'
import type { Lesson, ScheduleEntry, Subject } from '@zmanim/shared'
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
