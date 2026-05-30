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

import { useCallback, useEffect, Fragment } from 'react'
import type {
  ScheduleEntry,
  Lesson,
  Subject,
  Teacher,
  Grade,
  Class,
  SchoolConfig,
  Room,
} from '@zmanim/shared'
import type { EvaluationResult } from '@zmanim/shared'
import type { Day } from '@zmanim/shared'
import { LessonCard } from './LessonCard'
import { EmptyCell } from './EmptyCell'
import type { CellValidity } from './EmptyCell'
import { useScheduleStore } from '../../store/scheduleStore'

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
  rooms: Room[]
  isReviewMode?: boolean
  /**
   * When true, the outer div has NO overflow handling at all (no scroll container).
   * Use this in the week view where an ancestor wrapper owns scrolling in both axes.
   *
   * Without this flag the div is overflow:auto, which creates a nested scroll
   * container.  CSS also forbids mixing overflow-x:auto with overflow-y:visible —
   * the spec converts visible → auto — so there is no way to have "horizontal
   * scroll only" on a single element.  The solution is to remove overflow from
   * this div entirely and let the week-view wrapper handle both axes.
   */
  noVerticalOverflow?: boolean
  /**
   * Per-cell drop validity computed by ScheduleEditorPage while a pool lesson
   * is being dragged.  Key: `${day}:${slot}:${classId}`.
   * Null when no pool drag is in progress.
   */
  cellValidity: Map<string, CellValidity> | null
  /** When set, non-matching lesson cards are dimmed to 20% opacity */
  filterSubjectId?: string
  onRemoveEntry: (entryId: string) => void
  onChangeRoom: (entryId: string, roomId: string | null, which?: 1 | 2) => void
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
  rooms,
  isReviewMode,
  noVerticalOverflow,
  filterSubjectId,
  cellValidity,
  onRemoveEntry,
  onChangeRoom,
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

  // Map: classId → slot → entries[]
  // Cells can have multiple entries when math/English sibling groups are placed simultaneously.
  const cellMap: Record<string, Record<number, ScheduleEntry[]>> = {}
  for (const entry of dayEntries) {
    const lesson = lessonMap[entry.lessonId]
    if (!lesson) continue
    for (const classId of lesson.classIds) {
      if (!cellMap[classId]) cellMap[classId] = {}
      if (!cellMap[classId][entry.slot]) cellMap[classId][entry.slot] = []
      cellMap[classId][entry.slot].push(entry)
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

  const { highlightedEntryIds } = useScheduleStore()

  // Scroll to the first highlighted entry after its day has been switched into view.
  // 200 ms gives React time to re-render the new day before we query the DOM.
  useEffect(() => {
    if (highlightedEntryIds.length === 0) return
    const id = highlightedEntryIds[0]
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-entry-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, 200)
    return () => clearTimeout(timer)
  }, [highlightedEntryIds])

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
      // In week view (noVerticalOverflow=true) we strip all overflow handling from
      // this div and let the week-view wrapper own scrolling in both axes.
      //
      // WHY: CSS forbids mixing overflow-x:auto with overflow-y:visible — the spec
      // converts the visible axis to auto automatically, so the div becomes a full
      // scroll container regardless.  A nested scroll container reacts to pointer
      // movement during drag (scroll bar appears / content shifts) even with
      // dnd-kit's autoScroll disabled.
      //
      // By using no overflow here, the table naturally overflows into the
      // week-view wrapper (which has overflow-x-auto overflow-y-auto), so both
      // axes of scrolling are handled by that single outer container.  No nested
      // scroll containers → no scroll conflict during drag.
      className={noVerticalOverflow ? 'flex-1' : 'overflow-auto flex-1'}
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
                    const cellEntries = cellMap[cls.id]?.[slot] ?? []
                    const isEmpty = cellEntries.length === 0

                    // A cell occupied only by same-type sibling group lessons (math/English)
                    // is also a valid DnD drop target — additional groups can go here.
                    // We stamp data-cell-* on the <td> directly so elementsFromPoint()
                    // can find it even when the EmptyCell div isn't present.
                    const onlySiblingGroups =
                      !isEmpty &&
                      cellEntries.every(e => {
                        const l = lessonMap[e.lessonId]
                        return l?.type === 'MATH_GROUP' || l?.type === 'ENGLISH_GROUP'
                      }) &&
                      new Set(cellEntries.map(e => lessonMap[e.lessonId]?.type)).size === 1 &&
                      new Set(cellEntries.map(e => lessonMap[e.lessonId]?.gradeId)).size === 1

                    return (
                      <td
                        key={cls.id}
                        // data-entry-id lets the scroll-to-highlight effect find this cell
                        {...(cellEntries.length === 1 ? { 'data-entry-id': cellEntries[0].id } : {})}
                        // data-cell-* on the <td> so DnD can drop onto group-occupied cells
                        {...(onlySiblingGroups ? {
                          'data-cell-day': day,
                          'data-cell-slot': String(slot),
                          'data-cell-class-id': cls.id,
                        } : {})}
                        className="p-1 align-top"
                        style={{
                          borderBottom: '1px solid var(--border)',
                          borderRight: '1px solid var(--border)',
                          minWidth: 110,
                          maxWidth: 140,
                          verticalAlign: 'top',
                          minHeight: 80,
                        }}
                      >
                        {isEmpty ? (
                          <EmptyCell
                            day={day}
                            slot={slot}
                            classId={cls.id}
                            onClick={() => handleCellClick(slot, cls.id)}
                            disabled={isReviewMode}
                            validity={cellValidity?.get(`${day}:${slot}:${cls.id}`)}
                          />
                        ) : (
                          <div className="flex flex-col gap-0.5 w-full">
                            {cellEntries.map(entry => {
                              const lesson = lessonMap[entry.lessonId]
                              if (!lesson) return null
                              const subject = subjectMap[lesson.subjectId]

                              // Subject filter: dim non-matching entries to 20% opacity
                              const dimmed = !!filterSubjectId && lesson.subjectId !== filterSubjectId

                              // Resolve the teacher shown in THIS column:
                              //   REGULAR/SHARED/MATH_GROUP/ENGLISH_GROUP → single primary teacher
                              //   PARALLEL → the teacher assigned to this specific class column
                              //   MULTI_TEACHER → join all teacher names (no per-class split)
                              let teacher: { id: string; name: string; subjectIds: string[]; createdAt: string } | undefined
                              if (lesson.teacherId) {
                                teacher = teacherMap[lesson.teacherId] as typeof teacher
                              } else if (lesson.type === 'PARALLEL' && lesson.lessonTeachers?.length) {
                                const lt = lesson.lessonTeachers.find(lt => lt.classId === cls.id)
                                teacher = lt ? teacherMap[lt.teacherId] as typeof teacher : undefined
                              } else if (lesson.lessonTeachers?.length) {
                                teacher = {
                                  id: '',
                                  name: lesson.lessonTeachers
                                    .map(lt => teacherMap[lt.teacherId]?.name ?? '?')
                                    .join(' · '),
                                  subjectIds: [],
                                  createdAt: '',
                                }
                              }

                              const violations = violationMap[entry.id] ?? []
                              return (
                                <div
                                  key={entry.id}
                                  style={{ opacity: dimmed ? 0.2 : 1, transition: 'opacity 0.15s' }}
                                >
                                  <LessonCard
                                    entry={entry}
                                    lesson={lesson}
                                    subject={subject}
                                    teacher={teacher}
                                    violations={violations}
                                    rooms={rooms}
                                    displayClassId={cls.id}
                                    onRemove={() => onRemoveEntry(entry.id)}
                                    onChangeRoom={onChangeRoom}
                                    isReviewMode={isReviewMode}
                                  />
                                </div>
                              )
                            })}
                          </div>
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
