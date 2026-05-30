/**
 * GradeViewPage — read-only weekly grid filtered by grade.
 *
 * Shows the full week (all 5 days) for a single grade (both A and B classes).
 * Layout: rows = slots, columns = days, but TWO sub-columns per day (A/B class).
 *
 * This is the view students and homeroom teachers would use to check
 * the weekly schedule for their grade.
 */

import { Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Select } from '../../components/ui/Select'
import { CenteredSpinner } from '../../components/ui/Spinner'
import { Badge } from '../../components/ui/Badge'
import { useGrades, useClasses } from '../../api/grades'
import { useSubjects } from '../../api/subjects'
import { useTeachers } from '../../api/teachers'
import { useLessons } from '../../api/lessons'
import { useSchedules, useEntries } from '../../api/schedules'
import { useConfig } from '../../api/config'
import { DAY_ORDER, ScheduleState } from '@zmanim/shared'
import type { Day, ScheduleEntry } from '@zmanim/shared'

const DAY_SHORT: Record<Day, string> = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
}

function slotTime(slot: number, startTime: string, lessonDuration: number, recesses: Array<{ afterSlot: number; durationMinutes: number }>): string {
  const [h, m] = startTime.split(':').map(Number)
  let total = h * 60 + m
  for (let s = 1; s < slot; s++) {
    total += lessonDuration
    const r = recesses.find(r => r.afterSlot === s)
    if (r) total += r.durationMinutes
  }
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

interface GradeGridProps {
  gradeId: string
  scheduleId: string
}

function GradeGrid({ gradeId, scheduleId }: GradeGridProps) {
  const { data: entries = [] } = useEntries(scheduleId)
  const { data: lessons = [] } = useLessons()
  const { data: subjects = [] } = useSubjects()
  const { data: teachers = [] } = useTeachers()
  const { data: classes = [] } = useClasses()
  const { data: config } = useConfig()

  if (!config) return <CenteredSpinner />

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]))
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l]))

  // Classes for this grade, sorted A/B
  const gradeClasses = classes
    .filter(c => c.gradeId === gradeId)
    .sort((a, b) => a.section.localeCompare(b.section))

  const workDays = (config.workDays ?? DAY_ORDER) as Day[]
  const slots = Array.from({ length: config.slotsPerDay }, (_, i) => i + 1)

  // Build cell map: classId → day → slot → entry
  const cellMap: Record<string, Record<string, Record<number, ScheduleEntry>>> = {}
  for (const cls of gradeClasses) {
    cellMap[cls.id] = {}
    for (const day of workDays) {
      cellMap[cls.id][day] = {}
    }
  }
  for (const entry of entries) {
    const lesson = lessonMap[entry.lessonId]
    if (!lesson) continue
    for (const classId of lesson.classIds) {
      if (cellMap[classId]?.[entry.day]) {
        cellMap[classId][entry.day][entry.slot] = entry
      }
    }
  }

  return (
    <div className="overflow-auto mt-4">
      <table className="border-collapse text-[12px]" style={{ minWidth: `${70 + workDays.length * gradeClasses.length * 110}px` }}>
        <thead>
          {/* Day group header */}
          <tr style={{ background: 'var(--surface-2)' }}>
            <th style={{ width: 70, borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)' }} />
            {workDays.map(day => (
              <th
                key={day}
                colSpan={gradeClasses.length}
                className="text-[10px] font-bold uppercase tracking-wider text-center py-2"
                style={{ color: 'var(--text-2)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}
              >
                {DAY_SHORT[day]}
              </th>
            ))}
          </tr>
          {/* Class sub-header */}
          <tr style={{ background: 'var(--surface-2)' }}>
            <th style={{ width: 70, borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)', color: 'var(--text-3)' }} className="text-[10px] font-bold px-2 py-1">
              Slot
            </th>
            {workDays.flatMap(day =>
              gradeClasses.map(cls => (
                <th
                  key={`${day}-${cls.id}`}
                  className="text-[10px] font-bold text-center py-1 px-2"
                  style={{ color: 'var(--text-3)', borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)', minWidth: 110 }}
                >
                  Class {cls.section}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {slots.map(slot => {
            const time = slotTime(slot, config.dayStartTime, config.lessonDuration, config.recesses)
            const recess = config.recesses.find(r => r.afterSlot === slot)

            return (
              <Fragment key={slot}>
                <tr>
                  <td
                    className="text-center px-2 py-1 font-mono text-[10px]"
                    style={{
                      background: 'var(--surface-2)',
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      color: 'var(--text-2)',
                      height: 72,
                    }}
                  >
                    {time}
                  </td>
                  {workDays.flatMap(day =>
                    gradeClasses.map(cls => {
                      const entry = cellMap[cls.id]?.[day]?.[slot]
                      const lesson = entry ? lessonMap[entry.lessonId] : undefined
                      const subject = lesson ? subjectMap[lesson.subjectId] : undefined
                      const teacher = lesson ? teacherMap[lesson.teacherId] : undefined

                      return (
                        <td
                          key={`${day}-${cls.id}`}
                          className="px-1 py-1 align-top"
                          style={{
                            borderBottom: '1px solid var(--border)',
                            borderRight: '1px solid var(--border)',
                            minWidth: 110,
                            height: 72,
                          }}
                        >
                          {lesson && subject ? (
                            <div
                              className="h-full rounded px-2 py-1"
                              style={{
                                borderLeft: `3px solid ${subject.color}`,
                                background: 'var(--card-bg)',
                              }}
                            >
                              <p className="font-semibold hebrew text-[11px] text-[var(--text-1)] leading-tight">{subject.name}</p>
                              <p className="text-[10px] text-[var(--text-3)] hebrew leading-tight mt-0.5">{teacher?.name}</p>
                            </div>
                          ) : (
                            <div
                              className="h-full rounded flex items-center justify-center"
                              style={{ border: '1px dashed var(--empty-border)' }}
                            >
                              <span className="text-[var(--text-3)] text-[11px]">—</span>
                            </div>
                          )}
                        </td>
                      )
                    }),
                  )}
                </tr>
                {recess && (
                  <tr key={`recess-${slot}`}>
                    <td
                      colSpan={1 + workDays.length * gradeClasses.length}
                      className="text-[10px] italic text-center py-1"
                      style={{
                        background: 'var(--recess-bg)',
                        color: 'var(--recess-text)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {recess.durationMinutes}m recess
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

export function GradeViewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: grades = [], isLoading } = useGrades()
  const { data: schedules = [] } = useSchedules()

  const publishedSchedule = schedules.find(s => s.state === ScheduleState.PUBLISHED)
  const defaultScheduleId = publishedSchedule?.id ?? schedules[0]?.id ?? ''

  const gradeId    = searchParams.get('grade')    ?? grades[0]?.id ?? ''
  const scheduleId = searchParams.get('schedule') ?? defaultScheduleId

  const selectedGrade    = grades.find(g => g.id === gradeId)
  const selectedSchedule = schedules.find(s => s.id === scheduleId)

  // Preserve both params when either changes
  const setGrade    = (id: string) => setSearchParams(p => { p.set('grade',    id); return p })
  const setSchedule = (id: string) => setSearchParams(p => { p.set('schedule', id); return p })

  if (isLoading) {
    return <AppShell title="Grade View"><CenteredSpinner /></AppShell>
  }

  return (
    <AppShell title="Grade View">
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <Select
          label="Grade"
          value={gradeId}
          onChange={e => setGrade(e.target.value)}
          className="w-48"
        >
          <option value="">Select grade…</option>
          {[...grades].sort((a, b) => a.number - b.number).map(g => (
            <option key={g.id} value={g.id}>Grade {g.number}</option>
          ))}
        </Select>

        <Select
          label="Schedule"
          value={scheduleId}
          onChange={e => setSchedule(e.target.value)}
          className="w-64"
        >
          {schedules.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}{s.state === ScheduleState.PUBLISHED ? ' ★' : ''}
            </option>
          ))}
        </Select>

        {selectedSchedule && (
          <div className="mb-0.5">
            <Badge variant={selectedSchedule.state === ScheduleState.PUBLISHED ? 'published' : 'draft'}>
              {selectedSchedule.state === ScheduleState.PUBLISHED ? 'Published' : 'Draft'}
            </Badge>
          </div>
        )}
      </div>

      {selectedGrade && scheduleId ? (
        <>
          <h2 className="text-[16px] font-semibold text-[var(--text-1)] mb-2">
            Grade {selectedGrade.number}
          </h2>
          <GradeGrid gradeId={gradeId} scheduleId={scheduleId} />
        </>
      ) : (
        <p className="text-[var(--text-3)] text-[13px]">Select a grade to view its schedule.</p>
      )}
    </AppShell>
  )
}
