/**
 * ScheduleGrid — the main schedule table.
 *
 * Layout:
 *   - Rows = slots (1–N, from SchoolConfig.slotsPerDay)
 *   - Columns = all 12 classes (7A, 7B, ..., 12A, 12B)
 *   - Grade group headers span above A+B columns
 *   - First column = slot time (sticky left)
 *   - Header row = grade/class labels (sticky top)
 *   - Recess rows between slots (from SchoolConfig.recesses)
 *
 * The grid shows a SINGLE day at a time (determined by useUIStore.activeDay).
 * Each cell either:
 *   - Contains a LessonCard (if an entry exists for that class+slot+day)
 *   - Shows an EmptyCell drop target (if no entry)
 *
 * Note: a SHARED lesson or MATH_GROUP occupies cells in multiple class columns
 * simultaneously (merged visually — colspan not possible in CSS grid, so we
 * show the card in each relevant class column).
 */

import { useCallback, Fragment } from 'react'
import type {
  ScheduleEntry,
  Lesson,
  Subject,
  Teacher,
  Grade,
  Class,
  SchoolConfig,
} from '@zmanim/shared'
import type { EvaluationResult } from '@zmanim/shared'
import type { Day } from '@zmanim/shared'
import { LessonCard } from './LessonCard'
import { EmptyCell } from './EmptyCell'

