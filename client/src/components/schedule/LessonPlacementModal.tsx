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
import { createPortal } from 'react-dom'

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
  const [hoveredLessonId, setHoveredLessonId] = useState<string | null>(null)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)

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
                        <div key={lesson.id} className="flex items-center justify-between px-3 py-2 rounded border-2"
                          style={{
                            borderColor: selectedLessonId === lesson.id ? 'var(--accent)' : 'var(--border)',
                            background: selectedLessonId === lesson.id ? 'var(--accent-bg)' : 'transparent',
                          }}
                        >
                          <button
                            onClick={() => setSelectedLessonId(lesson.id)}
                            className="flex-1 text-left hebrew"
                            style={{ color: 'var(--text-1)' }}
                          >
                            {subject?.name ?? '—'} ({lesson.hoursPerWeek}h)
                          </button>
                          {hasViolations && (
                            <button
                              onMouseEnter={(e) => {
                                setHoveredLessonId(lesson.id)
                                setPopoverAnchor(e.currentTarget)
                              }}
                              onMouseLeave={() => {
                                setHoveredLessonId(null)
                                setPopoverAnchor(null)
                              }}
                              className="ml-2 flex items-center justify-center w-6 h-6 rounded"
                              style={{
                                background: '#FEE2E2',
                                color: '#DC2626',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                cursor: 'help',
                              }}
                              title={`${violations.length} violation(s)`}
                            >
                              {violations.length}
                            </button>
                          )}
                        </div>
                      )
                    })}

                    {/* Violations popover */}
                    {hoveredLessonId && popoverAnchor && violationsByLesson.get(hoveredLessonId) && violationsByLesson.get(hoveredLessonId)!.length > 0 &&
                      createPortal(
                        <div
                          style={{
                            position: 'fixed',
                            top: popoverAnchor.getBoundingClientRect().bottom + 4,
                            left: popoverAnchor.getBoundingClientRect().left,
                            zIndex: 9999,
                            maxWidth: 300,
                            padding: '8px 12px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          }}
                          onMouseEnter={() => setHoveredLessonId(hoveredLessonId)}
                          onMouseLeave={() => {
                            setHoveredLessonId(null)
                            setPopoverAnchor(null)
                          }}
                        >
                          <div className="space-y-1 text-[11px]">
                            {violationsByLesson.get(hoveredLessonId)!.map((v, i) => (
                              <p key={i} style={{ color: 'var(--text-2)' }}>
                                • {v.message}
                              </p>
                            ))}
                          </div>
                        </div>,
                        document.body
                      )
                    }
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
