/**
 * TeacherViewPage — read-only weekly grid filtered by teacher.
 *
 * Shows all 5 days simultaneously (a compact 5-column grid) for one teacher.
 * Columns = days (Sun–Thu), rows = slots (1–4).
 * Each occupied cell shows the class(es) and subject.
 *
 * The teacher selector is a dropdown at the top of the page.
 * This view is useful for checking a specific teacher's weekly schedule
 * for conflicts or to share with the teacher.
 *
 * Milestone 2 will surface this view to teachers via login.
 */

import { Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Select } from '../../components/ui/Select'
import { CenteredSpinner } from '../../components/ui/Spinner'
import { Badge } from '../../components/ui/Badge'
import { useTeachers } from '../../api/teachers'
import { useGrades, useClasses } from '../../api/grades'
import { useSubjects } from '../../api/subjects'
import { useLessons } from '../../api/lessons'
import { useSchedules, useEntries } from '../../api/schedules'
import { useConfig } from '../../api/config'
import { DAY_ORDER, ScheduleState } from '@zmanim/shared'
import type { Day, ScheduleEntry, Lesson } from '@zmanim/shared'

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

interface TeacherGridProps {
  teacherId: string
  scheduleId: string
}

function TeacherGrid({ teacherId, scheduleId }: TeacherGridProps) {
  const { data: entries = [] } = useEntries(scheduleId)
  const { data: lessons = [] } = useLessons()
  const { data: subjects = [] } = useSubjects()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: config } = useConfig()

  if (!config) return <CenteredSpinner />

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const gradeMap = Object.fromEntries(grades.map(g => [g.id, g]))
  const classMap = Object.fromEntries(classes.map(c => [c.id, c]))
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l]))

  // Filter entries to this teacher's lessons
  const teacherLessonIds = new Set(
    lessons.filter(l => l.teacherId === teacherId).map(l => l.id),
  )
  const teacherEntries = entries.filter(e => teacherLessonIds.has(e.lessonId))

  // Build cell map: day → slot → entry
  const cellMap: Record<string, Record<number, ScheduleEntry>> = {}
  for (const entry of teacherEntries) {
    if (!cellMap[entry.day]) cellMap[entry.day] = {}
    cellMap[entry.day][entry.slot] = entry
  }

  const slots = Array.from({ length: config.slotsPerDay }, (_, i) => i + 1)
  const workDays = (config.workDays ?? DAY_ORDER) as Day[]

  function classLabel(lesson: Lesson): string {
    return lesson.classIds
      .map(cid => {
        const cls = classMap[cid]
        const grade = cls ? gradeMap[cls.gradeId] : undefined
        return grade && cls ? `${grade.number}${cls.section}` : '?'
      })
      .join(' + ')
  }

  return (
    <div className="overflow-auto mt-4">
      <table className="border-collapse w-full text-[12px]">
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            <th
              className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-3)', borderBottom: '2px solid var(--border)', width: 70 }}
            >
              Slot
            </th>
            {workDays.map(day => (
              <th
                key={day}
                className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--text-2)', borderBottom: '2px solid var(--border)', minWidth: 140 }}
              >
                {DAY_SHORT[day]}
              </th>
            ))}
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
                    className="px-3 py-2 font-mono text-[11px] text-center align-middle"
                    style={{
                      background: 'var(--surface-2)',
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      color: 'var(--text-2)',
                    }}
                  >
                    <p>{time}</p>
                    <p style={{ color: 'var(--text-3)' }}>S{slot}</p>
                  </td>
                  {workDays.map(day => {
                    const entry = cellMap[day]?.[slot]
                    const lesson = entry ? lessonMap[entry.lessonId] : undefined
                    const subject = lesson ? subjectMap[lesson.subjectId] : undefined

                    return (
                      <td
                        key={day}
                        className="px-2 py-2 align-middle"
                        style={{
                          borderBottom: '1px solid var(--border)',
                          borderRight: '1px solid var(--border)',
                          minWidth: 140,
                          height: 72,
                        }}
                      >
                        {lesson && subject ? (
                          <div
                            className="h-full rounded px-2 py-1.5"
                            style={{
                              borderLeft: `3px solid ${subject.color}`,
                              background: 'var(--card-bg)',
                            }}
                          >
                            <p className="font-semibold hebrew text-[var(--text-1)]">{subject.name}</p>
                            <p className="text-[10px] text-[var(--text-3)]">{classLabel(lesson)}</p>
                          </div>
                        ) : (
                          <div
                            className="h-full rounded flex items-center justify-center"
                            style={{ background: 'var(--empty-bg)', border: '1px dashed var(--empty-border)' }}
                          >
                            <span style={{ color: 'var(--text-3)' }}>—</span>
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
                {recess && (
                  <tr key={`recess-${slot}`}>
                    <td
                      colSpan={workDays.length + 1}
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

export function TeacherViewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: teachers = [], isLoading } = useTeachers()
  const { data: schedules = [] } = useSchedules()

  const publishedSchedule = schedules.find(s => s.state === ScheduleState.PUBLISHED)
  const defaultScheduleId = publishedSchedule?.id ?? schedules[0]?.id ?? ''

  const teacherId  = searchParams.get('teacher')  ?? teachers[0]?.id ?? ''
  const scheduleId = searchParams.get('schedule') ?? defaultScheduleId

  const selectedTeacher  = teachers.find(t => t.id === teacherId)
  const selectedSchedule = schedules.find(s => s.id === scheduleId)

  // Preserve both params when either changes
  const setTeacher  = (id: string) => setSearchParams(p => { p.set('teacher',  id); return p })
  const setSchedule = (id: string) => setSearchParams(p => { p.set('schedule', id); return p })

  if (isLoading) {
    return <AppShell title="Teacher View"><CenteredSpinner /></AppShell>
  }

  return (
    <AppShell title="Teacher View">
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <Select
          label="Teacher"
          value={teacherId}
          onChange={e => setTeacher(e.target.value)}
          className="w-64"
        >
          <option value="">Select teacher…</option>
          {teachers.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
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

      {selectedTeacher && scheduleId ? (
        <>
          <h2 className="text-[16px] font-semibold text-[var(--text-1)] hebrew mb-2">
            {selectedTeacher.name}
          </h2>
          <TeacherGrid teacherId={teacherId} scheduleId={scheduleId} />
        </>
      ) : (
        <p className="text-[var(--text-3)] text-[13px]">
          {!selectedTeacher ? 'Select a teacher to view their schedule.' : 'No schedule available.'}
        </p>
      )}
    </AppShell>
  )
}
