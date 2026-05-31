/**
 * CompactViewPage — printable, color-coded schedule overview.
 *
 * Shows the full school week in a compact format:
 *   - All 12 classes as columns (grouped by grade)
 *   - All days × slots as rows
 *   - Each cell is a colored square (subject color) with abbreviated text
 *
 * Designed for printing or sharing as a PDF.
 * Uses @media print friendly layout (no sidebar, no topbar in print).
 * Includes a print button.
 *
 * This is a read-only view — no drag-and-drop.
 */

import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { CenteredSpinner } from '../../components/ui/Spinner'
import { useGrades, useClasses } from '../../api/grades'
import { useSubjects } from '../../api/subjects'
import { useLessons } from '../../api/lessons'
import { useSchedules, useEntries } from '../../api/schedules'
import { useConfig } from '../../api/config'
import { DAY_ORDER, ScheduleState } from '@zmanim/shared'
import type { Day } from '@zmanim/shared'

const DAY_SHORT: Record<Day, string> = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
}

export function CompactViewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: grades = [], isLoading: gradesLoading } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: subjects = [] } = useSubjects()
  const { data: lessons = [] } = useLessons()
  const { data: schedules = [] } = useSchedules()
  const { data: config } = useConfig()

  const publishedSchedule = schedules.find(s => s.state === ScheduleState.PUBLISHED)
  const scheduleId = searchParams.get('schedule') ?? publishedSchedule?.id ?? schedules[0]?.id ?? ''
  const { data: entries = [], isLoading: entriesLoading } = useEntries(scheduleId)

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l]))
  // gradeMap reserved for future grade-label display

  const workDays = (config?.workDays ?? DAY_ORDER) as Day[]
  const slots = config ? Array.from({ length: config.slotsPerDay }, (_, i) => i + 1) : []

  // Sort grades and classes
  const sortedGrades = [...grades].sort((a, b) => a.number - b.number)
  const gradeClasses = sortedGrades.map(grade => ({
    grade,
    classes: classes
      .filter(c => c.gradeId === grade.id)
      .sort((a, b) => a.section.localeCompare(b.section)),
  }))

  // Build cell map: classId → day → slot → subject color + name
  const cellMap: Record<string, Record<string, Record<number, { color: string; name: string }>>> = {}
  for (const entry of entries) {
    const lesson = lessonMap[entry.lessonId]
    if (!lesson) continue
    const subject = subjectMap[lesson.subjectId]
    if (!subject) continue
    for (const classId of lesson.classIds) {
      if (!cellMap[classId]) cellMap[classId] = {}
      if (!cellMap[classId][entry.day]) cellMap[classId][entry.day] = {}
      cellMap[classId][entry.day][entry.slot] = {
        color: subject.color,
        name: subject.name,
      }
    }
  }

  if (gradesLoading || entriesLoading) {
    return <AppShell title="Compact View"><CenteredSpinner /></AppShell>
  }

  return (
    <AppShell
      title="Compact View"
      actions={
        <div className="flex gap-2">
          <Select
            value={scheduleId}
            onChange={e => setSearchParams({ schedule: e.target.value })}
            className="w-48"
          >
            {schedules.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.state === ScheduleState.PUBLISHED ? ' ★' : ''}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            🖨 Print
          </Button>
        </div>
      }
    >
      <div className="overflow-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            {/* Class columns header — grouped by grade */}
            <tr style={{ background: 'var(--surface-2)' }}>
              <th
                className="text-left px-3 py-2 text-[10px] font-bold uppercase"
                style={{ color: 'var(--text-3)', borderBottom: '3px solid var(--border)', borderRight: '3px solid var(--border)', width: 56 }}
              >
                Slot
              </th>
              {gradeClasses.flatMap(({ grade, classes: gc }, gradeIdx) =>
                gc.map((cls, clsIdx) => (
                  <th
                    key={cls.id}
                    className="text-center px-1 py-2 text-[10px] font-bold"
                    style={{
                      color: 'var(--text-1)',
                      borderBottom: '3px solid var(--border)',
                      // Left edge of each grade group: strong separator
                      borderLeft: clsIdx === 0 ? '3px solid #4B5563' : undefined,
                      borderRight: clsIdx === gc.length - 1 ? '3px solid #4B5563' : '1px solid var(--border)',
                      minWidth: 72,
                      background: gradeIdx % 2 === 0 ? 'var(--surface-2)' : 'var(--accent-bg)',
                    }}
                  >
                    {grade.number}{cls.section}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {workDays.flatMap((day, dayIdx) =>
              slots.map(slot => {
                const isFirstSlot = slot === 1
                const isLastSlot = slot === slots[slots.length - 1]
                return (
                  <tr
                    key={`${day}-${slot}`}
                    style={{
                      background: dayIdx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                    }}
                  >
                    {/* Row label: day name on first slot, slot number otherwise */}
                    <td
                      className="px-3 py-1.5 font-bold text-[11px] text-center"
                      style={{
                        borderTop: isFirstSlot ? '3px solid #4B5563' : undefined,
                        borderBottom: isLastSlot ? '3px solid #4B5563' : '1px solid var(--border)',
                        borderRight: '3px solid var(--border)',
                        color: isFirstSlot ? 'var(--text-1)' : 'var(--text-3)',
                      }}
                    >
                      {isFirstSlot ? DAY_SHORT[day] : `S${slot}`}
                    </td>
                    {gradeClasses.flatMap(({ classes: gc }) =>
                      gc.map((cls, clsIdx) => {
                        const cell = cellMap[cls.id]?.[day]?.[slot]
                        return (
                          <td
                            key={cls.id}
                            className="px-0.5 py-0.5"
                            style={{
                              borderTop: isFirstSlot ? '3px solid #4B5563' : undefined,
                              borderBottom: isLastSlot ? '3px solid #4B5563' : '1px solid var(--border)',
                              borderLeft: clsIdx === 0 ? '3px solid #4B5563' : undefined,
                              borderRight: clsIdx === gc.length - 1 ? '3px solid #4B5563' : '1px solid var(--border)',
                              height: 48,
                              width: 72,
                            }}
                          >
                            {cell ? (
                              <div
                                className="w-full h-full rounded flex items-center justify-center text-white text-[9px] font-bold leading-tight px-0.5 text-center"
                                style={{ background: cell.color }}
                                title={cell.name}
                              >
                                {cell.name}
                              </div>
                            ) : (
                              <div
                                className="w-full h-full rounded"
                                style={{ background: 'var(--empty-bg)' }}
                              />
                            )}
                          </td>
                        )
                      })
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-6 flex flex-wrap gap-3">
        {subjects.map(s => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
            <span className="text-[10px] text-[var(--text-2)] hebrew">{s.name}</span>
          </div>
        ))}
      </div>
    </AppShell>
  )
}