// Compute human-readable slot time from config
function slotTime(
  slot: number,
  config: SchoolConfig,
): string {
  const [h, m] = config.dayStartTime.split(':').map(Number)
  let total = h * 60 + m
  for (let s = 1; s < slot; s++) {
    total += config.lessonDuration
    const recess = config.recesses.find(r => r.afterSlot === s)
    if (recess) total += recess.durationMinutes
  }
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

interface ScheduleGridProps {
  day: Day
  entries: ScheduleEntry[]
  lessons: Lesson[]
  subjects: Subject[]
  teachers: Teacher[]
  grades: Grade[]
  classes: Class[]
  config: SchoolConfig
  evaluation: EvaluationResult | null
  isReviewMode?: boolean
  onRemoveEntry: (entryId: string) => void
  onCellClick: (day: Day, slot: number, classId: string) => void
}

export function ScheduleGrid({
  day,
  entries,
  lessons,
  subjects,
  teachers,
  grades,
  classes,
  config,
  evaluation,
  isReviewMode,
  onRemoveEntry,
  onCellClick,
}: ScheduleGridProps) {
  // Sort grades ascending
  const sortedGrades = [...grades].sort((a, b) => a.number - b.number)

  // For each grade, get its classes sorted A/B
  const gradeClasses = sortedGrades.map(grade => ({
    grade,
    classes: classes
      .filter(c => c.gradeId === grade.id)
      .sort((a, b) => a.section.localeCompare(b.section)),
  }))

  // Flat ordered list of classes (for column indexing)
  const orderedClasses = gradeClasses.flatMap(gc => gc.classes)

  // Build lookup maps
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l]))
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]))

  // Entries for this day
  const dayEntries = entries.filter(e => e.day === day)

  // Map: classId → slot → entry
  const cellMap: Record<string, Record<number, ScheduleEntry>> = {}
  for (const entry of dayEntries) {
    const lesson = lessonMap[entry.lessonId]
    if (!lesson) continue
    for (const classId of lesson.classIds) {
      if (!cellMap[classId]) cellMap[classId] = {}
      cellMap[classId][entry.slot] = entry
    }
  }

  // Violation map: entryId → violations
  const violationMap: Record<string, EvaluationResult['violations']> = {}
  if (evaluation) {
    for (const v of evaluation.violations) {
      for (const entryId of v.affectedEntryIds) {
        if (!violationMap[entryId]) violationMap[entryId] = []
        violationMap[entryId].push(v)
      }
    }
  }

  const handleCellClick = useCallback(
    (slot: number, classId: string) => {
      onCellClick(day, slot, classId)
    },
    [day, onCellClick],
  )

  const slots = Array.from({ length: config.slotsPerDay }, (_, i) => i + 1)
  const totalCols = orderedClasses.length

  return (
    <div
      className="overflow-auto flex-1"
      style={{ background: 'var(--bg)' }}
    >
      <table
        className="border-collapse w-full"
        style={{ minWidth: `${220 + totalCols * 110}px` }}
      >
        <thead>
          {/* Grade group header row */}
          <tr style={{ background: 'var(--surface-2)' }}>
            <th
              className="sticky left-0 z-20"
              style={{
                width: 80,
                minWidth: 80,
                background: 'var(--surface-2)',
                borderBottom: '1px solid var(--border)',
                borderRight: '1px solid var(--border)',
              }}
            />
            {gradeClasses.map(({ grade, classes: gc }) => (
              <th
                key={grade.id}
                colSpan={gc.length}
                className="text-[11px] font-bold uppercase tracking-[0.05em] text-center py-2"
                style={{
                  color: 'var(--text-2)',
                  borderBottom: '1px solid var(--border)',
                  borderRight: '1px solid var(--border)',
                }}
              >
                Grade {grade.number}
              </th>
            ))}
          </tr>

          {/* Class label header row */}
          <tr style={{ background: 'var(--surface-2)' }}>
            <th
              className="sticky left-0 z-20 text-[10px] font-bold uppercase tracking-[0.05em] py-2 px-2"
              style={{
                background: 'var(--surface-2)',
                borderBottom: '2px solid var(--border)',
                borderRight: '1px solid var(--border)',
                color: 'var(--text-3)',
                minWidth: 80,
              }}
            >
              Time
            </th>
            {orderedClasses.map(cls => {
              const grade = grades.find(g => g.id === cls.gradeId)
              return (
                <th
                  key={cls.id}
                  className="text-[11px] font-bold uppercase tracking-[0.05em] text-center py-2 px-1"
                  style={{
                    color: 'var(--text-2)',
                    borderBottom: '2px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                    minWidth: 110,
                    maxWidth: 140,
                  }}
                >
                  {grade?.number}{cls.section}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {slots.map(slot => {
            const time = slotTime(slot, config)
            const recess = config.recesses.find(r => r.afterSlot === slot)

            return (
              <Fragment key={slot}>
                {/* Lesson row */}
                <tr key={slot} className="group">
                  {/* Time column */}
                  <td
                    className="sticky left-0 z-10 text-center align-middle px-2 py-1"
                    style={{
                      background: 'var(--surface-2)',
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      width: 80,
                    }}
                  >
                    <p className="text-[11px] font-mono font-medium text-[var(--text-2)]">
                      {time}
                    </p>
                    <p className="text-[10px] text-[var(--text-3)]">Slot {slot}</p>
                  </td>

                  {/* Class cells */}
                  {orderedClasses.map(cls => {
                    const entry = cellMap[cls.id]?.[slot]
                    const lesson = entry ? lessonMap[entry.lessonId] : undefined
                    const subject = lesson ? subjectMap[lesson.subjectId] : undefined
                    const teacher = lesson ? teacherMap[lesson.teacherId] : undefined
                    const violations = entry ? (violationMap[entry.id] ?? []) : []

                    return (
                      <td
                        key={cls.id}
                        className="p-1 align-top"
                        style={{
                          borderBottom: '1px solid var(--border)',
                          borderRight: '1px solid var(--border)',
                          minWidth: 110,
                          maxWidth: 140,
                          verticalAlign: 'top',
                          height: 80,
                        }}
                      >
                        {entry && lesson ? (
                          <LessonCard
                            entry={entry}
                            lesson={lesson}
                            subject={subject}
                            teacher={teacher}
                            violations={violations}
                            onRemove={() => onRemoveEntry(entry.id)}
                            isReviewMode={isReviewMode}
                          />
                        ) : (
                          <EmptyCell
                            day={day}
                            slot={slot}
                            classId={cls.id}
                            onClick={() => handleCellClick(slot, cls.id)}
                            disabled={isReviewMode}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>

                {/* Recess row */}
                {recess && (
                  <tr key={`recess-${slot}`}>
                    <td
                      className="sticky left-0 z-10 px-2 text-[10px] font-medium italic text-center"
                      style={{
                        background: 'var(--recess-bg)',
                        borderBottom: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        height: 24,
                        color: 'var(--recess-text)',
                      }}
                    >
                      {recess.durationMinutes}m
                    </td>
                    <td
                      colSpan={orderedClasses.length}
                      className="text-[10px] italic text-center"
                      style={{
                        background: 'var(--recess-bg)',
                        borderBottom: '1px solid var(--border)',
                        color: 'var(--recess-text)',
                        height: 24,
                      }}
                    >
                      Recess — {recess.durationMinutes} minutes
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
