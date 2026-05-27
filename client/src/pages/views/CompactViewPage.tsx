/**
 * CompactViewPage — printable, color-coded schedule overview.
 *
 * Shows the full school week in a compact format:
 *   - All 12 classes as rows
 *   - All 5 days × 4 slots = 20 cells per class
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
  const gradeMap = Object.fromEntries(grades.map(g => [g.id, g]))

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
        <table className="border-collapse text-[10px]" style={{ minWidth: 900 }}>
          <thead>
            {/* Day × slot header */}
            <tr style={{ background: 'var(--surface-2)' }}>
              <th
                className="text-left px-2 py-1.5 text-[9px] font-bold uppercase"
                style={{ color: 'var(--text-3)', borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)', width: 60 }}
              >
                Class
              </th>
              {workDays.flatMap(day =>
                slots.map(slot => (
                  <th
                    key={`${day}-${slot}`}
                    className="text-center px-1 py-1.5 text-[9px] font-bold"
                    style={{
                      color: slot === 1 ? 'var(--text-1)' : 'var(--text-3)',
                      borderBottom: '2px solid var(--border)',
                      borderRight: slot === slots[slots.length - 1] ? '2px solid var(--border)' : '1px solid var(--border)',
                      minWidth: 36,
                      background: slot === 1 ? 'var(--accent-bg)' : 'var(--surface-2)',
                    }}
                  >
                    {slot === 1 ? DAY_SHORT[day] : slot}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {gradeClasses.flatMap(({ grade, classes: gc }, gradeIdx) =>
              gc.map((cls, clsIdx) => (
                <tr
                  key={cls.id}
                  style={{
                    background: gradeIdx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                  }}
                >
                  <td
                    className="px-2 py-1 font-semibold text-[10px]"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      color: 'var(--text-2)',
                    }}
                  >
                    {grade.number}{cls.section}
                  </td>
                  {workDays.flatMap(day =>
                    slots.map(slot => {
                      const cell = cellMap[cls.id]?.[day]?.[slot]
                      return (
                        <td
                          key={`${day}-${slot}`}
                          className="px-0.5 py-0.5"
                          style={{
                            borderBottom: '1px solid var(--border)',
                            borderRight: slot === slots[slots.length - 1] ? '2px solid var(--border)' : '1px solid var(--border)',
                            height: 32,
                            width: 36,
                          }}
                        >
                          {cell ? (
                            <div
                              className="w-full h-full rounded-sm flex items-center justify-center text-white text-[8px] font-bold leading-none px-0.5"
                              style={{ background: cell.color }}
                              title={cell.name}
                            >
                              {/* Show first 3 Hebrew chars */}
                              {cell.name.slice(0, 3)}
                            </div>
                          ) : (
                            <div
                              className="w-full h-full rounded-sm"
                              style={{ background: 'var(--empty-bg)' }}
                            />
                          )}
                        </td>
                      )
                    }),
                  )}
                </tr>
              )),
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
